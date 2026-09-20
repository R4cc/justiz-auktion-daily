import { Accounts, AccountError } from './accounts.mjs';
import { caseRewards, loadCaseCatalog, publicCaseCatalog, rotationDate } from './cases.mjs';
import { readArchive } from './database.mjs';
import { higherLowerDeck } from './higher-lower.mjs';
import { auctionGallery } from './auction-images.mjs';
import { featureFlags } from './features.mjs';
import { saveNewsEvent } from './news.mjs';
import { bidOnPaletteAuction, createPaletteAuction, getPaletteAuctionRewards, paletteAuctionsByUser } from './palette-auctions.mjs';
import { cancelListing, listItem, listingsByUser, placeBid } from './resale.mjs';
import { maskLeaderboard } from './username-privacy.mjs';
import { markNotificationsRead, notificationsForUser } from './notifications.mjs';

const AUCTION_PAGE_SIZE = 25;

function auctionBasics(auction) {
  const gallery = auctionGallery(auction);
  return { id: auction.id, title: auction.title, category: auction.category,
    currentBid: auction.currentBid, finalPrice: auction.finalPrice ?? null,
    endAt: auction.endAt || null, bidCount: auction.bidCount || 0,
    image: gallery[0] || auction.image || null, imageCount: gallery.length };
}

function auctionDetail(auction) {
  return { ...auctionBasics(auction), description: auction.description || '',
    startBid: auction.startBid ?? 0, condition: auction.condition || null,
    fulfillment: auction.fulfillment || null, location: auction.location || null,
    url: auction.url || null, capturedAt: auction.capturedAt || null,
    images: auctionGallery(auction), correctPrice: auction.finalPrice ?? auction.currentBid };
}

function searchAuctions(auctions, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return auctions;
  return auctions.filter(auction => [auction.title, auction.description, auction.category, auction.id]
    .some(value => String(value ?? '').toLowerCase().includes(needle)));
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AccountError('json_required', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new AccountError('body_too_large', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AccountError('invalid_json'); }
}

export async function createAccountApi({ dataDir, dailyPayload, json, env = process.env, flags = featureFlags(env) }) {
  const accounts = new Accounts(dataDir, { flags });
  await accounts.bootstrap(env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
  const secure = env.COOKIE_SECURE !== 'false' && (env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production');
  const cookie = token => `jg_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 2592000 : 0}${secure ? '; Secure' : ''}`;
  let catalog;
  function getCatalog() {
    if (!catalog || catalog.rotationDate !== rotationDate()) catalog = loadCaseCatalog(dataDir);
    return catalog;
  }
  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/account/')) return false;
    try {
      const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jg_session='))?.slice(11);
      const user = accounts.user(token);
      const route = url.pathname.slice('/api/account/'.length);
      if (request.method === 'GET') {
        if (route === 'me') json(response, 200, { user: user ? accounts.profile(user) : null });
        else if (route === 'cases') json(response, 200, publicCaseCatalog(getCatalog()));
        else if (route === 'leaderboard') {
          // Public page: only signed-in viewers get uncensored names.
          const board = accounts.leaderboard();
          json(response, 200, user ? board : maskLeaderboard(board));
        }
        else {
          if (!user) throw new AccountError('login_required', 401);
          if (route === 'inventory') json(response, 200, { items: accounts.inventory(user) });
          else if (route === 'notifications') json(response, 200, notificationsForUser(dataDir, user.id));
          else if (route === 'resale/listings' && flags.resales) json(response, 200, { listings: listingsByUser(dataDir, user.id) });
          else if (route === 'palette-auctions' && flags.paletteAuctions) json(response, 200, { auctions: paletteAuctionsByUser(dataDir, user, { limit: Number(url.searchParams.get('limit')) || 50, offset: Number(url.searchParams.get('offset')) || 0 }) });
          else if (route === 'friends') json(response, 200, accounts.friends(user));
          else if (route === 'codes') json(response, 200, { codes: accounts.listCodes(user) });
          else if (route === 'admin') json(response, 200, accounts.adminOverview(user));
          else if (route === 'admin/auctions') {
            if (!user.admin) throw new AccountError('forbidden', 403);
            const matches = searchAuctions(readArchive(dataDir).auctions, url.searchParams.get('query') || '');
            const pages = Math.max(1, Math.ceil(matches.length / AUCTION_PAGE_SIZE));
            const page = Math.min(Math.max(1, Number(url.searchParams.get('page')) || 1), pages);
            json(response, 200, { total: matches.length, page, pages, pageSize: AUCTION_PAGE_SIZE,
              auctions: matches.slice((page - 1) * AUCTION_PAGE_SIZE, page * AUCTION_PAGE_SIZE).map(auctionBasics) });
          }
          else if (route.startsWith('admin/auctions/')) {
            if (!user.admin) throw new AccountError('forbidden', 403);
            const auction = readArchive(dataDir).auctions.find(entry => String(entry.id) === route.slice('admin/auctions/'.length));
            if (!auction) throw new AccountError('auction_not_found', 404);
            json(response, 200, { auction: auctionDetail(auction) });
          }
          else if (flags.paletteAuctions && route.startsWith('palette-auctions/') && route.endsWith('/rewards')) {
            // Winner-only reveal; the domain owns every rule (deadline,
            // settlement, non-winner genericity) — this branch only decodes
            // the id safely, like the resale detail route.
            const raw = route.slice('palette-auctions/'.length, -'/rewards'.length);
            let id = raw;
            try { id = decodeURIComponent(raw); } catch { /* keep raw */ }
            json(response, 200, { reveal: getPaletteAuctionRewards(dataDir, user, id) });
          }
          else throw new AccountError('not_found', 404);
        }
        return true;
      }
      if (request.method !== 'POST') throw new AccountError('method_not_allowed', 405);
      // Cross-site forms cannot set this header; CORS is deliberately not enabled.
      if (request.headers['x-requested-with'] !== 'JUSTIZGUESSR' || request.headers['sec-fetch-site'] === 'cross-site') throw new AccountError('forbidden', 403);
      if (['login', 'register'].includes(route)) accounts.throttle(`auth:${request.socket.remoteAddress}`, 60);
      else if (user) accounts.throttle(`mutate:${user.id}`, 500);
      const payload = await body(request);
      if (route === 'login' || route === 'register') {
        const nextToken = await accounts[route](payload);
        if (token) accounts.logout(token);
        response.setHeader('set-cookie', cookie(nextToken));
        json(response, 200, { user: accounts.profile(accounts.user(nextToken)) });
        return true;
      }
      if (!user) throw new AccountError('login_required', 401);
      let result;
      if (route === 'logout') {
        accounts.logout(token);
        response.setHeader('set-cookie', cookie(''));
        result = { user: null };
      } else if (route === 'codes') result = { codes: accounts.codes(user, payload.count) };
      else if (route === 'notifications/read') result = markNotificationsRead(dataDir, user.id, payload.ids);
      else if (route === 'admin/grant-tokens') result = { grant: accounts.grantTokens(user, payload.amount, payload.requestId), user: accounts.profile(user) };
      else if (route === 'admin/grant-user-tokens') result = { grant: accounts.grantUserTokens(user, payload.userId, payload.amount, payload.requestId), user: accounts.profile(user) };
      else if (route === 'admin/ban') result = { ban: accounts.banUser(user, payload.userId, payload.banned) };
      else if (route === 'admin/reset-economy') result = { reset: accounts.resetEconomy(user, payload.confirmation), user: accounts.profile(user) };
      else if (route === 'admin/news' && flags.news) {
        if (!user.admin) throw new AccountError('forbidden', 403);
        result = { event: saveNewsEvent(dataDir, payload) };
      }
      else if (flags.resales && route === 'resale/listings') {
        result = { listing: listItem(dataDir, user, payload), user: accounts.profile(user) };
      }
      else if (flags.resales && route === 'resale/bid') result = { listing: placeBid(dataDir, user, payload.id, payload.amount), user: accounts.profile(user) };
      else if (flags.resales && route === 'resale/cancel') result = { listing: cancelListing(dataDir, user, payload.id), user: accounts.profile(user) };
      else if (flags.paletteAuctions && route === 'palette-auctions/bid') {
        // Thin adapter: level gate, escrow, minimum bid, deadline and ban
        // handling all live in the domain function.
        result = { auction: bidOnPaletteAuction(dataDir, user, payload.id, payload.amount), user: accounts.profile(user) };
      }
      else if (flags.paletteAuctions && route === 'admin/palette-auctions') {
        // Narrow test/operations surface for trusted lot creation. Only
        // editionId and requestId reach the domain; callers cannot inject a
        // reserve, rewards, duration, level, valuation, winner or seed.
        if (!user.admin) throw new AccountError('forbidden', 403);
        result = { auction: createPaletteAuction(dataDir, { editionId: payload.editionId, requestId: payload.requestId }) };
      }
      else if (route === 'friends/request') {
        accounts.throttle(`friend-request:${user.id}`, 20);
        accounts.requestFriend(user, payload.username); result = accounts.friends(user);
      } else if (route === 'friends/accept') { accounts.acceptFriend(user, payload.id); result = accounts.friends(user); }
      else if (route === 'friends/remove') { accounts.removeFriend(user, payload.id); result = accounts.friends(user); }
      else if (route === 'codes/revoke') { accounts.revokeCode(user, payload.id); result = { ok: true }; }
      else if (route === 'cases/open') {
        if (typeof payload.revision !== 'string') throw new AccountError('catalog_changed', 409);
        result = { item: accounts.openCase(user, getCatalog(), payload.caseId, payload.requestId, payload.revision), user: accounts.profile(user) };
      }
      else if (route === 'inventory/sell') result = { ...accounts.sell(user, payload.id), user: accounts.profile(user) };
      else if (route === 'inventory/sell-all') result = { ...accounts.sellAll(user, payload.id), user: accounts.profile(user) };
      else if (route === 'games/start') {
        const auctions = payload.mode === 'daily' ? (await dailyPayload()).auctions : null;
        result = { run: accounts.startGame(user, payload.mode, () => auctions || higherLowerDeck(readArchive(dataDir).auctions).auctions, caseRewards(getCatalog())), user: accounts.profile(user) };
      } else if (route === 'games/answer') result = { run: accounts.answer(user, payload.id, payload.position, payload.answer), user: accounts.profile(user) };
      else throw new AccountError('not_found', 404);
      json(response, 200, result);
    } catch (error) {
      if (error instanceof AccountError) json(response, error.status, { error: error.message });
      else if (error.code === 'insufficient_variety') json(response, 503, { error: 'insufficient_variety' });
      else {
        console.error('Account API failed');
        json(response, 500, { error: 'internal_error' });
      }
    }
    return true;
  };
}
