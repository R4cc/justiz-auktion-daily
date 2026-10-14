import { createHash } from 'node:crypto';
import { auctionGallery } from './auction-images.mjs';
import { itemRarity, tokenValue } from './cases.mjs';
import { readArchiveRows, transaction, withDatabase } from './database.mjs';
import { estimatedValueTokens, marketCategoryForAuction, marketIndexes } from './market.mjs';
import { ensureResaleSchema } from './resale.mjs';

export const ITEM_SUPPLIER_ID = 'npc-item-supply';
export const ITEM_DROP_PERIOD_MS = 30 * 60_000;
export const ITEM_AUCTION_DURATION_MS = 2 * 3_600_000;
export const ITEM_ACTIVE_TARGET = ITEM_AUCTION_DURATION_MS / ITEM_DROP_PERIOD_MS;
const unit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;

// Db-scoped helpers shared with the half-price events. Supply creates one
// physical item; ordinary escrow/settlement transfers that same inventory row.
export function archivedListingStock(db) {
  return readArchiveRows(db).auctions.filter(auction => {
    const price = auction.finalPrice ?? auction.currentBid;
    return auction.title && auctionGallery(auction).length && Number.isFinite(price)
      && price >= 2 && Number.isSafeInteger(Math.round(price));
  }).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
}

export function insertNpcItemListing(db, { source, sellerId, id, inventoryId, ratio, startsAt, endsAt, now, indexes }) {
  const price = source.finalPrice ?? source.currentBid;
  const item = { id: inventoryId, auctionId: source.id, title: source.title,
    image: auctionGallery(source)[0], price, sellValue: tokenValue(price),
    category: source.category, marketCategory: marketCategoryForAuction(source),
    rarity: itemRarity(price, 1).id, createdAt: now };
  const reserve = Math.max(1, Math.round(estimatedValueTokens(item, indexes) * ratio));
  // Skip archive outliers which cannot be represented safely in J€.
  if (!Number.isSafeInteger(reserve)) return false;
  db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)')
    .run(inventoryId, sellerId, JSON.stringify(item), now);
  db.prepare(`INSERT INTO resale_auctions (id,seller_id,inventory_id,start_price,status,started_at,ends_at)
    VALUES (?,?,?,?,'active',?,?)`).run(id, sellerId, inventoryId, reserve, startsAt, endsAt);
  db.prepare('INSERT INTO resale_auction_items (auction_id,inventory_id,position) VALUES (?,?,0)').run(id, inventoryId);
  return true;
}

// One new listing per half-hour and four concurrently open slots. Backfill
// only those slots still live, using their original deadline and stable id.
export function supplyNpcItemAuctions(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now);
    const bucket = Math.floor(now / ITEM_DROP_PERIOD_MS), pending = [];
    for (let slot = bucket - ITEM_ACTIVE_TARGET + 1; slot <= bucket; slot++) {
      const id = `npc-item:${slot}`;
      if (!db.prepare('SELECT 1 FROM resale_auctions WHERE id=?').get(id)) pending.push({ id, slot });
    }
    if (!pending.length) return { supplied: 0, auctions: [] };
    const stock = archivedListingStock(db);
    if (!stock.length) return { supplied: 0, auctions: [] };
    db.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,npc,tokens,created_at)
      VALUES (?, 'Market Trader', 'disabled', 1, 0, ?)`).run(ITEM_SUPPLIER_ID, now);
    const indexes = marketIndexes(db, now), auctions = [];
    for (const { id, slot } of pending) {
      const source = stock[Math.floor(unit(`npc-item-source:${slot}`) * stock.length)];
      const ratio = .65 + unit(`npc-item-price:${slot}`) * .70;
      const startsAt = slot * ITEM_DROP_PERIOD_MS;
      if (insertNpcItemListing(db, { source, sellerId: ITEM_SUPPLIER_ID, id,
        inventoryId: `npc-item-inventory:${slot}`, ratio, startsAt,
        endsAt: startsAt + ITEM_AUCTION_DURATION_MS, now, indexes })) auctions.push(id);
    }
    return { supplied: auctions.length, auctions };
  }));
}
