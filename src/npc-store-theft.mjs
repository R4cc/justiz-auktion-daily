import { randomInt, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { ensureBusinessSchema } from './businesses.mjs';
import { ensureResaleSchema, inventoryIsLocked } from './resale.mjs';
import { plotLocation } from './town-plots.mjs';
import { npcStoreTheftChance } from './economy-balance.mjs';
import { ensureStoreActivitySchema } from './store-event-schema.mjs';
import { pushNotification } from './notifications.mjs';

export const NPC_STORE_THEFT_INTERVAL = 24 * 3_600_000;

// The economy runtime checks offline and online stores equally. First tracking
// grants a full day of grace; downtime creates one roll, never a loss backlog.
export function tickNpcStoreThefts(dataDir, { now = Date.now(), random = randomInt } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); ensureResaleSchema(db, now); ensureStoreActivitySchema(db);
    db.exec(`CREATE TABLE IF NOT EXISTS npc_store_theft_checks (
      business_id TEXT PRIMARY KEY REFERENCES businesses(id), checked_at INTEGER NOT NULL
    ) STRICT`);
    const events = [];
    const pendingHands = Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='store_heists'").get());
    for (const shop of db.prepare(`SELECT b.* FROM businesses b JOIN users u ON u.id=b.user_id
      WHERE b.retired=0 AND u.npc=0 ORDER BY b.bought_at,b.id`).all()) {
      db.prepare('INSERT OR IGNORE INTO npc_store_theft_checks VALUES (?,?)').run(shop.id, now);
      const last = db.prepare('SELECT checked_at FROM npc_store_theft_checks WHERE business_id=?').get(shop.id).checked_at;
      if (now < last + NPC_STORE_THEFT_INTERVAL || now < shop.bought_at + NPC_STORE_THEFT_INTERVAL) continue;
      db.prepare('UPDATE npc_store_theft_checks SET checked_at=? WHERE business_id=?').run(now, shop.id);
      const stock = db.prepare(`SELECT i.id,i.item FROM business_stock s JOIN inventory i ON i.id=s.inventory_id
        WHERE s.business_id=? AND s.sold_at IS NULL AND i.sold_at IS NULL AND i.user_id=? AND s.stocked_at<=?
        ORDER BY s.stocked_at,i.id`).all(shop.id, shop.user_id, now).filter(item =>
        !inventoryIsLocked(db, item.id) && (!pendingHands || !db.prepare(`SELECT 1 FROM store_heists
          WHERE inventory_id=? AND status IN ('active','police')`).get(item.id)));
      if (!stock.length) continue;
      const chance = npcStoreTheftChance(shop.security_guard, plotLocation(db, shop.plot_id)?.theftMultiplier ?? 1);
      if (random(10_000) >= Math.round(chance * 100)) continue;
      const item = stock[random(stock.length)], id = randomUUID(), title = JSON.parse(item.item).title || 'item';
      if (!db.prepare('UPDATE inventory SET sold_at=? WHERE id=? AND user_id=? AND sold_at IS NULL').run(now,item.id,shop.user_id).changes ||
          !db.prepare('DELETE FROM business_stock WHERE business_id=? AND inventory_id=? AND sold_at IS NULL').run(shop.id,item.id).changes)
        throw new AccountError('stock_conflict',409);
      const result = { id, shopId:shop.id, shopName:shop.store_name||'', shopType:shop.type, type:'npc_theft',
        titleEn:'NPC shoplifting', titleDe:'NPC-Diebstahl',
        bodyEn:`An NPC stole “${title}” from your shelves.`, bodyDe:`Ein NPC hat „${title}“ aus deinem Regal gestohlen.`,
        inventoryId:item.id, itemsLost:1, itemsSold:0, money:0, chancePercent:chance, createdAt:now };
      db.prepare('INSERT INTO store_events VALUES (?,?,?,?,?,NULL)').run(id,shop.id,shop.user_id,JSON.stringify(result),now);
      pushNotification(db,shop.user_id,{type:'store',sourceKey:`store-event:${id}`,titleEn:result.titleEn,titleDe:result.titleDe,
        bodyEn:result.bodyEn,bodyDe:result.bodyDe,href:`/stores?shop=${encodeURIComponent(shop.id)}`},now);
      events.push(result);
    }
    return { events };
  }));
}
