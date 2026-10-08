import { AccountError } from './errors.mjs';
import { createHash } from 'node:crypto';
import { auctionSelectionCategory } from './auction-selection.mjs';
import { tokenValue } from './cases.mjs';
import { getState, setState, transaction, withDatabase } from './database.mjs';
// Cyclic on purpose: market effects carry an FK into news_events, so the
// drift path must be able to guarantee that schema exists. Both modules only
// declare functions at module scope, so the cycle never dereferences a
// half-initialized binding.
import { ensureNewsSchema } from './news.mjs';

// Market categories are the global buckets that future shared price indexes
// attach to. They are intentionally coarser than the German listing categories
// classified in auction-selection.mjs; the mapping table below is the single
// place where the two vocabularies meet. Adding a category is a data-only
// change: append it here and map listing categories onto it.
export const MARKET_CATEGORIES = [
  { id: 'electronics', name: 'Electronics', nameDe: 'Elektronik' },
  { id: 'vehicles', name: 'Vehicles', nameDe: 'Fahrzeuge' },
  { id: 'wine', name: 'Wine & drinks', nameDe: 'Wein & Getränke' },
  { id: 'watches_jewelry', name: 'Watches & jewelry', nameDe: 'Schmuck & Uhren' },
  { id: 'tools', name: 'Tools', nameDe: 'Werkzeuge' },
  { id: 'collectibles', name: 'Collectibles', nameDe: 'Sammlerstücke' },
  { id: 'household', name: 'Household & home', nameDe: 'Haushalt & Wohnen' },
  { id: 'luxury_goods', name: 'Luxury goods', nameDe: 'Luxusgüter' },
  { id: 'bicycles', name: 'Bicycles', nameDe: 'Fahrräder' },
  { id: 'books_media', name: 'Books & media', nameDe: 'Bücher & Medien' },
  { id: 'fashion', name: 'Fashion', nameDe: 'Mode' },
  { id: 'cosmetics', name: 'Cosmetics', nameDe: 'Kosmetik' },
  { id: 'sport_leisure', name: 'Sport & leisure', nameDe: 'Sport & Freizeit' },
  { id: 'other', name: 'Other', nameDe: 'Sonstiges' }
];
const CATEGORY_IDS = new Map(MARKET_CATEGORIES.map(category => [category.id, category]));
// Neutral starting value and the deterministic simulation's fixed parameters.
export const DEFAULT_MARKET_INDEX = 100;
export const EFFECT_DURATION_MS = 72 * 3600_000;     // every effect expires exactly 72h after it starts
export const EFFECT_BUDGET = 30;                     // max absolute active contribution per category
export const INDEX_MIN = 50;
export const INDEX_MAX = 150;
export const SNAPSHOT_INTERVAL_MS = 3600_000;        // hourly UTC snapshot grid
export const SNAPSHOT_RETENTION_MS = 30 * 24 * 3600_000;
export const MAX_BACKFILL_BOUNDARIES = 720;          // per refresh, matching the 30-day retention window
export const SIMULATION_MARKER = 'market_simulation_v1';
export const INTRADAY_MARKER = 'market_intraday_v1';
const HISTORY_CURSOR = 'market_history_through_v1';
export const MARKET_QUOTE_INTERVAL_MS = 60_000;
export const MARKET_HISTORY_RANGES = {
  '1h': { duration: 3600_000, interval: 60_000 },
  '1d': { duration: 24 * 3600_000, interval: 5 * 60_000 },
  '1w': { duration: 7 * 24 * 3600_000, interval: 15 * 60_000 },
  '1m': { duration: 30 * 24 * 3600_000, interval: 3600_000 }
};

// German listing categories (auction-selection.mjs) -> market category ids.
const LISTING_CATEGORY_MAP = {
  Elektronik: 'electronics', Fahrzeuge: 'vehicles', 'Getränke': 'wine',
  Werkzeuge: 'tools', Werkzeug: 'tools', 'Schmuck & Uhren': 'watches_jewelry',
  'Sammlerstücke': 'collectibles', 'Möbel & Wohnen': 'household', 'Haushalt & Garten': 'household',
  'Fahrräder': 'bicycles', 'Bücher & Medien': 'books_media', Mode: 'fashion',
  Kosmetik: 'cosmetics', 'Sport & Freizeit': 'sport_leisure', Sonstiges: 'other'
};

// Case themes (the palette/seizure-story types in cases.mjs) -> market category.
// 'mixed' palettes intentionally span categories and map to null.
const THEME_MARKET_CATEGORIES = {
  cars: 'vehicles', wine: 'wine', electronics: 'electronics', tools: 'tools',
  jewellery: 'watches_jewelry', collectibles: 'collectibles', premium: 'luxury_goods', mixed: null
};

const fail = (code, status) => { throw new AccountError(code, status); };

export function isMarketCategory(id) { return CATEGORY_IDS.has(id); }
export function marketCategory(id) { return CATEGORY_IDS.get(id) || null; }

export function marketCategoryForListingCategory(category) { return LISTING_CATEGORY_MAP[category] ?? null; }

// Auctions are classified live from their listing text; collected items may
// carry a frozen market category (newer finds) or derive one from the German
// listing category saved at open time (legacy items).
export function marketCategoryForAuction(auction) {
  return marketCategoryForListingCategory(auctionSelectionCategory(auction || {}));
}

export function marketCategoryForItem(item) {
  if (item?.kind === 'case') return null;
  if (isMarketCategory(item?.marketCategory)) return item.marketCategory;
  return marketCategoryForListingCategory(item?.category) ?? marketCategoryForAuction(item || {});
}

export function marketCategoryForTheme(theme) {
  return theme in THEME_MARKET_CATEGORIES ? THEME_MARKET_CATEGORIES[theme] : null;
}

// News effects contribute signed index points and decay linearly over 72h.
// The persistent trend point is the baseline; reads reconstruct it and the
// effects from stored rows, without sampling randomness.
export function effectContribution(delta, startsAt, at) {
  const remaining = Math.min(1, Math.max(0, 1 - (at - startsAt) / EFFECT_DURATION_MS));
  return delta * remaining;
}

function indexFromEffects(effects, at, base = DEFAULT_MARKET_INDEX) {
  const index = base
    + effects.reduce((sum, effect) => sum + effectContribution(effect.delta, effect.starts_at, at), 0);
  // News can push a trending category beyond its allowed price band.
  return Math.min(INDEX_MAX, Math.max(INDEX_MIN, index));
}

export function computeCategoryIndex(db, category, at) {
  const trend = db.prepare(`SELECT index_value FROM market_trend_points
    WHERE category = ? AND bucket <= ? ORDER BY bucket DESC LIMIT 1`)
    .get(category, Math.floor(at / MARKET_DRIFT_INTERVAL_MS));
  const effects = db.prepare(`SELECT source_id, delta, starts_at FROM market_effects
    WHERE category = ? AND starts_at <= ? AND ends_at > ?`).all(category, at, at)
    .filter(effect => !trend || !effect.source_id.startsWith('drift:'));
  return indexFromEffects(effects, at, (trend?.index_value ?? DEFAULT_MARKET_INDEX)
    + intradayMovement(db, category, at)) * marketMultiplierAt(db, category, at);
}

// Unrounded, activation-aware index read for domain valuation (e.g. palette
// edition pricing): computed from trend points and effects after activation, the stored
// placeholder value before it. Deliberately not gated by feature flags —
// persisted global market state is always the valuation source of truth.
export function marketIndexAt(db, category, at) {
  if (!isMarketCategory(category)) return DEFAULT_MARKET_INDEX;
  if (simulationActivation(db) === null) {
    const row = db.prepare('SELECT current_index FROM market_categories WHERE category = ?').get(category);
    return (row ? row.current_index : DEFAULT_MARKET_INDEX) * marketMultiplierAt(db, category, at);
  }
  return computeCategoryIndex(db, category, at);
}

// Public indexes are rounded to two decimals; internal arithmetic stays unrounded.
export const roundIndex = index => Math.round(index * 100) / 100;

export function ensureMarketSchema(db, now) {
  db.exec(`CREATE TABLE IF NOT EXISTS market_categories (
    category TEXT PRIMARY KEY,
    base_index REAL NOT NULL,
    current_index REAL NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`);
  db.exec(`CREATE TABLE IF NOT EXISTS market_snapshots (
    category TEXT NOT NULL REFERENCES market_categories(category) ON DELETE CASCADE,
    index_value REAL NOT NULL,
    captured_at TEXT NOT NULL,
    PRIMARY KEY(category, captured_at)
  ) STRICT`);
  db.exec(`CREATE TABLE IF NOT EXISTS admin_market_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL, request_id TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES market_categories(category),
    action TEXT NOT NULL CHECK(action IN ('adjust', 'reset')), percent INTEGER,
    multiplier REAL NOT NULL CHECK(multiplier >= 0.001 AND multiplier <= 100),
    before_index REAL NOT NULL, after_index REAL NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(admin_id, request_id)
  ) STRICT`);
  db.exec(`CREATE INDEX IF NOT EXISTS admin_market_adjustments_category_time
    ON admin_market_adjustments(category, created_at DESC, id DESC)`);
  // Registry additions are seeded on first touch; existing rows are never touched.
  const seed = db.prepare(`INSERT OR IGNORE INTO market_categories
    (category, base_index, current_index, updated_at) VALUES (?, ?, ?, ?)`);
  const updatedAt = new Date(now).toISOString();
  for (const { id } of MARKET_CATEGORIES) seed.run(id, DEFAULT_MARKET_INDEX, DEFAULT_MARKET_INDEX, updatedAt);
}

// Admin controls multiply the simulated index after its normal price band.
// The timestamped journal preserves earlier valuations and survives drift ticks.
export function marketMultiplierAt(db, category, at) {
  return db.prepare(`SELECT multiplier FROM admin_market_adjustments
    WHERE category = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(category, at)?.multiplier ?? 1;
}

// Persisted simulation effects. News publications own 'news:<eventId>:<category>'
// rows; the one-time activation migration owns 'bootstrap:<category>' rows.
export function ensureMarketEffectsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS market_effects (
    source_id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES news_events(id),
    category TEXT NOT NULL REFERENCES market_categories(category),
    delta REAL NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    UNIQUE(event_id, category)
  ) STRICT`);
  db.exec(`CREATE INDEX IF NOT EXISTS market_effects_active ON market_effects(category, starts_at, ends_at)`);
  db.exec(`CREATE TABLE IF NOT EXISTS market_trend_points (
    category TEXT NOT NULL REFERENCES market_categories(category),
    bucket INTEGER NOT NULL,
    index_value REAL NOT NULL,
    momentum REAL NOT NULL,
    direction INTEGER NOT NULL,
    regime_until INTEGER NOT NULL,
    PRIMARY KEY(category, bucket)
  ) STRICT`);
}

// The durable activation marker in app_state. Its presence switches reads from
// the placeholder world (stored current_index values) to the deterministic
// effect-based simulation and makes the migration exactly-once.
export function simulationActivation(db) {
  const activatedAtMs = getState(db, SIMULATION_MARKER, null)?.activatedAtMs;
  return Number.isFinite(activatedAtMs) ? activatedAtMs : null;
}

export function markSimulationActivation(db, now) {
  setState(db, SIMULATION_MARKER, { activatedAt: new Date(now).toISOString(), activatedAtMs: now });
}

// Activation migration step: every legacy manually-set category index becomes
// a bootstrap effect that decays to neutral over one effect duration. Legacy
// out-of-range values are deliberately bounded into the production range
// first (documented in docs/auction-economy-foundation.md), fractional deltas
// are preserved, and exactly-neutral categories get no effect at all.
export function bootstrapMarketEffects(db, now) {
  const insert = db.prepare(`INSERT OR IGNORE INTO market_effects
    (source_id, event_id, category, delta, starts_at, ends_at) VALUES (?, NULL, ?, ?, ?, ?)`);
  const reset = db.prepare('UPDATE market_categories SET base_index = ?, current_index = ?, updated_at = ? WHERE category = ?');
  const updatedAt = new Date(now).toISOString();
  for (const row of db.prepare('SELECT category, current_index FROM market_categories').all()) {
    const bounded = Math.min(INDEX_MAX, Math.max(INDEX_MIN, row.current_index));
    const delta = bounded - DEFAULT_MARKET_INDEX;
    if (delta !== 0) insert.run(`bootstrap:${row.category}`, row.category, delta, now, now + EFFECT_DURATION_MS);
    reset.run(DEFAULT_MARKET_INDEX, bounded, updatedAt, row.category);
  }
}

// Budget rule: the absolute sum of active contributions at `now` plus the new
// magnitude may not exceed EFFECT_BUDGET per affected category. Opposing
// effects consume the same absolute budget. Rejects the whole publication.
export function assertEffectBudget(db, effects, now) {
  for (const effect of effects) {
    const active = db.prepare(`SELECT delta, starts_at FROM market_effects
      WHERE category = ? AND starts_at <= ? AND ends_at > ?`).all(effect.category, now, now);
    const used = active.reduce((sum, row) => sum + Math.abs(effectContribution(row.delta, row.starts_at, now)), 0);
    if (used + effect.magnitude > EFFECT_BUDGET) fail('market_effect_budget', 409);
  }
}

// Effects are always written through publication; plain INSERTs so that the
// primary key makes re-application a hard failure inside the transaction.
export function insertNewsMarketEffects(db, eventId, effects, now) {
  const insert = db.prepare(`INSERT INTO market_effects
    (source_id, event_id, category, delta, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const effect of effects) {
    const delta = effect.direction === 'up' ? effect.magnitude : -effect.magnitude;
    insert.run(`news:${eventId}:${effect.category}`, eventId, effect.category, delta, now, now + EFFECT_DURATION_MS);
  }
}

// Persistent two-hour trend points make price paths move over weeks. Momentum
// carries a category through a multi-day regime; small noise varies the path,
// while rare shocks create a visible jump or crash. All draws are keyed by
// category and bucket, so a restart or sparse runtime produces the same path.
// News remains a separate, short-lived effect on top of this baseline.
export const MARKET_DRIFT_INTERVAL_MS = 2 * 3600_000;
const TREND_BACKFILL_BUCKETS = 360; // 30 days, matching history retention
const trendDraw = key => parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16) / 0x100000000;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Intraday order flow overlays the durable longer-term trend. Correlated
// market moves and category-specific flows have different time scales and
// volatility. Hash-keyed anchors interpolate causally from the previous
// anchor to the current one, producing runs, reversals and short bursts.
// Every player/domain sees the same minute quote, independent of request
// frequency, runtime ticks or restarts; no random draw happens on a read.
function flowSignal(category, minute) {
  const flow = (key, period) => {
    const bucket = Math.floor(minute / period), fraction = (minute % period) / period;
    const previous = trendDraw(`intraday:${key}:${period}:${bucket - 1}`) * 2 - 1;
    const current = trendDraw(`intraday:${key}:${period}:${bucket}`) * 2 - 1;
    return previous + (current - previous) * fraction;
  };
  const volatility = .8 + trendDraw(`intraday:${category}:volatility`) * .5;
  return (flow(category, 3) * .9 + flow(category, 15) * 2.8 + flow(category, 90) * 4.2) * volatility
    + flow('shared-market', 10) * 1.2 + flow('shared-market', 60) * 2;
}

function intradayMovement(db, category, at) {
  const activation = getState(db, INTRADAY_MARKER, null)?.activatedAtMs;
  if (!Number.isFinite(activation) || at < activation) return 0;
  const minute = Math.floor(at / MARKET_QUOTE_INTERVAL_MS);
  const initialMinute = Math.floor(activation / MARKET_QUOTE_INTERVAL_MS);
  // Preserve the existing quote on deployment, then release the old anchor
  // over an hour. Earlier prices and saved receipts retain their meaning.
  return clamp(flowSignal(category, minute)
    - flowSignal(category, initialMinute) * Math.exp(-(minute - initialMinute) / 60), -12, 12);
}

export function applyMarketDrift(db, now, random = null) {
  ensureNewsSchema(db);
  ensureMarketSchema(db, now);
  ensureMarketEffectsSchema(db);
  if (simulationActivation(db) === null) {
    bootstrapMarketEffects(db, now);
    markSimulationActivation(db, now);
  }
  if (!getState(db, INTRADAY_MARKER, null)) {
    setState(db, INTRADAY_MARKER, { activatedAtMs: now });
  }
  const bucket = Math.floor(now / MARKET_DRIFT_INTERVAL_MS);
  const insert = db.prepare(`INSERT INTO market_trend_points
    (category, bucket, index_value, momentum, direction, regime_until) VALUES (?, ?, ?, ?, ?, ?)`);
  let applied = false, earliestStep = Infinity;
  for (const [ordinal, { id }] of MARKET_CATEGORIES.entries()) {
    let previous = db.prepare(`SELECT * FROM market_trend_points WHERE category = ?
      ORDER BY bucket DESC LIMIT 1`).get(id);
    if (!previous) {
      // Carry the old two-hour drift forward without a discontinuity. End its
      // effect at this boundary so it still reconstructs older snapshots.
      const old = db.prepare(`SELECT delta, starts_at FROM market_effects
        WHERE source_id = ? AND starts_at <= ? AND ends_at > ?`).get(`drift:${id}`, now, now);
      const carry = old ? effectContribution(old.delta, old.starts_at, now) : 0;
      db.prepare('UPDATE market_effects SET ends_at = ? WHERE source_id = ? AND ends_at > ?')
        .run(now, `drift:${id}`, now);
      const direction = ordinal % 2 ? -1 : 1;
      previous = { bucket: bucket - 1, index_value: clamp(100 + carry, INDEX_MIN, INDEX_MAX),
        momentum: direction * .24, direction, regime_until: bucket + 120 + Math.floor(trendDraw(`${id}:initial`) * 96) };
    }
    const first = Math.max(previous.bucket + 1, bucket - TREND_BACKFILL_BUCKETS + 1);
    for (let step = first; step <= bucket; step++) {
      const draw = name => random ? random() : trendDraw(`${id}:${step}:${name}`);
      let direction = previous.direction, regimeUntil = previous.regime_until;
      if (step >= regimeUntil) {
        direction = previous.index_value > 130 ? -1 : previous.index_value < 70 ? 1 : draw('regime') < .5 ? -1 : 1;
        regimeUntil = step + 84 + Math.floor(draw('duration') * 132); // 7–18 days
      }
      let momentum = clamp(previous.momentum * .94 + direction * .025 + (draw('noise') - .5) * .12, -.7, .7);
      const shock = draw('shock') < .007
        ? (draw('shock-sign') < .5 ? -1 : 1) * (6 + draw('shock-size') * 12) : 0;
      const index = clamp(previous.index_value + momentum + shock, INDEX_MIN, INDEX_MAX);
      if ((index === INDEX_MAX && momentum > 0) || (index === INDEX_MIN && momentum < 0)) {
        direction = -direction;
        momentum = -momentum * .65;
        regimeUntil = step + 84 + Math.floor(draw('rebound') * 84);
      }
      insert.run(id, step, index, momentum, direction, regimeUntil);
      previous = { bucket: step, index_value: index, momentum, direction, regime_until: regimeUntil };
      applied = true; earliestStep = Math.min(earliestStep, step);
    }
  }
  if (applied) {
    const rebuildFrom = Math.max(earliestStep * MARKET_DRIFT_INTERVAL_MS, simulationActivation(db));
    db.prepare('DELETE FROM market_snapshots WHERE captured_at >= ?').run(new Date(rebuildFrom).toISOString());
    const through = getState(db, HISTORY_CURSOR, null);
    if (Number.isFinite(through) && through >= rebuildFrom) {
      setState(db, HISTORY_CURSOR, Math.ceil(rebuildFrom / SNAPSHOT_INTERVAL_MS) * SNAPSHOT_INTERVAL_MS - SNAPSHOT_INTERVAL_MS);
    }
  }
  return { applied, bucket };
}

// Runtime wrapper: one transaction per tick. The persisted bucket marker
// makes the 30-second economy ticks and restarts inside the same window
// idempotent — a regime is sampled exactly once per category per window.
export function tickMarketDrift(dataDir, { now = Date.now(), random = null } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => applyMarketDrift(db, now, random)));
}

// Fill the hourly UTC snapshot grid through floor(now/hour)*hour, starting at
// the first hour boundary at/after activation. Values are reconstructed from
// effects at each boundary — never copied from today's index. At most
// MAX_BACKFILL_BOUNDARIES boundaries are (re)computed per refresh, so long
// downtime simply leaves unretained hours unfilled. Snapshots older than the
// retention window are deleted; effect and receipt records are never touched.
function refreshMarketHistory(db, now, activationMs) {
  const last = Math.floor(now / SNAPSHOT_INTERVAL_MS) * SNAPSHOT_INTERVAL_MS;
  const first = Math.ceil(activationMs / SNAPSHOT_INTERVAL_MS) * SNAPSHOT_INTERVAL_MS;
  const retentionFloor = Math.ceil((now - SNAPSHOT_RETENTION_MS) / SNAPSHOT_INTERVAL_MS) * SNAPSHOT_INTERVAL_MS;
  // Only extend a fully built grid. Arbitrary-time snapshots do not advance
  // this cursor, and drift backfills rewind it when invalidating history.
  const through = getState(db, HISTORY_CURSOR, null);
  let start = Math.max(first, retentionFloor, Number.isFinite(through) ? through + SNAPSHOT_INTERVAL_MS : -Infinity);
  if (start <= last) {
    if (last - start > (MAX_BACKFILL_BOUNDARIES - 1) * SNAPSHOT_INTERVAL_MS) {
      start = last - (MAX_BACKFILL_BOUNDARIES - 1) * SNAPSHOT_INTERVAL_MS;
    }
    const effects = db.prepare(`SELECT source_id, category, delta, starts_at FROM market_effects
      WHERE starts_at <= ? AND ends_at > ?`).all(last, start);
    const byCategory = new Map(MARKET_CATEGORIES.map(({ id }) => [id, []]));
    for (const effect of effects) byCategory.get(effect.category)?.push(effect);
    const trends = new Map(MARKET_CATEGORIES.map(({ id }) => [id, []]));
    const firstBucket = Math.floor(start / MARKET_DRIFT_INTERVAL_MS);
    const lastBucket = Math.floor(last / MARKET_DRIFT_INTERVAL_MS);
    for (const point of db.prepare(`SELECT category, bucket, index_value FROM market_trend_points
      WHERE bucket BETWEEN ? AND ? ORDER BY category, bucket`).all(firstBucket, lastBucket)) {
      trends.get(point.category)?.push(point);
    }
    for (const { id } of MARKET_CATEGORIES) {
      const prior = db.prepare(`SELECT category, bucket, index_value FROM market_trend_points
        WHERE category = ? AND bucket < ? ORDER BY bucket DESC LIMIT 1`).get(id, firstBucket);
      if (prior) trends.get(id).unshift(prior);
    }
    const modifiers = new Map(MARKET_CATEGORIES.map(({ id }) => [id, []]));
    for (const row of db.prepare(`SELECT category, multiplier, created_at FROM admin_market_adjustments
      WHERE created_at >= ? AND created_at <= ? ORDER BY created_at, id`).all(start, last)) modifiers.get(row.category)?.push(row);
    for (const { id } of MARKET_CATEGORIES) {
      const prior = db.prepare(`SELECT multiplier, created_at FROM admin_market_adjustments
        WHERE category = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(id, start);
      if (prior) modifiers.get(id).unshift(prior);
    }
    const modifierPositions = new Map(MARKET_CATEGORIES.map(({ id }) => [id, -1]));
    const positions = new Map(MARKET_CATEGORIES.map(({ id }) => [id, 0]));
    const insert = db.prepare('INSERT OR IGNORE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)');
    for (let boundary = start; boundary <= last; boundary += SNAPSHOT_INTERVAL_MS) {
      const capturedAt = new Date(boundary).toISOString();
      for (const { id } of MARKET_CATEGORIES) {
        // Per-boundary activation filter: an effect loaded for the window may
        // start after an earlier boundary, and effectContribution clamps such
        // pre-start reads to full strength — the same rule as the live
        // computeCategoryIndex (starts_at <= at) must hold retroactively.
        const points = trends.get(id), atBucket = Math.floor(boundary / MARKET_DRIFT_INTERVAL_MS);
        let position = positions.get(id);
        while (position + 1 < points.length && points[position + 1].bucket <= atBucket) position++;
        positions.set(id, position);
        const trend = points[position]?.bucket <= atBucket ? points[position] : null;
        const baseline = trend?.index_value ?? DEFAULT_MARKET_INDEX;
        const active = byCategory.get(id).filter(effect => effect.starts_at <= boundary
          && (!trend || !effect.source_id.startsWith('drift:')));
        const changes = modifiers.get(id);
        let modifierPosition = modifierPositions.get(id);
        while (modifierPosition + 1 < changes.length && changes[modifierPosition + 1].created_at <= boundary) modifierPosition++;
        modifierPositions.set(id, modifierPosition);
        insert.run(id, indexFromEffects(active, boundary, baseline + intradayMovement(db, id, boundary)) * (changes[modifierPosition]?.multiplier ?? 1), capturedAt);
      }
    }
  }
  if (last >= first && (!Number.isFinite(through) || last > through)) setState(db, HISTORY_CURSOR, last);
  // Drift backfills can rebuild snapshots. Restore each actual admin change
  // from its receipt, including changes between hourly boundaries.
  const receiptSnapshot = db.prepare('INSERT OR REPLACE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)');
  for (const row of db.prepare(`SELECT category, after_index, created_at FROM admin_market_adjustments
    WHERE created_at >= ? AND created_at <= ? ORDER BY created_at, id`).all(now - SNAPSHOT_RETENTION_MS, now)) {
    receiptSnapshot.run(row.category, row.after_index, new Date(row.created_at).toISOString());
  }
  db.prepare('DELETE FROM market_snapshots WHERE captured_at < ?').run(new Date(now - SNAPSHOT_RETENTION_MS).toISOString());
}

// market_categories.current_index is a cache refreshed on reads; the source of
// truth is the persisted trends, effects and admin adjustment journal.
function materializeMarketIndexes(db, now) {
  const updatedAt = new Date(now).toISOString();
  const update = db.prepare('UPDATE market_categories SET current_index = ?, updated_at = ? WHERE category = ?');
  for (const { id } of MARKET_CATEGORIES) update.run(computeCategoryIndex(db, id, now), updatedAt, id);
}

// Global, shared across all players: one row per market category. Before the
// simulation is activated (legacy databases that have never published under
// the new rules) this keeps returning the stored placeholder values; after
// activation it computes from effects with one captured now for the whole
// response. Both modes return the same shape.
export function marketState(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => {
    ensureMarketSchema(db, now);
    ensureMarketEffectsSchema(db);
    const activation = simulationActivation(db);
    if (activation === null) {
      const rows = new Map(db.prepare('SELECT * FROM market_categories').all().map(row => [row.category, row]));
      const categories = MARKET_CATEGORIES.filter(({ id }) => rows.has(id)).map(({ id, name, nameDe }) => {
        const row = rows.get(id);
        return { category: id, name, nameDe, baseIndex: row.base_index, currentIndex: roundIndex(row.current_index * marketMultiplierAt(db, id, now)), updatedAt: row.updated_at };
      });
      return { updatedAt: categories.reduce((latest, c) => c.updatedAt > latest ? c.updatedAt : latest, '') || null, categories };
    }
    transaction(db, () => {
      refreshMarketHistory(db, now, activation);
      materializeMarketIndexes(db, now);
    });
    const updatedAt = new Date(now).toISOString();
    const rows = new Map(db.prepare('SELECT * FROM market_categories').all().map(row => [row.category, row]));
    const categories = MARKET_CATEGORIES.filter(({ id }) => rows.has(id)).map(({ id, name, nameDe }) => {
      const row = rows.get(id);
      const currentIndex = roundIndex(row.current_index);
      const previous = computeCategoryIndex(db, id, Math.max(activation, now - 3600_000));
      return { category: id, name, nameDe, baseIndex: row.base_index, currentIndex, updatedAt: row.updated_at,
        change1h: roundIndex(row.current_index - previous),
        changePercent1h: previous > 0 ? roundIndex((row.current_index / previous - 1) * 100) : 0 };
    });
    return { updatedAt, categories };
  });
}

// The placeholder simulation's manual setter. Still usable for legacy/manual
// setup BEFORE activation; once the deterministic simulation owns the index,
// manual mutation is rejected outright.
export function setMarketIndex(dataDir, category, index, { now = Date.now(), snapshot = false } = {}) {
  if (!isMarketCategory(category)) fail('unknown_category', 404);
  if (!Number.isFinite(index) || index <= 0) fail('invalid_index');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureMarketSchema(db, now);
    ensureMarketEffectsSchema(db);
    if (simulationActivation(db) !== null) fail('market_simulation_owned', 409);
    const updatedAt = new Date(now).toISOString();
    if (!db.prepare('UPDATE market_categories SET current_index = ?, updated_at = ? WHERE category = ?')
      .run(index, updatedAt, category).changes) fail('unknown_category', 404);
    if (snapshot) db.prepare('INSERT OR REPLACE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)')
      .run(category, index, updatedAt);
    return { category, currentIndex: index, updatedAt };
  }));
}

// Compatibility helper: records the computed state for an arbitrary moment.
// After activation the recorded values are reconstructed from effects at
// `now`; arbitrary-time snapshots simply coexist with the hourly grid.
export function snapshotMarketState(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureMarketSchema(db, now);
    ensureMarketEffectsSchema(db);
    const activation = simulationActivation(db);
    const capturedAt = new Date(now).toISOString();
    const insert = db.prepare('INSERT OR REPLACE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)');
    for (const { id } of MARKET_CATEGORIES) {
      insert.run(id, activation !== null ? computeCategoryIndex(db, id, now)
        : marketIndexAt(db, id, now), capturedAt);
    }
    return { capturedAt };
  }));
}

export function marketHistory(dataDir, category, { now = Date.now(), limit = 100, range = null } = {}) {
  if (!isMarketCategory(category)) fail('unknown_category', 404);
  if (range !== null && !Object.hasOwn(MARKET_HISTORY_RANGES, range)) fail('invalid_market_range', 400);
  return withDatabase(dataDir, db => {
    ensureMarketSchema(db, now);
    ensureMarketEffectsSchema(db);
    const activation = simulationActivation(db);
    if (range !== null && activation !== null && now >= activation) {
      const { duration, interval } = MARKET_HISTORY_RANGES[range];
      const start = Math.max(activation, now - duration);
      // Reconstruct only this category at the requested resolution. This
      // avoids storing/rebuilding 600,000 minute rows on every public read.
      // Include the exact opening and live quote, and actual admin receipts
      // between samples, so jumps and the chart's latest value stay accurate.
      const times = new Set([start, now]), receipts = new Map();
      for (let at = Math.ceil(start / interval) * interval; at <= now; at += interval) times.add(at);
      for (const row of db.prepare(`SELECT created_at, after_index FROM admin_market_adjustments
        WHERE category = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at, id`).all(category, start, now)) {
        times.add(row.created_at); receipts.set(row.created_at, row.after_index);
      }
      return [...times].filter(at => at <= now).sort((a, b) => b - a).map(at => ({
        indexValue: roundIndex(receipts.get(at) ?? computeCategoryIndex(db, category, at)), capturedAt: new Date(at).toISOString()
      }));
    }
    if (activation !== null) transaction(db, () => refreshMarketHistory(db, now, activation));
    if (range !== null) return db.prepare(`SELECT index_value AS indexValue, captured_at AS capturedAt
      FROM market_snapshots WHERE category = ? AND captured_at >= ? AND captured_at <= ?
      ORDER BY captured_at DESC LIMIT 1000`).all(category,
        new Date(now - MARKET_HISTORY_RANGES[range].duration).toISOString(), new Date(now).toISOString())
      .map(row => ({ indexValue: roundIndex(row.indexValue), capturedAt: row.capturedAt }));
    return db.prepare(`SELECT index_value AS indexValue, captured_at AS capturedAt FROM market_snapshots
      WHERE category = ? ORDER BY captured_at DESC, rowid DESC LIMIT ?`)
      .all(category, Math.max(1, Math.min(1000, Math.floor(limit) || 100)))
      .map(row => ({ indexValue: roundIndex(row.indexValue), capturedAt: row.capturedAt }));
  });
}

// Pure valuation helper for future economy features: an item's estimated
// token value is its base token value scaled by its category's current index.
// Reads only — item.price, item.sellValue, rarity and inventory JSON are never
// rewritten. Inventory, resale and NPC read models all use this helper.
export function estimatedValueTokens(item, indexes = {}) {
  const category = marketCategoryForItem(item);
  const index = Number.isFinite(Number(indexes?.[category])) ? Number(indexes[category]) : DEFAULT_MARKET_INDEX;
  const baseValueTokens = tokenValue(item?.price ?? 0);
  return Math.max(1, Math.round(baseValueTokens * index / 100));
}

// Db-scoped read model, safe inside economic transactions; no history writes.
export function marketIndexes(db, now = Date.now()) {
  ensureMarketSchema(db, now);
  ensureMarketEffectsSchema(db);
  return Object.fromEntries(MARKET_CATEGORIES.map(({ id }) => [id, marketIndexAt(db, id, now)]));
}
