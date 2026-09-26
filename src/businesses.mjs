import { createHash, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { marketCategoryForItem, marketIndexAt, marketIndexes } from './market.mjs';
import { inventoryIsLocked } from './resale.mjs';
import { sealedPaletteInventoryIds } from './palette-auctions.mjs';
import { pushNotification } from './notifications.mjs';

const HOUR = 3_600_000;
const WHOLESALE_PERIOD = 2 * HOUR;
const fail = (code, status = 400) => { throw new AccountError(code, status); };
const hashNumber = value => parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) / 0x100000000;

export const SHOP_TYPES = [
  { id: 'wine', name: 'Wine store', nameDe: 'Weinhandlung', costFactor: 1, typicalValue: 35, conversion: .28 },
  { id: 'toys', name: 'Toy store', nameDe: 'Spielwarengeschaeft', costFactor: 1, typicalValue: 40, conversion: .28 },
  { id: 'electronics', name: 'Electronics store', nameDe: 'Elektronikladen', costFactor: 1.2, typicalValue: 120, conversion: .22 },
  { id: 'cars', name: 'Car dealership', nameDe: 'Autohaus', costFactor: 2.5, typicalValue: 2500, conversion: .06 }
];
export const SHOP_SIZES = [
  { id: 'popup', name: 'Street pop-up', nameDe: 'Strassenstand', cost: 350, capacity: 10, carCapacity: 1, visitorsPerHour: 1 },
  { id: 'tiny', name: 'Small shop', nameDe: 'Kleiner Laden', cost: 1700, capacity: 25, carCapacity: 3, visitorsPerHour: 2 },
  { id: 'medium', name: 'Medium shop', nameDe: 'Mittlerer Laden', cost: 6500, capacity: 60, carCapacity: 8, visitorsPerHour: 5 },
  { id: 'large', name: 'Large shop', nameDe: 'Grosser Laden', cost: 22000, capacity: 150, carCapacity: 20, visitorsPerHour: 11 }
];

// Fictional, repeatable NPC lots. Prices are per unit; bids buy the whole batch.
export const WHOLESALE_STOCK = [
  { id: 'riesling', type: 'wine', title: 'Wachau Riesling 2022', quantity: 24, price: 24 },
  { id: 'redwine', type: 'wine', title: 'Burgenland Red 2021', quantity: 12, price: 46 },
  { id: 'blocks', type: 'toys', title: 'Modular building set', quantity: 18, price: 32 },
  { id: 'puzzle', type: 'toys', title: 'Wooden puzzle set', quantity: 24, price: 19 },
  { id: 'headphones', type: 'electronics', title: 'Wireless headphones', quantity: 10, price: 95 },
  { id: 'tablet', type: 'electronics', title: '10-inch tablet', quantity: 6, price: 190 },
  { id: 'citycar', type: 'cars', title: 'Compact city car', quantity: 2, price: 1900 },
  { id: 'estate', type: 'cars', title: 'Used estate car', quantity: 2, price: 3600 }
];

const shopType = id => SHOP_TYPES.find(type => type.id === id);
const shopSize = id => SHOP_SIZES.find(size => size.id === id);
const shopCapacity = (type, size) => type === 'cars' ? size.carCapacity : size.capacity;
const lotId = (bucket, stockId) => `${bucket}:${stockId}`;
const marketCategory = type => type === 'cars' ? 'vehicles' : type === 'toys' ? 'collectibles' : type;

export function ensureBusinessSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
    size TEXT NOT NULL, bought_at INTEGER NOT NULL, last_tick_at INTEGER NOT NULL,
    visitors INTEGER NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0,
    revenue INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX IF NOT EXISTS businesses_user ON businesses(user_id);
  CREATE TABLE IF NOT EXISTS business_stock (
    inventory_id TEXT PRIMARY KEY REFERENCES inventory(id), business_id TEXT NOT NULL REFERENCES businesses(id),
    stocked_at INTEGER NOT NULL, asking_price INTEGER NOT NULL, sold_at INTEGER, sold_price INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS business_stock_active ON business_stock(business_id, sold_at);
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
}

function activeUser(db, user) {
  const row = db.prepare('SELECT id, tokens FROM users WHERE id = ? AND npc = 0 AND banned = 0').get(user?.id);
  if (!row) fail('login_required', 401);
  return row;
}

function stockType(item) {
  if (shopType(item.businessCategory)) return item.businessCategory;
  const category = marketCategoryForItem(item);
  if (category === 'wine' && /\b(wein|wine|riesling|merlot|pinot|chardonnay|sekt)\b/i.test(item.title || '')) return 'wine';
  if (category === 'vehicles' && /\b(auto|car|pkw|limousine|kombi|sedan|volkswagen|vw|bmw|audi|opel|ford|toyota)\b/i.test(item.title || '') && !/\b(modell|reifen|motor|teil|felge)\b/i.test(item.title || '')) return 'cars';
  if (category === 'electronics') return 'electronics';
  if (['collectibles', 'sport_leisure'].includes(category) && /\b(spielzeug|toy|puzzle|lego|baukasten|building set|board game|brettspiel|puppe)\b/i.test(item.title || '')) return 'toys';
  return null;
}

function shelfPrice(db, item, type, at) {
  const reference = Math.max(1, Math.round(item.price * marketIndexAt(db, marketCategory(type), at) / 100));
  return Math.max(reference + 1, Math.round(reference * 1.3));
}

function shopStock(db, id, now = Date.now()) {
  return db.prepare(`SELECT s.inventory_id AS id, s.asking_price AS askingPrice, s.stocked_at AS stockedAt,
    i.item FROM business_stock s JOIN inventory i ON i.id = s.inventory_id
    WHERE s.business_id = ? AND s.sold_at IS NULL ORDER BY s.stocked_at, s.inventory_id`).all(id)
    .map(row => {
      const item = JSON.parse(row.item);
      return { id: row.id, askingPrice: shelfPrice(db, item, stockType(item), now), stockedAt: row.stockedAt, item };
    });
}

function shopMetrics(row, stock) {
  const size = shopSize(row.size), type = shopType(row.type);
  const variety = new Set(stock.map(entry => entry.item.title)).size;
  const value = stock.length ? Math.round(stock.reduce((sum, entry) => sum + entry.askingPrice, 0) / stock.length) : 0;
  const capacity = shopCapacity(row.type, size);
  const fill = stock.length / capacity;
  const popularity = stock.length ? Math.min(1.5, Math.max(.3,
    (.65 + .15 * Math.min(4, variety)) * (.8 + .2 * Math.min(2, value / type.typicalValue)) * (.65 + .35 * fill))) : 0;
  return { variety, value, popularity: Math.round(popularity * 100) / 100, capacity };
}

function advanceShop(db, row, now) {
  let stock = shopStock(db, row.id, now);
  let visitors = 0, sales = 0, revenue = 0;
  const until = Math.floor(now / HOUR) * HOUR;
  for (let hour = row.last_tick_at + HOUR; hour <= until; hour += HOUR) {
    if (!stock.length) break;
    const metrics = shopMetrics(row, stock);
    const base = shopSize(row.size).visitorsPerHour * metrics.popularity;
    const count = Math.floor(base) + (hashNumber(`${row.id}:${hour}:visitors`) < base % 1 ? 1 : 0);
    visitors += count;
    for (let n = 0; n < count && stock.length; n++) {
      if (hashNumber(`${row.id}:${hour}:${n}:buy`) >= shopType(row.type).conversion) continue;
      const index = Math.floor(hashNumber(`${row.id}:${hour}:${n}:item`) * stock.length);
      const [sold] = stock.splice(index, 1);
      const salePrice = shelfPrice(db, sold.item, row.type, hour);
      db.prepare('UPDATE business_stock SET sold_at = ?, sold_price = ? WHERE inventory_id = ? AND sold_at IS NULL')
        .run(hour, salePrice, sold.id);
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
  const stock = shopStock(db, row.id, now);
  return { id: row.id, type: row.type, size: row.size, boughtAt: row.bought_at,
    visitors: row.visitors, sales: row.sales, revenue: row.revenue,
    ...shopMetrics(row, stock), stock };
}

export function businessDashboard(dataDir, user, { now = Date.now() } = {}) {
  tickBusinesses(dataDir, { now });
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db); activeUser(db, user); advanceShops(db, now, user.id);
    const sealed = sealedPaletteInventoryIds(db);
    return { types: SHOP_TYPES, sizes: SHOP_SIZES,
      bids: db.prepare(`SELECT a.*, MAX(b.amount) AS highest_bid FROM wholesale_auctions a
        JOIN wholesale_bids b ON b.auction_id = a.id WHERE b.bidder_id = ? GROUP BY a.id
        ORDER BY a.ends_at DESC LIMIT 50`).all(user.id)
        .map(row => ({ ...lotSnapshot(db, row), highestBid: row.highest_bid,
          leading: row.settled_at === null && row.bidder_id === user.id,
          won: row.settled_at !== null && row.winner_id === user.id })),
      shops: db.prepare('SELECT * FROM businesses WHERE user_id = ? ORDER BY bought_at, id').all(user.id).map(row => publicShop(db, row, now)),
      inventory: db.prepare('SELECT id, item FROM inventory WHERE user_id = ? AND sold_at IS NULL ORDER BY created_at DESC').all(user.id)
        .filter(row => !db.prepare('SELECT 1 FROM business_stock WHERE inventory_id = ? AND sold_at IS NULL').get(row.id)
          && !inventoryIsLocked(db, row.id) && !sealed.has(row.id))
        .map(row => ({ id: row.id, title: JSON.parse(row.item).title, type: stockType(JSON.parse(row.item)), price: JSON.parse(row.item).price }))
        .filter(item => item.type) };
  }));
}

export function buyBusiness(dataDir, user, typeId, sizeId, { now = Date.now() } = {}) {
  const type = shopType(typeId), size = shopSize(sizeId);
  if (!type || !size) fail('invalid_business');
  const cost = Math.round(size.cost * type.costFactor);
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db); activeUser(db, user);
    if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(cost, user.id, cost).changes) fail('insufficient_tokens', 409);
    const id = randomUUID();
    db.prepare('INSERT INTO businesses (id, user_id, type, size, bought_at, last_tick_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, user.id, type.id, size.id, now, Math.floor(now / HOUR) * HOUR);
    return { shop: publicShop(db, db.prepare('SELECT * FROM businesses WHERE id = ?').get(id), now), cost };
  }));
}

export function stockBusiness(dataDir, user, shopId, inventoryIds, { now = Date.now() } = {}) {
  if (!Array.isArray(inventoryIds) || !inventoryIds.length || inventoryIds.length > 150 || new Set(inventoryIds).size !== inventoryIds.length) fail('invalid_stock');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db); activeUser(db, user); advanceShops(db, now, user.id);
    const shop = db.prepare('SELECT * FROM businesses WHERE id = ? AND user_id = ?').get(shopId, user.id);
    if (!shop) fail('business_not_found', 404);
    if (shopStock(db, shop.id).length + inventoryIds.length > shopCapacity(shop.type, shopSize(shop.size))) fail('business_full', 409);
    const sealed = sealedPaletteInventoryIds(db);
    marketIndexes(db, now);
    for (const id of inventoryIds) {
      const row = db.prepare('SELECT item FROM inventory WHERE id = ? AND user_id = ? AND sold_at IS NULL').get(id, user.id);
      if (!row) fail('item_not_found', 404);
      const item = JSON.parse(row.item);
      if (stockType(item) !== shop.type) fail('wrong_shop_type', 409);
      if (sealed.has(id) || inventoryIsLocked(db, id) || db.prepare('SELECT 1 FROM business_stock WHERE inventory_id = ?').get(id)) fail('item_locked', 409);
      if (!Number.isFinite(item.price) || item.price <= 0) fail('invalid_stock', 409);
      const askingPrice = shelfPrice(db, item, shop.type, now);
      db.prepare('INSERT INTO business_stock (inventory_id, business_id, stocked_at, asking_price) VALUES (?, ?, ?, ?)')
        .run(id, shop.id, now, askingPrice);
    }
    return publicShop(db, shop, now);
  }));
}

export function unstockBusiness(dataDir, user, shopId, inventoryId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db); activeUser(db, user); advanceShops(db, now, user.id);
    const shop = db.prepare('SELECT * FROM businesses WHERE id = ? AND user_id = ?').get(shopId, user.id);
    if (!shop) fail('business_not_found', 404);
    if (!db.prepare('DELETE FROM business_stock WHERE business_id = ? AND inventory_id = ? AND sold_at IS NULL')
      .run(shop.id, inventoryId).changes) fail('stock_not_found', 404);
    return publicShop(db, shop, now);
  }));
}

function lotSnapshot(db, row) {
  const stock = WHOLESALE_STOCK.find(item => item.id === row.stock_id);
  return { id: row.id, title: stock.title, type: stock.type, quantity: stock.quantity,
    unitValue: stock.price, reserve: row.reserve, currentBid: row.current_bid,
    bidIncrement: Math.max(1, Math.ceil(row.reserve * .02)), endsAt: row.ends_at,
    status: row.settled_at === null ? 'active' : 'ended', winnerId: row.winner_id,
    bidCount: db.prepare('SELECT COUNT(*) AS count FROM wholesale_bids WHERE auction_id = ?').get(row.id).count };
}

function settleLot(db, row, now) {
  if (row.settled_at !== null || now < row.ends_at) return;
  if (row.bidder_id) {
    const stock = WHOLESALE_STOCK.find(item => item.id === row.stock_id);
    for (let i = 0; i < stock.quantity; i++) {
      const item = { title: stock.title, price: stock.price, sellValue: stock.price,
        marketCategory: marketCategory(stock.type), businessCategory: stock.type,
        rarity: 'common', wholesaleAuctionId: row.id, wholesaleUnit: i + 1 };
      db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), row.bidder_id, JSON.stringify(item), now);
    }
    pushNotification(db, row.bidder_id, {
      type: 'won', sourceKey: `wholesale:won:${row.id}`, href: '/businesses',
      titleEn: 'Stock auction won', titleDe: 'Warenauktion gewonnen',
      bodyEn: `${stock.quantity} × ${stock.title} is in your inventory.`,
      bodyDe: `${stock.quantity} × ${stock.title} ist in deinem Inventar.`
    }, now);
  }
  db.prepare('UPDATE wholesale_auctions SET winner_id = bidder_id, settled_at = ? WHERE id = ? AND settled_at IS NULL').run(now, row.id);
}

export function tickBusinesses(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db);
    const bucket = Math.floor(now / WHOLESALE_PERIOD), startsAt = bucket * WHOLESALE_PERIOD;
    for (const stock of WHOLESALE_STOCK) {
      const reserve = Math.max(1, Math.round(stock.price * stock.quantity * .75));
      db.prepare(`INSERT OR IGNORE INTO wholesale_auctions (id, stock_id, starts_at, ends_at, reserve)
        VALUES (?, ?, ?, ?, ?)`).run(lotId(bucket, stock.id), stock.id, startsAt, startsAt + WHOLESALE_PERIOD, reserve);
    }
    for (const row of db.prepare('SELECT * FROM wholesale_auctions WHERE settled_at IS NULL AND ends_at <= ?').all(now)) settleLot(db, row, now);
    advanceShops(db, now);
    return { supplied: WHOLESALE_STOCK.length };
  }));
}

export function listWholesale(dataDir, { now = Date.now() } = {}) {
  tickBusinesses(dataDir, { now });
  return withDatabase(dataDir, db => db.prepare('SELECT * FROM wholesale_auctions WHERE settled_at IS NULL AND ends_at > ? ORDER BY ends_at, id').all(now)
    .map(row => lotSnapshot(db, row)));
}

export function bidWholesale(dataDir, user, id, amount, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(amount) || amount < 1) fail('invalid_bid');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBusinessSchema(db); activeUser(db, user);
    const row = db.prepare('SELECT * FROM wholesale_auctions WHERE id = ?').get(id);
    if (!row) fail('wholesale_not_found', 404);
    if (row.settled_at !== null || now >= row.ends_at) fail('auction_ended', 409);
    const minimum = row.current_bid === null ? row.reserve : row.current_bid + Math.max(1, Math.ceil(row.reserve * .02));
    if (amount < minimum) fail('bid_too_low', 409);
    const charge = row.bidder_id === user.id ? amount - row.current_bid : amount;
    if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(charge, user.id, charge).changes) fail('insufficient_tokens', 409);
    if (row.bidder_id && row.bidder_id !== user.id) {
      const previous = db.prepare('SELECT tokens FROM users WHERE id = ?').get(row.bidder_id);
      if (!previous || !Number.isSafeInteger(previous.tokens + row.current_bid)) fail('token_balance_limit', 409);
      db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(row.current_bid, row.bidder_id);
      const stock = WHOLESALE_STOCK.find(item => item.id === row.stock_id);
      pushNotification(db, row.bidder_id, {
        type: 'outbid', sourceKey: `wholesale:outbid:${id}:${amount}`, href: '/businesses',
        titleEn: 'You were outbid', titleDe: 'Du wurdest ueberboten',
        bodyEn: `${stock.quantity} × ${stock.title} is now at J€ ${amount}.`,
        bodyDe: `${stock.quantity} × ${stock.title} steht jetzt bei J€ ${amount}.`
      }, now);
    }
    db.prepare('INSERT INTO wholesale_bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, amount, now);
    db.prepare('UPDATE wholesale_auctions SET current_bid = ?, bidder_id = ? WHERE id = ?').run(amount, user.id, id);
    return lotSnapshot(db, db.prepare('SELECT * FROM wholesale_auctions WHERE id = ?').get(id));
  }));
}
