import { createHash } from 'node:crypto';
import { auctionGallery } from './auction-images.mjs';
import { itemRarity, tokenValue } from './cases.mjs';
import { readArchiveRows, transaction, withDatabase } from './database.mjs';
import { estimatedValueTokens, marketCategoryForAuction, marketIndexes } from './market.mjs';
import { ensureResaleSchema } from './resale.mjs';

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
    const stock = readArchiveRows(db).auctions.filter(auction => {
      const price = auction.finalPrice ?? auction.currentBid;
      return auction.title && auctionGallery(auction).length && Number.isFinite(price)
        && price >= 2 && Number.isSafeInteger(Math.round(price));
    }).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
    if (!stock.length) return { supplied: 0, auctions: [] };
    db.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,npc,tokens,created_at)
      VALUES (?, 'Bargain Trader', 'disabled', 1, 0, ?)`).run(BARGAIN_SUPPLIER_ID, now);
    const indexes = marketIndexes(db, now), auctions = [];
    for (const { startsAt, endsAt } of pending) {
      const source = stock[Math.floor(unit(`bargain-item:${startsAt}`) * stock.length)];
      const id = `npc-bargain:${startsAt}`, inventoryId = `bargain-item:${startsAt}`;
      const price = source.finalPrice ?? source.currentBid;
      const item = { id: inventoryId, auctionId: source.id, title: source.title,
        image: auctionGallery(source)[0], price, sellValue: tokenValue(price),
        category: source.category, marketCategory: marketCategoryForAuction(source),
        rarity: itemRarity(price, 1).id, createdAt: now };
      // Freeze the reserve against the live quote at actual creation, keeping
      // the original item's value intact for inventory and future market moves.
      const reserve = Math.max(1, Math.round(estimatedValueTokens(item, indexes) * .5));
      db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)')
        .run(inventoryId, BARGAIN_SUPPLIER_ID, JSON.stringify(item), now);
      db.prepare(`INSERT INTO resale_auctions (id,seller_id,inventory_id,start_price,status,started_at,ends_at)
        VALUES (?,?,?,?,'active',?,?)`).run(id, BARGAIN_SUPPLIER_ID, inventoryId, reserve, startsAt, endsAt);
      db.prepare('INSERT INTO resale_auction_items (auction_id,inventory_id,position) VALUES (?,?,0)').run(id, inventoryId);
      auctions.push(id);
    }
    return { supplied: auctions.length, auctions };
  }));
}
