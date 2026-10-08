import { randomInt, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { advanceShop, ensureBusinessSchema, shopStock, SHOP_TYPES } from './businesses.mjs';
import { marketIndexes } from './market.mjs';
import { inventoryIsLocked } from './resale.mjs';
import { pushNotification } from './notifications.mjs';
import { maskUsername } from './username-privacy.mjs';

export const GOOSE_GUARD_COST = 250;
export const HEIST_COOLDOWN = 30 * 60000;
export const STORE_HEIST_COOLDOWN = 5 * 60000;
export const HEIST_DURATION = 65000;
const fail = (code, status = 400) => { throw new AccountError(code, status); };
const date = now => new Date(now).toISOString().slice(0, 10);

export function ensureStoreSchema(db) {
  ensureBusinessSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS store_receipts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id), action TEXT NOT NULL,
    payload TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(user_id, request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS store_receipts_shop ON store_receipts(business_id, action, user_id);
  CREATE TABLE IF NOT EXISTS store_reviews (
    business_id TEXT NOT NULL REFERENCES businesses(id), user_id TEXT NOT NULL REFERENCES users(id),
    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5), comment TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(business_id, user_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_visits (
    business_id TEXT NOT NULL REFERENCES businesses(id), user_id TEXT NOT NULL REFERENCES users(id),
    day TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(business_id, user_id, day)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_reactions (
    business_id TEXT NOT NULL REFERENCES businesses(id), user_id TEXT NOT NULL REFERENCES users(id),
    day TEXT NOT NULL, reaction TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(business_id, user_id, day, reaction)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_heists (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), business_id TEXT NOT NULL REFERENCES businesses(id),
    owner_id TEXT NOT NULL REFERENCES users(id), inventory_id TEXT NOT NULL,
    sequence TEXT NOT NULL, roll INTEGER NOT NULL, chance INTEGER NOT NULL, fee INTEGER NOT NULL,
    created_at INTEGER NOT NULL, ready_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', result TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS store_heists_actor ON store_heists(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS store_heists_shop ON store_heists(business_id, created_at DESC)`);
}

function actor(db, user) {
  const row = db.prepare('SELECT id, username, tokens FROM users WHERE id = ? AND npc = 0 AND banned = 0 AND must_change_password = 0').get(user?.id || '');
  if (!row) fail('login_required', 401);
  return row;
}
function store(db, shopId) {
  if (typeof shopId !== 'string' || shopId.length > 100) fail('business_not_found', 404);
  const row = db.prepare(`SELECT b.*, u.username FROM businesses b JOIN users u ON u.id = b.user_id
    WHERE b.id = ? AND u.npc = 0 AND u.banned = 0`).get(shopId);
  if (!row) fail('business_not_found', 404);
  return row;
}
const otherStore = (row, user) => { if (row.user_id === user.id) fail('own_store', 409); };
function transferMoney(db, from, to, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1) fail('invalid_store_amount');
  const balance = db.prepare('SELECT tokens FROM users WHERE id = ?').get(to)?.tokens;
  if (!Number.isSafeInteger(balance + amount)) fail('token_balance_limit', 409);
  if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(amount, from, amount).changes) fail('insufficient_tokens', 409);
  db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(amount, to);
}
function notify(db, shop, key, titleEn, titleDe, bodyEn, bodyDe, now) {
  pushNotification(db, shop.user_id, { type: 'store', sourceKey: `store:${key}`, titleEn, titleDe, bodyEn, bodyDe,
    href: `/stores?shop=${encodeURIComponent(shop.id)}` }, now);
}
function atomic(dataDir, user, fn, now) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreSchema(db); const player = actor(db, user); marketIndexes(db, now);
    return fn(db, player);
  }));
}
function receipt(db, player, payload, action, now, fn) {
  if (typeof payload?.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId)) fail('invalid_request');
  const signature = JSON.stringify({ action, payload });
  const previous = db.prepare('SELECT payload, result FROM store_receipts WHERE user_id = ? AND request_id = ?').get(player.id, payload.requestId);
  if (previous) {
    if (previous.payload !== signature) fail('request_conflict', 409);
    return JSON.parse(previous.result);
  }
  const id = randomUUID(), result = fn(id);
  db.prepare(`INSERT INTO store_receipts (id, user_id, request_id, business_id, action, payload, amount, result, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, player.id, payload.requestId, payload.shopId, action, signature, result.amount || 0, JSON.stringify(result), now);
  return result;
}
function shelf(db, shop, inventoryId, now) {
  if (typeof inventoryId !== 'string' || inventoryId.length > 100) fail('invalid_stock');
  advanceShop(db, shop, now);
  const entry = shopStock(db, shop.id, shop.type, shop.profit_margin, now).find(entry => entry.id === inventoryId);
  if (!entry || !db.prepare('SELECT 1 FROM inventory WHERE id = ? AND user_id = ? AND sold_at IS NULL').get(inventoryId, shop.user_id)) fail('stock_not_found', 409);
  if (inventoryIsLocked(db, inventoryId)) fail('item_locked', 409);
  return entry;
}
function moveItem(db, shop, player, inventoryId) {
  if (!db.prepare('DELETE FROM business_stock WHERE business_id = ? AND inventory_id = ? AND sold_at IS NULL').run(shop.id, inventoryId).changes) fail('stock_not_found', 409);
  if (!db.prepare('UPDATE inventory SET user_id = ? WHERE id = ? AND user_id = ? AND sold_at IS NULL').run(player.id, inventoryId, shop.user_id).changes) fail('stock_conflict', 409);
}
export function theftQuote(referencePrice, gooseGuard) {
  return { fee: Math.max(5, Math.ceil(referencePrice * .1)),
    chancePercent: Math.max(gooseGuard ? 2 : 5, Math.floor(35 / (1 + referencePrice / 500) * (gooseGuard ? .5 : 1))) };
}
function publicCard(db, shop, viewer) {
  const rating = db.prepare(`SELECT COUNT(*) AS count, AVG(r.stars) AS average FROM store_reviews r
    JOIN users u ON u.id = r.user_id WHERE r.business_id = ? AND u.banned = 0`).get(shop.id);
  return { id: shop.id, ownerId: shop.user_id, owner: viewer ? shop.username : maskUsername(shop.username),
    name: shop.store_name, motto: shop.store_motto, type: shop.type, size: shop.size, gooseGuard: Boolean(shop.goose_guard),
    stockCount: db.prepare('SELECT COUNT(*) AS n FROM business_stock WHERE business_id = ? AND sold_at IS NULL').get(shop.id).n,
    playerVisits: db.prepare('SELECT COUNT(*) AS n FROM store_visits WHERE business_id = ?').get(shop.id).n,
    rating: rating.average === null ? null : Math.round(rating.average * 10) / 10, reviewCount: rating.count };
}
function serializeHeist(row, now) {
  if (!row) return null;
  if (row.status !== 'active') return { id: row.id, ...JSON.parse(row.result) };
  if (now >= row.expires_at) return { id: row.id, outcome: 'expired', fee: row.fee };
  return { id: row.id, outcome: 'active', sequence: JSON.parse(row.sequence), chancePercent: row.chance, fee: row.fee,
    readyAt: row.ready_at, expiresAt: row.expires_at };
}

export function listStores(dataDir, viewer = null, { now = Date.now(), query = '', type = '', offset = 0, limit = 24 } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreSchema(db); marketIndexes(db, now);
    const needle = String(query).slice(0, 80).trim().toLowerCase();
    const filter = `u.npc = 0 AND u.banned = 0 AND (? = '' OR b.type = ?) AND
      (? = '' OR instr(lower(b.store_name || ' ' || b.store_motto || ' ' || u.username), ?) > 0)`;
    const selectedType = SHOP_TYPES.some(entry => entry.id === type) ? type : '';
    const args = [selectedType, selectedType, needle, needle];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM businesses b JOIN users u ON u.id = b.user_id WHERE ${filter}`).get(...args).n;
    const requestedOffset = Math.floor(Number(offset));
    const start = Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    const count = Math.max(1, Math.min(48, Math.floor(Number(limit)) || 24));
    const rows = db.prepare(`SELECT b.*, u.username FROM businesses b JOIN users u ON u.id = b.user_id
      WHERE ${filter} ORDER BY b.bought_at DESC, b.id LIMIT ? OFFSET ?`).all(...args, count, start);
    for (const shop of rows) advanceShop(db, shop, now);
    return { stores: rows.map(shop => publicCard(db, shop, viewer)), total, offset: start, limit: count };
  }));
}
export function visitStore(dataDir, viewer, shopId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreSchema(db); marketIndexes(db, now); const shop = store(db, shopId); advanceShop(db, shop, now);
    const player = viewer ? actor(db, viewer) : null;
    const own = player?.id === shop.user_id;
    const rows = db.prepare(`SELECT r.stars, r.comment, r.updated_at AS updatedAt, u.username FROM store_reviews r
      JOIN users u ON u.id = r.user_id WHERE r.business_id = ? AND u.banned = 0 ORDER BY r.updated_at DESC, r.user_id LIMIT 30`).all(shop.id);
    const reactions = db.prepare('SELECT reaction, COUNT(*) AS count FROM store_reactions WHERE business_id = ? GROUP BY reaction').all(shop.id);
    const lastHeist = player ? db.prepare('SELECT * FROM store_heists WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(player.id) : null;
    const storeHeist = db.prepare('SELECT MAX(created_at) AS last FROM store_heists WHERE business_id = ?').get(shop.id).last;
    const cooldownUntil = Math.max(lastHeist ? lastHeist.created_at + HEIST_COOLDOWN : 0, storeHeist === null ? 0 : storeHeist + STORE_HEIST_COOLDOWN);
    return { store: { ...publicCard(db, shop, player), own,
      stock: shopStock(db, shop.id, shop.type, shop.profit_margin, now).map(entry => ({ id: entry.id, price: entry.askingPrice,
        item: { title: entry.item.title, image: entry.item.image || null, rarity: entry.item.rarity || 'common' },
        theft: theftQuote(entry.referencePrice, shop.goose_guard) })),
      reviews: rows.map(row => ({ ...row, username: player ? row.username : maskUsername(row.username) })), reactions,
      canReview: Boolean(player && !own && db.prepare("SELECT 1 FROM store_receipts WHERE business_id = ? AND user_id = ? AND action = 'buy'").get(shop.id, player.id)),
      myReview: player ? db.prepare('SELECT stars, comment FROM store_reviews WHERE business_id = ? AND user_id = ?').get(shop.id, player.id) || null : null,
      myReactions: player ? db.prepare('SELECT reaction FROM store_reactions WHERE business_id = ? AND user_id = ? AND day = ?').all(shop.id, player.id, date(now)).map(r => r.reaction) : [],
      cooldownUntil, heist: lastHeist?.business_id === shop.id ? serializeHeist(lastHeist, now) : null } };
  }));
}
export function recordStoreVisit(dataDir, user, shopId, { now = Date.now() } = {}) {
  return atomic(dataDir, user, (db, player) => {
    const shop = store(db, shopId); if (shop.user_id !== player.id) db.prepare('INSERT OR IGNORE INTO store_visits VALUES (?, ?, ?, ?)').run(shop.id, player.id, date(now), now);
    return { visited: true };
  }, now);
}
export function buyStoreItem(dataDir, user, payload, { now = Date.now() } = {}) {
  return atomic(dataDir, user, (db, player) => receipt(db, player, payload, 'buy', now, id => {
    const shop = store(db, payload.shopId); otherStore(shop, player);
    const entry = shelf(db, shop, payload.inventoryId, now);
    if (!Number.isSafeInteger(payload.expectedPrice) || payload.expectedPrice !== entry.askingPrice) fail('store_price_changed', 409);
    transferMoney(db, player.id, shop.user_id, entry.askingPrice); moveItem(db, shop, player, entry.id);
    db.prepare('INSERT INTO business_sales VALUES (?, ?, ?, ?, ?)').run(`player:${id}`, shop.id, entry.id, entry.askingPrice, now);
    db.prepare('UPDATE businesses SET sales = sales + 1, revenue = revenue + ? WHERE id = ?').run(entry.askingPrice, shop.id);
    notify(db, shop, id, 'A player bought something!', 'Ein Spieler hat eingekauft!', `${player.username} bought ${entry.item.title} for J€ ${entry.askingPrice}.`, `${player.username} hat ${entry.item.title} für J€ ${entry.askingPrice} gekauft.`, now);
    return { id, inventoryId: entry.id, title: entry.item.title, amount: entry.askingPrice };
  }), now);
}
export function reviewStore(dataDir, user, { shopId, stars, comment = '' } = {}, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(stars) || stars < 1 || stars > 5 || typeof comment !== 'string' || comment.trim().length > 240) fail('invalid_store_review');
  return atomic(dataDir, user, (db, player) => {
    const shop = store(db, shopId); otherStore(shop, player);
    if (!db.prepare("SELECT 1 FROM store_receipts WHERE business_id = ? AND user_id = ? AND action = 'buy'").get(shop.id, player.id)) fail('purchase_required', 403);
    db.prepare(`INSERT INTO store_reviews VALUES (?, ?, ?, ?, ?) ON CONFLICT(business_id, user_id)
      DO UPDATE SET stars = excluded.stars, comment = excluded.comment, updated_at = excluded.updated_at`).run(shop.id, player.id, stars, comment.trim(), now);
    notify(db, shop, `review:${player.id}:${shop.id}`, 'A verified customer left a review', 'Ein Käufer hat eine Bewertung hinterlassen', `${player.username} rated your store ${stars}/5.`, `${player.username} hat deinen Laden mit ${stars}/5 bewertet.`, now);
    return { reviewed: true };
  }, now);
}
export function reactToStore(dataDir, user, { shopId, reaction } = {}, { now = Date.now() } = {}) {
  if (!['applause', 'joke', 'bell'].includes(reaction)) fail('invalid_store_reaction');
  return atomic(dataDir, user, (db, player) => {
    const shop = store(db, shopId); otherStore(shop, player);
    const inserted = db.prepare('INSERT OR IGNORE INTO store_reactions VALUES (?, ?, ?, ?, ?)').run(shop.id, player.id, date(now), reaction, now);
    if (inserted.changes) notify(db, shop, `${shop.id}:${player.id}:${date(now)}:${reaction}`, 'Someone caused a little commotion', 'Kleine Aufregung im Laden',
      `${player.username} ${reaction === 'bell' ? 'rang the bell. Ding ding!' : reaction === 'joke' ? 'told a terrible dad joke. The shelves groaned.' : 'applauded your store. Standing ovation!'}`,
      `${player.username} ${reaction === 'bell' ? 'hat geklingelt. Ding dong!' : reaction === 'joke' ? 'hat einen schlechten Witz erzählt. Die Regale ächzen.' : 'hat deinem Laden applaudiert. Standing Ovations!'}`, now);
    return { reacted: true };
  }, now);
}
export function tipStore(dataDir, user, payload, { now = Date.now() } = {}) {
  if (![5, 10, 25].includes(payload?.amount)) fail('invalid_store_amount');
  return atomic(dataDir, user, (db, player) => receipt(db, player, payload, 'tip', now, id => {
    const shop = store(db, payload.shopId); otherStore(shop, player); transferMoney(db, player.id, shop.user_id, payload.amount);
    notify(db, shop, id, 'A tip for the tip jar', 'Trinkgeld für die Kasse', `${player.username} left J€ ${payload.amount}.`, `${player.username} hat J€ ${payload.amount} dagelassen.`, now);
    return { id, amount: payload.amount };
  }), now);
}
export function customizeStore(dataDir, user, payload, { now = Date.now() } = {}) {
  if (typeof payload?.name !== 'string' || payload.name.trim().length > 60 || typeof payload.motto !== 'string' || payload.motto.trim().length > 140 || typeof payload.gooseGuard !== 'boolean') fail('invalid_store_profile');
  return atomic(dataDir, user, (db, player) => receipt(db, player, payload, 'profile', now, id => {
    const shop = store(db, payload.shopId); if (shop.user_id !== player.id) fail('forbidden', 403);
    if (shop.goose_guard && !payload.gooseGuard) fail('guard_permanent', 409);
    const cost = payload.gooseGuard && !shop.goose_guard ? GOOSE_GUARD_COST : 0;
    if (cost && !db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(cost, player.id, cost).changes) fail('insufficient_tokens', 409);
    db.prepare('UPDATE businesses SET store_name = ?, store_motto = ?, goose_guard = ? WHERE id = ?').run(payload.name.trim(), payload.motto.trim(), Number(payload.gooseGuard), shop.id);
    return { id, amount: cost };
  }), now);
}
export function startStoreHeist(dataDir, user, payload, { now = Date.now(), draw = randomInt } = {}) {
  return atomic(dataDir, user, (db, player) => receipt(db, player, payload, 'heist', now, id => {
    const shop = store(db, payload.shopId); otherStore(shop, player);
    const last = db.prepare('SELECT created_at FROM store_heists WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(player.id);
    const target = db.prepare('SELECT MAX(created_at) AS last FROM store_heists WHERE business_id = ?').get(shop.id).last;
    if ((last && now < last.created_at + HEIST_COOLDOWN) || (target !== null && now < target + STORE_HEIST_COOLDOWN)) fail('heist_cooldown', 409);
    const entry = shelf(db, shop, payload.inventoryId, now);
    if (payload.expectedPrice !== entry.askingPrice) fail('store_price_changed', 409);
    const quote = theftQuote(entry.referencePrice, shop.goose_guard);
    if (payload.expectedFee !== quote.fee || payload.expectedChance !== quote.chancePercent) fail('store_risk_changed', 409);
    transferMoney(db, player.id, shop.user_id, quote.fee);
    // Charge a disclosed attempt fee once. The owner keeps it even if the
    // player abandons the game, so no escrow can be stranded on disconnect.
    const sequence = Array.from({ length: 6 }, () => draw(4));
    db.prepare(`INSERT INTO store_heists (id, user_id, business_id, owner_id, inventory_id, sequence, roll, chance, fee, created_at, ready_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, player.id, shop.id, shop.user_id, entry.id, JSON.stringify(sequence), draw(1000000), quote.chancePercent, quote.fee, now, now + 5000, now + HEIST_DURATION);
    notify(db, shop, `${id}:start`, 'A suspicious customer paid the mischief fee', 'Ein verdächtiger Kunde hat die Unfuggebühr bezahlt',
      `${player.username} paid J€ ${quote.fee} and is eyeing ${entry.item.title}.`, `${player.username} hat J€ ${quote.fee} bezahlt und schielt auf ${entry.item.title}.`, now);
    return { id, amount: quote.fee };
  }), now);
}
export function finishStoreHeist(dataDir, user, { heistId, moves } = {}, { now = Date.now() } = {}) {
  return atomic(dataDir, user, (db, player) => {
    const attempt = db.prepare('SELECT * FROM store_heists WHERE id = ? AND user_id = ?').get(typeof heistId === 'string' ? heistId : '', player.id);
    if (!attempt) fail('heist_not_found', 404);
    if (attempt.status !== 'active') return JSON.parse(attempt.result);
    if (now < attempt.ready_at) fail('heist_not_ready', 409);
    if (now < attempt.expires_at && (!Array.isArray(moves) || moves.length !== 6 || moves.some(move => !Number.isSafeInteger(move) || move < 0 || move > 3))) fail('invalid_heist_moves');
    const shop = db.prepare(`SELECT b.*, u.banned FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = ?`).get(attempt.business_id);
    if (shop) advanceShop(db, shop, now);
    const present = shop && !shop.banned && db.prepare(`SELECT 1 FROM business_stock s JOIN inventory i ON i.id = s.inventory_id
      WHERE s.inventory_id = ? AND s.business_id = ? AND s.sold_at IS NULL AND i.sold_at IS NULL AND i.user_id = ?`).get(attempt.inventory_id, shop.id, attempt.owner_id) && !inventoryIsLocked(db, attempt.inventory_id);
    const correct = JSON.stringify(moves) === attempt.sequence;
    const outcome = now >= attempt.expires_at ? 'expired' : !present ? 'gone' : !correct ? 'fumbled' : attempt.roll >= attempt.chance * 10000 ? 'caught' : 'stolen';
    if (outcome === 'stolen') moveItem(db, shop, player, attempt.inventory_id);
    const result = { id: attempt.id, outcome, fee: attempt.fee, inventoryId: outcome === 'stolen' ? attempt.inventory_id : null };
    db.prepare('UPDATE store_heists SET status = ?, result = ? WHERE id = ?').run(outcome, JSON.stringify(result), attempt.id);
    if (shop) notify(db, shop, `${attempt.id}:end`, outcome === 'stolen' ? 'A shelf item vanished!' : 'The store survived some mischief', outcome === 'stolen' ? 'Ein Artikel ist verschwunden!' : 'Der Laden hat den Unfug überstanden',
      `${player.username}: ${outcome === 'stolen' ? 'one item was stolen. Check your shelves.' : 'the attempt failed. Your mischief fee is safe.'}`,
      `${player.username}: ${outcome === 'stolen' ? 'Ein Artikel wurde gestohlen. Schau in deine Regale.' : 'Der Versuch ist gescheitert. Die Unfuggebühr bleibt bei dir.'}`, now);
    return result;
  }, now);
}
