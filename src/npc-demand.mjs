import { createHash } from 'node:crypto';

export const NPC_DEMAND_WINDOW_MS = 6 * 3600_000;
export const NPC_DEMAND_DEPTH = 8;

// Ownership, listing UUID and bundle size cannot manufacture a fresh audience.
export function npcItemKey(item) {
  return createHash('sha256').update(JSON.stringify(item.auctionId != null
    ? ['auction', String(item.auctionId)] : ['item', item.title || '', item.marketCategory || '', item.price]))
    .digest('hex');
}
export function npcAudienceKey(item, now) {
  return `${npcItemKey(item)}:${Math.floor(now / NPC_DEMAND_WINDOW_MS)}`;
}

export function npcDemand(db, item, now, excludeAuctionId = '') {
  const condition = item.auctionId != null ? "CAST(json_extract(i.item, '$.auctionId') AS TEXT) = ?"
    : "json_extract(i.item, '$.title') = ? AND COALESCE(json_extract(i.item, '$.marketCategory'), '') = ? AND json_extract(i.item, '$.price') = ?";
  const identity = item.auctionId != null ? [String(item.auctionId)] : [item.title || '', item.marketCategory || '', item.price];
  const rows = db.prepare(`SELECT a.id, a.quantity, a.settled_at, a.status FROM (
    SELECT r.id, r.settled_at, r.status, COUNT(*) AS quantity FROM resale_auctions r
    JOIN users u ON u.id = COALESCE(r.winner_id, r.current_bidder_id) AND u.npc = 1
    JOIN resale_auction_items ai ON ai.auction_id = r.id JOIN inventory i ON i.id = ai.inventory_id
    WHERE r.id != ? AND ${condition} AND (
      (r.status = 'ended' AND r.winner_id IS NOT NULL AND r.settled_at > ?) OR
      (r.status = 'active' AND r.ends_at > ?) OR
      (r.status = 'ended' AND r.winner_id IS NOT NULL AND r.settled_at IS NULL))
    GROUP BY r.id) a`).all(excludeAuctionId, ...identity, now - NPC_DEMAND_WINDOW_MS, now);
  const committed = rows.reduce((sum, row) => sum + row.quantity * (row.settled_at == null ? 1
    : Math.max(0, Math.min(1, 1 - (now - row.settled_at) / NPC_DEMAND_WINDOW_MS))), 0);
  const multiplier = Math.max(.35, 1 / (1 + committed / NPC_DEMAND_DEPTH));
  return { multiplier, level: multiplier < .7 ? 'low' : multiplier < .95 ? 'limited' : 'steady' };
}
