import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { createHash } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { AccountError } from './errors.mjs';
import { ensureResaleSchema, inventoryIsLocked } from './resale.mjs';
import { advanceShop, ensureBusinessSchema } from './businesses.mjs';
import { assertPlayerFree } from './justice.mjs';
import { ensureStoreSchema } from './storefronts.mjs';
import { pushNotification } from './notifications.mjs';

export const REVIEW_SUPPLIER_ID = 'npc-review-agency';
export const REVIEW_AUCTION_DURATION_MS = 12 * 3_600_000;
export const REVIEW_PACK_SIZES = Object.freeze([5, 10, 15, 20, 30]);
export const REVIEW_PRICE_PER_REVIEW = ECONOMY_BALANCE.reviewPricePerReview;
const DAY = 86_400_000, HOUR = 3_600_000;
const unit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;
const fail = (code, status = 400) => { throw new AccountError(code, status); };

// One guaranteed 08:00 UTC listing and an optional 20:00 UTC listing.
// Restart catch-up offers only windows still open, with their original end.
export function reviewAuctionWindows(dayStart) {
  return [8, ...(unit(`review-second:${dayStart}`) < .5 ? [20] : [])].map(hour => ({
    startsAt: dayStart + hour * HOUR, endsAt: dayStart + hour * HOUR + REVIEW_AUCTION_DURATION_MS
  }));
}

export function supplyReviewAuctions(dataDir, { now = Date.now() } = {}) {
  const dayStart = Math.floor(now / DAY) * DAY;
  const windows = [dayStart - DAY, dayStart].flatMap(reviewAuctionWindows).filter(window => window.startsAt <= now && window.endsAt > now);
  if (!windows.length) return { supplied: 0, auctions: [] };
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db); ensureResaleSchema(db, now);
    db.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,npc,tokens,created_at)
      VALUES (?, 'Five Star Agency', 'disabled', 1, 0, ?)`).run(REVIEW_SUPPLIER_ID, now);
    const auctions = [];
    for (const { startsAt, endsAt } of windows) {
      const id = `npc-reviews:${startsAt}`, inventoryId = `review-pack:${startsAt}`;
      if (db.prepare('SELECT 1 FROM resale_auctions WHERE id=?').get(id)) continue;
      const reviewCount = REVIEW_PACK_SIZES[Math.floor(unit(`review-size:${startsAt}`) * REVIEW_PACK_SIZES.length)];
      const price = reviewCount * REVIEW_PRICE_PER_REVIEW;
      const item = { id: inventoryId, kind: 'review-pack', reviewCount, stars: 5,
        title: `${reviewCount} five-star reviews`, titleDe: `${reviewCount} Fünf-Sterne-Bewertungen`,
        price, sellValue: 0, rarity: 'uncommon', createdAt: startsAt };
      db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)')
        .run(inventoryId, REVIEW_SUPPLIER_ID, JSON.stringify(item), startsAt);
      db.prepare('INSERT INTO store_review_packs (inventory_id,review_count) VALUES (?,?)').run(inventoryId, reviewCount);
      db.prepare(`INSERT INTO resale_auctions (id,seller_id,inventory_id,start_price,status,started_at,ends_at)
        VALUES (?,?,?,?,'active',?,?)`).run(id, REVIEW_SUPPLIER_ID, inventoryId, price, startsAt, endsAt);
      db.prepare('INSERT INTO resale_auction_items (auction_id,inventory_id,position) VALUES (?,?,0)').run(id, inventoryId);
      auctions.push(id);
    }
    return { supplied: auctions.length, auctions };
  }));
}

export function redeemReviewPack(dataDir, user, { inventoryId, shopId } = {}, { now = Date.now() } = {}) {
  if (typeof inventoryId !== 'string' || inventoryId.length > 100 || typeof shopId !== 'string' || shopId.length > 100) fail('invalid_review_pack');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreSchema(db); ensureResaleSchema(db, now);
    const player = db.prepare('SELECT id FROM users WHERE id=? AND npc=0 AND banned=0 AND must_change_password=0').get(user?.id || '');
    if (!player) fail('login_required', 401);
    assertPlayerFree(db, player.id, now);
    const pack = db.prepare(`SELECT p.*,i.user_id,i.sold_at,i.item FROM store_review_packs p
      JOIN inventory i ON i.id=p.inventory_id WHERE p.inventory_id=?`).get(inventoryId);
    if (!pack || pack.user_id !== player.id || JSON.parse(pack.item).kind !== 'review-pack') fail('review_pack_not_found', 404);
    // The inventory ID is the redemption receipt; an exact retry never adds stars.
    if (pack.redeemed_at !== null) {
      if (pack.business_id !== shopId || pack.redeemed_by !== player.id) fail('review_pack_used', 409);
      return { inventoryId, shopId, reviewCount: pack.review_count, stars: 5 };
    }
    if (pack.sold_at !== null) fail('review_pack_used', 409);
    if (inventoryIsLocked(db, inventoryId)) fail('item_listed', 409);
    if (db.prepare('SELECT 1 FROM business_stock WHERE inventory_id=? AND sold_at IS NULL').get(inventoryId)) fail('item_stocked', 409);
    const shop = db.prepare('SELECT * FROM businesses WHERE id=? AND user_id=?').get(shopId, player.id);
    if (!shop) fail('business_not_found', 404);
    // Flush historical sales before applying the new reputation boost.
    advanceShop(db, shop, now);
    if (!db.prepare('UPDATE inventory SET sold_at=? WHERE id=? AND user_id=? AND sold_at IS NULL').run(now, inventoryId, player.id).changes) fail('review_pack_used', 409);
    db.prepare('UPDATE store_review_packs SET business_id=?,redeemed_by=?,redeemed_at=? WHERE inventory_id=?')
      .run(shopId, player.id, now, inventoryId);
    pushNotification(db, player.id, { type: 'store', sourceKey: `review-pack:${inventoryId}`,
      titleEn: 'Five-star reviews applied', titleDe: 'Fünf-Sterne-Bewertungen hinzugefügt',
      bodyEn: `${pack.review_count} five-star reviews added to ${shop.store_name || 'your store'}.`,
      bodyDe: `${pack.review_count} Fünf-Sterne-Bewertungen für ${shop.store_name || 'deinen Laden'}.`,
      href: `/stores?shop=${encodeURIComponent(shopId)}` }, now);
    return { inventoryId, shopId, reviewCount: pack.review_count, stars: 5 };
  }));
}
