import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { maskListing, maskUsername } from '../src/username-privacy.mjs';
import { marketState } from '../src/market.mjs';
import { featureFlags } from '../src/features.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { Accounts } from '../src/accounts.mjs';
import { checkStoreEvents } from '../src/store-events.mjs';
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';

const password = 'economy-foundation-password';
const lots = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `Product ${i + 100}`,
  category: 'Werkzeug', image: `/assets/${i}.jpg`, currentBid: 100 + i }));
const env = {
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true',
  FEATURE_NEWS: '1', FEATURE_MARKET: 'yes', FEATURE_RESALES: 'true', FEATURE_PALETTES: 'on'
};

async function fixture(t, flags = env) {
  flags = { ...{ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }, ...flags };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-economy-'));
  upsertAuctions(dir, lots);
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const testFlags = { ...featureFlags(flags), news: flags.FEATURE_NEWS === '1' };
  const economyApi = createEconomyApi({ dataDir: dir, json, flags: testFlags });
  const accountApi = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: lots.slice(0, 5) }), json, env: flags, flags: testFlags });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await economyApi(req, res, url)) return;
    if (await accountApi(req, res, url)) return;
    json(res, 404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeIdleConnections?.();
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections?.();
    closeDataStore(dir);
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, base: `http://127.0.0.1:${server.address().port}`, server };
}

const post = (base, route, value, cookie = '') => fetch(`${base}/api/account/${route}`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR', cookie }, body: JSON.stringify(value) });

test('public storefronts and player interactions use feature flags, sessions, CSRF and atomic live stock', async t => {
  const { base, dir } = await fixture(t);
  const accounts = new Accounts(dir), time = Date.now();
  const ownerCookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  const owner = accounts.db(db => db.prepare("SELECT id FROM users WHERE username = 'admin'").get());
  accounts.db(db => {
    db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(owner.id);
    for (let n = 0; n < 3; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`http-wine-${n}`, owner.id, JSON.stringify({ title: 'API Wine', price: 100, marketCategory: 'wine' }), time);
  });
  const shop = buyBusiness(dir, owner, 'wine', 'popup', { now: time }).shop;
  stockBusiness(dir, owner, shop.id, ['http-wine-0','http-wine-1','http-wine-2'], { now: time });
  const codes = (await (await post(base, 'codes', { count: 2 }, ownerCookie)).json()).codes;
  const buyerCookie = (await post(base, 'register', { username: 'StoreBuyer', password, code: codes[0] })).headers.get('set-cookie');
  const rivalCookie = (await post(base, 'register', { username: 'StoreRival', password, code: codes[1] })).headers.get('set-cookie');
  assert.equal((await (await fetch(`${base}/api/stores`)).json()).stores[0].owner, 'ad****');
  const view = async cookie => (await (await fetch(`${base}/api/stores/${shop.id}`, { headers: { cookie } })).json()).store;
  assert.equal((await view(buyerCookie)).owner, 'admin');
  const payload = { shopId: shop.id, inventoryId: 'http-wine-0', expectedPrice: 120, requestId: 'store-http-purchase-0001' };
  assert.equal((await post(base, 'stores/buy', payload)).status, 401);
  assert.equal((await fetch(`${base}/api/account/stores/buy`, { method: 'POST', headers: { cookie: buyerCookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  const [buyer, rival] = await Promise.all([post(base, 'stores/buy', payload, buyerCookie), post(base, 'stores/buy', { ...payload, requestId: 'store-http-rival-000001' }, rivalCookie)]);
  assert.deepEqual([buyer.status, rival.status].sort(), [200,409]);
  const winnerCookie = buyer.status === 200 ? buyerCookie : rivalCookie, winningPayload = buyer.status === 200 ? payload : { ...payload, requestId: 'store-http-rival-000001' };
  const replay = await post(base, 'stores/buy', winningPayload, winnerCookie);
  assert.equal(replay.status, 200); assert.equal((await view(winnerCookie)).stock.length, 2);
  assert.equal((await post(base, 'stores/review', { shopId: shop.id, stars: 5, comment: 'Great shop!' }, winnerCookie)).status, 200);
  assert.equal((await view(winnerCookie)).reviewCount, 1);
  assert.equal((await post(base, 'stores/visit', { shopId: shop.id }, winnerCookie)).status, 200);
  assert.equal((await post(base, 'stores/react', { shopId: shop.id, reaction: 'bell' }, winnerCookie)).status, 200);
  const start = await post(base, 'stores/heist/start', { ...payload, inventoryId: 'http-wine-1', expectedFee: 10, expectedChance: 29, requestId: 'store-http-heist-000001' }, winnerCookie);
  assert.equal(start.status, 200);
  const { store: { heist } } = await start.json();
  assert.ok(heist.sequence.length === 6); assert.ok(!('roll' in heist));
  assert.equal((await view('')).heist, null);
  assert.equal((await post(base, 'stores/heist/finish', { heistId: heist.id, moves: heist.sequence, won: true }, winnerCookie)).status, 409);
  accounts.db(db => db.prepare('UPDATE store_heists SET ready_at = ?, roll = 0 WHERE id = ?').run(time - 1, heist.id));
  const finish = await post(base, 'stores/heist/finish', { heistId: heist.id, moves: heist.sequence }, winnerCookie);
  assert.equal(finish.status, 200); assert.equal((await finish.json()).heist.outcome, 'stolen');
  const hidden = createEconomyApi({ dataDir: dir, json: () => {}, flags: { ...featureFlags({}), businesses: false } });
  assert.equal(hidden({ method: 'GET' }, null, new URL('/api/stores', base)), false);
  assert.equal(hidden({ method: 'GET' }, null, new URL(`/api/stores/${shop.id}`, base)), false);
});

test('disabled businesses hide authenticated store interactions', async t => {
  const { base } = await fixture(t, { ...env, FEATURE_BUSINESSES: 'false' });
  const cookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  for (const route of ['stores/buy','stores/heist/start','stores/review','stores/visit','businesses/profile']) assert.equal((await post(base, route, {}, cookie)).status, 404);
  assert.equal((await fetch(`${base}/api/stores`)).status, 404);
});

test('admin market controls enforce sessions, authority and CSRF and safely replay concurrent adjustments', async t => {
  const { base } = await fixture(t);
  const read = cookie => fetch(`${base}/api/account/admin/market`, { headers: { cookie } });
  assert.equal((await read('')).status, 401);
  const cookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  const code = (await (await post(base, 'codes', { count: 1 }, cookie)).json()).codes[0];
  const player = (await post(base, 'register', { username: 'MarketPlayer', password, code })).headers.get('set-cookie');
  const change = { category: 'wine', percent: -80, requestId: 'market-http-change-0001' };
  assert.equal((await read(player)).status, 403);
  assert.equal((await post(base, 'admin/market/adjust', change, player)).status, 403);
  assert.equal((await post(base, 'admin/market/adjust', change)).status, 401);
  assert.equal((await fetch(`${base}/api/account/admin/market/adjust`, { method: 'POST',
    headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(change) })).status, 403);
  const before = await (await read(cookie)).json();
  assert.equal(before.categories.length, 14);
  assert.ok(before.presets.includes(-80) && before.presets.includes(5) && before.presets.includes(10));
  const responses = await Promise.all([post(base, 'admin/market/adjust', change, cookie), post(base, 'admin/market/adjust', change, cookie)]);
  for (const response of responses) assert.equal(response.status, 200);
  const [first, replay] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(first.adjustment, replay.adjustment);
  const after = await (await read(cookie)).json();
  assert.equal(after.history.length, 1);
  assert.ok(Math.abs(after.categories.find(c => c.id === 'wine').currentIndex - 20) < .01);
  assert.deepEqual(after.categories.filter(c => c.id !== 'wine'), before.categories.filter(c => c.id !== 'wine'));
  const publicMarket = await (await fetch(`${base}/api/market`)).json();
  assert.ok(Math.abs(publicMarket.categories.find(c => c.category === 'wine').currentIndex - 20) < .01);
  assert.equal((await post(base, 'admin/market/adjust', { ...change, percent: 5 }, cookie)).status, 409);
  assert.equal((await post(base, 'admin/market/adjust', { ...change, percent: '-80' }, cookie)).status, 400);
  const reset = await post(base, 'admin/market/adjust', { category: 'wine', action: 'reset', requestId: 'market-http-reset-00001' }, cookie);
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).market.categories.find(c => c.id === 'wine').currentIndex, 100);
});

test('admin market controls remain available when the public market flag is disabled', async t => {
  const { base } = await fixture(t, { ...env, FEATURE_MARKET: 'false' });
  const cookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  assert.equal((await fetch(`${base}/api/market`)).status, 404);
  assert.equal((await fetch(`${base}/api/account/admin/market`, { headers: { cookie } })).status, 200);
  const response = await post(base, 'admin/market/adjust', { category: 'wine', percent: 10, requestId: 'market-disabled-000001' }, cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).market.categories.find(c => c.id === 'wine').currentIndex, 110);
});

test('disabled feature flags fall through so unfinished systems stay invisible', () => {
  const handler = createEconomyApi({ dataDir: 'unused', json: () => {}, flags: featureFlags({ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }) });
  for (const path of ['/api/news', '/api/market', '/api/palettes', '/api/resales', '/api/resales/abc']) {
    assert.equal(handler({ method: 'GET' }, null, new URL(path, 'http://localhost')), false);
  }
  assert.equal(handler({ method: 'POST' }, null, new URL('/api/news', 'http://localhost')), false);
});

test('economy endpoints expose news, global market, palettes and resale listings', async t => {
  const { dir, base, server } = await fixture(t);
  const endsAt = new Date(Date.now() + 3600_000).toISOString();
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  // Admin news tooling seeds the public feed with a real market effect.
  const news = await post(base, 'admin/news', { id: 'news-tool-bust', title: 'Tool importer busted',
    body: 'Seized tools will be auctioned soon.', status: 'published',
    marketEffects: [{ category: 'tools', direction: 'down', magnitude: 4 }] }, cookie);
  assert.equal(news.status, 200);
  const publicNews = await (await fetch(`${base}/api/news`)).json();
  assert.deepEqual(publicNews.news.map(item => item.id), ['news-tool-bust']);
  assert.deepEqual(publicNews.news[0].marketEffects, [{ category: 'tools', direction: 'down', magnitude: 4 }]);
  // Non-admins cannot seed news; bad events are rejected.
  assert.equal((await post(base, 'admin/news', { title: 'x', body: 'y' })).status, 401);
  assert.equal((await post(base, 'admin/news', { title: '', body: 'y' }, cookie)).status, 400);
  assert.equal((await post(base, 'admin/news', { id: 'x', title: 'x', body: 'y', status: 'published',
    marketEffects: [{ category: 'tools', direction: 'down' }] }, cookie)).status, 400);
  const market = await (await fetch(`${base}/api/market`)).json();
  assert.ok(market.categories.length >= 8);
  // The publication moved its category deterministically; the rest stays neutral.
  assert.equal(market.categories.find(category => category.category === 'tools').currentIndex, 96);
  assert.ok(market.categories.filter(category => category.category !== 'tools')
    .every(category => category.currentIndex === 100 && category.baseIndex === 100));
  const palettes = await (await fetch(`${base}/api/palettes`)).json();
  assert.ok(palettes.palettes.some(palette => palette.id === 'fundkiste'));
  assert.doesNotMatch(JSON.stringify(palettes), /"(?:odds|weights|chance)":/);
  // The persisted edition catalog exposes frozen edition metadata and no
  // purchase path.
  const fundkiste = palettes.palettes.find(palette => palette.id === 'fundkiste');
  assert.equal(fundkiste.kind, 'base');
  assert.equal(fundkiste.rewardCount, 3);
  assert.equal(fundkiste.acquisitionMode, 'auction');
  assert.equal(fundkiste.purchasable, false);
  assert.ok(fundkiste.editionId.startsWith('base:fundkiste:'));
  assert.ok(fundkiste.story.fictional);
  assert.equal(fundkiste.available, fundkiste.availability === 'available');
  // Resale flow over HTTP: list an owned item, see it publicly, sell attempt blocked.
  const catalogResponse = await (await fetch(`${base}/api/account/cases`)).json();
  const opened = await (await post(base, 'cases/open', { caseId: 'fundkiste', requestId: 'economy-open-000001',
    revision: catalogResponse.revision }, cookie)).json();
  const listing = await (await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 40, endsAt }, cookie)).json();
  assert.equal(listing.listing.status, 'active');
  const marketplace = (await (await fetch(`${base}/api/resales`)).json()).listings;
  assert.ok(marketplace.some(row => row.id === listing.listing.id));
  // This fixture has only tools, so the business supplier has no eligible
  // auction records and must not invent stock lots.
  assert.equal(marketplace.filter(row => row.sellerUsername === 'St****').length, 0);
  const detail = await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json();
  assert.equal(detail.listing.item.marketCategory, 'tools');
  assert.deepEqual(detail.listing.bids, []);
  // Guests only ever see censored seller names; sessions see the real ones.
  assert.equal((await (await fetch(`${base}/api/resales`)).json()).listings
    .find(row => row.id === listing.listing.id).sellerUsername, 'ad****');
  assert.equal((await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json()).listing.sellerUsername, 'ad****');
  assert.equal((await (await fetch(`${base}/api/resales`, { headers: { cookie } })).json()).listings
    .find(row => row.id === listing.listing.id).sellerUsername, 'admin');
  assert.equal((await (await post(base, 'inventory/sell', { id: opened.item.id }, cookie)).json()).error, 'instant_sell_disabled');
  assert.equal((await fetch(`${base}/api/account/resale/listings`)).status, 401);
  assert.equal((await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 40, endsAt })).status, 401);
  const own = await (await fetch(`${base}/api/account/resale/listings`, { headers: { cookie } })).json();
  assert.deepEqual(own.listings.map(row => row.id), [listing.listing.id]);
  assert.equal((await (await post(base, 'resale/cancel', { id: listing.listing.id }, cookie)).json()).listing.status, 'cancelled');
  assert.equal((await fetch(`${base}/api/resales/missing`)).status, 404);
});

test('marketplace bidder names are censored for guests and full for signed-in players', async t => {
  const { base } = await fixture(t);
  const endsAt = new Date(Date.now() + 3600_000).toISOString();
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  const code = (await (await post(base, 'codes', { count: 1 }, cookie)).json()).codes[0];
  const join = await post(base, 'register', { username: 'Bidder01', password: 'economy-bidder-password-123', code });
  assert.equal(join.status, 200);
  const bidderCookie = join.headers.get('set-cookie');
  const catalogResponse = await (await fetch(`${base}/api/account/cases`)).json();
  const opened = await (await post(base, 'cases/open', { caseId: 'fundkiste', requestId: 'economy-open-000002',
    revision: catalogResponse.revision }, cookie)).json();
  const listing = await (await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 5, endsAt }, cookie)).json();
  const bid = await (await post(base, 'resale/bid', { id: listing.listing.id, amount: 7 }, bidderCookie)).json();
  assert.equal(bid.listing.currentBid, 5);
  const guest = await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json();
  assert.equal(guest.listing.sellerUsername, 'ad****');
  assert.deepEqual(guest.listing.bids.map(row => row.bidderUsername), ['Bi****']);
  const signedIn = await (await fetch(`${base}/api/resales/${listing.listing.id}`, { headers: { cookie: bidderCookie } })).json();
  assert.equal(signedIn.listing.sellerUsername, 'admin');
  assert.deepEqual(signedIn.listing.bids.map(row => row.bidderUsername), ['Bidder01']);
});

test('archived marketplace bids are authenticated, flag-gated and start empty', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/api/account/resale/bids/archived`)).status, 401);
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  const archived = await (await fetch(`${base}/api/account/resale/bids/archived`, { headers: { cookie } })).json();
  assert.deepEqual(archived, { listings: [] });
});

test('username censoring keeps a short prefix and never reveals short names whole', () => {
  assert.equal(maskUsername('admin'), 'ad****');
  assert.equal(maskUsername('mira fund'), 'mi****');
  assert.equal(maskUsername('bob'), 'b****');
  assert.equal(maskUsername('jo'), 'j****');
  assert.equal(maskUsername('x'), '****');
  assert.equal(maskUsername(null), null);
  assert.deepEqual(maskListing({ id: 1, sellerUsername: 'admin', bids: [{ amount: 7, bidderUsername: 'mira fund' }] }),
    { id: 1, sellerUsername: 'ad****', bids: [{ amount: 7, bidderUsername: 'mi****' }] });
  assert.equal(maskListing({ id: 2, sellerUsername: null }).sellerUsername, null);
});

test('account api hides resale routes entirely while the resales flag is off', async t => {
  const { base, server } = await fixture(t, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true' });
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await fetch(`${base}/api/account/resale/listings`, { headers: { cookie } })).status, 404);
  assert.equal((await post(base, 'resale/listings', { inventoryId: 'x', startPrice: 1, endsAt: 'nope' }, cookie)).status, 404);
  assert.equal((await fetch(`${base}/api/news`)).status, 404);
  assert.equal((await fetch(`${base}/api/market`)).status, 404);
  assert.equal((await fetch(`${base}/api/palettes`)).status, 404);
  assert.equal((await fetch(`${base}/api/resales`)).status, 404);
});

test('publication registers market effects even while the market endpoint is hidden', async t => {
  const { dir, base } = await fixture(t, {
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true',
    FEATURE_NEWS: '1' // market flag deliberately off
  });
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await fetch(`${base}/api/market`)).status, 404);
  const news = await (await post(base, 'admin/news', { id: 'hidden-market-bust', title: 'Wine cellar seized',
    body: 'B.', status: 'published', marketEffects: [{ category: 'wine', direction: 'up', magnitude: 6 }] }, cookie)).json();
  assert.equal(news.event.status, 'published');
  const state = marketState(dir);
  assert.equal(state.categories.find(category => category.category === 'wine').currentIndex, 106);
});


test('both instant-sell HTTP paths reject unlisted items with resales enabled, legacy mode still sells', async t => {
  for (const enabled of [true, false]) {
    const { base } = await fixture(t, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, FEATURE_RESALES: enabled ? '1' : '0' });
    const login = await post(base, 'login', { username: 'admin', password });
    const cookie = login.headers.get('set-cookie');
    const catalog = await fetch(base + '/api/account/cases').then(r => r.json());
    const opened = await post(base, 'cases/open', { caseId: 'fundkiste', requestId: 'instant-guard-00001', revision: catalog.revision }, cookie).then(r => r.json());
    for (const route of ['inventory/sell', 'inventory/sell-all']) {
      const response = await post(base, route, { id: opened.item.id }, cookie);
      assert.equal(response.status, enabled ? 409 : 200);
      if (enabled) assert.equal((await response.json()).error, 'instant_sell_disabled');
    }
  }
});

test('case store stays public with auction features on or off and purchases sealed cases over HTTP', async t => {
  for (const enabled of ['true', 'false']) {
    const { base } = await fixture(t, { ...env, FEATURE_PALETTE_AUCTIONS: enabled, FEATURE_RESALES: enabled });
    const quote = await (await fetch(`${base}/api/account/case-store`)).json();
    assert.deepEqual(quote.cases.map(box => box.id), ['lost-property', 'evidence-locker', 'seizure', 'vault', 'collectors-cache']);
    assert.doesNotMatch(JSON.stringify(quote), /"(?:reward|weights|odds|chance)":/);
    const payload = { caseId: 'lost-property', requestId: 'http-case-purchase-0001', revision: quote.revision };
    assert.equal((await post(base, 'cases/buy', payload)).status, 401);
    const login = await post(base, 'login', { username: 'admin', password });
    const cookie = login.headers.get('set-cookie');
    assert.equal((await post(base, 'cases/buy', { ...payload, revision: undefined }, cookie)).status, 409);
    const before = (await (await fetch(`${base}/api/account/me`, { headers: { cookie } })).json()).user.tokens;
    const results = await Promise.all([post(base, 'cases/buy', payload, cookie), post(base, 'cases/buy', payload, cookie)]);
    assert.ok(results.every(response => response.status === 200));
    const [first, retry] = await Promise.all(results.map(response => response.json()));
    assert.deepEqual(retry.item, first.item);
    assert.equal(first.user.tokens, before - quote.cases[0].cost);
    assert.equal(first.item.kind, 'case'); assert.equal(first.item.caseType, 'lost-property');
    assert.ok(!('reward' in first.item) && !('auctionId' in first.item));
    const inventory = await (await fetch(`${base}/api/account/inventory`, { headers: { cookie } })).json();
    assert.equal(inventory.items.length, 1); assert.equal(inventory.items[0].id, first.item.id);
    const opened = await post(base, 'inventory/case/open', { id: first.item.id }, cookie);
    assert.equal(opened.status, 200);
    assert.ok((await opened.json()).item.auctionId);
    assert.equal((await post(base, 'cases/buy', { ...payload, caseId: 'seizure' }, cookie)).status, 409);
  }
});


test('store events and the three-store cap use live sessions, CSRF, private results and idempotent acknowledgement', async t => {
  const { base, dir } = await fixture(t);
  const accounts = new Accounts(dir), time = Date.now();
  const ownerCookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  const owner = accounts.db(db => db.prepare("SELECT id FROM users WHERE username = 'admin'").get());
  accounts.db(db => db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(owner.id));
  const shop = buyBusiness(dir, owner, 'wine', 'popup', { now: time }).shop;
  buyBusiness(dir, owner, 'wine', 'popup', { now: time });
  buyBusiness(dir, owner, 'toys', 'popup', { now: time });
  const before = accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);
  const capped = await post(base, 'businesses/buy', { type: 'electronics', size: 'popup' }, ownerCookie);
  assert.equal(capped.status,409); assert.equal((await capped.json()).error,'store_limit_reached');
  assert.equal(accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),before);
  accounts.db(db => db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)').run('event-api-item',owner.id,JSON.stringify({title:'Event wine',price:100,marketCategory:'wine'}),time));
  stockBusiness(dir,owner,shop.id,['event-api-item'],{now:time});
  accounts.db(db => db.prepare('UPDATE businesses SET bought_at=?, last_tick_at=?, traffic_popularity=0 WHERE id=?').run(time-2*86400000,time,shop.id));
  const event = checkStoreEvents(dir,owner,{now:time,random:()=>0}).events[0];
  assert.equal((await post(base,'stores/events/check',{})).status,401);
  assert.equal((await fetch(base+'/api/account/stores/events/acknowledge',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:JSON.stringify({ids:[event.id]})})).status,403);
  const code=(await (await post(base,'codes',{count:1},ownerCookie)).json()).codes[0];
  const rivalCookie=(await post(base,'register',{username:'EventRival',password,code})).headers.get('set-cookie');
  assert.deepEqual((await (await post(base,'stores/events/check',{},rivalCookie)).json()).events,[]);
  await post(base,'stores/events/acknowledge',{ids:[event.id]},rivalCookie);
  const pending=(await (await post(base,'stores/events/check',{event:'windfall',random:0,shopId:shop.id},ownerCookie)).json()).events;
  assert.equal(pending.length,1); assert.equal(pending[0].type,'bombing');
  assert.equal((await post(base,'stores/events/acknowledge',{ids:[]},ownerCookie)).status,400);
  assert.deepEqual((await (await post(base,'stores/events/acknowledge',{ids:[event.id]},ownerCookie)).json()).events,[]);
  assert.deepEqual((await (await post(base,'stores/events/acknowledge',{ids:[event.id]},ownerCookie)).json()).events,[]);
  assert.deepEqual((await (await post(base,'stores/events/check',{},ownerCookie)).json()).events,[]);
});
