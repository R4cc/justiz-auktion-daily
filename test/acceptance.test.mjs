import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDataStore, withDatabase } from '../src/database.mjs';
import { ensureNewsSchema, getNewsEvent, saveNewsEvent } from '../src/news.mjs';
import { marketHistory, marketState } from '../src/market.mjs';

// Acceptance pass for the durable news publication + deterministic market
// simulation contract (docs §"Global market state" / §"News events"). Every
// scenario uses injected clocks and temporary SQLite databases and asserts
// concrete index values and database row counts — never just "did not throw".
const hour = 3600_000;
const EFFECT_MS = 259_200_000; // exactly 72 hours
// Deliberately off the hourly grid so activation/boundary math is exercised.
const t0 = Date.parse('2026-03-01T10:15:00Z');

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-acceptance-'));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

const publish = (dir, id, effects, at) => saveNewsEvent(dir,
  { id, title: `Story ${id}`, body: 'Body text.', status: 'published', marketEffects: effects }, { now: at });
const indexAt = (dir, category, at) => marketState(dir, { now: at })
  .categories.find(entry => entry.category === category).currentIndex;
const count = (dir, sql, ...params) => withDatabase(dir, db => db.prepare(sql).get(...params).count);
const rows = (dir, sql, ...params) => withDatabase(dir, db => db.prepare(sql).all(...params));

test('acceptance: down 15 at t0 reads exactly 85, 92.5 and 100 at 0h/36h/72h', async t => {
  const dir = await fixture(t);
  publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], t0);
  assert.equal(indexAt(dir, 'electronics', t0), 85);
  assert.equal(indexAt(dir, 'electronics', t0 + 36 * hour), 92.5);
  assert.equal(indexAt(dir, 'electronics', t0 + 72 * hour), 100);
  // Exactly one persisted effect row carries the whole contract.
  const [effect] = rows(dir, `SELECT event_id, category, delta, starts_at, ends_at FROM market_effects`);
  assert.deepEqual({ event_id: effect.event_id, category: effect.category, delta: effect.delta },
    { event_id: 'crash', category: 'electronics', delta: -15 });
  assert.equal(effect.starts_at, t0);
  assert.equal(effect.ends_at, t0 + EFFECT_MS);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM market_effects'), 1);
  // Neutral categories are untouched by the crash.
  assert.equal(indexAt(dir, 'wine', t0 + 36 * hour), 100);
});

test('acceptance: frequent reads and no reads until 36h produce identical indexes and history', async t => {
  const frequent = await fixture(t);
  const sparse = await fixture(t);
  for (const dir of [frequent, sparse]) {
    publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], t0);
  }
  for (let offset = 6; offset <= 30; offset += 6) indexAt(frequent, 'electronics', t0 + offset * hour);
  const at = t0 + 36 * hour;
  assert.equal(indexAt(frequent, 'electronics', at), 92.5);
  assert.equal(indexAt(sparse, 'electronics', at), 92.5);
  // Identical reconstructed hourly history, not just the headline index.
  // Boundaries sit on the hourly grid, so elapsed decay at the newest boundary
  // is 35.75h (t0 is 10:15): index(B) = 85 + 15·B/72, rounded to two decimals.
  const frequentHistory = marketHistory(frequent, 'electronics', { now: at });
  assert.deepEqual(marketHistory(sparse, 'electronics', { now: at }), frequentHistory);
  assert.equal(frequentHistory.length, 36);
  assert.equal(frequentHistory[0].capturedAt, '2026-03-02T22:00:00.000Z');
  assert.equal(frequentHistory[frequentHistory.length - 1].capturedAt, '2026-03-01T11:00:00.000Z');
  assert.equal(frequentHistory[0].indexValue, 92.45); // 35.75h elapsed
  assert.equal(frequentHistory[frequentHistory.length - 1].indexValue, 85.16); // 0.75h elapsed
  assert.deepEqual(frequentHistory.map(entry => entry.indexValue),
    frequentHistory.map(entry => {
      const elapsedHours = (Date.parse(entry.capturedAt) - t0) / hour;
      return Math.round((85 + 15 * elapsedHours / 72) * 100) / 100;
    }));
  // Row counts agree too: one boundary row per category per hour since activation.
  assert.equal(count(frequent, `SELECT COUNT(*) AS count FROM market_snapshots WHERE category = 'electronics'`), 36);
  assert.equal(count(sparse, `SELECT COUNT(*) AS count FROM market_snapshots WHERE category = 'electronics'`), 36);
});

test('acceptance: reopen SQLite and retry the publication: one receipt, one effect, unchanged publishedAt', async t => {
  const dir = await fixture(t);
  const published = publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], t0);
  closeDataStore(dir);
  // Retry ten hours later with the original economic payload.
  const retry = publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], t0 + 10 * hour);
  assert.equal(retry.publishedAt, published.publishedAt);
  assert.equal(retry.publishedAt, new Date(t0).toISOString());
  assert.equal(getNewsEvent(dir, 'crash').updatedAt, new Date(t0 + 10 * hour).toISOString());
  // Exactly one receipt and one effect; decay was not restarted.
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM news_publications WHERE event_id = 'crash'`), 1);
  assert.deepEqual(rows(dir, `SELECT kind, processed_at FROM news_publications WHERE event_id = 'crash'`)
    .map(row => [row.kind, row.processed_at]), [['applied', t0]]);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE event_id = 'crash'`), 1);
  assert.deepEqual(rows(dir, `SELECT delta, starts_at FROM market_effects WHERE event_id = 'crash'`)
    .map(row => [row.delta, row.starts_at]), [[-15, t0]]);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM news_events'), 1);
  // The index at retry time still reflects the ORIGINAL schedule, not a reroll:
  // ten hours of decay on a down-15 effect → 100 − 15·(62/72) = 87.0833… → 87.08.
  assert.equal(indexAt(dir, 'electronics', t0 + 10 * hour), 87.08);
});

test('acceptance: archiving after one hour does not stop the recovery', async t => {
  const dir = await fixture(t);
  const published = publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], t0);
  const archived = saveNewsEvent(dir, { ...published, status: 'archived', publishedAt: published.publishedAt },
    { now: t0 + hour });
  assert.equal(archived.status, 'archived');
  assert.equal(archived.publishedAt, published.publishedAt);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM market_effects'), 1); // effect survives archiving
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM news_publications WHERE kind = 'applied'`), 1);
  // Recovery continues on the original schedule: 85.21 one hour in (15 · 71/72
  // still active), 92.71 thirty-seven hours in, back to 100 at expiry.
  assert.equal(indexAt(dir, 'electronics', t0 + hour), 85.21);
  assert.equal(indexAt(dir, 'electronics', t0 + 37 * hour), 92.71);
  assert.equal(indexAt(dir, 'electronics', t0 + 72 * hour), 100);
});

test('acceptance: opposing effects consume the same absolute 30-point budget', async t => {
  const dir = await fixture(t);
  publish(dir, 'boom', [{ category: 'tools', direction: 'up', magnitude: 20 }], t0);
  assert.equal(indexAt(dir, 'tools', t0), 120);
  // The opposing direction does not create headroom: 20 active + 11 new = 31 > 30.
  assert.throws(() => publish(dir, 'counter-huge', [{ category: 'tools', direction: 'down', magnitude: 11 }], t0),
    { status: 409, message: 'market_effect_budget' });
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE category = 'tools'`), 1);
  assert.equal(getNewsEvent(dir, 'counter-huge'), null);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM news_publications WHERE event_id = 'counter-huge'`), 0);
  // The fitting opposite is accepted and the index reflects both signs.
  publish(dir, 'counter', [{ category: 'tools', direction: 'down', magnitude: 10 }], t0 + 1000);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE category = 'tools'`), 2);
  assert.equal(indexAt(dir, 'tools', t0 + 1000), 110);
  // One second later even +1 would exceed the budget: 20·remaining + 10·remaining + 1 > 30.
  assert.throws(() => publish(dir, 'another', [{ category: 'tools', direction: 'up', magnitude: 1 }], t0 + 2000),
    { status: 409, message: 'market_effect_budget' });
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE category = 'tools'`), 2);
  assert.equal(indexAt(dir, 'tools', t0 + 2000), 110);
});

test('acceptance: a rejected multi-category publication leaves every category and the news row untouched', async t => {
  const dir = await fixture(t);
  publish(dir, 'boom', [{ category: 'tools', direction: 'up', magnitude: 20 }], t0);
  publish(dir, 'boom-2', [{ category: 'tools', direction: 'up', magnitude: 10 }], t0 + 1000);
  assert.equal(indexAt(dir, 'tools', t0 + 2000), 130); // 30 active points, budget exhausted
  assert.equal(indexAt(dir, 'wine', t0 + 2000), 100);
  const categoriesBefore = marketState(dir, { now: t0 + 2000 }).categories.map(entry => [entry.category, entry.currentIndex]);
  const eventsBefore = rows(dir, `SELECT * FROM news_events ORDER BY id`);
  const receiptsBefore = count(dir, 'SELECT COUNT(*) AS count FROM news_publications');
  // wine fits (0 + 5 <= 30) but tools busts (30 + 1 > 30): the WHOLE event dies.
  assert.throws(() => publish(dir, 'mixed-bust', [
    { category: 'wine', direction: 'up', magnitude: 5 },
    { category: 'tools', direction: 'up', magnitude: 1 }], t0 + 2000), { status: 409, message: 'market_effect_budget' });
  assert.deepEqual(marketState(dir, { now: t0 + 2000 }).categories.map(entry => [entry.category, entry.currentIndex]),
    categoriesBefore);
  assert.equal(indexAt(dir, 'wine', t0 + 2000), 100);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE category = 'wine'`), 0);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE category = 'tools'`), 2);
  assert.deepEqual(rows(dir, `SELECT * FROM news_events ORDER BY id`), eventsBefore);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM news_publications'), receiptsBefore);
  assert.equal(getNewsEvent(dir, 'mixed-bust'), null);
});

test('acceptance: long downtime backfills exactly 720 hourly boundaries inside 30-day retention', async t => {
  const dir = await fixture(t);
  publish(dir, 'crash', [{ category: 'electronics', direction: 'down', magnitude: 15 }], t0);
  indexAt(dir, 'electronics', t0); // activation-time read fills nothing yet
  const now = t0 + 40 * 24 * hour; // 40 days offline: beyond retention and the 720 cap
  const state = marketState(dir, { now });
  assert.equal(state.categories.find(entry => entry.category === 'electronics').currentIndex, 100);
  const history = marketHistory(dir, 'electronics', { now, limit: 1000 });
  assert.equal(history.length, 720);
  const newest = Date.parse(history[0].capturedAt);
  const oldest = Date.parse(history[history.length - 1].capturedAt);
  assert.equal(newest, Math.floor(now / hour) * hour);
  assert.equal(oldest, newest - 719 * hour);
  assert.ok(oldest >= now - 30 * 24 * hour - hour); // never older than retention
  // The crashed effect expired long before the retained window began.
  assert.ok(history.every(entry => entry.indexValue === 100));
  // Nothing was fabricated before activation, and effect/receipt rows survive.
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_snapshots
    WHERE captured_at < '2026-03-01T11:00:00.000Z'`), 0);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM market_effects'), 1);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM news_publications WHERE kind = 'applied'`), 1);
  // Total snapshot rows: 720 boundaries × 14 registry categories, exactly.
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM market_snapshots'), 720 * 14);
});

test('acceptance: legacy published placeholder effects are never applied during the upgrade', async t => {
  const dir = await fixture(t);
  // Foundation-era world: published/archived placeholder news with fractional
  // magnitudes (never backed by the simulation), plus one editable draft.
  withDatabase(dir, db => {
    ensureNewsSchema(db);
    const iso = new Date(t0).toISOString();
    const insert = db.prepare(`INSERT INTO news_events
      (id, title, body, status, published_at, palette_ids, palette_windows, market_effects, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run('legacy-pub', 'Old published', 'B', 'published', iso, '[]', '[]',
      '[{"category":"electronics","direction":"up","magnitude":0.85}]', '{}', iso, iso);
    insert.run('legacy-arch', 'Old archived', 'B', 'archived', iso, '[]', '[]',
      '[{"category":"wine","direction":"down","magnitude":2.5}]', '{}', iso, iso);
    insert.run('legacy-draft', 'Old draft', 'B', 'draft', null, '[]', '[]',
      '[{"category":"tools","direction":"up","magnitude":null}]', '{}', iso, iso);
  });
  // Before activation the placeholder world is neutral: placeholders inert.
  const before = marketState(dir, { now: t0 });
  assert.ok(before.categories.every(entry => entry.currentIndex === 100));
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM market_effects'), 0);
  // The upgrade runs with the first real publication.
  publish(dir, 'fresh', [{ category: 'tools', direction: 'up', magnitude: 5 }], t0 + 1000);
  // Legacy receipts: published/archived stamped, draft not.
  assert.deepEqual(rows(dir, `SELECT event_id, kind FROM news_publications ORDER BY event_id`)
    .map(row => [row.event_id, row.kind]), [['fresh', 'applied'], ['legacy-arch', 'legacy'], ['legacy-pub', 'legacy']]);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM news_publications WHERE event_id = 'legacy-draft'`), 0);
  // Exactly one effect row exists — the fresh publication's. The placeholders
  // produced no rows, so electronics and wine stay exactly neutral.
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM market_effects'), 1);
  assert.equal(count(dir, `SELECT COUNT(*) AS count FROM market_effects WHERE event_id LIKE 'legacy-%'`), 0);
  assert.equal(indexAt(dir, 'electronics', t0 + 1000), 100);
  assert.equal(indexAt(dir, 'wine', t0 + 1000), 100);
  assert.equal(indexAt(dir, 'tools', t0 + 1000), 105);
});
