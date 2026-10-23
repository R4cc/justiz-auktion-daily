import { STORE_CASES } from './store-case-definitions.mjs';
import { AccountError } from './errors.mjs';

export const CASE_STOCK_LIMIT = 10;
export const CASE_STOCK_LIMITS = Object.freeze(Object.fromEntries(STORE_CASES.map(box=>[box.id,box.stock])));
const legacyLimits={'lost-property':100,'evidence-locker':60,seizure:35,vault:20,'collectors-cache':10};
export const caseStockLimit = caseId => CASE_STOCK_LIMITS[caseId] ?? legacyLimits[caseId] ?? CASE_STOCK_LIMIT;
export const CASE_STOCK_WINDOW_MS = 4 * 60 * 60 * 1000;

export function ensureCaseStockSchema(db) {
  const schema = `CREATE TABLE IF NOT EXISTS case_stock (
    case_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL,
    sold INTEGER NOT NULL CHECK(sold >= 0)
  ) STRICT`;
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'case_stock'").get();
  if (existing && /sold\s*<=/i.test(existing.sql)) {
    // Preserve sold counts and refill windows while removing the legacy cap.
    // A savepoint also works when schema setup runs inside a transaction.
    db.exec('SAVEPOINT case_stock_upgrade');
    try {
      db.exec('ALTER TABLE case_stock RENAME TO case_stock_legacy');
      db.exec(schema);
      db.exec(`INSERT INTO case_stock SELECT case_id, window_start, sold FROM case_stock_legacy;
        DROP TABLE case_stock_legacy; RELEASE case_stock_upgrade`);
    } catch (error) {
      db.exec('ROLLBACK TO case_stock_upgrade; RELEASE case_stock_upgrade');
      throw error;
    }
  } else db.exec(schema);
}

// Epoch-aligned windows refill at 00:00, 04:00, ... UTC. Only one row per
// category is retained; stock is independent of accounts and catalog editions.
export function withCaseStock(db, catalog, now = Date.now()) {
  const windowStart = Math.floor(now / CASE_STOCK_WINDOW_MS) * CASE_STOCK_WINDOW_MS;
  const sold = new Map(db.prepare('SELECT case_id, sold FROM case_stock WHERE window_start = ?')
    .all(windowStart).map(row => [row.case_id, row.sold]));
  return { ...catalog, cases: catalog.cases.map(box => ({ ...box,
    stock: { remaining: Math.max(0, caseStockLimit(box.id) - (sold.get(box.id) || 0)), limit: caseStockLimit(box.id),
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
    .run(caseId, windowStart, caseStockLimit(caseId));
  if (!result.changes) throw new AccountError('case_out_of_stock', 409);
}
