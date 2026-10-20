import { loanDebt } from './loan-ledger.mjs';
import { withDatabase, transaction } from './database.mjs';
import { estimatedValueTokens, marketIndexes } from './market.mjs';
import { sealedPaletteInventoryIds } from './palette-auctions.mjs';
import { SHOP_TYPES, SHOP_SIZES } from './businesses.mjs';
import { plotLocation } from './town-plots.mjs';
import { AccountError } from './errors.mjs';
import { storeCashTotal } from './store-cash.mjs';

export const NET_WORTH_RANGES = Object.freeze({ '1d': 86400000, '1w': 7 * 86400000, '1m': 30 * 86400000, all: null });
export const NET_WORTH_SAMPLE_MS = 5 * 60000;
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
export function ensureNetWorthSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS net_worth_snapshots (
    user_id TEXT NOT NULL REFERENCES users(id), bucket INTEGER NOT NULL, captured_at INTEGER NOT NULL,
    cash INTEGER NOT NULL, held_bids INTEGER NOT NULL, items INTEGER NOT NULL,
    businesses INTEGER NOT NULL, sealed_palettes INTEGER NOT NULL, total INTEGER NOT NULL,
    PRIMARY KEY(user_id, bucket)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS net_worth_snapshots_time ON net_worth_snapshots(user_id, captured_at)`);
  if(!db.prepare('PRAGMA table_info(net_worth_snapshots)').all().some(column=>column.name==='store_cash')) db.exec('ALTER TABLE net_worth_snapshots ADD COLUMN store_cash INTEGER NOT NULL DEFAULT 0');
}
export function currentNetWorth(db, userId, { now = Date.now(), indexes = marketIndexes(db, now) } = {}) {
  const user = db.prepare('SELECT tokens FROM users WHERE id=? AND npc=0').get(userId);
  if (!user) throw new AccountError('login_required', 401);
  let heldBids = 0;
  for (const table of ['resale_auctions', 'primary_palette_auctions']) {
    if (hasTable(db, table)) heldBids += db.prepare(`SELECT COALESCE(SUM(COALESCE(max_bid,current_bid)),0) AS value FROM ${table}
      WHERE current_bidder_id=? AND settled_at IS NULL AND status != 'cancelled'`).get(userId).value;
  }
  const hidden = sealedPaletteInventoryIds(db);
  const items = db.prepare('SELECT id,item FROM inventory WHERE user_id=? AND sold_at IS NULL').all(userId)
    .reduce((total, row) => total + (hidden.has(row.id) ? 0 : estimatedValueTokens(JSON.parse(row.item), indexes)), 0);
  // Hidden drawn rewards must not leak through a wealth total. Value a won,
  // unopened palette at its public winning price until the reveal completes.
  let sealedPalettes = hasTable(db, 'primary_palette_auctions') && db.prepare('PRAGMA table_info(primary_palette_auctions)').all().some(column => column.name === 'revealed_at') ? db.prepare(`SELECT COALESCE(SUM(current_bid),0) AS value
    FROM primary_palette_auctions WHERE winner_id=? AND settled_at IS NOT NULL AND revealed_at IS NULL`).get(userId).value : 0;
  if(hasTable(db,'stock_palette_purchases')) sealedPalettes+=db.prepare('SELECT COALESCE(SUM(cost),0) AS value FROM stock_palette_purchases WHERE user_id=? AND revealed_at IS NULL AND seized_at IS NULL').get(userId).value;
  let businesses = 0;
  if (hasTable(db, 'businesses')) for (const shop of db.prepare('SELECT * FROM businesses WHERE user_id=?').all(userId)) {
    if (shop.upgrade_size) businesses += shop.upgrade_cost || 0;
    const size = SHOP_SIZES.find(entry => entry.id === shop.size), type = SHOP_TYPES.find(entry => entry.id === shop.type);
    if (size && type) businesses += Math.round(size.cost * type.costFactor * (plotLocation(db, shop.plot_id)?.priceMultiplier ?? 1));
  }
  const fineDebt=hasTable(db,'player_justice') ? db.prepare('SELECT fine_due FROM player_justice WHERE user_id=?').get(userId)?.fine_due||0 : 0;
  const current = { cash: user.tokens, storeCash:storeCashTotal(db,userId), heldBids, items, businesses, sealedPalettes };
  current.total = Object.values(current).reduce((sum, value) => sum + value, 0);
  current.total -= fineDebt; current.fineDebt=fineDebt;
  current.loanDebt=loanDebt(db,userId,now);current.total-=current.loanDebt;
  if (Object.entries(current).some(([key,value]) => !Number.isSafeInteger(value) || (key!=='total' && value < 0))) throw new AccountError('token_balance_limit', 409);
  return current;
}
export function recordNetWorth(db, userId, { now = Date.now(), indexes } = {}) {
  ensureNetWorthSchema(db);
  const current = currentNetWorth(db, userId, { now, ...(indexes ? { indexes } : {}) });
  // One latest observation per minute keeps profile polling bounded. Keep the
  // actual observation time rather than manufacturing a bucket-start date.
  db.prepare(`INSERT INTO net_worth_snapshots(user_id,bucket,captured_at,cash,held_bids,items,businesses,sealed_palettes,total,store_cash) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,bucket) DO UPDATE SET
    captured_at=excluded.captured_at,cash=excluded.cash,held_bids=excluded.held_bids,items=excluded.items,
    businesses=excluded.businesses,sealed_palettes=excluded.sealed_palettes,total=excluded.total,store_cash=excluded.store_cash
    WHERE excluded.captured_at >= net_worth_snapshots.captured_at`)
    .run(userId, Math.floor(now / 60000), now, current.cash, current.heldBids, current.items, current.businesses, current.sealedPalettes, current.total,current.storeCash);
  return current;
}
export function captureNetWorth(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => {
    if (!hasTable(db, 'users')) return { recorded: 0 };
    return transaction(db, () => {
      ensureNetWorthSchema(db);
      const users = db.prepare(`SELECT u.id FROM users u WHERE u.npc=0 AND u.banned=0 AND NOT EXISTS
        (SELECT 1 FROM net_worth_snapshots s WHERE s.user_id=u.id AND s.captured_at>?)`).all(now - NET_WORTH_SAMPLE_MS);
      if (!users.length) return { recorded: 0 };
      const indexes = marketIndexes(db, now);
      for (const user of users) recordNetWorth(db, user.id, { now, indexes });
      return { recorded: users.length };
    });
  });
}
export function netWorthHistory(dataDir, user, { range = '1d', now = Date.now() } = {}) {
  if (!Object.hasOwn(NET_WORTH_RANGES, range)) throw new AccountError('invalid_net_worth_range');
  return withDatabase(dataDir, db => transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM users WHERE id=? AND npc=0 AND banned=0').get(user?.id)) throw new AccountError('login_required', 401);
    const current = recordNetWorth(db, user.id, { now });
    const trackedSince = db.prepare('SELECT MIN(captured_at) AS first FROM net_worth_snapshots WHERE user_id=?').get(user.id).first;
    const from = NET_WORTH_RANGES[range] === null ? trackedSince : Math.max(trackedSince, now - NET_WORTH_RANGES[range]);
    const step = Math.max(NET_WORTH_SAMPLE_MS, Math.ceil((now - from) / 400));
    // Return the latest real snapshot per display bucket, bounded to ~401
    // points even across years. Retain exact first and last observations.
    const points = db.prepare(`SELECT captured_at AS capturedAt,total FROM net_worth_snapshots WHERE user_id=? AND captured_at IN
      (SELECT MAX(captured_at) FROM net_worth_snapshots WHERE user_id=? AND captured_at>=? AND captured_at<=?
       GROUP BY CAST((captured_at-?)/? AS INTEGER)) ORDER BY captured_at`).all(user.id, user.id, from, now, from, step);
    const first = db.prepare(`SELECT captured_at AS capturedAt,total FROM net_worth_snapshots
      WHERE user_id=? AND captured_at>=? AND captured_at<=? ORDER BY captured_at LIMIT 1`).get(user.id, from, now);
    if (first && points[0]?.capturedAt !== first.capturedAt) points.unshift(first);
    const observationCount = db.prepare('SELECT COUNT(*) AS n FROM net_worth_snapshots WHERE user_id=? AND captured_at>=? AND captured_at<=?').get(user.id, from, now).n;
    return { range, capturedAt: now, trackedSince, current, points, observationCount };

  }));
}
