import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDataStore, withDatabase } from '../src/database.mjs';
import { saveNewsEvent, getNewsEvent } from '../src/news.mjs';
import {
  EFFECT_DURATION_MS, marketHistory, marketState, setMarketIndex, snapshotMarketState
} from '../src/market.mjs';

const hour = 3600_000;
// Deliberately off the hourly grid so activation-boundary math is exercised.
const day = Date.parse('2026-09-12T12:30:00Z');

async function fixture(t, prefix = 'jg-simulation-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

const publish = (dir, id, effects, at) => saveNewsEvent(dir,
  { id, title: `Story ${id}`, body: 'Body text.', status: 'published', marketEffects: effects }, { now: at });
const indexAt = (dir, category, at) => marketState(dir, { now: at })
  .categories.find(entry => entry.category === category).currentIndex;
const rows = (dir, sql, ...params) => withDatabase(dir, db => db.prepare(sql).all(...params));

test('effects decay linearly: 100 -> 85 -> 92.5 -> 100 over 72 hours', async t => {
  const dir = await fixture(t);
  publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], day);
  assert.equal(indexAt(dir, 'electronics', day), 85);
  assert.equal(indexAt(dir, 'electronics', day + 36 * hour), 92.5);
  assert.equal(indexAt(dir, 'electronics', day + 72 * hour - 1), 100);
  assert.equal(indexAt(dir, 'electronics', day + 72 * hour), 100);
  assert.equal(indexAt(dir, 'electronics', day + 100 * hour), 100);
});

test('categories are independent; overlapping effects add with sign', async t => {
  const dir = await fixture(t);
  publish(dir, 'boom', [{ category: 'electronics', direction: 'up', magnitude: 10 }], day);
  publish(dir, 'mixed', [{ category: 'electronics', direction: 'down', magnitude: 4 },
    { category: 'wine', direction: 'up', magnitude: 6 }], day + hour);
  const state = marketState(dir, { now: day + hour });
  const by = Object.fromEntries(state.categories.map(category => [category.category, category.currentIndex]));
  // 100 + 10 * (1 - 1/72) - 4 = 105.8611... -> 105.86
  assert.equal(by.electronics, 105.86);
  assert.equal(by.wine, 106);
  assert.equal(by.tools, 100);
  assert.ok(state.categories.every(category => category.baseIndex === 100));
  assert.equal(state.updatedAt, new Date(day + hour).toISOString());
});

test('the absolute effect budget rejects whole publications atomically', async t => {
  const dir = await fixture(t);
  publish(dir, 'first', [{ category: 'tools', direction: 'up', magnitude: 20 }], day);
  assert.throws(() => publish(dir, 'second', [{ category: 'tools', direction: 'up', magnitude: 11 }], day),
    /market_effect_budget/);
  // The rejected event left nothing behind: no row, no receipt, no effects.
  assert.equal(getNewsEvent(dir, 'second'), null);
  assert.deepEqual(rows(dir, 'SELECT event_id FROM news_publications WHERE event_id = ?', 'second'), []);
  assert.deepEqual(rows(dir, 'SELECT source_id FROM market_effects WHERE category = ? ORDER BY source_id', 'tools')
    .map(row => row.source_id), ['news:first:tools']);
  assert.equal(indexAt(dir, 'tools', day), 120);
  // Opposing effects consume the same absolute budget.
  publish(dir, 'counter', [{ category: 'tools', direction: 'down', magnitude: 10 }], day + 1000);
  assert.equal(indexAt(dir, 'tools', day + 1000), 110);
  assert.throws(() => publish(dir, 'third', [{ category: 'tools', direction: 'down', magnitude: 1 }], day + 2000),
    /market_effect_budget/);
  // A multi-category event is rejected wholesale when one category busts.
  assert.throws(() => publish(dir, 'bust', [
    { category: 'wine', direction: 'up', magnitude: 5 },
    { category: 'tools', direction: 'up', magnitude: 1 }], day + 3000), /market_effect_budget/);
  assert.equal(getNewsEvent(dir, 'bust'), null);
  assert.deepEqual(rows(dir, 'SELECT source_id FROM market_effects WHERE category = ?', 'wine'), []);
  // Decay frees budget: after 36h roughly 15 of the absolute 30 is still
  // active, so 14 more points fit and 16 does not.
  const later = day + 36 * hour;
  assert.throws(() => publish(dir, 'late-big', [{ category: 'tools', direction: 'up', magnitude: 16 }], later),
    /market_effect_budget/);
  publish(dir, 'late-fit', [{ category: 'tools', direction: 'up', magnitude: 14 }], later);
  assert.ok(indexAt(dir, 'tools', later) > 100);
});

test('results are identical regardless of read frequency and survive restart', async t => {
  const frequent = await fixture(t, 'jg-sim-frequent-');
  const sparse = await fixture(t, 'jg-sim-sparse-');
  for (const dir of [frequent, sparse]) {
    publish(dir, 'story', [{ category: 'vehicles', direction: 'up', magnitude: 9 }], day);
  }
  for (let offset = 0; offset <= 48; offset += 6) indexAt(frequent, 'vehicles', day + offset * hour);
  const end = day + 48 * hour;
  assert.equal(indexAt(frequent, 'vehicles', end), 103);
  assert.equal(indexAt(frequent, 'vehicles', end), indexAt(sparse, 'vehicles', end));
  assert.deepEqual(marketHistory(frequent, 'vehicles', { now: end }),
    marketHistory(sparse, 'vehicles', { now: end }));
  closeDataStore(frequent);
  closeDataStore(sparse);
  assert.equal(indexAt(frequent, 'vehicles', end), indexAt(sparse, 'vehicles', end));
  assert.deepEqual(marketHistory(frequent, 'vehicles', { now: end }),
    marketHistory(sparse, 'vehicles', { now: end }));
});

test('hourly snapshots start at activation, reconstruct from effects and stay bounded', async t => {
  const dir = await fixture(t);
  publish(dir, 'story', [{ category: 'electronics', direction: 'down', magnitude: 15 }], day); // 12:30
  marketState(dir, { now: day + 5 * hour });
  const history = marketHistory(dir, 'electronics', { now: day + 5 * hour });
  const boundary = offset => new Date(day + 30 * 60000 + offset * hour).toISOString();
  assert.deepEqual(history.map(entry => entry.capturedAt),
    [boundary(4), boundary(3), boundary(2), boundary(1), boundary(0)]);
  // Every boundary value is reconstructed from the effect at that moment, not
  // copied from today's index.
  assert.deepEqual(history.map(entry => entry.indexValue), [85.94, 85.73, 85.52, 85.31, 85.1]);
  assert.deepEqual(marketHistory(dir, 'wine', { now: day + 5 * hour }).map(entry => entry.indexValue),
    [100, 100, 100, 100, 100]);
  assert.ok(history.every(entry => Date.parse(entry.capturedAt) >= day)); // no pre-activation history
  // Long downtime: only retained missing hours are computed, at most 720
  // boundaries per refresh; unretained hours are never fabricated.
  const late = day + 800 * hour;
  marketState(dir, { now: late });
  const lateHistory = marketHistory(dir, 'electronics', { now: late, limit: 1000 });
  assert.equal(lateHistory.length, 720);
  const newest = Date.parse(lateHistory[0].capturedAt);
  const oldest = Date.parse(lateHistory[lateHistory.length - 1].capturedAt);
  assert.equal(newest, Math.floor(late / hour) * hour);
  assert.equal(oldest, newest - 719 * hour);
  assert.ok(oldest >= late - 30 * 24 * hour - hour);
  assert.ok(lateHistory.every(entry => entry.indexValue === 100)); // the effect expired long ago
  assert.deepEqual(rows(dir, 'SELECT COUNT(*) AS count FROM market_effects').map(row => row.count), [1]); // effects are kept, never pruned
});

test('legacy news and manual indexes migrate exactly once at activation', async t => {
  const dir = await fixture(t);
  // Foundation-era world: drafts, published/archived placeholder news with
  // fractional magnitudes and palette references, manually set category
  // indexes, and no simulation marker.
  saveNewsEvent(dir, { id: 'old-draft', title: 'Old draft', body: 'B', status: 'draft',
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 0.85 }] }, { now: day });
  withDatabase(dir, db => {
    const iso = new Date(day).toISOString();
    const insert = db.prepare(`INSERT INTO news_events
      (id, title, body, status, published_at, palette_ids, market_effects, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run('old-pub', 'Old published', 'B', 'published', iso, '["electronics"]',
      '[{"category":"electronics","direction":"up","magnitude":0.85}]', '{}', iso, iso);
    insert.run('old-arch', 'Old archived', 'B', 'archived', iso, '[]', '[]', '{}', iso, iso);
  });
  setMarketIndex(dir, 'electronics', 96.5, { now: day });  // fractional, in range
  setMarketIndex(dir, 'wine', 200, { now: day });          // out of range: bounded to 130
  // Activation happens with the first publication under the new rules.
  publish(dir, 'fresh', [{ category: 'tools', direction: 'up', magnitude: 5 }], day + 2000);
  // Legacy published/archived news received receipts; drafts did not.
  assert.deepEqual(rows(dir, 'SELECT event_id, kind FROM news_publications ORDER BY event_id')
    .map(row => [row.event_id, row.kind]), [['fresh', 'applied'], ['old-arch', 'legacy'], ['old-pub', 'legacy']]);
  // Bounded manual indexes became decaying bootstrap effects; neutral
  // categories got none. Fractional deltas are preserved.
  assert.deepEqual(rows(dir, `SELECT source_id, delta FROM market_effects WHERE event_id IS NULL ORDER BY source_id`)
    .map(row => [row.source_id, row.delta]), [['bootstrap:electronics', -3.5], ['bootstrap:wine', 30]]);
  assert.deepEqual(rows(dir, `SELECT starts_at, ends_at FROM market_effects WHERE source_id = 'bootstrap:electronics'`)
    .map(row => [row.starts_at, row.ends_at]), [[day + 2000, day + 2000 + EFFECT_DURATION_MS]]);
  // The market reflects bounded legacy values plus the fresh publication —
  // and deliberately NOT the old placeholder effect (electronics +0.85).
  const state = marketState(dir, { now: day + 2000 });
  const by = Object.fromEntries(state.categories.map(category => [category.category, category.currentIndex]));
  assert.equal(by.electronics, 96.5);
  assert.equal(by.wine, 130);
  assert.equal(by.tools, 105);
  assert.ok(state.categories.every(category => category.baseIndex === 100));
  // Manual index writes are rejected once the simulation owns the market.
  assert.throws(() => setMarketIndex(dir, 'wine', 100, { now: day + 3000 }), /market_simulation_owned/);
  // A second publication does not rerun the migration.
  const before = rows(dir, `SELECT processed_at FROM news_publications WHERE event_id = 'old-pub'`)[0].processed_at;
  publish(dir, 'fresh-two', [{ category: 'vehicles', direction: 'down', magnitude: 3 }], day + 4000);
  assert.equal(rows(dir, `SELECT processed_at FROM news_publications WHERE event_id = 'old-pub'`)[0].processed_at, before);
  assert.equal(rows(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE source_id LIKE 'bootstrap:%'`)[0].count, 2);
  // A legacy retry with its original payload (paletteIds, fractional
  // magnitude) is accepted as a correction without activating palettes or
  // applying new effects.
  const retried = saveNewsEvent(dir, { id: 'old-pub', title: 'Old published, corrected', body: 'B',
    status: 'published', publishedAt: null, paletteIds: ['electronics'],
    marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 0.85 }] }, { now: day + 5000 });
  assert.equal(retried.title, 'Old published, corrected');
  assert.equal(retried.publishedAt, new Date(day).toISOString());
  assert.equal(rows(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE event_id = 'old-pub'`)[0].count, 0);
  // Old drafts stay editable; publishing one still requires whole index
  // points, so the placeholder payload must be modernized first. The
  // modernized draft may also retarget its effects: drafts are free.
  assert.throws(() => saveNewsEvent(dir, { id: 'old-draft', title: 'T', body: 'B', status: 'published',
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 0.85 }] }, { now: day + 6000 }),
    /invalid_market_effects/);
  assert.equal(getNewsEvent(dir, 'old-draft').status, 'draft');
  const modernized = saveNewsEvent(dir, { id: 'old-draft', title: 'T', body: 'B', status: 'published',
    marketEffects: [{ category: 'vehicles', direction: 'up', magnitude: 2 }] }, { now: day + 7000 });
  assert.equal(modernized.publishedAt, new Date(day + 7000).toISOString());
  // Bootstrap +30 on wine still consumes the absolute budget there.
  assert.throws(() => publish(dir, 'over-wine', [{ category: 'wine', direction: 'up', magnitude: 1 }], day + 8000),
    /market_effect_budget/);
});

test('a database failure mid-publication leaves row, receipt and effects untouched', async t => {
  const dir = await fixture(t);
  publish(dir, 'seed', [{ category: 'tools', direction: 'up', magnitude: 1 }], day);
  // Sabotage the victim's effect insert with a colliding source id.
  withDatabase(dir, db => db.prepare(`INSERT INTO market_effects
    (source_id, event_id, category, delta, starts_at, ends_at) VALUES ('news:victim:tools', NULL, 'tools', 1, ?, ?)`)
    .run(day, day + EFFECT_DURATION_MS));
  assert.throws(() => publish(dir, 'victim', [{ category: 'tools', direction: 'up', magnitude: 1 }], day + 1000), Error);
  assert.equal(getNewsEvent(dir, 'victim'), null);
  assert.deepEqual(rows(dir, 'SELECT event_id FROM news_publications WHERE event_id = ?', 'victim'), []);
  assert.equal(rows(dir, 'SELECT COUNT(*) AS count FROM market_effects WHERE event_id = ?', 'victim')[0].count, 0);
  assert.equal(rows(dir, 'SELECT COUNT(*) AS count FROM market_effects')[0].count, 2);
});

test('arbitrary-time snapshots coexist with the hourly grid', async t => {
  const dir = await fixture(t);
  publish(dir, 'story', [{ category: 'wine', direction: 'up', magnitude: 10 }], day);
  const at = day + 36 * hour; // 00:30, off the grid
  snapshotMarketState(dir, { now: at });
  const history = marketHistory(dir, 'wine', { now: at });
  assert.equal(history[0].indexValue, 105);
  assert.equal(history[0].capturedAt, new Date(at).toISOString());
  assert.ok(history.length > 1);
  assert.ok(history.slice(1).every(entry => entry.capturedAt.endsWith(':00:00.000Z')));
});
