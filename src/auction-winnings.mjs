import { withDatabase } from './database.mjs';
import { AccountError } from './errors.mjs';
import { settleAuction, inventoryIsLocked } from './resale.mjs';
import { settlePaletteAuction, ensurePaletteAuctionSchema } from './palette-auctions.mjs';
import { assertPlayerFree } from './justice.mjs';

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const offerArt = offer => ({ category: offer.category, quantity: offer.quantity, openingMode: offer.openingMode });

// Independent of the bounded bid-history pages: an old unopened win remains
// discoverable. Read only public box metadata, never the reserved finds.
export function unopenedAuctionWinnings(dataDir, user, { now = Date.now(), flags = {} } = {}) {
  const due = withDatabase(dataDir, db => {
    const player = db.prepare('SELECT id,must_change_password FROM users WHERE id=? AND npc=0 AND banned=0').get(user?.id || '');
    if (!player) throw new AccountError('login_required', 401);
    if (player.must_change_password) throw new AccountError('password_change_required', 403);
    assertPlayerFree(db, player.id, now);
    if (flags.paletteAuctions && hasTable(db,'primary_palette_auctions')) ensurePaletteAuctionSchema(db,now);
    const pending = table => hasTable(db, table) ? db.prepare(`SELECT id FROM ${table}
      WHERE current_bidder_id=? AND settled_at IS NULL AND ends_at<=? AND status!='cancelled'`).all(player.id, now).map(row => row.id) : [];
    return { resales: flags.resales ? pending('resale_auctions') : [], palettes: flags.paletteAuctions ? pending('primary_palette_auctions') : [] };
  });
  for (const id of due.resales) settleAuction(dataDir, id, { now });
  for (const id of due.palettes) settlePaletteAuction(dataDir, id, { now });
  return withDatabase(dataDir, db => {
    const rewards = [];
    if (flags.resales && hasTable(db, 'sealed_cases')) {
      const rows = db.prepare(`SELECT i.id,i.item,a.id AS auction_id,a.settled_at FROM inventory i
        JOIN sealed_cases c ON c.inventory_id=i.id
        JOIN resale_auction_items ai ON ai.inventory_id=i.id JOIN resale_auctions a ON a.id=ai.auction_id
        WHERE i.user_id=? AND i.sold_at IS NULL AND c.opened_at IS NULL
          AND a.winner_id=? AND a.settled_at IS NOT NULL AND json_extract(i.item,'$.kind')='case'
        ORDER BY a.settled_at DESC,a.id,i.id`).all(user.id,user.id);
      const seen = new Set();
      for (const row of rows) {
        if (seen.has(row.id) || inventoryIsLocked(db,row.id)) continue;
        seen.add(row.id);
        const item = JSON.parse(row.item);
        rewards.push({ id:row.id, kind:'case', auctionId:row.auction_id, name:item.title, nameDe:item.titleDe || item.title,
          wonAt:row.settled_at, box:{ kind:'case', caseType:item.caseType, caseTier:item.caseTier, caseBadge:item.caseBadge },
          href:`/inventory?focus=${encodeURIComponent(row.id)}&action=open` });
      }
    }
    if (flags.paletteAuctions && hasTable(db,'primary_palette_auctions')) {
      const rows = db.prepare(`SELECT a.id,a.public_snapshot_json,a.settled_at FROM primary_palette_auctions a
        WHERE a.winner_id=? AND a.settled_at IS NOT NULL AND a.revealed_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM primary_palette_mystery_stock m WHERE m.auction_id=a.id AND m.seized_at IS NOT NULL)
        ORDER BY a.settled_at DESC,a.id`).all(user.id);
      for (const row of rows) {
        const snapshot = JSON.parse(row.public_snapshot_json);
        rewards.push({ id:row.id, kind:'palette', name:snapshot.name, nameDe:snapshot.nameDe || snapshot.name,
          wonAt:row.settled_at, offer:snapshot.stockOffer ? offerArt(snapshot.stockOffer) : { openingMode:'mystery' },
          href:`/auction-house?reveal=${encodeURIComponent(row.id)}` });
      }
    }
    if (flags.palettes && hasTable(db,'stock_palette_purchases')) {
      for (const row of db.prepare(`SELECT id,offer,created_at FROM stock_palette_purchases
        WHERE user_id=? AND revealed_at IS NULL AND seized_at IS NULL ORDER BY created_at DESC,id`).all(user.id)) {
        const offer = JSON.parse(row.offer);
        rewards.push({ id:row.id, kind:'stock-palette', name:offer.name, nameDe:offer.nameDe || offer.name,
          wonAt:row.created_at, offer:offerArt(offer), href:`/auction-house?open-palette=${encodeURIComponent(row.id)}` });
      }
    }
    return rewards.sort((a,b) => b.wonAt-a.wonAt || a.id.localeCompare(b.id));
  });
}
