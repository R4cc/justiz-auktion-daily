import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDataStore, getState, withDatabase } from '../src/database.mjs';
import { ensureMarketChaos } from '../src/market-chaos.mjs';
import { MANUAL_ADJUSTMENTS_RETIRED_MARKER, MARKET_CATEGORIES, estimatedValueTokens,
  marketHistory, marketIndexes, marketMultiplierAt, marketState, tickMarketDrift } from '../src/market.mjs';

const start = Date.parse('2026-10-01T12:00:00Z'), hour = 3600_000;
const round = value => Math.round(value * 100) / 100;
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-market-retirement-'));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  withDatabase(dir, db => ensureMarketChaos(db, start, { seed: 'retirement-regression' }));
  tickMarketDrift(dir, { now: start });
  return dir;
}

// Model a deployed database from before retirement: its normal category trends
// have diverged, but saved manual overrides pin all the visible quotes to 100.
function oldOverrides(dir, at) {
  tickMarketDrift(dir, { now: at });
  withDatabase(dir, db => {
    db.prepare('DELETE FROM app_state WHERE key = ?').run(MANUAL_ADJUSTMENTS_RETIRED_MARKER);
    const indexes = marketIndexes(db, at);
    for (const { id } of MARKET_CATEGORIES) {
      db.prepare(`INSERT INTO admin_market_adjustments
        (admin_id, request_id, category, action, percent, multiplier, before_index, after_index, created_at)
        VALUES ('old-admin', ?, ?, 'adjust', 10, ?, ?, 100, ?)`)
        .run(`old-${id}`, id, 100 / indexes[id], indexes[id], at);
    }
  });
}

test('first updated tick releases clustered manual overrides and preserves all pre-fix history', async t => {
  const dir = await fixture(t), adjustedAt = start + 7 * 24 * hour;
  oldOverrides(dir, adjustedAt);
  const before = adjustedAt + 10 * 60_000, retiredAt = before + 17_000;
  const originals = new Map(), cachedOriginals = new Map();
  const raw = withDatabase(dir, db => {
    const indexes = marketIndexes(db, retiredAt);
    return Object.fromEntries(MARKET_CATEGORIES.map(({ id }) => [id, indexes[id] / marketMultiplierAt(db, id, retiredAt)]));
  });
  assert.ok(marketState(dir, { now: adjustedAt }).categories.every(c => c.currentIndex === 100));
  for (const { id } of MARKET_CATEGORIES) {
    originals.set(id, marketHistory(dir, id, { now: before, range: '1d' }));
    cachedOriginals.set(id, marketHistory(dir, id, { now: before, limit: 1000 }));
  }
  const journal = withDatabase(dir, db => db.prepare('SELECT * FROM admin_market_adjustments').all());
  // Migration must also run when the two-hour drift bucket is already done.
  assert.equal(tickMarketDrift(dir, { now: retiredAt }).applied, false);
  const state = marketState(dir, { now: retiredAt });
  const values = state.categories.map(c => c.currentIndex);
  assert.ok(Math.max(...values) - Math.min(...values) > 30, JSON.stringify(values));
  for (const category of state.categories) {
    const id = category.category;
    assert.equal(category.currentIndex, round(raw[id]));
    assert.ok(category.currentIndex >= 50 && category.currentIndex <= 150);
    assert.equal(withDatabase(dir, db => marketMultiplierAt(db, id, retiredAt)), 1);
    assert.equal(estimatedValueTokens({ price: 1000, marketCategory: id }, raw), Math.round(raw[id] * 10));
    assert.deepEqual(marketHistory(dir, id, { now: before, range: '1d' }), originals.get(id));
    for (const range of ['1h', '1d', '1w', '1m']) {
      const history = marketHistory(dir, id, { now: retiredAt, range });
      assert.equal(history[0].indexValue, category.currentIndex);
      assert.equal(history[0].capturedAt, new Date(retiredAt).toISOString());
    }
    assert.equal(marketHistory(dir, id, { now: retiredAt })[0].indexValue, category.currentIndex);
  }
  assert.deepEqual(withDatabase(dir, db => db.prepare('SELECT * FROM admin_market_adjustments').all()), journal);
  const marker = withDatabase(dir, db => getState(db, MANUAL_ADJUSTMENTS_RETIRED_MARKER));
  assert.deepEqual(marker, { retiredAtMs: retiredAt, changedPrices: true });
  closeDataStore(dir);
  assert.equal(tickMarketDrift(dir, { now: retiredAt + 1000 }).applied, false);
  assert.deepEqual(withDatabase(dir, db => getState(db, MANUAL_ADJUSTMENTS_RETIRED_MARKER)), marker);
  assert.deepEqual(marketState(dir, { now: retiredAt }), state);
  // Later sparse backfills must preserve both old overrides and the exact
  // between-grid retirement quote in cached and reconstructed history.
  const later = retiredAt + 48 * hour;
  tickMarketDrift(dir, { now: later });
  for (const { id } of MARKET_CATEGORIES) {
    assert.deepEqual(marketHistory(dir, id, { now: before, range: '1d' }), originals.get(id));
    assert.deepEqual(marketHistory(dir, id, { now: later, limit: 1000 })
      .filter(point => Date.parse(point.capturedAt) <= before), cachedOriginals.get(id));
    for (const range of [null, '1w', '1m']) {
      const boundary = marketHistory(dir, id, { now: later, range, limit: 1000 })
        .find(point => Date.parse(point.capturedAt) === retiredAt);
      assert.equal(boundary?.indexValue, round(raw[id]), `${id}, ${range}`);
    }
  }
});

test('fresh automatic markets retire overrides without changing quotes or adding artificial history points', async t => {
  const dir = await fixture(t), now = start + 30 * 60_000;
  const marker = withDatabase(dir, db => getState(db, MANUAL_ADJUSTMENTS_RETIRED_MARKER));
  assert.deepEqual(marker, { retiredAtMs: start, changedPrices: false });
  tickMarketDrift(dir, { now });
  assert.deepEqual(withDatabase(dir, db => getState(db, MANUAL_ADJUSTMENTS_RETIRED_MARKER)), marker);
  const state = marketState(dir, { now });
  for (const c of state.categories) {
    assert.equal(c.currentIndex, round(withDatabase(dir, db => marketIndexes(db, now)[c.category])));
    assert.equal(marketHistory(dir, c.category, { now, range: '1h' }).length, 31);
  }
});
