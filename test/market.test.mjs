import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CASES, caseCatalog } from '../src/cases.mjs';
import { Accounts } from '../src/accounts.mjs';
import { ensureNewsSchema } from '../src/news.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { DEFAULT_MARKET_INDEX, MARKET_CATEGORIES, estimatedValueTokens, marketCategoryForAuction, marketCategoryForItem,
  marketCategoryForListingCategory, marketCategoryForTheme, markSimulationActivation, marketHistory, marketIndexes, marketState,
  setMarketIndex, snapshotMarketState, tickMarketDrift } from '../src/market.mjs';

const day = Date.parse('2026-09-12T12:00:00Z');
const stock = Array.from({ length: 24 }, (_, n) => ({
  id: n + 1000, title: `Laptop Lenovo ${n + 1000}`, category: 'Elektronik',
  currentBid: (n + 1) * 10, image: `/assets/electronics.jpg`
}));

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-market-'));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test('market category registry is unique and every case theme maps into it', () => {
  const ids = MARKET_CATEGORIES.map(category => category.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const palette of CASES) {
    const marketCategory = marketCategoryForTheme(palette.category);
    assert.ok(marketCategory === null || ids.includes(marketCategory), `theme ${palette.category}`);
  }
  // Only the mixed theme intentionally spans categories.
  assert.equal(marketCategoryForTheme('mixed'), null);
  assert.equal(marketCategoryForTheme('cars'), 'vehicles');
  assert.equal(marketCategoryForTheme('premium'), 'luxury_goods');
});

test('listing categories, auctions and items all resolve to a market category', () => {
  assert.equal(marketCategoryForListingCategory('Elektronik'), 'electronics');
  assert.equal(marketCategoryForListingCategory('Getränke'), 'wine');
  assert.equal(marketCategoryForListingCategory('Nonsens'), null);
  assert.equal(marketCategoryForAuction({ title: 'MacBook Laptop 2023' }), 'electronics');
  assert.equal(marketCategoryForAuction({ title: 'Unknown Thing', category: 'Quatsch' }), 'other');
  // Items freeze their market category at creation; legacy items derive one.
  assert.equal(marketCategoryForItem({ marketCategory: 'tools' }), 'tools');
  assert.equal(marketCategoryForItem({ category: 'Werkzeuge' }), 'tools');
  assert.equal(marketCategoryForItem({ title: 'Riesling Wein 2018' }), 'wine');
  // An invalid stored category falls back to derivation instead of leaking.
  assert.equal(marketCategoryForItem({ marketCategory: 'bogus', category: 'Elektronik' }), 'electronics');
});

test('global market state starts neutral for every category and persists', async t => {
  const dir = await fixture(t);
  const state = marketState(dir, { now: day });
  assert.equal(state.updatedAt, new Date(day).toISOString());
  assert.deepEqual(state.categories.map(category => category.category), MARKET_CATEGORIES.map(category => category.id));
  assert.ok(state.categories.every(category => category.baseIndex === DEFAULT_MARKET_INDEX &&
    category.currentIndex === DEFAULT_MARKET_INDEX && category.updatedAt === state.updatedAt));
  closeDataStore(dir);
  assert.deepEqual(marketState(dir), state);
});

test('setMarketIndex moves exactly one category, validates input and keeps snapshots', async t => {
  const dir = await fixture(t);
  setMarketIndex(dir, 'electronics', 96.5, { now: day, snapshot: true });
  setMarketIndex(dir, 'wine', 105, { now: day + 1000 });
  const state = marketState(dir);
  const electronics = state.categories.find(category => category.category === 'electronics');
  const tools = state.categories.find(category => category.category === 'tools');
  assert.equal(electronics.currentIndex, 96.5);
  assert.equal(tools.currentIndex, DEFAULT_MARKET_INDEX);
  assert.equal(state.updatedAt, new Date(day + 1000).toISOString());
  assert.deepEqual(marketHistory(dir, 'electronics'), [{ indexValue: 96.5, capturedAt: new Date(day).toISOString() }]);
  assert.deepEqual(marketHistory(dir, 'tools'), []);
  snapshotMarketState(dir, { now: day + 2000 });
  assert.equal(marketHistory(dir, 'tools').length, 1);
  assert.equal(marketHistory(dir, 'tools')[0].indexValue, DEFAULT_MARKET_INDEX);
  for (const category of ['nonsense', null, undefined]) {
    assert.throws(() => setMarketIndex(dir, category, 100), /unknown_category/);
  }
  for (const index of [0, -2, NaN, Infinity, '100', null]) {
    assert.throws(() => setMarketIndex(dir, 'electronics', index), /invalid_index/);
  }
  assert.throws(() => marketHistory(dir, 'nonsense'), /unknown_category/);
});

test('estimated token values scale the frozen base value by the category index without touching history', () => {
  const item = { title: 'MacBook Laptop 2023', price: 123.45, rarity: 'rare',
    sellValue: 123, marketCategory: 'electronics' };
  const before = structuredClone(item);
  // round(tokenValue(123.45) * 85 / 100) = round(104.55) = 105.
  assert.equal(estimatedValueTokens(item, { electronics: 85 }), 105);
  assert.equal(estimatedValueTokens(item, { electronics: 130 }), 160);
  // Missing or unknown indexes fall back to neutral 100.
  assert.equal(estimatedValueTokens(item, {}), 123);
  assert.equal(estimatedValueTokens(item), 123);
  assert.equal(estimatedValueTokens({ ...item, marketCategory: 'bogus', category: 'Elektronik' }, { wine: 80 }), 123);
  // Legacy derivation still applies (existing category fallback behavior).
  assert.equal(estimatedValueTokens({ title: 'Riesling Wein 2018', price: 50 }, { wine: 120 }), 60);
  // The floor never yields zero tokens; historical fields stay untouched.
  assert.equal(estimatedValueTokens({ title: 'Stub', price: 0.4, sellValue: 1, marketCategory: 'electronics' }, { electronics: 50 }), 1);
  assert.deepEqual(item, before);
});

test('inventory items carry their frozen market category and legacy items derive one', async t => {
  const dir = await fixture(t);
  upsertAuctions(dir, stock);
  let now = day;
  const service = new Accounts(dir, { now: () => now });
  const password = 'market-category-password';
  await service.bootstrap('admin', password);
  const admin = service.user(await service.login({ username: 'admin', password }));
  const item = service.openCase(admin, caseCatalog(stock), 'electronics', 'market-item-00001');
  assert.equal(item.marketCategory, 'electronics');
  const listed = service.inventory(admin)[0];
  assert.equal(listed.marketCategory, 'electronics');
  // A legacy item without a stored category still resolves by derivation.
  service.db(db => {
    const stored = db.prepare('SELECT item FROM inventory WHERE id = ?').get(item.id);
    const legacy = { ...JSON.parse(stored.item) };
    delete legacy.marketCategory;
    db.prepare('UPDATE inventory SET item = ? WHERE id = ?').run(JSON.stringify(legacy), item.id);
  });
  assert.equal(service.inventory(admin)[0].marketCategory, 'electronics');
  assert.equal(service.inventory(admin)[0].sellValue, item.sellValue);
});

test('market trends persist across weeks, mix gains and losses, and stay within ±50%', async t => {
  const dir = await fixture(t);
  const index = (now = day) => Object.fromEntries(
    marketState(dir, { now }).categories.map(c => [c.category, c.currentIndex]));
  const first = tickMarketDrift(dir, { now: day });
  assert.equal(first.applied, true);
  const initial = index();
  assert.ok(Object.values(initial).some(value => value > 100));
  assert.ok(Object.values(initial).some(value => value < 100));
  assert.equal(tickMarketDrift(dir, { now: day + 1000 }).applied, false);
  for (const days of [7, 14, 30]) {
    tickMarketDrift(dir, { now: day + days * 24 * 3600_000 });
    const values = Object.values(index(day + days * 24 * 3600_000));
    assert.ok(values.every(value => value >= 50 && value <= 150), JSON.stringify(values));
    assert.ok(values.some(value => value > 100) && values.some(value => value < 100));
  }
  const sevenDays = index(day + 7 * 24 * 3600_000);
  assert.ok(Math.abs(sevenDays.electronics - initial.electronics) > 10);
  // Sparse ticks backfill the same persisted path, including occasional jumps.
  const points = withDatabase(dir, db => db.prepare(`SELECT a.index_value - b.index_value AS move
    FROM market_trend_points a JOIN market_trend_points b
      ON a.category = b.category AND a.bucket = b.bucket + 1`).all());
  assert.ok(points.some(point => Math.abs(point.move) >= 6));
  const final = index(day + 30 * 24 * 3600_000);
  closeDataStore(dir);
  assert.deepEqual(index(day + 30 * 24 * 3600_000), final);
});

test('old drift is carried into the first trend without doubling chart history', async t => {
  const dir = await fixture(t);
  marketState(dir, { now: day - 4 * 3600_000 });
  withDatabase(dir, db => {
    ensureNewsSchema(db);
    markSimulationActivation(db, day - 4 * 3600_000);
    db.prepare(`INSERT INTO market_effects
      (source_id, event_id, category, delta, starts_at, ends_at)
      VALUES ('drift:electronics', NULL, 'electronics', 20, ?, ?)`)
      .run(day - 3600_000, day + 71 * 3600_000);
  });
  tickMarketDrift(dir, { now: day + 30 * 60_000 });
  const atBoundary = marketHistory(dir, 'electronics', { now: day + 30 * 60_000 })[0];
  assert.equal(atBoundary.capturedAt, new Date(day).toISOString());
  assert.ok(atBoundary.indexValue > 115 && atBoundary.indexValue < 125, atBoundary.indexValue);
  assert.ok(marketState(dir, { now: day + 30 * 60_000 }).categories
    .find(category => category.category === 'electronics').currentIndex < 125);
});

test('intraday quotes move each minute with both rallies and pullbacks and are shared by valuations', async t => {
  const dir = await fixture(t);
  tickMarketDrift(dir, { now: day });
  const history = marketHistory(dir, 'electronics', { now: day + 3600_000, range: '1h' });
  assert.equal(history.length, 61);
  const moves = history.slice(1).map((point, i) => history[i].indexValue - point.indexValue);
  assert.ok(moves.filter(move => move !== 0).length >= 50);
  assert.ok(moves.some(move => move > 0) && moves.some(move => move < 0));
  assert.ok(Math.max(...history.map(p => p.indexValue)) - Math.min(...history.map(p => p.indexValue)) > 1);
  const at = day + 3600_000;
  const shared = withDatabase(dir, db => marketIndexes(db, at).electronics);
  assert.equal(history[0].indexValue, Math.round(shared * 100) / 100);
  const card = marketState(dir, { now: at }).categories[0];
  assert.equal(card.currentIndex, history[0].indexValue);
  assert.equal(card.change1h, Math.round((shared - withDatabase(dir, db => marketIndexes(db, day).electronics)) * 100) / 100);
  assert.equal(card.changePercent1h, Math.round((shared / withDatabase(dir, db => marketIndexes(db, day).electronics) - 1) * 10000) / 100);
  assert.equal(estimatedValueTokens({ price: 1000, marketCategory: 'electronics' }, { electronics: shared }), Math.round(shared * 10));
});

test('intraday history is identical after frequent reads, sparse ticks and restart', async t => {
  const frequent = await fixture(t), sparse = await fixture(t);
  for (const dir of [frequent, sparse]) tickMarketDrift(dir, { now: day });
  const end = day + 24 * 3600_000;
  for (let now = day; now <= end; now += 3600_000) {
    tickMarketDrift(frequent, { now });
    marketHistory(frequent, 'vehicles', { now, range: '1h' });
  }
  tickMarketDrift(sparse, { now: end });
  const expected = marketHistory(frequent, 'vehicles', { now: end, range: '1d' });
  assert.deepEqual(marketHistory(sparse, 'vehicles', { now: end, range: '1d' }), expected);
  closeDataStore(sparse);
  assert.deepEqual(marketHistory(sparse, 'vehicles', { now: end, range: '1d' }), expected);
});

test('quick history ranges cover their full duration, include the live quote and stay bounded', async t => {
  const dir = await fixture(t);
  tickMarketDrift(dir, { now: day });
  const now = day + 31 * 24 * 3600_000 + 37_000;
  tickMarketDrift(dir, { now });
  const durations = { '1h': 3600_000, '1d': 24 * 3600_000, '1w': 7 * 24 * 3600_000, '1m': 30 * 24 * 3600_000 };
  for (const [range, duration] of Object.entries(durations)) {
    const history = marketHistory(dir, 'vehicles', { now, range });
    assert.equal(Date.parse(history[0].capturedAt), now);
    assert.equal(Date.parse(history.at(-1).capturedAt), now - duration);
    assert.ok(history.length <= 722 && history.length >= 60);
    assert.ok(history.every(p => p.indexValue >= 50 && p.indexValue <= 150));
    assert.equal(history[0].indexValue, marketState(dir, { now }).categories.find(c => c.category === 'vehicles').currentIndex);
  }
  assert.throws(() => marketHistory(dir, 'vehicles', { now, range: 'all' }), /invalid_market_range/);
});

test('intraday activation preserves earlier quotes and never invents pre-activation data', async t => {
  const dir = await fixture(t);
  setMarketIndex(dir, 'electronics', 113, { now: day, snapshot: true });
  const before = marketHistory(dir, 'electronics', { now: day, range: '1h' });
  tickMarketDrift(dir, { now: day + 3600_000 });
  assert.deepEqual(marketHistory(dir, 'electronics', { now: day, range: '1h' }), before);
  assert.equal(before[0].indexValue, 113);
  const history = marketHistory(dir, 'electronics', { now: day + 2 * 3600_000, range: '1m' });
  assert.ok(history.every(p => Date.parse(p.capturedAt) >= day + 3600_000));
});
