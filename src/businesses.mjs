import { ensureTownSchema, availableTownPlot, plotLocation } from './town-plots.mjs';
import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { marketCategoryForItem, marketIndexAt, marketIndexes, estimatedValueTokens } from './market.mjs';
import { ensureResaleSchema, inventoryIsLocked } from './resale.mjs';
import { sealedPaletteInventoryIds } from './palette-auctions.mjs';
import { ensureNotificationSchema } from './notifications.mjs';
import { auctionSelectionCategory } from './auction-selection.mjs';
import { auctionGallery } from './auction-images.mjs';

const HOUR = 3_600_000;
const WHOLESALE_PERIOD = 2 * HOUR;
const WHOLESALE_SLOT = 15 * 60_000;
const STOCK_SELLER_ID = 'npc-stock-supply';
export const DEFAULT_PROFIT_MARGIN = ECONOMY_BALANCE.businessDefaultMargin;
export const MAX_PROFIT_MARGIN = 100;
export const MAX_STORES_PER_USER = 3;
const fail = (code, status = 400) => { throw new AccountError(code, status); };
const hashNumber = value => parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) / 0x100000000;

export const SHOP_TYPES = [
  { id: 'wine', name: 'Wine store', nameDe: 'Weinhandlung', costFactor: 1, typicalValue: 35, conversion: .28 },
  { id: 'toys', name: 'Toy store', nameDe: 'Spielwarengeschaeft', costFactor: 1, typicalValue: 40, conversion: .28 },
  { id: 'electronics', name: 'Electronics store', nameDe: 'Elektronikladen', costFactor: 1.2, typicalValue: 120, conversion: .22 },
  { id: 'cars', name: 'Car dealership', nameDe: 'Autohaus', costFactor: 2.5, typicalValue: 2500, conversion: .06 }
];
export const SHOP_SIZES = [
  { id: 'popup', name: 'Street pop-up', nameDe: 'Strassenstand', cost: 1000, capacity: 10, carCapacity: 1, visitorsPerHour: 1 },
  { id: 'tiny', name: 'Small shop', nameDe: 'Kleiner Laden', cost: 4000, capacity: 25, carCapacity: 3, visitorsPerHour: 2 },
  { id: 'medium', name: 'Medium shop', nameDe: 'Mittlerer Laden', cost: 15000, capacity: 60, carCapacity: 8, visitorsPerHour: 5 },
  { id: 'large', name: 'Large shop', nameDe: 'Grosser Laden', cost: 50000, capacity: 150, carCapacity: 20, visitorsPerHour: 11 }
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
  cars: { quantity: 2, budget: 3800, maxPrice: 25000 }
};

const shopType = id => SHOP_TYPES.find(type => type.id === id);
const shopSize = id => SHOP_SIZES.find(size => size.id === id);
const shopCapacity = (type, size) => type === 'cars' ? size.carCapacity : size.capacity;
const lotId = (bucket, stockId) => `${bucket}:${stockId}`;
const marketCategory = type => type === 'cars' ? 'vehicles' : type === 'toys' ? 'collectibles' : type;

export function ensureBusinessSchema(db, { now = Date.now() } = {}) {
  const migrateSales = !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'business_sales'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
    size TEXT NOT NULL, bought_at INTEGER NOT NULL, last_tick_at INTEGER NOT NULL,
    visitors INTEGER NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0,
    revenue INTEGER NOT NULL DEFAULT 0,
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
  for (const [name, definition] of [['store_name', "TEXT NOT NULL DEFAULT ''"], ['store_motto', "TEXT NOT NULL DEFAULT ''"], ['goose_guard', 'INTEGER NOT NULL DEFAULT 0']]) {
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
      const popularity = shopMetrics(db, row, stock, Date.now()).popularity;
      db.prepare('UPDATE businesses SET traffic_popularity = ? WHERE id = ?').run(popularity, row.id);
    }
  }
  ensureTownSchema(db, { now });
}

function activeUser(db, user) {
  const row = db.prepare('SELECT id, tokens FROM users WHERE id = ? AND npc = 0 AND banned = 0').get(user?.id);
  if (!row) fail('login_required', 401);
  return row;
}

function stockType(item) {
  if (shopType(item.businessCategory)) return item.businessCategory;
  const category = marketCategoryForItem(item);
  // The wine market also covers drinks. Use the same category rule for
  // supplier units and individual finds; older generic categories can use
  // the shared title/description classifier without rewriting their values.
  if (category === 'wine' || (category === 'other' && auctionSelectionCategory(item) === 'Getränke')) return 'wine';
  if (category === 'vehicles' && /\b(auto|car|pkw|limousine|kombi|sedan|volkswagen|vw|bmw|audi|opel|ford|toyota)\b/i.test(item.title || '') && !/\b(modell|reifen|motor|teil|felge)\b/i.test(item.title || '')) return 'cars';
  if (category === 'electronics') return 'electronics';
  if (['collectibles', 'sport_leisure'].includes(category) && /\b(spielzeug|toy|puzzle|lego|baukasten|building set|board game|brettspiel|puppe)\b/i.test(item.title || '')) return 'toys';
  return null;
}

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
  const fill = stock.length / capacity;
  const popularity = stock.length ? Math.min(1.5, Math.max(.3,
    (.65 + .15 * Math.min(4, variety)) * (.8 + .2 * Math.min(2, value / type.typicalValue)) * (.65 + .35 * fill))) : 0;
  return { variety, value, popularity: Math.round(popularity * 100) / 100, capacity };
}

export function advanceShop(db, row, now) {
  let stock = shopStock(db, row.id, row.type, row.profit_margin, now);
  let visitors = 0, sales = 0, revenue = 0;
  const until = Math.floor(now / HOUR) * HOUR;
  const plotTraffic = plotLocation(db, row.plot_id)?.trafficMultiplier ?? 1;
  for (let hour = row.last_tick_at + HOUR; hour <= until; hour += HOUR) {
    if (!stock.length && !row.traffic_popularity) break;
    const traffic = hour >= row.plot_since ? plotTraffic : 1;
    const base = shopSize(row.size).visitorsPerHour * row.traffic_popularity * traffic;
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
      if (!db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ? AND sold_at IS NULL AND user_id = ?')
        .run(hour, sold.id, row.user_id).changes) fail('stock_conflict', 409);
      sales++; revenue += salePrice;
    }
  }
  if (revenue && !Number.isSafeInteger(db.prepare('SELECT tokens FROM users WHERE id = ?').get(row.user_id).tokens + revenue)) fail('token_balance_limit', 409);
  if (revenue) db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(revenue, row.user_id);
  db.prepare(`UPDATE businesses SET visitors = visitors + ?, sales = sales + ?, revenue = revenue + ?, last_tick_at = ? WHERE id = ?`)
    .run(visitors, sales, revenue, Math.max(row.last_tick_at, until), row.id);
}

function advanceShops(db, now, userId = null) {
  const rows = userId ? db.prepare('SELECT * FROM businesses WHERE user_id = ?').all(userId)
    : db.prepare('SELECT * FROM businesses').all();
  for (const row of rows) advanceShop(db, row, now);
}

function publicShop(db, row, now = Date.now()) {
  const stock = shopStock(db, row.id, row.type, row.profit_margin, now);
  const dayStart = Math.floor(now / (24 * HOUR)) * 24 * HOUR;
  const today = db.prepare(`SELECT COUNT(*) AS sales, COALESCE(SUM(price), 0) AS revenue
    FROM business_sales WHERE business_id = ? AND sold_at >= ? AND sold_at < ?`)
    .get(row.id, dayStart, dayStart + 24 * HOUR);
  return { id: row.id, type: row.type, size: row.size, boughtAt: row.bought_at,
    location: plotLocation(db, row.plot_id), name: row.store_name, motto: row.store_motto, gooseGuard: Boolean(row.goose_guard),
    visitors: row.visitors, sales: row.sales, salesToday: today.sales,
    revenue: row.revenue, revenueToday: today.revenue, profitMargin: row.profit_margin,
    buyChancePercent: Math.round((stock.length ? stock.reduce((sum, entry) => sum
      + businessItemSaleChance(shopType(row.type), row.profit_margin, entry.referencePrice), 0) / stock.length
      : businessSaleChance(shopType(row.type).conversion, row.profit_margin)) * 1000) / 10,
    ...shopMetrics(db, row, stock, now), popularity: row.traffic_popularity, stock };
}

export function businessDashboard(dataDir, user, { now = Date.now() } = {}) {
  tickBusinesses(dataDir, { now });
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); activeUser(db, user); advanceShops(db, now, user.id);
    const sealed = sealedPaletteInventoryIds(db);
    return { types: SHOP_TYPES, sizes: SHOP_SIZES, maxStores: MAX_STORES_PER_USER,
      shops: db.prepare('SELECT * FROM businesses WHERE user_id = ? ORDER BY bought_at, id').all(user.id).map(row => publicShop(db, row, now)),
      inventory: db.prepare('SELECT id, item FROM inventory WHERE user_id = ? AND sold_at IS NULL ORDER BY created_at DESC').all(user.id)
        .filter(row => !db.prepare('SELECT 1 FROM business_stock WHERE inventory_id = ? AND sold_at IS NULL').get(row.id)
          && !inventoryIsLocked(db, row.id) && !sealed.has(row.id))
        .map(row => ({ id: row.id, title: JSON.parse(row.item).title, type: stockType(JSON.parse(row.item)), price: JSON.parse(row.item).price }))
        .filter(item => item.type) };
  }));
}

export function buyBusiness(dataDir, user, typeId, sizeId, { now = Date.now(), plotId = null } = {}) {
  const type = shopType(typeId);
  if (!type || (sizeId != null && !shopSize(sizeId)) || (plotId === null && !shopSize(sizeId))) fail('invalid_business');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); activeUser(db, user);
    if (db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE user_id = ?').get(user.id).n >= MAX_STORES_PER_USER) fail('store_limit_reached', 409);
    const plot = availableTownPlot(db, sizeId, plotId), size = shopSize(plot.size);
    const cost = Math.round(size.cost * type.costFactor * plotLocation(db, plot.id).priceMultiplier);
    if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(cost, user.id, cost).changes) fail('insufficient_tokens', 409);
    const id = randomUUID();
    db.prepare('INSERT INTO businesses (id, user_id, type, size, bought_at, last_tick_at, profit_margin, plot_id, plot_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, type.id, size.id, now, Math.floor(now / HOUR) * HOUR, DEFAULT_PROFIT_MARGIN, plot.id, now);
    return { shop: publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(id), now), cost };
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
    db.prepare('UPDATE businesses SET profit_margin = ? WHERE id = ?').run(profitMargin, shop.id);
    return publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(shop.id), now);
  }));
}

export function stockBusiness(dataDir, user, shopId, inventoryIds, { now = Date.now() } = {}) {
  if (!Array.isArray(inventoryIds) || !inventoryIds.length || inventoryIds.length > 150 || new Set(inventoryIds).size !== inventoryIds.length) fail('invalid_stock');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); activeUser(db, user); advanceShops(db, now, user.id);
    const shop = db.prepare('SELECT * FROM businesses WHERE id = ? AND user_id = ?').get(shopId, user.id);
    if (!shop) fail('business_not_found', 404);
    if (shopStock(db, shop.id, shop.type, shop.profit_margin, now).length + inventoryIds.length > shopCapacity(shop.type, shopSize(shop.size))) fail('business_full', 409);
    const sealed = sealedPaletteInventoryIds(db);
    marketIndexes(db, now);
    for (const id of inventoryIds) {
      const row = db.prepare('SELECT item FROM inventory WHERE id = ? AND user_id = ? AND sold_at IS NULL').get(id, user.id);
      if (!row) fail('item_not_found', 404);
      const item = JSON.parse(row.item);
      if (stockType(item) !== shop.type) fail('wrong_shop_type', 409);
      if (sealed.has(id) || inventoryIsLocked(db, id) || db.prepare('SELECT 1 FROM business_stock WHERE inventory_id = ?').get(id)) fail('item_locked', 409);
      if (!Number.isFinite(item.price) || item.price <= 0) fail('invalid_stock', 409);
      const askingPrice = shelfPrice(db, item, shop.type, shop.profit_margin, now);
      db.prepare('INSERT INTO business_stock (inventory_id, business_id, stocked_at, asking_price) VALUES (?, ?, ?, ?)')
        .run(id, shop.id, now, askingPrice);
    }
    const stock = shopStock(db, shop.id, shop.type, shop.profit_margin, now);
    db.prepare('UPDATE businesses SET traffic_popularity = ? WHERE id = ?')
      .run(shopMetrics(db, shop, stock, now).popularity, shop.id);
    return publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(shop.id), now);
  }));
}

export function unstockBusiness(dataDir, user, shopId, inventoryId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now }); activeUser(db, user); advanceShops(db, now, user.id);
    const shop = db.prepare('SELECT * FROM businesses WHERE id = ? AND user_id = ?').get(shopId, user.id);
    if (!shop) fail('business_not_found', 404);
    if (!db.prepare('DELETE FROM business_stock WHERE business_id = ? AND inventory_id = ? AND sold_at IS NULL')
      .run(shop.id, inventoryId).changes) fail('stock_not_found', 404);
    const stock = shopStock(db, shop.id, shop.type, shop.profit_margin, now);
    db.prepare('UPDATE businesses SET traffic_popularity = ? WHERE id = ?')
      .run(shopMetrics(db, shop, stock, now).popularity, shop.id);
    return publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(shop.id), now);
  }));
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
      marketCategory: marketCategory(type), price: Math.max(1, Math.round(price)),
      quantity: Math.max(1, Math.min(limits.quantity, Math.floor(limits.budget / price) || 1)) });
  }
  return groups;
}

export function supplyStockAuctions(dataDir, { now = Date.now() } = {}) {
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
        AND json_extract(i.item, '$.auctionId') IS NULL`).all(STOCK_SELLER_ID)) {
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
  const supply = supplyStockAuctions(dataDir, { now });
  withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db, { now });
    advanceShops(db, now);
  }));
  return supply;
}
