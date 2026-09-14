import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CASES, caseCatalog } from '../src/cases.mjs';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { DEFAULT_MARKET_INDEX, MARKET_CATEGORIES, estimatedValueTokens, marketCategoryForAuction, marketCategoryForItem,
  marketCategoryForListingCategory, marketCategoryForTheme, marketHistory, marketState,
  setMarketIndex, snapshotMarketState } from '../src/market.mjs';

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
