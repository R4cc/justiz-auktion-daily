import { randomUUID } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { transaction, withDatabase } from './database.mjs';
import {
  createEventEditions, ensurePaletteEditionSchema, isEventPalette, paletteDefinition, PALETTE_DEFINITIONS
} from './palette-definitions.mjs';
import {
  assertEffectBudget, bootstrapMarketEffects, ensureMarketEffectsSchema, ensureMarketSchema,
  insertNewsMarketEffects, isMarketCategory, markSimulationActivation, simulationActivation
} from './market.mjs';

// Global news events connect the narrative to palettes and the market. A
// PUBLISHED event is an economic transaction: it atomically writes the final
// news row, a publication receipt (news_publications, the exact-once guard),
// one market effect per category (market_effects, index points decaying
// linearly to zero over 72h — see market.mjs) and one frozen palette edition
// per resolved event palette window (palette_editions — see
// palette-definitions.mjs). Drafts stay freely editable; economics are frozen
// once published.
export const NEWS_STATUSES = ['draft', 'published', 'archived'];
// Built lazily: the mutual import with palette-definitions must stay
// evaluation-safe, so no palette-definitions binding is touched at module init.
const paletteIdSet = () => new Set(PALETTE_DEFINITIONS.map(definition => definition.id));
// Event palettes open for a bounded window after publication:
// startsAt = publishedAt + startOffsetHours * hour, endsAt = startsAt + durationHours * hour.
export const PALETTE_WINDOW_LIMITS = { maxOffsetHours: 168, minDurationHours: 1, maxDurationHours: 168, defaultDurationHours: 72 };
// draft is fully editable; published allows text corrections and archiving;
// archived is terminal.
const ALLOWED_TRANSITIONS = {
  draft: ['draft', 'published', 'archived'],
  published: ['published', 'archived'],
  archived: ['archived']
};
const fail = (code, status) => { throw new AccountError(code, status); };

// Exported for palette-definitions: palette_editions rows carry an FK to
// news_events, so every database that stores editions needs this table. The
// mutual import with palette-definitions is evaluation-safe — both modules
// use each other only inside functions, never at module init.
export function ensureNewsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS news_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
    published_at TEXT,
    palette_ids TEXT CHECK(json_valid(palette_ids)),
    palette_windows TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(palette_windows)),
    market_effects TEXT CHECK(json_valid(market_effects)),
    metadata_json TEXT CHECK(json_valid(metadata_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`);
  // Idempotent column migration for databases created before palette windows.
  const columns = db.prepare('PRAGMA table_info(news_events)').all().map(column => column.name);
  if (!columns.includes('palette_windows')) {
    db.exec(`ALTER TABLE news_events ADD COLUMN palette_windows TEXT NOT NULL DEFAULT '[]'`);
  }
}

function ensurePublicationSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS news_publications (
    event_id TEXT PRIMARY KEY REFERENCES news_events(id),
    processed_at INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('applied','legacy')),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
  ) STRICT`);
}

function validateMarketEffects(effects) {
  if (!Array.isArray(effects)) fail('invalid_market_effects');
  const seen = new Set();
  return effects.map(effect => {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) fail('invalid_market_effects');
    if (!isMarketCategory(effect.category)) fail('invalid_market_effects');
    if (effect.direction !== 'up' && effect.direction !== 'down') fail('invalid_market_effects');
    const magnitude = effect.magnitude ?? null;
    // Structural only: drafts may keep the placeholder null (and legacy rows
    // carry fractional placeholder values); publication enforces whole index
    // points 1..20. At most one effect per category per event.
    if (magnitude !== null && (!Number.isFinite(magnitude) || magnitude <= 0)) fail('invalid_market_effects');
    if (seen.has(effect.category)) fail('invalid_market_effects');
    seen.add(effect.category);
    return { category: effect.category, direction: effect.direction, magnitude };
  });
}

// Publication converts placeholder effects into real index points: integer
// magnitudes 1..20 only.
function assertPublishableEffects(effects) {
  for (const effect of effects) {
    if (!Number.isInteger(effect.magnitude) || effect.magnitude < 1 || effect.magnitude > 20) fail('invalid_market_effects');
  }
}

function validatePaletteIds(paletteIds) {
  const known = paletteIdSet();
  if (!Array.isArray(paletteIds) || paletteIds.some(id => !known.has(id))) fail('invalid_palette');
  return [...new Set(paletteIds)];
}

// Structured palette windows for event palettes. Base ids may appear in
// paletteIds as informational references only (no window, no activation);
// event ids receive a default window unless an explicit one is supplied; an
// explicit window must reference an event definition that is also in
// paletteIds. Duplicates and unknown ids are rejected. The returned list is
// the effective window set: defaults materialized, sorted by palette id.
export function validatePaletteWindows(inputWindows, paletteIds) {
  const explicit = new Map();
  for (const window of inputWindows ?? []) {
    if (!window || typeof window !== 'object' || Array.isArray(window)) fail('invalid_palette_windows');
    const paletteId = String(window.paletteId ?? '');
    if (!isEventPalette(paletteId) || !paletteIds.includes(paletteId) || explicit.has(paletteId)) fail('invalid_palette_windows');
    const startOffsetHours = window.startOffsetHours ?? 0;
    const durationHours = window.durationHours ?? PALETTE_WINDOW_LIMITS.defaultDurationHours;
    if (!Number.isInteger(startOffsetHours) || startOffsetHours < 0
      || startOffsetHours > PALETTE_WINDOW_LIMITS.maxOffsetHours) fail('invalid_palette_windows');
    if (!Number.isInteger(durationHours) || durationHours < PALETTE_WINDOW_LIMITS.minDurationHours
      || durationHours > PALETTE_WINDOW_LIMITS.maxDurationHours) fail('invalid_palette_windows');
    explicit.set(paletteId, { paletteId, startOffsetHours, durationHours });
  }
  return paletteIds.filter(isEventPalette).sort()
    .map(paletteId => explicit.get(paletteId) ?? { paletteId, startOffsetHours: 0, durationHours: PALETTE_WINDOW_LIMITS.defaultDurationHours });
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('invalid_metadata');
  return metadata;
}

const stableStringify = value => JSON.stringify(value, (key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
    : entry);

// The economic identity of a publication. Order-insensitive for effects,
// palettes and windows; title/body are deliberately excluded so corrections
// stay possible.
const economicFingerprint = ({ publishedAt, paletteIds, paletteWindows, marketEffects, metadata }) => JSON.stringify([
  publishedAt ?? null,
  [...(paletteIds ?? [])].sort(),
  [...(paletteWindows ?? [])].map(window => [window.paletteId, window.startOffsetHours, window.durationHours]),
  [...(marketEffects ?? [])].sort((left, right) => left.category < right.category ? -1 : left.category > right.category ? 1 : 0)
    .map(effect => [effect.category, effect.direction, effect.magnitude ?? null]),
  stableStringify(metadata ?? {})
]);

function publicationPayload(row) {
  return {
    title: row.title, body: row.body, status: row.status,
    publishedAt: row.published_at || null,
    paletteIds: JSON.parse(row.palette_ids || '[]'),
    paletteWindows: JSON.parse(row.palette_windows || '[]'),
    marketEffects: JSON.parse(row.market_effects || '[]'),
    metadata: JSON.parse(row.metadata_json || '{}')
  };
}

// One-time market simulation activation, composed from db-scoped helpers so
// the caller can run it inside its own transaction. Everything — schemas,
// legacy receipts, bootstrap effects, base index reset and the durable
// app_state marker (written last) — happens in that single transaction, and
// the marker makes it exactly-once across restarts.
function ensureSimulation(db, now) {
  ensureNewsSchema(db);
  ensurePublicationSchema(db);
  ensureMarketSchema(db, now);
  ensureMarketEffectsSchema(db);
  ensurePaletteEditionSchema(db);
  if (simulationActivation(db) !== null) return;
  // Legacy published/archived news gets a 'legacy' receipt but no effects:
  // its placeholder payloads (fractional/null magnitudes) were never backed
  // by the simulation and must not move indexes retroactively. Drafts stay
  // editable and receive no receipt.
  const insertReceipt = db.prepare(`INSERT OR IGNORE INTO news_publications
    (event_id, processed_at, kind, payload_json) VALUES (?, ?, 'legacy', ?)`);
  for (const row of db.prepare(`SELECT * FROM news_events WHERE status IN ('published','archived')`).all()) {
    insertReceipt.run(row.id, now, JSON.stringify(publicationPayload(row)));
  }
  // Legacy manually-set category indexes become bounded bootstrap effects.
  bootstrapMarketEffects(db, now);
  markSimulationActivation(db, now);
}

function writeEventRow(db, { id, title, body, status, publishedAt, paletteIds, paletteWindows, marketEffects, metadata, now }, existing) {
  const timestamp = new Date(now).toISOString();
  if (existing) {
    db.prepare(`UPDATE news_events SET title = ?, body = ?, status = ?, published_at = ?,
      palette_ids = ?, palette_windows = ?, market_effects = ?, metadata_json = ?, updated_at = ? WHERE id = ?`)
      .run(title, body, status, publishedAt, JSON.stringify(paletteIds), JSON.stringify(paletteWindows ?? []),
        JSON.stringify(marketEffects), JSON.stringify(metadata), timestamp, id);
  } else {
    db.prepare(`INSERT INTO news_events
      (id, title, body, status, published_at, palette_ids, palette_windows, market_effects, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, title, body, status, publishedAt, JSON.stringify(paletteIds), JSON.stringify(paletteWindows ?? []),
        JSON.stringify(marketEffects), JSON.stringify(metadata), timestamp, timestamp);
  }
}

// First publication (new row or existing draft): validation, migration,
// budget check, then news row + receipt + effects + frozen palette editions
// inside the caller's transaction. Any failure rolls all four back together.
function publishEvent(db, existing, event) {
  // The server owns the publication timestamp; clients must not backdate.
  if (event.inputPublishedAt !== null) fail('invalid_published_at');
  assertPublishableEffects(event.marketEffects);
  ensureSimulation(db, event.now);
  assertEffectBudget(db, event.marketEffects, event.now);
  const publishedAt = new Date(event.now).toISOString();
  writeEventRow(db, { ...event, status: 'published', publishedAt }, existing);
  const payload = { title: event.title, body: event.body, status: 'published', publishedAt,
    paletteIds: event.paletteIds, paletteWindows: event.paletteWindows,
    marketEffects: event.marketEffects, metadata: event.metadata };
  db.prepare(`INSERT INTO news_publications (event_id, processed_at, kind, payload_json)
    VALUES (?, ?, 'applied', ?)`).run(event.id, event.now, JSON.stringify(payload));
  insertNewsMarketEffects(db, event.id, event.marketEffects, event.now);
  // Frozen event editions for every resolved palette window. Themed stock
  // shortage persists an unavailable edition without cancelling anything; a
  // retry never reaches this path again (exact-once receipt above), and
  // INSERT OR IGNORE keeps even a partial rerun from re-rolling editions.
  if (event.paletteWindows.length) createEventEditions(db, event.id, event.paletteWindows, event.now);
  return serializeNewsEvent(db.prepare('SELECT * FROM news_events WHERE id = ?').get(event.id));
}

function createEvent(db, event) {
  if (event.status === 'published') return publishEvent(db, null, event);
  writeEventRow(db, { ...event, publishedAt: event.inputPublishedAt }, null);
  return serializeNewsEvent(db.prepare('SELECT * FROM news_events WHERE id = ?').get(event.id));
}

function updateEvent(db, existing, event) {
  if (!ALLOWED_TRANSITIONS[existing.status].includes(event.status)) fail('invalid_news_transition', 409);
  if (existing.status === 'draft') {
    if (event.status === 'published') return publishEvent(db, existing, event);
    // Draft edits (and abandoning a draft by archiving it) keep the whole
    // document writable; nothing economic has ever happened.
    writeEventRow(db, { ...event, publishedAt: event.inputPublishedAt }, existing);
    return serializeNewsEvent(db.prepare('SELECT * FROM news_events WHERE id = ?').get(event.id));
  }
  // Published (and archived) economics are frozen. A retry with the same
  // economic payload — or a title/body correction — is fine; a conflicting
  // economic payload is rejected. Missing publishedAt means "keep original".
  const receipt = db.prepare('SELECT payload_json FROM news_publications WHERE event_id = ?').get(event.id);
  const frozen = receipt ? JSON.parse(receipt.payload_json) : publicationPayload(existing);
  const publishedAt = existing.published_at || null;
  if (event.inputPublishedAt !== null && event.inputPublishedAt !== publishedAt) fail('news_already_published', 409);
  if (economicFingerprint({ ...event, publishedAt }) !== economicFingerprint({ ...frozen, publishedAt: frozen.publishedAt ?? null })) {
    fail('news_already_published', 409);
  }
  writeEventRow(db, { ...event, status: event.status, publishedAt,
    paletteIds: frozen.paletteIds, paletteWindows: frozen.paletteWindows ?? [],
    marketEffects: frozen.marketEffects, metadata: frozen.metadata }, existing);
  return serializeNewsEvent(db.prepare('SELECT * FROM news_events WHERE id = ?').get(event.id));
}

// Whole-document upsert keeps the store boring: callers send the complete
// event, created_at is preserved, updated_at always moves.
export function saveNewsEvent(dataDir, input, { now = Date.now() } = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 200) fail('invalid_title');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > 4000) fail('invalid_body');
  const status = input.status ?? 'draft';
  if (!NEWS_STATUSES.includes(status)) fail('invalid_status');
  let inputPublishedAt = input.publishedAt ?? null;
  if (inputPublishedAt !== null) {
    const parsed = typeof inputPublishedAt === 'number' ? inputPublishedAt : Date.parse(inputPublishedAt);
    if (!Number.isFinite(parsed)) fail('invalid_published_at');
    inputPublishedAt = new Date(parsed).toISOString();
  }
  const id = input.id !== undefined ? String(input.id) : randomUUID();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) fail('invalid_id');
  const paletteIds = validatePaletteIds(input.paletteIds ?? []);
  const paletteWindows = validatePaletteWindows(input.paletteWindows, paletteIds);
  const marketEffects = validateMarketEffects(input.marketEffects ?? []);
  const metadata = validateMetadata(input.metadata ?? {});
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureNewsSchema(db);
    const existing = db.prepare('SELECT * FROM news_events WHERE id = ?').get(id);
    const event = { id, title, body, status, inputPublishedAt, paletteIds, paletteWindows, marketEffects, metadata, now };
    return existing ? updateEvent(db, existing, event) : createEvent(db, event);
  }));
}

export function serializeNewsEvent(row) {
  return {
    id: row.id, title: row.title, body: row.body, status: row.status,
    publishedAt: row.published_at || null,
    paletteIds: JSON.parse(row.palette_ids || '[]'),
    paletteWindows: JSON.parse(row.palette_windows || '[]'),
    marketEffects: JSON.parse(row.market_effects || '[]'),
    metadata: JSON.parse(row.metadata_json || '{}'),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function getNewsEvent(dataDir, id) {
  return withDatabase(dataDir, db => {
    ensureNewsSchema(db);
    const row = db.prepare('SELECT * FROM news_events WHERE id = ?').get(String(id));
    return row ? serializeNewsEvent(row) : null;
  });
}

export function listNewsEvents(dataDir, { status, limit = 50 } = {}) {
  return withDatabase(dataDir, db => {
    ensureNewsSchema(db);
    const rows = status
      ? db.prepare('SELECT * FROM news_events WHERE status = ? ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?')
          .all(status, limit)
      : db.prepare('SELECT * FROM news_events ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?').all(limit);
    return rows.map(serializeNewsEvent);
  });
}

export function listPublishedNews(dataDir, { limit = 20 } = {}) {
  return listNewsEvents(dataDir, { status: 'published', limit });
}
