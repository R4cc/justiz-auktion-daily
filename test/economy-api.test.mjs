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
  assert.deepEqual((await (await fetch(`${base}/api/resales`)).json()).listings.map(row => row.id), [listing.listing.id]);
  const detail = await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json();
  assert.equal(detail.listing.item.marketCategory, 'tools');
  assert.deepEqual(detail.listing.bids, []);
  // Guests only ever see censored seller names; sessions see the real ones.
  assert.equal((await (await fetch(`${base}/api/resales`)).json()).listings[0].sellerUsername, 'ad****');
  assert.equal((await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json()).listing.sellerUsername, 'ad****');
  assert.equal((await (await fetch(`${base}/api/resales`, { headers: { cookie } })).json()).listings[0].sellerUsername, 'admin');
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
  assert.equal(bid.listing.currentBid, 7);
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
