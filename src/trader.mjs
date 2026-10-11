// Private ownership accounting. Callers own the enclosing economy transaction.
// Costs never enter item JSON, which also supplies public auction snapshots.
export function ensureTraderSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS item_acquisitions (
    inventory_id TEXT PRIMARY KEY REFERENCES inventory(id), user_id TEXT NOT NULL REFERENCES users(id),
    cost INTEGER CHECK(cost IS NULL OR cost >= 0), source TEXT NOT NULL, acquired_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS trader_sales (
    source_id TEXT NOT NULL, inventory_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
    proceeds INTEGER NOT NULL CHECK(proceeds >= 0), cost INTEGER, reward INTEGER NOT NULL,
    business_id TEXT, sold_at INTEGER NOT NULL, PRIMARY KEY(source_id, inventory_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS trader_sales_owner ON trader_sales(user_id, sold_at);
  CREATE TABLE IF NOT EXISTS trader_milestones (
    user_id TEXT NOT NULL REFERENCES users(id), step TEXT NOT NULL, completed_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, step)
  ) STRICT`);
}

export function milestone(db, userId, step, now) {
  ensureTraderSchema(db);
  db.prepare('INSERT OR IGNORE INTO trader_milestones VALUES (?, ?, ?)').run(userId, step, now);
}

export function splitCost(total, count) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(count) || count < 1)
    throw new Error('invalid_acquisition_cost');
  return Array.from({ length: count }, (_, index) => Math.floor(total / count) + (index < total % count ? 1 : 0));
}

export function acquisition(db, inventoryId, userId) {
  ensureTraderSchema(db);
  const row = db.prepare('SELECT cost, source FROM item_acquisitions WHERE inventory_id = ? AND user_id = ?').get(inventoryId, userId);
  return { acquisitionCost: row?.cost ?? null, acquisitionSource: row?.source ?? 'unknown' };
}

export function acquireItems(db, userId, ids, total, source, now, { reinvest = true } = {}) {
  ensureTraderSchema(db);
  const costs = total === null ? ids.map(() => null) : splitCost(total, ids.length);
  const insert = db.prepare(`INSERT INTO item_acquisitions VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(inventory_id) DO UPDATE SET user_id=excluded.user_id, cost=excluded.cost,
      source=excluded.source, acquired_at=excluded.acquired_at`);
  ids.forEach((id, index) => insert.run(id, userId, costs[index], source, now));
  if (reinvest && source === 'purchase' && total > 0 && db.prepare("SELECT 1 FROM trader_milestones WHERE user_id=? AND step='sale'").get(userId))
    milestone(db, userId, 'reinvest', now);
}

export function recordSale(db, userId, ids, total, sourceId, now, businessId = null) {
  ensureTraderSchema(db);
  const shares = splitCost(total, ids.length);
  const insert = db.prepare('INSERT OR IGNORE INTO trader_sales VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ids.forEach((id, index) => {
    const basis = acquisition(db, id, userId);
    insert.run(sourceId, id, userId, shares[index], basis.acquisitionCost,
      Number(basis.acquisitionSource === 'reward'), businessId, now);
  });
  milestone(db, userId, 'sale', now);
}

export function tradingTotals(db, userId, businessId = null) {
  ensureTraderSchema(db);
  const rows = db.prepare(`SELECT proceeds,cost,reward FROM trader_sales WHERE user_id=?
    AND (? IS NULL OR business_id=?)`).all(userId, businessId, businessId);
  return {
    realizedTradingProfit: rows.filter(row => row.cost !== null && !row.reward).reduce((sum, row) => sum + row.proceeds - row.cost, 0),
    rewardProceeds: rows.filter(row => row.reward).reduce((sum, row) => sum + row.proceeds, 0),
    unknownCostSales: rows.filter(row => row.cost === null).length,
    trackedSales: rows.length
  };
}

export function traderProgress(db, userId, now) {
  ensureTraderSchema(db);
  // Existing players retain credit for their saved activity without invented costs.
  if (db.prepare("SELECT 1 FROM account_games WHERE user_id=? AND mode='daily' AND complete=1").get(userId))
    milestone(db, userId, 'daily', now);
  if (db.prepare(`SELECT 1 FROM inventory i WHERE user_id=? AND (json_extract(item,'$.kind') IS NOT 'case'
    OR EXISTS(SELECT 1 FROM resale_auction_items r WHERE r.inventory_id=i.id)
    OR EXISTS(SELECT 1 FROM business_stock s WHERE s.inventory_id=i.id))`).get(userId)) milestone(db, userId, 'find', now);
  const hasTable = name => db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
  if (hasTable('resale_auctions') && db.prepare("SELECT 1 FROM resale_auctions WHERE seller_id=? AND settled_at IS NOT NULL AND winner_id IS NOT NULL").get(userId))
    milestone(db, userId, 'sale', now);
  if (hasTable('businesses') && db.prepare('SELECT 1 FROM businesses WHERE user_id=? AND sales>0').get(userId))
    milestone(db, userId, 'sale', now);
  return db.prepare('SELECT step, completed_at AS completedAt FROM trader_milestones WHERE user_id=?').all(userId);
}
