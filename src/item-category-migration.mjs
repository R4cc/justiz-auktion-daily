import { CATEGORY_CLASSIFICATION_VERSION, SELECTION_MARKET_CATEGORIES, auctionSelectionCategory, classifiedBusinessType } from './item-categories.mjs';
import { RESALE_LOCK_SQL } from './inventory-locks.mjs';

export { CATEGORY_CLASSIFICATION_VERSION };
const exists = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
const pendingTable = 'item_category_pending_stock';
const jsonColumns = {
  auctions: ['payload_json'], daily_game_auctions: ['payload_json'], account_games: ['payload'],
  inventory: ['item'], daily_case_rewards: ['item'], case_openings: ['item'], sealed_cases: ['reward'],
  case_purchases: ['item'], case_rotations: ['payload'], palette_editions: ['payload_json'],
  primary_palette_rewards: ['item_json'], primary_palette_auctions: ['public_snapshot_json'],
  stock_palette_editions: ['payload'], stock_palette_purchases: ['offer', 'rewards'],
  primary_palette_stock_draws: ['draws', 'rewards'], primary_palette_mystery_stock: ['offer', 'rewards'],
  store_receipts: ['result']
};

// Caller owns a transaction. Only category metadata and incompatible shelf
// placement change: never prices, item IDs, draws, balances, costs or bids.
export function migrateSavedItemCategories(db, { dryRun = false } = {}) {
  const report = { version: CATEGORY_CLASSIFICATION_VERSION, objects: 0, rows: 0, tables: {}, returnedToInventory: 0, deferredStock: 0 };
  const cache = new Map();
  const sourceQuery = exists(db, 'auctions') ? db.prepare('SELECT payload_json FROM auctions WHERE id=?') : null;
  const sourceFor = id => {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !sourceQuery) return null;
    if (cache.has(Number(id))) return cache.get(Number(id));
    const row = sourceQuery.get(Number(id)), source = row ? JSON.parse(row.payload_json) : null;
    if (cache.size >= 1000) cache.clear();
    cache.set(Number(id), source);
    return source;
  };
  function update(value, archive = false, count = true) {
    if (!value || typeof value !== 'object') return false;
    let changed = false;
    if (typeof value.title === 'string' && !['case', 'review-pack'].includes(value.kind) && !Array.isArray(value.items) &&
        (archive || Number.isFinite(value.price) || value.auctionId != null || Number.isSafeInteger(value.id))) {
      const source = archive ? value : sourceFor(value.auctionId ?? (Number.isSafeInteger(value.id) ? value.id : null));
      const evidence = { ...value, description: value.description || source?.description || '',
        category: source?.sourceCategory || source?.category || value.category || value.marketCategory || '' };
      const category = auctionSelectionCategory(evidence);
      const assign = (key, next) => { if (value[key] !== next) { value[key] = next; changed = true; } };
      if (archive && typeof value.category === 'string' && !value.sourceCategory) assign('sourceCategory', value.category);
      assign('category', category);
      if (!archive || Object.hasOwn(value, 'marketCategory')) assign('marketCategory', SELECTION_MARKET_CATEGORIES[category]);
      // Preserve the inferred shop type even when rewards omit the source
      // description (for example a generically titled lot containing toys).
      if (!archive) assign('businessCategory', classifiedBusinessType(evidence, category));
      assign('categoryVersion', CATEGORY_CLASSIFICATION_VERSION);
      if (changed && count) report.objects++;
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object' && update(child, false, count)) changed = true;
    return changed;
  }
  for (const [table, fields] of Object.entries(jsonColumns)) {
    if (!exists(db, table)) continue;
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const field of fields.filter(name => columns.has(name))) {
      const write = dryRun ? null : db.prepare(`UPDATE ${table} SET ${field}=?${table === 'auctions' ? ',category=?' : ''} WHERE rowid=?`);
      for (const row of db.prepare(`SELECT rowid AS row_id,${field} AS payload${table === 'auctions' ? ',category AS stored_category' : ''} FROM ${table} WHERE ${field} IS NOT NULL`).iterate()) {
        const value = JSON.parse(row.payload), changed = update(value, table === 'auctions');
        if (!changed && !(table === 'auctions' && value.category !== row.stored_category)) continue;
        if (write) {
          if (table === 'auctions') write.run(JSON.stringify(value), value.category, row.row_id);
          else write.run(JSON.stringify(value), row.row_id);
        }
        report.rows++;
        report.tables[table] = (report.tables[table] || 0) + 1;
      }
    }
  }
  // Dry-run predicts placement from revised metadata without writing it.
  const placement = reconcileCategorizedStock(db, { all: true, dryRun,
    project: dryRun ? value => { update(value, false, false); return value; } : null });
  report.returnedToInventory = placement.returned;
  report.deferredStock = placement.deferred;
  return report;
}

// A restart may find an in-progress theft or auction. Keep that item locked,
// then retry only those deferred shelf rows on later economy ticks.
export function reconcileCategorizedStock(db, { all = false, dryRun = false, project = null } = {}) {
  if (!['business_stock', 'businesses', 'inventory'].every(table => exists(db, table)) || (!all && !exists(db, pendingTable))) return { returned: 0, deferred: 0 };
  if (!all && !db.prepare(`SELECT 1 FROM ${pendingTable} LIMIT 1`).get()) return { returned: 0, deferred: 0 };
  if (!dryRun) db.exec(`CREATE TABLE IF NOT EXISTS ${pendingTable} (inventory_id TEXT PRIMARY KEY) STRICT`);
  const hands = exists(db, 'store_heists'), resales = exists(db, 'resale_auction_items') && exists(db, 'resale_auctions');
  const active = RESALE_LOCK_SQL.replaceAll('status', 'a.status').replaceAll('winner_id', 'a.winner_id').replaceAll('settled_at', 'a.settled_at');
  const heist = hands ? db.prepare("SELECT 1 FROM store_heists WHERE inventory_id=? AND status IN ('active','police')") : null;
  const resale = resales ? db.prepare(`SELECT 1 FROM resale_auction_items ai JOIN resale_auctions a ON a.id=ai.auction_id WHERE ai.inventory_id=? AND ${active}`) : null;
  const remove = dryRun ? null : db.prepare('DELETE FROM business_stock WHERE business_id=? AND inventory_id=? AND sold_at IS NULL');
  const defer = dryRun ? null : db.prepare(`INSERT OR IGNORE INTO ${pendingTable} VALUES(?)`);
  let returned = 0, deferred = 0;
  const ownedStock = `SELECT s.inventory_id,s.business_id,i.item,b.type FROM business_stock s
    ${all ? '' : `JOIN ${pendingTable} p ON p.inventory_id=s.inventory_id`}
    JOIN businesses b ON b.id=s.business_id JOIN inventory i ON i.id=s.inventory_id
    WHERE s.sold_at IS NULL AND i.sold_at IS NULL AND i.user_id=b.user_id`;
  for (const row of db.prepare(ownedStock).iterate()) {
    const item = project ? project(JSON.parse(row.item)) : JSON.parse(row.item);
    const type = item.businessCategory ?? classifiedBusinessType(item, item.category);
    if (item.categoryVersion !== CATEGORY_CLASSIFICATION_VERSION || type === row.type) continue;
    if (heist?.get(row.inventory_id) || resale?.get(row.inventory_id)) { defer?.run(row.inventory_id); deferred++; continue; }
    remove?.run(row.business_id, row.inventory_id);
    returned++;
  }
  if (!dryRun) db.exec(`DELETE FROM ${pendingTable} WHERE inventory_id NOT IN (
    SELECT s.inventory_id FROM business_stock s JOIN businesses b ON b.id=s.business_id JOIN inventory i ON i.id=s.inventory_id
    WHERE s.sold_at IS NULL AND i.sold_at IS NULL AND i.user_id=b.user_id)`);
  return { returned, deferred };
}
