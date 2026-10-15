export const BUSINESS_ABANDONMENT_MS = 20 * 86_400_000;

// Existing stores get a full grace period on first deployment. Remember known
// shelf placements so removing and replacing goods cannot renew ownership.
export function ensureBusinessAbandonmentSchema(db, now) {
  if (!db.prepare('PRAGMA table_info(businesses)').all().some(column => column.name === 'last_restock_at')) {
    db.exec('ALTER TABLE businesses ADD COLUMN last_restock_at INTEGER');
    db.prepare('UPDATE businesses SET last_restock_at = ?').run(now);
  }
  const seedHistory = !db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='business_stock_history'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS business_stock_history (
    business_id TEXT NOT NULL REFERENCES businesses(id), inventory_id TEXT NOT NULL REFERENCES inventory(id),
    first_stocked_at INTEGER NOT NULL, PRIMARY KEY(business_id, inventory_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS business_takeovers (
    buyer_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, payload TEXT NOT NULL,
    old_business_id TEXT NOT NULL REFERENCES businesses(id), old_owner_id TEXT NOT NULL REFERENCES users(id),
    new_business_id TEXT NOT NULL REFERENCES businesses(id), result TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(buyer_id, request_id)
  ) STRICT`);
  if (seedHistory) db.exec(`INSERT OR IGNORE INTO business_stock_history
    SELECT business_id, inventory_id, stocked_at FROM business_stock`);
}

export function businessAbandonment(shop, now) {
  const lastRestockedAt = shop.last_restock_at ?? shop.bought_at;
  const abandonedAt = lastRestockedAt + BUSINESS_ABANDONMENT_MS;
  return { lastRestockedAt, abandonedAt, abandoned: !shop.retired && now >= abandonedAt };
}

export function recordBusinessRestock(db, shopId, inventoryIds, now) {
  const insert = db.prepare('INSERT OR IGNORE INTO business_stock_history VALUES (?, ?, ?)');
  let added = 0;
  for (const id of inventoryIds) added += Number(insert.run(shopId, id, now).changes);
  if (added) db.prepare('UPDATE businesses SET last_restock_at = ? WHERE id = ?').run(now, shopId);
  return added;
}
