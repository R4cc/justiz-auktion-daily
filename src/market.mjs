import { AccountError } from './errors.mjs';
import { auctionSelectionCategory } from './auction-selection.mjs';
import { transaction, withDatabase } from './database.mjs';

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
// Neutral starting value; the future simulation owns every real movement.
export const DEFAULT_MARKET_INDEX = 100;

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
  if (isMarketCategory(item?.marketCategory)) return item.marketCategory;
  return marketCategoryForListingCategory(item?.category) ?? marketCategoryForAuction(item || {});
}

export function marketCategoryForTheme(theme) {
  return theme in THEME_MARKET_CATEGORIES ? THEME_MARKET_CATEGORIES[theme] : null;
}

function ensureMarketSchema(db, now) {
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
  // Registry additions are seeded on first touch; existing rows are never touched.
  const seed = db.prepare(`INSERT OR IGNORE INTO market_categories
    (category, base_index, current_index, updated_at) VALUES (?, ?, ?, ?)`);
  const updatedAt = new Date(now).toISOString();
  for (const { id } of MARKET_CATEGORIES) seed.run(id, DEFAULT_MARKET_INDEX, DEFAULT_MARKET_INDEX, updatedAt);
}

// Global, shared across all players: one row per market category.
export function marketState(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => {
    ensureMarketSchema(db, now);
    const rows = new Map(db.prepare('SELECT * FROM market_categories').all().map(row => [row.category, row]));
    const categories = MARKET_CATEGORIES.filter(({ id }) => rows.has(id)).map(({ id, name, nameDe }) => {
      const row = rows.get(id);
      return { category: id, name, nameDe, baseIndex: row.base_index, currentIndex: row.current_index, updatedAt: row.updated_at };
    });
    return { updatedAt: categories.reduce((latest, c) => c.updatedAt > latest ? c.updatedAt : latest, '') || null, categories };
  });
}

// Deliberately boring write path for the future simulation: set one category's
// index, optionally leaving a snapshot. No scheduling, no fluctuation logic.
export function setMarketIndex(dataDir, category, index, { now = Date.now(), snapshot = false } = {}) {
  if (!isMarketCategory(category)) fail('unknown_category', 404);
  if (!Number.isFinite(index) || index <= 0) fail('invalid_index');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureMarketSchema(db, now);
    const updatedAt = new Date(now).toISOString();
    if (!db.prepare('UPDATE market_categories SET current_index = ?, updated_at = ? WHERE category = ?')
      .run(index, updatedAt, category).changes) fail('unknown_category', 404);
    if (snapshot) db.prepare('INSERT OR REPLACE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)')
      .run(category, index, updatedAt);
    return { category, currentIndex: index, updatedAt };
  }));
}

export function snapshotMarketState(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureMarketSchema(db, now);
    const capturedAt = new Date(now).toISOString();
    const insert = db.prepare('INSERT OR REPLACE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)');
    for (const row of db.prepare('SELECT category, current_index FROM market_categories').all()) insert.run(row.category, row.current_index, capturedAt);
    return { capturedAt };
  }));
}

export function marketHistory(dataDir, category, { limit = 100 } = {}) {
  if (!isMarketCategory(category)) fail('unknown_category', 404);
  return withDatabase(dataDir, db => {
    ensureMarketSchema(db, Date.now());
    return db.prepare('SELECT index_value AS indexValue, captured_at AS capturedAt FROM market_snapshots WHERE category = ? ORDER BY captured_at DESC, rowid DESC LIMIT ?')
      .all(category, Math.max(1, Math.min(1000, Math.floor(limit) || 100)))
      .map(row => ({ ...row }));
  });
}
