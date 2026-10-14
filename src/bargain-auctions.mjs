import { createHash } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { marketIndexes } from './market.mjs';
import { ensureResaleSchema } from './resale.mjs';
import { archivedListingStock, insertNpcItemListing } from './npc-item-supply.mjs';

export const BARGAIN_SUPPLIER_ID = 'npc-bargain-supply';
export const BARGAIN_PERIOD_MS = 4 * 3_600_000;
export const BARGAIN_DURATION_MS = 3_600_000;
const DAY = 24 * 3_600_000;
const unit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;

// Six varied drop times per UTC day. Stable windows survive restarts and
// catch up only while still open; missed events never flood the board.
export function bargainAuctionWindows(dayStart) {
  return Array.from({ length: 6 }, (_, slot) => {
    const startsAt = dayStart + slot * BARGAIN_PERIOD_MS
      + Math.floor(unit(`bargain-time:${dayStart}:${slot}`) * (BARGAIN_PERIOD_MS - BARGAIN_DURATION_MS));
    return { startsAt, endsAt: startsAt + BARGAIN_DURATION_MS };
  });
}

export function supplyBargainAuctions(dataDir, { now = Date.now() } = {}) {
  const dayStart = Math.floor(now / DAY) * DAY;
  const windows = bargainAuctionWindows(dayStart).filter(window => window.startsAt <= now && window.endsAt > now);
  if (!windows.length) return { supplied: 0, auctions: [] };
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now);
    const pending = windows.filter(window => !db.prepare('SELECT 1 FROM resale_auctions WHERE id=?')
      .get(`npc-bargain:${window.startsAt}`));
    if (!pending.length) return { supplied: 0, auctions: [] };
    const stock = archivedListingStock(db);
    if (!stock.length) return { supplied: 0, auctions: [] };
    db.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,npc,tokens,created_at)
      VALUES (?, 'Bargain Trader', 'disabled', 1, 0, ?)`).run(BARGAIN_SUPPLIER_ID, now);
    const indexes = marketIndexes(db, now), auctions = [];
    for (const { startsAt, endsAt } of pending) {
      const source = stock[Math.floor(unit(`bargain-item:${startsAt}`) * stock.length)];
      const id = `npc-bargain:${startsAt}`, inventoryId = `bargain-item:${startsAt}`;
      // Freeze the reserve against the live quote at actual creation, keeping
      // the original item's value intact for inventory and future market moves.
      if (insertNpcItemListing(db, { source, sellerId: BARGAIN_SUPPLIER_ID, id, inventoryId,
        ratio: .5, startsAt, endsAt, now, indexes })) auctions.push(id);
    }
    return { supplied: auctions.length, auctions };
  }));
}
