import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { bidWholesale, businessDashboard, buyBusiness, listWholesale, stockBusiness, tickBusinesses, unstockBusiness } from '../src/businesses.mjs';
import { listItem } from '../src/resale.mjs';
import { setMarketIndex } from '../src/market.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { featureFlags } from '../src/features.mjs';

const start = Date.parse('2026-09-26T12:00:00Z');
const hour = 3_600_000;

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-business-'));
  const accounts = new Accounts(dir, { now: () => start });
  accounts.db(db => {
    for (const [id, tokens, admin] of [['owner', 1000, 1], ['rival', 5000, 0]]) {
      db.prepare(`INSERT INTO users (id, username, password_hash, tokens, created_at, admin)
        VALUES (?, ?, 'disabled', ?, ?, ?)`).run(id, id, tokens, start, admin);
    }
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, owner: { id: 'owner', admin: true }, rival: { id: 'rival' },
    balance: id => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id = ?').get(id).tokens),
    count: (table, condition = '1 = 1') => accounts.db(db => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).get().count) };
}

test('NPC bulk auctions escrow bids and mint exactly one batch at settlement', async t => {
  const f = await fixture(t);
  const lots = listWholesale(f.dir, { now: start });
  assert.equal(lots.length, 8);
  const wine = lots.find(lot => lot.type === 'wine' && lot.quantity === 24);
  assert.equal(wine.reserve, 432);
  bidWholesale(f.dir, f.owner, wine.id, 432, { now: start + 1000 });
  assert.equal(f.balance('owner'), 568);
  bidWholesale(f.dir, f.rival, wine.id, 441, { now: start + 2000 });
  assert.equal(f.balance('owner'), 1000);
  bidWholesale(f.dir, f.owner, wine.id, 450, { now: start + 3000 });
  assert.equal(f.balance('owner'), 550);
  assert.throws(() => bidWholesale(f.dir, f.rival, wine.id, 450, { now: start + 4000 }), /bid_too_low/);
  tickBusinesses(f.dir, { now: start + 2 * hour });
  assert.equal(f.count('inventory'), 24);
  assert.equal(f.count('inventory', "user_id = 'owner'"), 24);
  tickBusinesses(f.dir, { now: start + 2 * hour + 1000 });
  assert.equal(f.count('inventory'), 24);
  assert.equal(f.balance('owner'), 550);
  assert.equal(businessDashboard(f.dir, f.owner, { now: start + 2 * hour }).bids[0].won, true);
  assert.equal(businessDashboard(f.dir, f.rival, { now: start + 2 * hour }).bids[0].won, false);
  assert.equal(f.count('account_notifications', "source_key LIKE 'wholesale:won:%'"), 1);
  assert.throws(() => bidWholesale(f.dir, f.rival, wine.id, 1000, { now: start + 2 * hour }), /auction_ended/);
});

test('store stock is exclusive, category-checked, and earns once after offline time', async t => {
  const f = await fixture(t);
  const wineLot = listWholesale(f.dir, { now: start }).find(lot => lot.type === 'wine' && lot.quantity === 24);
  bidWholesale(f.dir, f.owner, wineLot.id, wineLot.reserve, { now: start });
  tickBusinesses(f.dir, { now: start + 2 * hour });
  const boughtAt = start + 2 * hour;
  const shop = buyBusiness(f.dir, f.owner, 'wine', 'popup', { now: boughtAt }).shop;
  assert.equal(f.balance('owner'), 218);
  assert.throws(() => buyBusiness(f.dir, f.owner, 'wine', 'tiny', { now: boughtAt }), /insufficient_tokens/);
  const ids = f.accounts.db(db => db.prepare("SELECT id FROM inventory WHERE user_id = 'owner' ORDER BY id LIMIT 4").all().map(row => row.id));
  assert.throws(() => stockBusiness(f.dir, f.rival, shop.id, ids, { now: boughtAt }), /business_not_found/);
  assert.throws(() => stockBusiness(f.dir, f.owner, shop.id, [...ids, ids[0]], { now: boughtAt }), /invalid_stock/);
  stockBusiness(f.dir, f.owner, shop.id, ids, { now: boughtAt });
  assert.equal(businessDashboard(f.dir, f.owner, { now: boughtAt }).shops[0].stock.length, 4);
  assert.equal(f.accounts.inventory(f.owner).length, 20);
  assert.throws(() => listItem(f.dir, f.owner, { inventoryId: ids[0], startPrice: 10,
    endsAt: new Date(boughtAt + 24 * hour).toISOString() }, { now: boughtAt }), /item_stocked/);
  setMarketIndex(f.dir, 'wine', 130, { now: boughtAt });
  const later = boughtAt + 7 * 24 * hour;
  const after = businessDashboard(f.dir, f.owner, { now: later }).shops[0];
  assert.equal(after.stock.length, 0);
  assert.equal(after.sales, 4);
  assert.ok(after.visitors > 0);
  assert.equal(after.revenue, 4 * 40);
  assert.equal(f.balance('owner'), 218 + after.revenue);
  closeDataStore(f.dir);
  assert.equal(businessDashboard(f.dir, f.owner, { now: later }).shops[0].revenue, after.revenue);
  assert.equal(f.balance('owner'), 218 + after.revenue);
  assert.equal(f.count('inventory', 'sold_at IS NOT NULL'), 4);
  assert.equal(f.count('business_stock', 'sold_price = 40'), 4);
});

test('shop categories and capacities reject unsuitable or excess stock atomically', async t => {
  const f = await fixture(t);
  const toy = buyBusiness(f.dir, f.rival, 'toys', 'popup', { now: start }).shop;
  f.accounts.db(db => {
    for (let n = 0; n < 5; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`toy-${n}`, 'rival', JSON.stringify({ title: 'Wooden puzzle set', price: 20, businessCategory: 'toys' }), start);
    db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run('wine-1', 'rival', JSON.stringify({ title: 'Red wine', price: 20, businessCategory: 'wine' }), start);
  });
  assert.throws(() => stockBusiness(f.dir, f.rival, toy.id, ['toy-0', 'wine-1'], { now: start }), /wrong_shop_type/);
  assert.equal(f.count('business_stock'), 0);
  assert.throws(() => stockBusiness(f.dir, f.rival, toy.id, ['toy-0', 'toy-1', 'toy-2', 'toy-3', 'toy-4'], { now: start }), /business_full/);
  assert.equal(f.count('business_stock'), 0);
  stockBusiness(f.dir, f.rival, toy.id, ['toy-0', 'toy-1'], { now: start });
  assert.throws(() => stockBusiness(f.dir, f.rival, toy.id, ['toy-0'], { now: start }), /item_locked/);
  assert.equal(f.count('business_stock'), 2);
  unstockBusiness(f.dir, f.rival, toy.id, 'toy-0', { now: start });
  assert.equal(f.count('business_stock'), 1);
  assert.ok(f.accounts.inventory(f.rival).some(item => item.id === 'toy-0'));
  assert.throws(() => unstockBusiness(f.dir, f.owner, toy.id, 'toy-1', { now: start }), /business_not_found/);
  f.accounts.resetEconomy(f.owner, 'RESET ECONOMY');
  assert.equal(f.count('businesses'), 0);
  assert.equal(f.count('business_stock'), 0);
  assert.equal(f.count('inventory'), 0);
});

test('business HTTP routes require sessions and CSRF while bulk lots remain public', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-business-http-'));
  const password = 'business-http-password';
  const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password };
  const flags = featureFlags(env);
  const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const economy = createEconomyApi({ dataDir: dir, json, flags });
  const accounts = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: [] }), json, env, flags });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (await economy(request, response, url)) return;
    if (await accounts(request, response, url)) return;
    json(response, 404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve));
    closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, payload, cookie = '', csrf = true) => fetch(`${base}/api/account/${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'x-requested-with': 'JUSTIZGUESSR' } : {}), cookie },
    body: JSON.stringify(payload) });
  const lots = await (await fetch(`${base}/api/wholesale`)).json();
  assert.equal(lots.auctions.length, 8);
  assert.equal((await fetch(`${base}/api/account/businesses`)).status, 401);
  const login = await post('login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await post('businesses/buy', { type: 'wine', size: 'popup' }, cookie, false)).status, 403);
  assert.equal((await post('businesses/buy', { type: 'wine', size: 'popup' }, cookie)).status, 200);
  const shops = await (await fetch(`${base}/api/account/businesses`, { headers: { cookie } })).json();
  assert.equal(shops.shops.length, 1);
  const wine = lots.auctions.find(lot => lot.type === 'wine' && lot.quantity === 24);
  const bid = await post('wholesale/bid', { id: wine.id, amount: wine.reserve }, cookie);
  assert.equal(bid.status, 200);
  const bidResult = await bid.json();
  assert.equal(bidResult.user.tokens, 1000 - 350 - wine.reserve);
  assert.equal(bidResult.user.activeBids, 1);
  const hidden = createEconomyApi({ dataDir: dir, json, flags: { ...flags, businesses: false } });
  assert.equal(hidden({ method: 'GET' }, null, new URL('/api/wholesale', base)), false);
});
