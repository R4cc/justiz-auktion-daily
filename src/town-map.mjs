import { storeReputation } from './store-reputation.mjs';
import { withDatabase, transaction } from './database.mjs';
import { ensureBusinessSchema, advanceShop, SHOP_TYPES, SHOP_SIZES, MAX_STORES_PER_USER, businessTypeForItem } from './businesses.mjs';
import { inventoryIsLocked } from './resale.mjs';
import { sealedPaletteInventoryIds } from './palette-auctions.mjs';
import { TOWN_DISTRICTS, TOWN_STREETS, plotLocation } from './town-plots.mjs';
import { marketIndexes } from './market.mjs';
import { maskUsername } from './username-privacy.mjs';
import { levelForXp } from './progression.mjs';

export function townMap(dataDir, viewer = null, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); marketIndexes(db, now);
    const player=viewer && db.prepare('SELECT id, xp FROM users WHERE id=? AND npc=0 AND banned=0 AND must_change_password=0').get(viewer.id);
    const businesses=db.prepare('SELECT b.*,u.username,u.banned,u.npc FROM businesses b JOIN users u ON u.id=b.user_id').all();
    for (const shop of businesses) if (!shop.banned && !shop.npc) advanceShop(db, shop, now);
    const plots=db.prepare('SELECT * FROM town_plots ORDER BY id').all().map(plot=>{
      const location=plotLocation(db,plot.id), size=SHOP_SIZES.find(entry=>entry.id===plot.size), shop=businesses.find(entry=>entry.plot_id===plot.id);
      return {id:plot.id,...location,occupied:Boolean(shop),costs:Object.fromEntries(SHOP_TYPES.map(type=>[type.id,Math.round(size.cost*type.costFactor*location.priceMultiplier)])),
        capacity:size.capacity,carCapacity:size.carCapacity,requiredLevel:size.requiredLevel,
        business:shop && !shop.banned && !shop.npc ? {...storeReputation(db,shop,now),id:shop.id,type:shop.type,name:shop.store_name,owner:player ? shop.username : maskUsername(shop.username),own:player?.id===shop.user_id,
          stockCount:db.prepare('SELECT COUNT(*) AS n FROM business_stock WHERE business_id=? AND sold_at IS NULL').get(shop.id).n} : null};
    });
    const sealed = sealedPaletteInventoryIds(db), compatibleStock = Object.fromEntries(SHOP_TYPES.map(type=>[type.id,0]));
    if (player) for (const row of db.prepare('SELECT id,item FROM inventory WHERE user_id=? AND sold_at IS NULL').all(player.id)) {
      if (sealed.has(row.id) || inventoryIsLocked(db,row.id) || db.prepare('SELECT 1 FROM business_stock WHERE inventory_id=? AND sold_at IS NULL').get(row.id)) continue;
      const type = businessTypeForItem(JSON.parse(row.item)); if (type) compatibleStock[type]++;
    }
    return {districts:TOWN_DISTRICTS,streets:TOWN_STREETS,types:SHOP_TYPES,sizes:SHOP_SIZES,plots,total:plots.length,available:plots.filter(plot=>!plot.occupied).length, compatibleStock,
      playerLevel:player ? levelForXp(player.xp) : null,
      myStoreCount:player ? businesses.filter(shop=>shop.user_id===player.id).length : 0,maxStores:MAX_STORES_PER_USER};
  }));
}
