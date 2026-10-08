import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { adminMarketDashboard, adjustAdminMarket } from '../src/admin-economy.mjs';
import { marketHistory, marketIndexes, marketMultiplierAt, marketState, tickMarketDrift } from '../src/market.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { businessDashboard, buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { listItem, getResale } from '../src/resale.mjs';

const day = Date.parse('2026-10-08T12:30:00Z'), hour = 3600000;
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-admin-market-'));
  const accounts = new Accounts(dir, { now: () => day });
  accounts.db(db => {
    for (const [id, admin] of [['admin', 1], ['player', 0]]) db.prepare(`INSERT INTO users
      (id, username, password_hash, tokens, admin, created_at) VALUES (?, ?, 'disabled', 100000, ?, ?)`).run(id, id, admin, day);
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  let sequence = 0;
  const admin = { id: 'admin', admin: true }, player = { id: 'player' };
  const adjust = (category, percent, now = day) => adjustAdminMarket(dir, admin,
    { category, percent, requestId: `market-adjustment-${++sequence}-0001` }, { now });
  const index = (category, now = day) => marketState(dir, { now }).categories.find(entry => entry.category === category).currentIndex;
  const count = () => accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM admin_market_adjustments').get().n);
  return { dir, accounts, admin, player, adjust, index, count };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('category controls apply relative percentages, compound, persist and reset to the simulated baseline', async t => {
  const f = await fixture(t);
  near(f.adjust('wine', 5).afterIndex, 105);
  near(f.adjust('wine', 10, day + 1).afterIndex, 115.5);
  near(f.adjust('wine', -80, day + 2).afterIndex, 23.1);
  assert.equal(f.index('wine', day + 2), 23.1);
  assert.equal(f.index('electronics', day + 2), 100);
  closeDataStore(f.dir);
  assert.equal(f.index('wine', day + hour), 23.1);
  tickMarketDrift(f.dir, { now: day + 2 * hour });
  const state = f.accounts.db(db => marketIndexes(db, day + 2 * hour));
  const multiplier = f.accounts.db(db => marketMultiplierAt(db, 'wine', day + 2 * hour));
  near(multiplier, .231); assert.ok(state.wine < 50);
  const baseline = state.wine / multiplier;
  const reset = adjustAdminMarket(f.dir, f.admin, { category: 'wine', action: 'reset', requestId: 'reset-wine-market-0001' }, { now: day + 2 * hour + 1 });
  near(reset.afterIndex, baseline);
  assert.equal(f.accounts.db(db => marketMultiplierAt(db, 'wine', day + 2 * hour + 1)), 1);
  const dashboard = adminMarketDashboard(f.dir, f.admin, { now: day + 2 * hour + 1 });
  assert.equal(dashboard.categories.length, 14); assert.equal(dashboard.history.length, 4);
  assert.ok(dashboard.presets.includes(-80) && dashboard.presets.includes(5) && dashboard.presets.includes(10));
});

test('history records each adjustment at its time and reconstructs its multiplier through sparse drift backfills', async t => {
  const f = await fixture(t);
  tickMarketDrift(f.dir, { now: day });
  const original = f.index('wine');
  const first = f.adjust('wine', -80, day + 10 * 60000);
  const second = f.adjust('wine', 10, day + 2 * hour + 10 * 60000);
  assert.equal(f.index('wine', day - 1), original);
  assert.equal(f.index('wine', day + 5 * 60000), original);
  const later = day + 4 * hour;
  tickMarketDrift(f.dir, { now: later });
  const history = marketHistory(f.dir, 'wine', { now: later });
  for (const receipt of [first, second]) {
    const point = history.find(point => point.capturedAt === new Date(receipt.createdAt).toISOString());
    near(point.indexValue, Math.round(receipt.afterIndex * 100) / 100);
  }
  const early = history.find(point => point.capturedAt === '2026-10-08T13:00:00.000Z');
  const following = history.find(point => point.capturedAt === '2026-10-08T15:00:00.000Z');
  assert.ok(early.indexValue < 30 && following.indexValue < 35);
  closeDataStore(f.dir);
  assert.deepEqual(marketHistory(f.dir, 'wine', { now: later }), history);
});

test('admin adjustments require live authority, validate inputs and cannot double-apply retries or leave partial receipts', async t => {
  const f = await fixture(t), payload = { category: 'wine', percent: 10, requestId: 'idempotent-market-0001' };
  assert.throws(() => adjustAdminMarket(f.dir, { ...f.player, admin: true }, payload, { now: day }), /forbidden/);
  assert.throws(() => adminMarketDashboard(f.dir, f.player, { now: day }), /forbidden/);
  const first = adjustAdminMarket(f.dir, f.admin, payload, { now: day });
  f.adjust('wine', -80, day + 1);
  assert.deepEqual(adjustAdminMarket(f.dir, f.admin, payload, { now: day + 2 }), first);
  assert.equal(f.count(), 2); assert.equal(f.index('wine', day + 2), 22);
  assert.throws(() => adjustAdminMarket(f.dir, f.admin, { ...payload, percent: 5 }, { now: day }), /request_conflict/);
  for (const percent of [-100, 101, 0, 5.5, '10', null, NaN, Infinity]) {
    assert.throws(() => adjustAdminMarket(f.dir, f.admin, { ...payload, percent, requestId: 'invalid-percentage-0001' }, { now: day }), /invalid_market_adjustment/);
  }
  assert.throws(() => f.adjust('unknown', 5), /unknown_category/);
  assert.throws(() => adjustAdminMarket(f.dir, f.admin, { ...payload, requestId: 'bad' }, { now: day }), /invalid_request/);
  f.accounts.db(db => db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(f.admin.id));
  assert.throws(() => adjustAdminMarket(f.dir, f.admin, payload, { now: day }), /forbidden/);
  f.accounts.db(db => {
    db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(f.admin.id);
    db.exec(`CREATE TRIGGER fail_adjustment_snapshot BEFORE INSERT ON market_snapshots BEGIN SELECT RAISE(ABORT, 'snapshot_unavailable'); END`);
  });
  assert.throws(() => f.adjust('wine', 5, day + 3), /snapshot_unavailable/);
  assert.equal(f.count(), 2); assert.equal(f.index('wine', day + 3), 22);
});

test('category changes flow through inventory, resale, business shelf prices and new case quotes', async t => {
  const f = await fixture(t);
  upsertAuctions(f.dir, Array.from({ length: 24 }, (_, n) => ({ id: 1000 + n, title: `Laptop ${1000 + n}`, category: 'Elektronik', currentBid: (n + 1) * 20, image: '/favicon.png' })));
  f.accounts.db(db => {
    for (const id of ['wine-inventory', 'wine-shelf']) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(id, f.player.id, JSON.stringify({ title: 'Bordeaux', price: 100, category: 'Getränke', marketCategory: 'wine', rarity: 'common' }), day);
  });
  const shop = buyBusiness(f.dir, f.player, 'wine', 'popup', { now: day }).shop;
  stockBusiness(f.dir, f.player, shop.id, ['wine-shelf'], { now: day });
  const listing = listItem(f.dir, f.player, { inventoryId: 'wine-inventory', startPrice: 10, endsAt: new Date(day + hour).toISOString() }, { now: day });
  f.adjust('wine', -80);
  assert.equal(f.accounts.inventory(f.player).find(item => item.id === 'wine-inventory').estimatedValueTokens, 20);
  assert.equal(getResale(f.dir, listing.id, { now: day }).estimatedValueTokens, 20);
  assert.equal(businessDashboard(f.dir, f.player, { now: day }).shops[0].stock[0].askingPrice, 24);
  const catalog = loadCaseStoreCatalog(f.dir, day);
  const quote = () => f.accounts.db(db => quoteCaseStore(catalog, marketIndexes(db, day)));
  const neutral = quote(); f.adjust('electronics', 50);
  assert.ok(quote().cases.every((box, index) => box.cost > neutral.cases[index].cost));
});
