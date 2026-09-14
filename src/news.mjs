import { randomUUID } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { transaction, withDatabase } from './database.mjs';
import { CASES } from './cases.mjs';
import { isMarketCategory } from './market.mjs';

// Global news events connect the narrative to palettes and the market:
// a published event can reference palettes (making them narratively available)
// and carry structural market effects per category. The effect representation
// is intentionally minimal — the future simulation decides what direction and
// magnitude actually mean; validation only enforces the shape.
export const NEWS_STATUSES = ['draft', 'published', 'archived'];
const PALETTE_IDS = new Set(CASES.map(palette => palette.id));
const fail = (code, status) => { throw new AccountError(code, status); };

function ensureNewsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS news_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
    published_at TEXT,
    palette_ids TEXT CHECK(json_valid(palette_ids)),
    market_effects TEXT CHECK(json_valid(market_effects)),
    metadata_json TEXT CHECK(json_valid(metadata_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`);
}

function validateMarketEffects(effects) {
  if (!Array.isArray(effects)) fail('invalid_market_effects');
  return effects.map(effect => {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) fail('invalid_market_effects');
    if (!isMarketCategory(effect.category)) fail('invalid_market_effects');
    if (effect.direction !== 'up' && effect.direction !== 'down') fail('invalid_market_effects');
    const magnitude = effect.magnitude ?? null;
    if (magnitude !== null && (!Number.isFinite(magnitude) || magnitude <= 0)) fail('invalid_market_effects');
    return { category: effect.category, direction: effect.direction, magnitude };
  });
}

function validatePaletteIds(paletteIds) {
  if (!Array.isArray(paletteIds) || paletteIds.some(id => !PALETTE_IDS.has(id))) fail('invalid_palette');
  return [...new Set(paletteIds)];
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('invalid_metadata');
  return metadata;
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
  let publishedAt = input.publishedAt ?? null;
  if (publishedAt !== null && publishedAt !== undefined) {
    const parsed = typeof publishedAt === 'number' ? publishedAt : Date.parse(publishedAt);
    if (!Number.isFinite(parsed)) fail('invalid_published_at');
    publishedAt = new Date(parsed).toISOString();
  }
  if (status === 'published' && !publishedAt) publishedAt = new Date(now).toISOString();
  const id = input.id !== undefined ? String(input.id) : randomUUID();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) fail('invalid_id');
  const paletteIds = validatePaletteIds(input.paletteIds ?? []);
  const marketEffects = validateMarketEffects(input.marketEffects ?? []);
  const metadata = validateMetadata(input.metadata ?? {});
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureNewsSchema(db);
    const timestamp = new Date(now).toISOString();
    db.prepare(`INSERT INTO news_events
      (id, title, body, status, published_at, palette_ids, market_effects, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, body = excluded.body, status = excluded.status,
        published_at = excluded.published_at, palette_ids = excluded.palette_ids,
        market_effects = excluded.market_effects, metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`)
      .run(id, title, body, status, publishedAt, JSON.stringify(paletteIds),
        JSON.stringify(marketEffects), JSON.stringify(metadata), timestamp, timestamp);
    return serializeNewsEvent(db.prepare('SELECT * FROM news_events WHERE id = ?').get(id));
  }));
}

export function serializeNewsEvent(row) {
  return {
    id: row.id, title: row.title, body: row.body, status: row.status,
    publishedAt: row.published_at || null,
    paletteIds: JSON.parse(row.palette_ids || '[]'),
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
