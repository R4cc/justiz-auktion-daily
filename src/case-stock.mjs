import { AccountError } from './errors.mjs';

export const CASE_STOCK_LIMIT = 10;
export const CASE_STOCK_WINDOW_MS = 4 * 60 * 60 * 1000;

export function ensureCaseStockSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS case_stock (
    case_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL,
    sold INTEGER NOT NULL CHECK(sold >= 0 AND sold <= ${CASE_STOCK_LIMIT})
  ) STRICT`);
}

// Epoch-aligned windows refill at 00:00, 04:00, ... UTC. Only one row per
// category is retained; stock is independent of accounts and catalog editions.
export function withCaseStock(db, catalog, now = Date.now()) {
  const windowStart = Math.floor(now / CASE_STOCK_WINDOW_MS) * CASE_STOCK_WINDOW_MS;
  const sold = new Map(db.prepare('SELECT case_id, sold FROM case_stock WHERE window_start = ?')
    .all(windowStart).map(row => [row.case_id, row.sold]));
  return { ...catalog, cases: catalog.cases.map(box => ({ ...box,
    stock: { remaining: CASE_STOCK_LIMIT - (sold.get(box.id) || 0), limit: CASE_STOCK_LIMIT,
      restocksAt: windowStart + CASE_STOCK_WINDOW_MS }
  })) };
}

// Call inside the purchase transaction so failed charges/inserts release stock
// and concurrent purchasers cannot buy the same last unit.
export function consumeCaseStock(db, caseId, now) {
  const windowStart = Math.floor(now / CASE_STOCK_WINDOW_MS) * CASE_STOCK_WINDOW_MS;
  const result = db.prepare(`INSERT INTO case_stock (case_id, window_start, sold) VALUES (?, ?, 1)
    ON CONFLICT(case_id) DO UPDATE SET window_start = excluded.window_start,
      sold = CASE WHEN case_stock.window_start = excluded.window_start THEN case_stock.sold + 1 ELSE 1 END
    WHERE case_stock.window_start <> excluded.window_start OR case_stock.sold < ?`)
    .run(caseId, windowStart, CASE_STOCK_LIMIT);
  if (!result.changes) throw new AccountError('case_out_of_stock', 409);
}
