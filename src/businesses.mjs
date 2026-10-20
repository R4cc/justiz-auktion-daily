import { syncUserStatistics } from './user-statistics.mjs';
import { ensureBusinessAbandonmentSchema, businessAbandonment, recordBusinessRestock } from './business-abandonment.mjs';
import { checkDueStoreEvent } from './store-events.mjs';
import { assertPlayerFree } from './justice.mjs';
import { reconcileCategorizedStock } from './item-category-migration.mjs';
import { storePopularity, storeReputation, storePopularityBreakdown, shelfFillFactor, assortmentPopularity } from './store-reputation.mjs';
import { ensureReviewSchema, recordNpcStoreFeedback } from './store-reviews.mjs';
import { businessTypeForItem } from './stock-compatibility.mjs';
export { businessTypeForItem } from './stock-compatibility.mjs';
import { ensureTownSchema, availableTownPlot, plotLocation } from './town-plots.mjs';
import { ECONOMY_BALANCE, npcStoreTheftChance } from './economy-balance.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { withDatabase, transaction, setState } from './database.mjs';
import { AccountError } from './errors.mjs';
import { marketCategoryForItem, marketIndexAt, marketIndexes, estimatedValueTokens } from './market.mjs';
import { ensureResaleSchema, inventoryIsLocked } from './resale.mjs';
import { sealedPaletteInventoryIds } from './palette-auctions.mjs';
import { ensureNotificationSchema, pushNotification } from './notifications.mjs';
import { auctionSelectionCategory } from './auction-selection.mjs';
import { auctionGallery } from './auction-images.mjs';
import { recordSale, salePayout, tradingTotals, acquisition, milestone, ensureTraderSchema } from './trader.mjs';
import { levelForXp } from './progression.mjs';
import { creditStoreCash, ensureStoreCashSchema } from './store-cash.mjs';
import { ensurePrestigeSchema } from './prestige-effects.mjs';

const HOUR = 3_600_000;
const WHOLESALE_PERIOD = 2 * HOUR;
const WHOLESALE_SLOT = 15 * 60_000;
const STOCK_SELLER_ID = 'npc-stock-supply';
export const DEFAULT_PROFIT_MARGIN = ECONOMY_BALANCE.businessDefaultMargin;
export const MAX_PROFIT_MARGIN = 100;
export const MAX_STORES_PER_USER = 3;
export const STORE_UPGRADE_DISCOUNT = 10;
export const STORE_UPGRADE_HOURS = Object.freeze({popup:2, tiny:8, medium:48});
const fail = (code, status = 400) => { throw new AccountError(code, status); };
const hashNumber = value => parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) / 0x100000000;

export const SHOP_TYPES = [
  { id: 'wine', name: 'Wine store', nameDe: 'Weinhandlung', costFactor: 1, typicalValue: 35, conversion: .28 },
  { id: 'toys', name: 'Toy store', nameDe: 'Spielwarengeschaeft', costFactor: 1, typicalValue: 40, conversion: .28 },
  { id: 'electronics', name: 'Electronics store', nameDe: 'Elektronikladen', costFactor: 1.2, typicalValue: 120, conversion: .22 },
  { id: 'cars', name: 'Car dealership', nameDe: 'Autohaus', costFactor: 2.5, typicalValue: 2500, conversion: .06 },
  { id: 'jeweler', name: 'Jeweler', nameDe: 'Juwelier', costFactor: 1.8, typicalValue: 350, conversion: .16 },
  { id: 'hardware', name: 'Hardware store', nameDe: 'Baumarkt', costFactor: 1.1, typicalValue: 90, conversion: .24 }
];
export const SHOP_SIZES = [
  { id: 'popup', name: 'Street pop-up', nameDe: 'Strassenstand', requiredLevel: 1, cost: 1000, capacity: 10, carCapacity: 1, visitorsPerHour: 1 * ECONOMY_BALANCE.businessVisitorMultiplier },
  { id: 'tiny', name: 'Small shop', nameDe: 'Kleiner Laden', requiredLevel: 3, cost: 4000, capacity: 25, carCapacity: 3, visitorsPerHour: 2 * ECONOMY_BALANCE.businessVisitorMultiplier },
  { id: 'medium', name: 'Medium shop', nameDe: 'Mittlerer Laden', requiredLevel: 6, cost: 15000, capacity: 60, carCapacity: 8, visitorsPerHour: 5 * ECONOMY_BALANCE.businessVisitorMultiplier },
  { id: 'large', name: 'Large shop', nameDe: 'Grosser Laden', requiredLevel: 10, cost: 50000, capacity: 150, carCapacity: 20, visitorsPerHour: 11 * ECONOMY_BALANCE.businessVisitorMultiplier }
];

// Retained only to migrate bids on stock auctions created by older versions.
const LEGACY_WHOLESALE_STOCK = [
  { id: 'riesling', type: 'wine', title: 'Wachau Riesling 2022', quantity: 24, price: 24 },
  { id: 'blocks', type: 'toys', title: 'Modular building set', quantity: 18, price: 32 },
  { id: 'headphones', type: 'electronics', title: 'Wireless headphones', quantity: 10, price: 95 },
  { id: 'citycar', type: 'cars', title: 'Compact city car', quantity: 2, price: 1900 },
  { id: 'redwine', type: 'wine', title: 'Burgenland Red 2021', quantity: 12, price: 46 },
  { id: 'puzzle', type: 'toys', title: 'Wooden puzzle set', quantity: 24, price: 19 },
  { id: 'tablet', type: 'electronics', title: '10-inch tablet', quantity: 6, price: 190 },
  { id: 'estate', type: 'cars', title: 'Used estate car', quantity: 2, price: 3600 }
];
const STOCK_SLOTS = ['wine', 'toys', 'electronics', 'cars', 'wine', 'toys', 'electronics', 'cars'];
const STOCK_BATCHES = {
  wine: { quantity: 24, budget: 576, maxPrice: 250 },
  toys: { quantity: 24, budget: 576, maxPrice: 250 },
  electronics: { quantity: 10, budget: 950, maxPrice: 1500 },
  cars: { quantity: 2, budget: 3800, maxPrice: 25000 },
  jeweler: { quantity: 6, budget: 2100, maxPrice: 5000 },
  hardware: { quantity: 12, budget: 1080, maxPrice: 1500 }
};

const shopType = id => SHOP_TYPES.find(type => type.id === id);
const shopSize = id => SHOP_SIZES.find(size => size.id === id);
const shopCapacity = (type, size) => type === 'cars' ? size.carCapacity : size.capacity;
const lotId = (bucket, stockId) => `${bucket}:${stockId}`;
const marketCategory = type => ({cars:'vehicles',toys:'collectibles',jeweler:'watches_jewelry',hardware:'tools'})[type] || type;

export function ensureBusinessSchema(db, { now = Date.now() } = {}) {
  const migrateSales = !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'business_sales'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
    size TEXT NOT NULL, bought_at INTEGER NOT NULL, last_tick_at INTEGER NOT NULL,
    visitors INTEGER NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0,
    revenue INTEGER NOT NULL DEFAULT 0, cash_balance INTEGER NOT NULL DEFAULT 0 CHECK(cash_balance>=0),
    profit_margin INTEGER NOT NULL DEFAULT 20 CHECK(profit_margin BETWEEN 0 AND 100),
    traffic_popularity REAL NOT NULL DEFAULT 0 CHECK(traffic_popularity BETWEEN 0 AND 1.5)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS businesses_user ON businesses(user_id);
  CREATE TABLE IF NOT EXISTS business_stock (
    inventory_id TEXT PRIMARY KEY REFERENCES inventory(id), business_id TEXT NOT NULL REFERENCES businesses(id),
    stocked_at INTEGER NOT NULL, asking_price INTEGER NOT NULL, sold_at INTEGER, sold_price INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS business_stock_active ON business_stock(business_id, sold_at);
  CREATE TABLE IF NOT EXISTS business_sales (
    id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
    inventory_id TEXT NOT NULL, price INTEGER NOT NULL, sold_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS business_sales_time ON business_sales(business_id, sold_at);
  CREATE TABLE IF NOT EXISTS business_upgrade_requests (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id), payload TEXT NOT NULL,
    cost INTEGER NOT NULL CHECK(cost>0), started_at INTEGER NOT NULL,
    result TEXT NOT NULL, PRIMARY KEY(user_id,request_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS wholesale_auctions (
    id TEXT PRIMARY KEY, stock_id TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    reserve INTEGER NOT NULL, current_bid INTEGER, bidder_id TEXT REFERENCES users(id),
    winner_id TEXT REFERENCES users(id), settled_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS wholesale_due ON wholesale_auctions(ends_at, settled_at);
  CREATE TABLE IF NOT EXISTS wholesale_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT, auction_id TEXT NOT NULL REFERENCES wholesale_auctions(id),
    bidder_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, created_at INTEGER NOT NULL
  ) STRICT`);
  if (!db.prepare('PRAGMA table_info(business_stock)').all().some(column => column.name === 'sold_price')) {
    db.exec('ALTER TABLE business_stock ADD COLUMN sold_price INTEGER');
  }
  if (!db.prepare('PRAGMA table_info(businesses)').all().some(column => column.name === 'profit_margin')) {
    db.exec('ALTER TABLE businesses ADD COLUMN profit_margin INTEGER NOT NULL DEFAULT 30 CHECK(profit_margin BETWEEN 0 AND 100)');
  }
  const guardColumns = db.prepare('PRAGMA table_info(businesses)').all();
  if (guardColumns.some(column => column.name === 'goose_guard') && !guardColumns.some(column => column.name === 'security_guard')) {
    db.exec('ALTER TABLE businesses RENAME COLUMN goose_guard TO security_guard');
  }
  for (const [name, definition] of [['upgrade_size','TEXT'], ['upgrade_started_at','INTEGER'], ['upgrade_ends_at','INTEGER'], ['upgrade_cost','INTEGER'], ['opening_cost', 'INTEGER'], ['retired', 'INTEGER NOT NULL DEFAULT 0'], ['popularity_factors', 'TEXT'], ['store_name', "TEXT NOT NULL DEFAULT ''"], ['store_motto', "TEXT NOT NULL DEFAULT ''"], ['security_guard', 'INTEGER NOT NULL DEFAULT 0'], ['security_guard_profit', 'INTEGER NOT NULL DEFAULT 0'], ['security_guard_fees', 'INTEGER NOT NULL DEFAULT 0 CHECK(security_guard_fees>=0)'], ['mischief_enabled','INTEGER NOT NULL DEFAULT 0 CHECK(mischief_enabled IN (0,1))']]) {
    if (!db.prepare('PRAGMA table_info(businesses)').all().some(column => column.name === name)) db.exec(`ALTER TABLE businesses ADD COLUMN ${name} ${definition}`);
  }
  // Keep sale history independently of physical shelf rows: a player purchase
  // transfers that same inventory item, which its new owner may stock again.
  if (migrateSales) db.exec(`INSERT OR IGNORE INTO business_sales (id, business_id, inventory_id, price, sold_at)
    SELECT 'npc:' || inventory_id, business_id, inventory_id, COALESCE(sold_price, asking_price), sold_at
    FROM business_stock WHERE sold_at IS NOT NULL`);
  if (!db.prepare('PRAGMA table_info(businesses)').all().some(column => column.name === 'traffic_popularity')) {
    db.exec('ALTER TABLE businesses ADD COLUMN traffic_popularity REAL NOT NULL DEFAULT 0 CHECK(traffic_popularity BETWEEN 0 AND 1.5)');
    // Existing stores inherit the appeal of their current assortment once.
    marketIndexes(db, Date.now());
    for (const row of db.prepare('SELECT * FROM businesses').all()) {
      const stock = shopStock(db, row.id, row.type, row.profit_margin);
      const metrics=shopMetrics(db,row,stock,Date.now());
      db.prepare('UPDATE businesses SET traffic_popularity=?,popularity_factors=? WHERE id=?').run(metrics.popularity,JSON.stringify(metrics.factors),row.id);
    }
  }
  upgradeStockPopularity(db);
  ensureStoreCashSchema(db);
  ensureReviewSchema(db);
  ensureTownSchema(db, { now });
  ensureBusinessAbandonmentSchema(db, now);
}

// Upgrade recorded assortment factors, using their original stock snapshot so
// sales or market movements since stocking do not rewrite the other factors.
function upgradeStockPopularity(db) {
  const key = 'store_popularity_factors_v2';
  if (db.prepare('SELECT 1 FROM app_state WHERE key=?').get(key)) return;
  const update = db.prepare('UPDATE businesses SET traffic_popularity=?,popularity_factors=? WHERE id=? AND popularity_factors=? AND traffic_popularity=?');
  for (const row of db.prepare('SELECT id,traffic_popularity,popularity_factors FROM businesses WHERE popularity_factors IS NOT NULL').all()) {
    let old;
    try { old = JSON.parse(row.popularity_factors); } catch { continue; }
    if (old?.version !== 1 || old.basePopularity !== row.traffic_popularity ||
        ![old.count,old.capacity,old.varietyFactor,old.valueFactor].every(Number.isFinite) || old.capacity <= 0) continue;
    const factors = {...old,version:2,valueFactor:Math.max(1,old.valueFactor),fillFactor:shelfFillFactor(old.count,old.capacity)};
    factors.basePopularity = assortmentPopularity(factors.count,factors.varietyFactor,factors.valueFactor,factors.fillFactor);
    update.run(factors.basePopularity,JSON.stringify(factors),row.id,row.popularity_factors,row.traffic_popularity);
  }
  setState(db,key,{version:2});
}

function activeUser(db, user) {
  const row = db.prepare('SELECT id, tokens, xp FROM users WHERE id = ? AND npc = 0 AND banned = 0').get(user?.id);
  if (!row) fail('login_required', 401);
  return row;
}

const stockType = businessTypeForItem;
export function businessSaleChance(baseConversion, profitMargin) {
  // Discounting improves turnover; the default margin is 20%, while
  // very high margins still sell occasionally. Visitors are calculated apart.
  return Math.max(0, Math.min(.85, baseConversion * Math.exp(-ECONOMY_BALANCE.businessMarginElasticity * (profitMargin - DEFAULT_PROFIT_MARGIN) / 100)));
}

export function businessItemSaleChance(type, profitMargin, referenceValue) {
  const affordability = Math.min(1, Math.sqrt(type.typicalValue / Math.max(1, referenceValue)));
  return businessSaleChance(type.conversion, profitMargin) * affordability;
}

function referencePrice(db, item, type, at) {
  const category = marketCategoryForItem(item) || marketCategory(type);
  return estimatedValueTokens({ ...item, marketCategory: category }, { [category]: marketIndexAt(db, category, at) });
}

function shelfPrice(db, item, type, profitMargin, at) {
  const reference = referencePrice(db, item, type, at);
  return profitMargin ? Math.max(reference + 1, Math.round(reference * (1 + profitMargin / 100))) : reference;
}

export function shopStock(db, id, type, profitMargin, now = Date.now()) {
  return db.prepare(`SELECT s.inventory_id AS id, s.asking_price AS askingPrice, s.stocked_at AS stockedAt,
    i.item FROM business_stock s JOIN inventory i ON i.id = s.inventory_id
    WHERE s.business_id = ? AND s.sold_at IS NULL ORDER BY s.stocked_at, s.inventory_id`).all(id)
    .map(row => {
      const item = JSON.parse(row.item);
      return { id: row.id, referencePrice: referencePrice(db, item, type, now),
        askingPrice: shelfPrice(db, item, type, profitMargin, now), stockedAt: row.stockedAt, item };
    });
}

function shopMetrics(db, row, stock, at) {
  const size = shopSize(row.size), type = shopType(row.type);
  const variety = new Set(stock.map(entry => entry.item.title)).size;
  // Assortment appeal is captured when the owner stocks or removes goods.
  // Sales consume items but do not rewrite foot traffic or popularity.
  const value = stock.length ? Math.round(stock.reduce((sum, entry) =>
    sum + referencePrice(db, entry.item, row.type, at), 0) / stock.length) : 0;
  const capacity = shopCapacity(row.type, size);
  const varietyFactor=.65+.15*Math.min(4,variety), valueFactor=Math.max(1,.8+.2*Math.min(2,value/type.typicalValue)), fillFactor=shelfFillFactor(stock.length,capacity);
  const popularity = assortmentPopularity(stock.length,varietyFactor,valueFactor,fillFactor);
  return { variety, value, popularity: Math.round(popularity * 100) / 100, capacity,
    factors:{version:2,varietyFactor,valueFactor,fillFactor,variety,count:stock.length,capacity,updatedAt:at,basePopularity:Math.round(popularity*100)/100} };
}

// Settle old-size trading first so an offline upgrade never backdates larger
// capacity or traffic. Every runtime/store read uses this same transition.
export function advanceShop(db, row, now) {
  if (row.upgrade_size && row.upgrade_ends_at <= now && !row.retired) {
    const completedAt = row.upgrade_ends_at, target = shopSize(row.upgrade_size);
    advanceShopAtSize(db, row, completedAt);
    db.prepare(`UPDATE businesses SET size=?,upgrade_size=NULL,upgrade_started_at=NULL,
      upgrade_ends_at=NULL,upgrade_cost=NULL WHERE id=?`).run(target.id,row.id);
    if (row.plot_id) db.prepare('UPDATE town_plots SET size=? WHERE id=?').run(target.id,row.plot_id);
    Object.assign(row,db.prepare('SELECT * FROM businesses WHERE id=?').get(row.id));
    const metrics = shopMetrics(db,row,shopStock(db,row.id,row.type,row.profit_margin,completedAt),completedAt);
    db.prepare('UPDATE businesses SET traffic_popularity=?,popularity_factors=? WHERE id=?')
      .run(metrics.popularity,JSON.stringify(metrics.factors),row.id);
    row.traffic_popularity=metrics.popularity;row.popularity_factors=JSON.stringify(metrics.factors);
    pushNotification(db,row.user_id,{type:'store',sourceKey:`store-upgrade:${row.id}:${completedAt}`,
      titleEn:'Store upgrade complete',titleDe:'Ladenausbau abgeschlossen',
      bodyEn:`${row.store_name || shopType(row.type).name}: ${target.name}`,
      bodyDe:`${row.store_name || shopType(row.type).nameDe}: ${target.nameDe}`,
      href:`/stores?shop=${encodeURIComponent(row.id)}`},completedAt);
  }
  advanceShopAtSize(db,row,now);
}

function advanceShopAtSize(db, row, now) {
  let stock = shopStock(db, row.id, row.type, row.profit_margin, now);
  let visitors = 0, sales = 0, revenue = 0, guardFees = 0;
  const until = Math.floor(now / HOUR) * HOUR;
  const plotTraffic = plotLocation(db, row.plot_id)?.trafficMultiplier ?? 1;
  for (let hour = row.last_tick_at + HOUR; hour <= until; hour += HOUR) {
    if (!stock.length && !row.traffic_popularity) break;
    const traffic = hour >= row.plot_since ? plotTraffic : 1;
    const base = shopSize(row.size).visitorsPerHour * storePopularity(db, row, hour) * traffic;
    const count = Math.floor(base) + (hashNumber(`${row.id}:${hour}:visitors`) < base % 1 ? 1 : 0);
    visitors += count;
    for (let n = 0; n < count && stock.length; n++) {
      const index = Math.floor(hashNumber(`${row.id}:${hour}:${n}:item`) * stock.length);
      const type = shopType(row.type), candidate = stock[index];
      // Expensive goods need suitable customers. A million-token collectible
      // cannot move at the same rate as a normal shop's everyday stock.
      const chance = businessItemSaleChance(type, row.profit_margin, referencePrice(db, candidate.item, row.type, hour));
      if (hashNumber(`${row.id}:${hour}:${n}:buy`) >= chance) continue;
      const [sold] = stock.splice(index, 1);
      const salePrice = shelfPrice(db, sold.item, row.type, row.profit_margin, hour);
      db.prepare('UPDATE business_stock SET sold_at = ?, sold_price = ? WHERE inventory_id = ? AND sold_at IS NULL')
        .run(hour, salePrice, sold.id);
      db.prepare('INSERT INTO business_sales (id, business_id, inventory_id, price, sold_at) VALUES (?, ?, ?, ?, ?)')
          .run(`npc:${sold.id}`, row.id, sold.id, salePrice, hour);
      const payout=salePayout(db,row.user_id,[sold.id],salePrice);
      guardFees += recordSale(db,row.user_id,[sold.id],payout,`npc:${sold.id}`,hour,row.id);
      if (!db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ? AND sold_at IS NULL AND user_id = ?')
        .run(hour, sold.id, row.user_id).changes) fail('stock_conflict', 409);
      recordNpcStoreFeedback(db,{ saleId:`npc:${sold.id}`, shopId:row.id,
        category:marketCategoryForItem(sold.item) || marketCategory(row.type), paid:salePrice,
        reference:referencePrice(db,sold.item,row.type,hour), now:hour });
      sales++; revenue += payout;
    }
  }
  if (revenue) creditStoreCash(db,row.id,revenue - guardFees);
  db.prepare(`UPDATE businesses SET visitors = visitors + ?, sales = sales + ?, revenue = revenue + ?, last_tick_at = ? WHERE id = ?`)
    .run(visitors, sales, revenue, Math.max(row.last_tick_at, until), row.id);
}

function advanceShops(db, now, userId = null) {
  const rows = userId ? db.prepare('SELECT * FROM businesses WHERE user_id = ?').all(userId)
    : db.prepare('SELECT * FROM businesses').all();
  for (const row of rows) advanceShop(db, row, now);
}

// Called inside the owner's inventory transaction and the economy runtime.
// Move existing, unlocked stock only; preserve basis and never buy supplies.
export function restockPrestigeStores(db, now, userId = null) {
  ensurePrestigeSchema(db);
  const shops = db.prepare(`SELECT b.* FROM businesses b JOIN users u ON u.id=b.user_id
    JOIN user_prestige p ON p.user_id=b.user_id
    WHERE b.retired=0 AND u.npc=0 AND u.banned=0 AND (? IS NULL OR b.user_id=?)
    AND EXISTS (SELECT 1 FROM json_each(p.buffs) WHERE value='restocker')
    ORDER BY b.bought_at,b.id`).all(userId,userId);
  const owners = new Map();
  for (const shop of shops) {
    // Settle elapsed sales before adding stock acquired in the present.
    advanceShop(db,shop,now);
    checkDueStoreEvent(db,shop,now,{advance:false});
    const stock = shopStock(db,shop.id,shop.type,shop.profit_margin,now);
    const space = shopCapacity(shop.type,shopSize(shop.size)) - stock.length;
    if (space <= 0) continue;
    if (!owners.has(shop.user_id)) owners.set(shop.user_id,[]);
    owners.get(shop.user_id).push({shop,space,titles:new Set(stock.map(entry=>entry.item.title)),added:0});
  }
  if (!owners.size) return 0;
  const sealed = sealedPaletteInventoryIds(db);
  const insert = db.prepare('INSERT INTO business_stock(inventory_id,business_id,stocked_at,asking_price) VALUES(?,?,?,?)');
  let stocked = 0;
  for (const [ownerId,states] of owners) {
    const pools = new Map(), types = new Set(states.map(state=>state.shop.type));
    for (const row of db.prepare(`SELECT i.id,i.item FROM inventory i WHERE i.user_id=? AND i.sold_at IS NULL
      AND i.created_at<=? AND NOT EXISTS (SELECT 1 FROM business_stock s WHERE s.inventory_id=i.id)
      ORDER BY i.created_at,i.id`).all(ownerId,now)) {
      const item = JSON.parse(row.item), type = stockType(item);
      if (!types.has(type) || sealed.has(row.id) || !Number.isFinite(item.price) || item.price <= 0 || inventoryIsLocked(db,row.id)) continue;
      if (!pools.has(type)) pools.set(type,[]);
      pools.get(type).push({id:row.id,item});
    }
    // Round-robin prevents one store taking all available stock of its type.
    let moved;
    do {
      moved = false;
      for (const state of states) {
        const pool = pools.get(state.shop.type);
        if (!state.space || !pool?.length) continue;
        const varied = pool.findIndex(entry=>!state.titles.has(entry.item.title));
        const [entry] = pool.splice(varied < 0 ? 0 : varied,1);
        insert.run(entry.id,state.shop.id,now,shelfPrice(db,entry.item,state.shop.type,state.shop.profit_margin,now));
        recordBusinessRestock(db,state.shop.id,[entry.id],now);
        state.titles.add(entry.item.title); state.space--; state.added++; stocked++; moved=true;
      }
    } while (moved);
    for (const state of states) if (state.added) {
      checkDueStoreEvent(db,state.shop,now,{advance:false});
      const metrics = shopMetrics(db,state.shop,shopStock(db,state.shop.id,state.shop.type,state.shop.profit_margin,now),now);
      db.prepare('UPDATE businesses SET traffic_popularity=?,popularity_factors=? WHERE id=?')
        .run(metrics.popularity,JSON.stringify(metrics.factors),state.shop.id);
    }
    if (states.some(state=>state.added)) milestone(db,ownerId,'find',now);
  }
  return stocked;
}

export function businessUpgrade(row) {
  return row.upgrade_size ? {fromSize:row.size,toSize:row.upgrade_size,startedAt:row.upgrade_started_at,
    completesAt:row.upgrade_ends_at,cost:row.upgrade_cost} : null;
}

function upgradeOffer(db, row) {
  const index=SHOP_SIZES.findIndex(size=>size.id===row.size), target=SHOP_SIZES[index+1];
  if (!target || row.retired || row.upgrade_size) return null;
  const purchaseCost=Math.round(target.cost*shopType(row.type).costFactor*(plotLocation(db,row.plot_id)?.priceMultiplier ?? 1));
  const player=db.prepare('SELECT xp FROM users WHERE id=?').get(row.user_id);
  return {targetSize:target.id,cost:Math.round(purchaseCost*(100-STORE_UPGRADE_DISCOUNT)/100),purchaseCost,
    discountPercent:STORE_UPGRADE_DISCOUNT,durationHours:STORE_UPGRADE_HOURS[row.size],
    requiredLevel:target.requiredLevel,unlocked:levelForXp(player?.xp||0)>=target.requiredLevel,
    capacity:shopCapacity(row.type,target),visitorsPerHour:target.visitorsPerHour};
}

export function upgradeBusiness(dataDir,user,{shopId,targetSize,expectedPrice,requestId}={}, {now=Date.now()}={}) {
  if(typeof shopId!=='string'||shopId.length>100||typeof targetSize!=='string'||
    !Number.isSafeInteger(expectedPrice)||expectedPrice<1||typeof requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))fail('invalid_request');
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureBusinessSchema(db,{now});const player=activeUser(db,user);
    if(db.prepare('SELECT must_change_password FROM users WHERE id=?').get(player.id).must_change_password)fail('password_change_required',403);
    assertPlayerFree(db,player.id,now);
    const payload=JSON.stringify({shopId,targetSize,expectedPrice});
    const prior=db.prepare('SELECT payload,result FROM business_upgrade_requests WHERE user_id=? AND request_id=?').get(player.id,requestId);
    if(prior){if(prior.payload!==payload)fail('request_conflict',409);return JSON.parse(prior.result);}
    const shop=db.prepare('SELECT * FROM businesses WHERE id=? AND user_id=? AND retired=0').get(shopId,player.id);
    if(!shop)fail('business_not_found',404);
    advanceShop(db,shop,now);
    if(shop.upgrade_size)fail('store_upgrade_pending',409);
    const offer=upgradeOffer(db,shop);
    if(!offer||offer.targetSize!==targetSize)fail('invalid_store_upgrade',409);
    if(!offer.unlocked)fail('store_level_required',403);
    if(businessAbandonment(shop,now).abandoned)fail('store_upgrade_abandoned',409);
    if(offer.cost!==expectedPrice)fail('store_upgrade_price_changed',409);
    if(!db.prepare('UPDATE users SET tokens=tokens-? WHERE id=? AND tokens>=?').run(offer.cost,player.id,offer.cost).changes)fail('insufficient_tokens',409);
    const completesAt=now+offer.durationHours*HOUR;
    db.prepare('UPDATE businesses SET upgrade_size=?,upgrade_started_at=?,upgrade_ends_at=?,upgrade_cost=? WHERE id=?')
      .run(targetSize,now,completesAt,offer.cost,shop.id);
    const result={shopId,fromSize:shop.size,toSize:targetSize,cost:offer.cost,startedAt:now,completesAt};
    db.prepare('INSERT INTO business_upgrade_requests VALUES(?,?,?,?,?,?,?)')
      .run(player.id,requestId,shop.id,payload,offer.cost,now,JSON.stringify(result));
    return result;
  }));
}

function publicShop(db, row, now = Date.now()) {
  const stock = shopStock(db, row.id, row.type, row.profit_margin, now);
  const dayStart = Math.floor(now / (24 * HOUR)) * 24 * HOUR;
  const today = db.prepare(`SELECT COUNT(*) AS sales, COALESCE(SUM(price), 0) AS revenue
    FROM business_sales WHERE business_id = ? AND sold_at >= ? AND sold_at < ?`)
    .get(row.id, dayStart, dayStart + 24 * HOUR);
  const {factors,...metrics}=shopMetrics(db,row,stock,now);
  return { id: row.id, type: row.type, size: row.size, boughtAt: row.bought_at,
    upgrade:businessUpgrade(row),nextUpgrade:upgradeOffer(db,row),
    npcTheftChancePercent: npcStoreTheftChance(row.security_guard, plotLocation(db,row.plot_id)?.theftMultiplier ?? 1),
    ...businessAbandonment(row,now), takeoverPrice: Math.round(shopSize(row.size).cost * shopType(row.type).costFactor * (plotLocation(db,row.plot_id)?.priceMultiplier ?? 1)),
    location: plotLocation(db, row.plot_id), name: row.store_name, motto: row.store_motto, securityGuard: Boolean(row.security_guard), securityGuardProfitPercent: ECONOMY_BALANCE.securityGuardProfitPercent, securityGuardFees: row.security_guard_fees, mischiefEnabled: Boolean(row.mischief_enabled),
    ...tradingTotals(db,row.user_id,row.id),
    visitors: row.visitors, sales: row.sales, salesToday: today.sales,
    revenue: row.revenue, revenueToday: today.revenue, cashReady: row.cash_balance, profitMargin: row.profit_margin,
    buyChancePercent: Math.round((stock.length ? stock.reduce((sum, entry) => sum
      + businessItemSaleChance(shopType(row.type), row.profit_margin, entry.referencePrice), 0) / stock.length
      : businessSaleChance(shopType(row.type).conversion, row.profit_margin)) * 1000) / 10,
    ...metrics, ...storeReputation(db, row, now),
    popularityBreakdown:storePopularityBreakdown(db,row,plotLocation(db,row.plot_id),now),
    stock: stock.map(entry=>({...entry,...acquisition(db,entry.id,row.user_id)})) };
}

export function businessDashboard(dataDir, user, { now = Date.now() } = {}) {
  tickBusinesses(dataDir, { now });
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); activeUser(db, user); advanceShops(db, now, user.id);
    const sealed = sealedPaletteInventoryIds(db), indexes=marketIndexes(db,now);
    return { types: SHOP_TYPES, sizes: SHOP_SIZES, maxStores: MAX_STORES_PER_USER,
      shops: db.prepare('SELECT * FROM businesses WHERE user_id = ? ORDER BY bought_at, id').all(user.id).map(row => publicShop(db, row, now)),
      inventory: db.prepare('SELECT id, item FROM inventory WHERE user_id = ? AND sold_at IS NULL ORDER BY created_at DESC').all(user.id)
        .filter(row => !db.prepare('SELECT 1 FROM business_stock WHERE inventory_id = ? AND sold_at IS NULL').get(row.id)
          && !inventoryIsLocked(db, row.id) && !sealed.has(row.id))
        .map(row => { const item=JSON.parse(row.item);return { ...item, id:row.id, type:stockType(item), estimatedValueTokens:estimatedValueTokens(item,indexes), ...acquisition(db,row.id,user.id) }; })
        .filter(item => item.type) };
  }));
}

export function buyBusiness(dataDir, user, typeId, sizeId, { now = Date.now(), plotId = null } = {}) {
  const type = shopType(typeId);
  if (!type || (sizeId != null && !shopSize(sizeId)) || (plotId === null && !shopSize(sizeId))) fail('invalid_business');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); const player = activeUser(db, user);
    if (db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE user_id = ?').get(user.id).n >= MAX_STORES_PER_USER) fail('store_limit_reached', 409);
    const plot = availableTownPlot(db, sizeId, plotId), size = shopSize(plot.size);
    if (levelForXp(player.xp) < size.requiredLevel) fail('store_level_required', 403);
    const cost = Math.round(size.cost * type.costFactor * plotLocation(db, plot.id).priceMultiplier);
    if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(cost, user.id, cost).changes) fail('insufficient_tokens', 409);
    const id = randomUUID();
    db.prepare('INSERT INTO businesses (id, user_id, type, size, bought_at, last_tick_at, profit_margin, plot_id, plot_since, opening_cost, last_restock_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, type.id, size.id, now, Math.floor(now / HOUR) * HOUR, DEFAULT_PROFIT_MARGIN, plot.id, now, cost, now);
    ensureTraderSchema(db);
    if (db.prepare("SELECT 1 FROM trader_milestones WHERE user_id=? AND step='sale'").get(user.id)) milestone(db,user.id,'reinvest',now);
    return { shop: publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(id), now), cost };
  }));
}

export function takeOverBusiness(dataDir, user, { shopId, expectedPrice, requestId } = {}, { now = Date.now() } = {}) {
  if (typeof shopId !== 'string' || typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)
    || !Number.isSafeInteger(expectedPrice) || expectedPrice < 1) fail('invalid_request');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db,{now});
    const player = activeUser(db,user);
    if (db.prepare('SELECT must_change_password FROM users WHERE id=?').get(player.id).must_change_password) fail('password_change_required',403);
    assertPlayerFree(db,player.id,now);
    const payload = JSON.stringify({shopId,expectedPrice});
    const prior = db.prepare('SELECT payload,result FROM business_takeovers WHERE buyer_id=? AND request_id=?').get(player.id,requestId);
    if (prior) {
      if (prior.payload !== payload) fail('request_conflict',409);
      return JSON.parse(prior.result);
    }
    const shop = db.prepare(`SELECT b.* FROM businesses b JOIN users u ON u.id=b.user_id
      WHERE b.id=? AND b.retired=0 AND u.npc=0`).get(shopId);
    if (shop) advanceShop(db,shop,now);
    if (!shop || !shop.plot_id || shop.user_id === player.id || !businessAbandonment(shop,now).abandoned) fail('store_not_abandoned',409);
    if (db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE user_id=? AND retired=0').get(player.id).n >= MAX_STORES_PER_USER) fail('store_limit_reached',409);
    const size = shopSize(shop.size), type = shopType(shop.type), location = plotLocation(db,shop.plot_id);
    if (levelForXp(player.xp) < size.requiredLevel) fail('store_level_required',403);
    const cost = Math.round(size.cost * type.costFactor * location.priceMultiplier);
    if (cost !== expectedPrice) fail('store_price_changed',409);
    const has = name => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
    if (has('store_heists')) {
      // Legacy memory games have no financial consequence left to resolve
      // once expired. Keep live games and modern police proceedings locked.
      db.prepare(`UPDATE store_heists SET status='expired',result=json_object('id',id,'outcome','expired','fee',fee,'inventoryId',NULL)
        WHERE business_id=? AND status='active' AND blackjack IS NULL AND expires_at<=?`).run(shop.id,now);
      if (db.prepare("SELECT 1 FROM store_heists WHERE business_id=? AND retired=0 AND status IN ('active','police') LIMIT 1").get(shop.id)) fail('store_takeover_pending',409);
    }
    const stock = shopStock(db,shop.id,shop.type,shop.profit_margin,now);
    if (stock.some(item => inventoryIsLocked(db,item.id))) fail('store_takeover_pending',409);
    const cash = db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(shop.id).cash_balance;
    const oldOwner = db.prepare('SELECT tokens FROM users WHERE id=?').get(shop.user_id);
    if (!Number.isSafeInteger(oldOwner.tokens + cash)) fail('token_balance_limit',409);
    if (!db.prepare('UPDATE users SET tokens=tokens-? WHERE id=? AND tokens>=?').run(cost,player.id,cost).changes) fail('insufficient_tokens',409);
    if (cash) db.prepare('UPDATE users SET tokens=tokens+? WHERE id=?').run(cash,shop.user_id);
    // Preserve old store receipts and reviews; shelf items already belong to
    // the previous owner and simply return to their ordinary inventory.
    syncUserStatistics(db,shop.user_id,now);
    db.prepare('DELETE FROM business_stock WHERE business_id=? AND sold_at IS NULL').run(shop.id);
    const retired = 'npc-abandoned-retired';
    db.prepare("INSERT OR IGNORE INTO users(id,username,password_hash,npc,tokens,created_at) VALUES(?,'Abandoned Assets','disabled',1,0,?)").run(retired,now);
    db.prepare('UPDATE businesses SET user_id=?,retired=1,plot_id=NULL,cash_balance=0,traffic_popularity=0 WHERE id=?').run(retired,shop.id);
    const id = randomUUID();
    db.prepare(`INSERT INTO businesses (id,user_id,type,size,bought_at,last_tick_at,profit_margin,plot_id,plot_since,opening_cost,last_restock_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,player.id,shop.type,shop.size,now,Math.floor(now/HOUR)*HOUR,DEFAULT_PROFIT_MARGIN,shop.plot_id,now,cost,now);
    const result = {shop:publicShop(db,db.prepare('SELECT * FROM businesses WHERE id=?').get(id),now),cost};
    db.prepare('INSERT INTO business_takeovers VALUES (?,?,?,?,?,?,?,?)').run(player.id,requestId,payload,shop.id,shop.user_id,id,JSON.stringify(result),now);
    pushNotification(db,shop.user_id,{type:'store',sourceKey:`store-takeover:${shop.id}`,href:'/businesses',
      titleEn:'Abandoned store purchased',titleDe:'Verlassener Laden übernommen',
      bodyEn:`Your remaining stock returned to inventory and J€ ${cash} was collected from the till.`,
      bodyDe:`Deine übrigen Waren sind im Inventar. J€ ${cash} aus der Kasse wurden gutgeschrieben.`},now);
    return result;
  }));
}

export function setBusinessMargin(dataDir, user, shopId, profitMargin, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(profitMargin) || profitMargin < 0 || profitMargin > MAX_PROFIT_MARGIN) fail('invalid_profit_margin');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); activeUser(db, user);
    const shop = db.prepare('SELECT * FROM businesses WHERE id = ? AND user_id = ?').get(shopId, user.id);
    if (!shop) fail('business_not_found', 404);
    // Settle elapsed hours with the old margin before changing future sales.
    advanceShop(db, shop, now);
    checkDueStoreEvent(db,shop,now,{advance:false});
    db.prepare('UPDATE businesses SET profit_margin = ? WHERE id = ?').run(profitMargin, shop.id);
    return publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(shop.id), now);
  }));
}

// Db-scoped stock transfer, shared by legacy actions and the atomic editor.
export function applyBusinessStock(db, user, shopId, addIds, removeIds, now) {
  for(const ids of [addIds,removeIds])if(!Array.isArray(ids)||ids.length>150||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length>100))fail('invalid_stock');
  if(!addIds.length&&!removeIds.length||addIds.some(id=>removeIds.includes(id)))fail('invalid_stock');
  ensureBusinessSchema(db,{now});activeUser(db,user);advanceShops(db,now,user.id);
  const shop=db.prepare('SELECT * FROM businesses WHERE id=? AND user_id=?').get(shopId,user.id);
  if(!shop)fail('business_not_found',404);
  checkDueStoreEvent(db,shop,now,{advance:false});
  const stock=shopStock(db,shop.id,shop.type,shop.profit_margin,now);
  for(const id of removeIds)if(!stock.some(entry=>entry.id===id))fail('stock_not_found',409);
  if(stock.length-removeIds.length+addIds.length>shopCapacity(shop.type,shopSize(shop.size)))fail('business_full',409);
  const sealed=sealedPaletteInventoryIds(db);marketIndexes(db,now);
  // Validate the entire draft before changing a single shelf position.
  const additions=addIds.map(id=>{
    const row=db.prepare('SELECT item FROM inventory WHERE id=? AND user_id=? AND sold_at IS NULL').get(id,user.id);
    if(!row)fail('item_not_found',404);
    const item=JSON.parse(row.item);
    if(stockType(item)!==shop.type)fail('wrong_shop_type',409);
    if(sealed.has(id)||inventoryIsLocked(db,id)||db.prepare('SELECT 1 FROM business_stock WHERE inventory_id=?').get(id))fail('item_locked',409);
    if(!Number.isFinite(item.price)||item.price<=0)fail('invalid_stock',409);
    return {id,price:shelfPrice(db,item,shop.type,shop.profit_margin,now)};
  });
  for(const id of removeIds)db.prepare('DELETE FROM business_stock WHERE business_id=? AND inventory_id=? AND sold_at IS NULL').run(shop.id,id);
  for(const entry of additions)db.prepare('INSERT INTO business_stock(inventory_id,business_id,stocked_at,asking_price) VALUES(?,?,?,?)').run(entry.id,shop.id,now,entry.price);
  recordBusinessRestock(db,shop.id,addIds,now);
  if(addIds.length)milestone(db,user.id,'find',now);
  checkDueStoreEvent(db,shop,now,{advance:false});
  const metrics=shopMetrics(db,shop,shopStock(db,shop.id,shop.type,shop.profit_margin,now),now);
  db.prepare('UPDATE businesses SET traffic_popularity=?,popularity_factors=? WHERE id=?').run(metrics.popularity,JSON.stringify(metrics.factors),shop.id);
  return publicShop(db,db.prepare('SELECT * FROM businesses WHERE id=?').get(shop.id),now);
}
export function stockBusiness(dataDir,user,shopId,inventoryIds,{now=Date.now()}={}) {
  if(!Array.isArray(inventoryIds)||!inventoryIds.length)fail('invalid_stock');
  return withDatabase(dataDir,db=>transaction(db,()=>applyBusinessStock(db,user,shopId,inventoryIds,[],now)));
}
export function unstockBusiness(dataDir,user,shopId,inventoryId,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>applyBusinessStock(db,user,shopId,[],[inventoryId],now)));
}

function createStockListing(db, { id, stock, startsAt, endsAt, reserve, currentBid = null, bidderId = null }) {
  if (db.prepare('SELECT 1 FROM resale_auctions WHERE id = ?').get(id)) return false;
  const item = { auctionId: stock.auctionId, title: stock.title, image: stock.image || null,
    category: stock.category, price: stock.price, sellValue: stock.price,
    marketCategory: stock.marketCategory || marketCategory(stock.type), businessCategory: stock.type,
    rarity: 'common', wholesaleAuctionId: id };
  const insertInventory = db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO resale_auction_items (auction_id, inventory_id, position) VALUES (?, ?, ?)');
  const inventoryIds = Array.from({ length: stock.quantity }, () => randomUUID());
  inventoryIds.forEach((inventoryId, position) =>
    insertInventory.run(inventoryId, STOCK_SELLER_ID, JSON.stringify({ ...item, wholesaleUnit: position + 1 }), startsAt));
  db.prepare(`INSERT INTO resale_auctions
    (id, seller_id, inventory_id, start_price, current_bid, max_bid, current_bidder_id, status, started_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(id, STOCK_SELLER_ID, inventoryIds[0], reserve, currentBid, currentBid, bidderId, startsAt, endsAt);
  inventoryIds.forEach((inventoryId, position) => insertItem.run(id, inventoryId, position));
  return true;
}

function archivedStock(db) {
  const groups = Object.fromEntries(SHOP_TYPES.map(type => [type.id, []]));
  for (const row of db.prepare(`SELECT payload_json FROM auctions
    WHERE title <> '' AND COALESCE(final_price, current_bid) > 0 ORDER BY id`).all()) {
    const auction = JSON.parse(row.payload_json);
    const price = Number(auction.finalPrice ?? auction.currentBid);
    if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(Number(auction.id))) continue;
    const category = auctionSelectionCategory(auction);
    const type = stockType({ ...auction, category });
    if (!type) continue;
    const limits = STOCK_BATCHES[type];
    if (price > limits.maxPrice) continue;
    groups[type].push({ auctionId: Number(auction.id), type, title: auction.title,
      image: auctionGallery(auction)[0] || null, category,
      marketCategory: marketCategoryForItem({...auction,category}) || marketCategory(type), price: Math.max(1, Math.round(price)),
      quantity: Math.max(1, Math.min(limits.quantity, Math.floor(limits.budget / price) || 1)) });
  }
  return groups;
}

// Legacy auction migration. Production only retires unbid system lots;
// explicit retire:false is retained for historical settlement regression fixtures.
export function supplyStockAuctions(dataDir, { now = Date.now(), retire = true } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); ensureResaleSchema(db, now); ensureNotificationSchema(db); marketIndexes(db, now);
    db.prepare(`UPDATE account_notifications SET href =
      CASE WHEN source_key LIKE 'wholesale:won:%' THEN '/inventory' ELSE '/marketplace?view=bids' END
      WHERE href = '/businesses' AND source_key LIKE 'wholesale:%'`).run();
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, npc, tokens, created_at)
      VALUES (?, 'Stock Supply', 'disabled', 1, 0, ?)`).run(STOCK_SELLER_ID, now);
    // Unbid batches are never owned by a player. Retire them after a day so
    // recurring stock supply does not grow abandoned NPC inventory forever.
    const stale = db.prepare(`SELECT id FROM resale_auctions WHERE seller_id = ?
      AND status = 'ended' AND settled_at IS NOT NULL AND winner_id IS NULL AND ends_at < ?`)
      .all(STOCK_SELLER_ID, now - 24 * HOUR);
    const hasInterest = Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'resale_npc_interest'").get());
    for (const { id } of stale) {
      const inventoryIds = db.prepare('SELECT inventory_id FROM resale_auction_items WHERE auction_id = ?').all(id).map(row => row.inventory_id);
      if (hasInterest) db.prepare('DELETE FROM resale_npc_interest WHERE auction_id = ?').run(id);
      db.prepare('DELETE FROM resale_auctions WHERE id = ?').run(id);
      const remove = db.prepare('DELETE FROM inventory WHERE id = ? AND user_id = ?');
      for (const inventoryId of inventoryIds) remove.run(inventoryId, STOCK_SELLER_ID);
    }
    // Move any escrowed bids from the old stock-auction table exactly once.
    // Its deterministic id is retained so existing links and bids keep working.
    for (const row of db.prepare('SELECT * FROM wholesale_auctions WHERE settled_at IS NULL ORDER BY starts_at, id').all()) {
      const stock = LEGACY_WHOLESALE_STOCK.find(entry => entry.id === row.stock_id);
      if (!stock) continue;
      if (createStockListing(db, { id: row.id, stock, startsAt: row.starts_at,
        endsAt: row.ends_at, reserve: row.reserve, currentBid: row.current_bid, bidderId: row.bidder_id })) {
        for (const bid of db.prepare('SELECT bidder_id, amount, created_at FROM wholesale_bids WHERE auction_id = ? ORDER BY id').all(row.id)) {
          db.prepare('INSERT INTO resale_bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)')
            .run(row.id, bid.bidder_id, bid.amount, bid.created_at);
        }
      }
      db.prepare('UPDATE wholesale_auctions SET settled_at = ? WHERE id = ?').run(now, row.id);
    }
    // Remove old fictional supply only when nobody has bid. Escrowed lots
    // finish normally so a player's bid and its history remain intact.
    for (const { id } of db.prepare(`SELECT a.id FROM resale_auctions a
      JOIN inventory i ON i.id = a.inventory_id
      WHERE a.seller_id = ? AND a.status = 'active' AND a.current_bidder_id IS NULL
        AND (? OR json_extract(i.item, '$.auctionId') IS NULL)`).all(STOCK_SELLER_ID, Number(retire))) {
      const inventoryIds = db.prepare('SELECT inventory_id FROM resale_auction_items WHERE auction_id = ?').all(id);
      if (hasInterest) db.prepare('DELETE FROM resale_npc_interest WHERE auction_id = ?').run(id);
      db.prepare('DELETE FROM resale_auctions WHERE id = ?').run(id);
      for (const item of inventoryIds) db.prepare('DELETE FROM inventory WHERE id = ? AND user_id = ?').run(item.inventory_id, STOCK_SELLER_ID);
    }
    const bucket = Math.floor(now / WHOLESALE_PERIOD);
    // Lots created by the old scheduler all started and ended together. Keep
    // their existing bid windows intact, then extend later slots to their new
    // staggered deadlines. A live bid is never cut short during the upgrade.
    for (const row of db.prepare(`SELECT id, started_at, ends_at FROM resale_auctions
      WHERE seller_id = ? AND status = 'active' AND ends_at > ?`).all(STOCK_SELLER_ID, now)) {
      const stockIndex = LEGACY_WHOLESALE_STOCK.findIndex(stock => row.id === lotId(Math.floor(row.started_at / WHOLESALE_PERIOD), stock.id));
      if (stockIndex < 1 || row.started_at % WHOLESALE_PERIOD !== 0 || row.ends_at !== row.started_at + WHOLESALE_PERIOD) continue;
      db.prepare('UPDATE resale_auctions SET ends_at = ? WHERE id = ?')
        .run(row.ends_at + stockIndex * WHOLESALE_SLOT, row.id);
    }
    if(retire) return {supplied:0};
    let supplied = 0;
    let sources;
    // At any moment one listing for each category slot is live. Include the
    // previous cycle on cold start or after downtime so the board is filled
    // without creating expired listings or duplicate active batches.
    for (const cycle of [bucket - 1, bucket]) {
      for (const [slot, type] of STOCK_SLOTS.entries()) {
        const startsAt = cycle * WHOLESALE_PERIOD + slot * WHOLESALE_SLOT;
        const endsAt = startsAt + WHOLESALE_PERIOD;
        if (startsAt > now || endsAt <= now) continue;
        const id = lotId(cycle, `archive:${slot}`);
        if (cycle === bucket - 1 && db.prepare(`SELECT 1 FROM resale_auctions
          WHERE id = ? AND status = 'active' AND ends_at > ?`).get(lotId(bucket, `archive:${slot}`), now)) continue;
        if (db.prepare('SELECT 1 FROM wholesale_auctions WHERE id = ?').get(id)) continue;
        if (db.prepare('SELECT 1 FROM resale_auctions WHERE id = ?').get(id)) continue;
        sources ||= archivedStock(db);
        const candidates = sources[type];
        if (!candidates.length) continue;
        const stock = candidates[((cycle + Math.floor(slot / 4)) % candidates.length + candidates.length) % candidates.length];
        const reserve = Math.max(1, Math.round(referencePrice(db, { price: stock.price, marketCategory: stock.marketCategory }, stock.type, now) * stock.quantity * ECONOMY_BALANCE.wholesaleReserveRate));
        if (createStockListing(db, { id, stock, startsAt, endsAt, reserve })) supplied++;
      }
    }
    return { supplied };
  }));
}

export function tickBusinesses(dataDir, { now = Date.now() } = {}) {
  const supply = supplyStockAuctions(dataDir, { now, retire: true });
  withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now });
    reconcileCategorizedStock(db);
    advanceShops(db, now);
    restockPrestigeStores(db, now);
  }));
  return supply;
}
