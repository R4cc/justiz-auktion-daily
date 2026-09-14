import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-economy-'));
  upsertAuctions(dir, lots);
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const economyApi = createEconomyApi({ dataDir: dir, json, flags: featureFlags(flags) });
  const accountApi = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: lots.slice(0, 5) }), json, env: flags });
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
  const handler = createEconomyApi({ dataDir: 'unused', json: () => {}, flags: featureFlags({}) });
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
  // Admin news tooling seeds the public feed.
  const news = await post(base, 'admin/news', { id: 'news-tool-bust', title: 'Tool importer busted',
    body: 'Seized tools will be auctioned soon.', status: 'published', paletteIds: ['tools'],
    marketEffects: [{ category: 'tools', direction: 'down' }] }, cookie);
  assert.equal(news.status, 200);
  const publicNews = await (await fetch(`${base}/api/news`)).json();
  assert.deepEqual(publicNews.news.map(item => item.id), ['news-tool-bust']);
  assert.deepEqual(publicNews.news[0].marketEffects, [{ category: 'tools', direction: 'down', magnitude: null }]);
  // Non-admins cannot seed news; bad events are rejected.
  assert.equal((await post(base, 'admin/news', { title: 'x', body: 'y' })).status, 401);
  assert.equal((await post(base, 'admin/news', { title: '', body: 'y' }, cookie)).status, 400);
  const market = await (await fetch(`${base}/api/market`)).json();
  assert.ok(market.categories.length >= 8);
  assert.ok(market.categories.every(category => category.currentIndex === 100 && category.baseIndex === 100));
  const palettes = await (await fetch(`${base}/api/palettes`)).json();
  assert.ok(palettes.palettes.some(palette => palette.id === 'fundkiste'));
  assert.doesNotMatch(JSON.stringify(palettes), /"(?:odds|weights|chance)":/);
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
  assert.equal((await (await post(base, 'inventory/sell', { id: opened.item.id }, cookie)).json()).error, 'item_listed');
  assert.equal((await fetch(`${base}/api/account/resale/listings`)).status, 401);
  assert.equal((await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 40, endsAt })).status, 401);
  const own = await (await fetch(`${base}/api/account/resale/listings`, { headers: { cookie } })).json();
  assert.deepEqual(own.listings.map(row => row.id), [listing.listing.id]);
  assert.equal((await (await post(base, 'resale/cancel', { id: listing.listing.id }, cookie)).json()).listing.status, 'cancelled');
  assert.equal((await fetch(`${base}/api/resales/missing`)).status, 404);
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
