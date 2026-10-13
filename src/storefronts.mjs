import { storeReputation } from './store-reputation.mjs';
import { storeReviewList } from './store-reviews.mjs';
import { skillEffects } from './skill-effects.mjs';
import { plotLocation } from './town-plots.mjs';
import { randomInt, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { advanceShop, ensureBusinessSchema, shopStock, SHOP_TYPES } from './businesses.mjs';
import { marketIndexes } from './market.mjs';
import { inventoryIsLocked } from './resale.mjs';
import { pushNotification } from './notifications.mjs';
import { maskUsername } from './username-privacy.mjs';
import { recordSale, acquireItems } from './trader.mjs';
import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { dealBlackjack, playBlackjack, publicBlackjack } from './blackjack.mjs';
import { ensureJusticeSchema, assertPlayerFree, imposeFine, collectFine } from './justice.mjs';

export const GOOSE_GUARD_COST = 250;
export const HEIST_COOLDOWN = 30 * 60000;
export const STORE_HEIST_COOLDOWN = 5 * 60000;
export const HEIST_DURATION = 10 * 60000;
export const POLICE_WHEEL_DURATION = 2 * 60000;
export const POLICE_CATCH_PERCENT = ECONOMY_BALANCE.theftPoliceCatchPercent;
const fail = (code, status = 400) => { throw new AccountError(code, status); };
const date = now => new Date(now).toISOString().slice(0, 10);

export function ensureStoreSchema(db) {
  ensureBusinessSchema(db);
  ensureJusticeSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS store_receipts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id), action TEXT NOT NULL,
    payload TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(user_id, request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS store_receipts_shop ON store_receipts(business_id, action, user_id);
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
  if (!db.prepare('PRAGMA table_info(store_heists)').all().some(column => column.name === 'choice')) {
    db.exec("ALTER TABLE store_heists ADD COLUMN choice TEXT CHECK(choice IN ('red', 'black'))");
  }
  if (!db.prepare('PRAGMA table_info(store_heists)').all().some(column => column.name === 'blackjack')) db.exec("ALTER TABLE store_heists ADD COLUMN blackjack TEXT");
  if (!db.prepare('PRAGMA table_info(store_heists)').all().some(column => column.name === 'settled_at')) {
    db.exec('ALTER TABLE store_heists ADD COLUMN settled_at INTEGER');
    // Historical catch receipts preserve the actual recording time. Expiry
    // alone cannot establish when an offline attempt was processed.
    db.exec(`UPDATE store_heists AS h SET settled_at=
      (SELECT MIN(r.created_at) FROM store_receipts r WHERE r.user_id=h.user_id
        AND json_extract(r.result,'$.id')=h.id AND
        (json_extract(r.result,'$.outcome')='caught' OR json_extract(r.result,'$.heist.outcome')='caught'))
      WHERE h.status='caught'`);
  }
}

function actor(db, user, now = Date.now()) {
  const row = db.prepare('SELECT id, username, tokens FROM users WHERE id = ? AND npc = 0 AND banned = 0 AND must_change_password = 0').get(user?.id || '');
  if (!row) fail('login_required', 401);
  assertPlayerFree(db,row.id,now);
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
    ensureStoreSchema(db); const player = actor(db, user, now); marketIndexes(db, now);
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
export function theftQuote(referencePrice, gooseGuard, locationMultiplier = 1, securityPercent = 0) {
  const baseFine = Math.max(20, Math.ceil(referencePrice * ECONOMY_BALANCE.theftFineMultiplier * (gooseGuard ? 2 : 1) * Math.max(1, 1 / locationMultiplier)));
  const fine=Math.ceil(baseFine*(100+securityPercent)/100);
  return { fine, policeCatchPercent: POLICE_CATCH_PERCENT, rules: 'single-deck-s17' };
}
function publicCard(db, shop, viewer, now) {
  return { id: shop.id, ownerId: shop.user_id, owner: viewer ? shop.username : maskUsername(shop.username),
    location: plotLocation(db, shop.plot_id), name: shop.store_name, motto: shop.store_motto, type: shop.type, size: shop.size, gooseGuard: Boolean(shop.goose_guard), mischiefEnabled: Boolean(shop.mischief_enabled),
    stockCount: db.prepare('SELECT COUNT(*) AS n FROM business_stock WHERE business_id = ? AND sold_at IS NULL').get(shop.id).n,
    playerVisits: db.prepare('SELECT COUNT(*) AS n FROM store_visits WHERE business_id = ?').get(shop.id).n,
    ...storeReputation(db, shop, now) };
}
function serializeHeist(row, now) {
  if (!row) return null;
  if (row.blackjack) return { id:row.id, outcome:row.status, fine:row.fee, expiresAt:row.expires_at, blackjack:publicBlackjack(JSON.parse(row.blackjack)), ...(row.result ? JSON.parse(row.result) : {}) };
  if (row.status !== 'active') return { id: row.id, ...JSON.parse(row.result) };
  if (now >= row.expires_at) return { id: row.id, outcome: 'expired', fee: row.fee, choice: row.choice || 'red' };
  return { id: row.id, outcome: 'active', choice: row.choice || 'red', chancePercent: row.chance, fee: row.fee,
    readyAt: row.ready_at, expiresAt: row.expires_at };
}

export function listStores(dataDir, viewer = null, { now = Date.now(), query = '', type = '', offset = 0, limit = 24, ownerId = '', excludeOwnerId = '' } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreSchema(db); marketIndexes(db, now);
    const needle = String(query).slice(0, 80).trim().toLowerCase();
    const filter = `u.npc = 0 AND u.banned = 0 AND (? = '' OR b.user_id = ?) AND (? = '' OR b.user_id != ?) AND (? = '' OR b.type = ?) AND
      (? = '' OR instr(lower(b.store_name || ' ' || b.store_motto || ' ' || u.username), ?) > 0)`;
    const selectedType = SHOP_TYPES.some(entry => entry.id === type) ? type : '';
    const args = [ownerId, ownerId, excludeOwnerId, excludeOwnerId, selectedType, selectedType, needle, needle];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM businesses b JOIN users u ON u.id = b.user_id WHERE ${filter}`).get(...args).n;
    const requestedOffset = Math.floor(Number(offset));
    const start = Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    const count = Math.max(1, Math.min(48, Math.floor(Number(limit)) || 24));
    const rows = db.prepare(`SELECT b.*, u.username FROM businesses b JOIN users u ON u.id = b.user_id
      WHERE ${filter} ORDER BY b.bought_at DESC, b.id LIMIT ? OFFSET ?`).all(...args, count, start);
    for (const shop of rows) advanceShop(db, shop, now);
    return { stores: rows.map(shop => publicCard(db, shop, viewer, now)), total, offset: start, limit: count };
  }));
}
export function visitStore(dataDir, viewer, shopId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreSchema(db); marketIndexes(db, now); const shop = store(db, shopId); advanceShop(db, shop, now);
    const player = viewer ? actor(db, viewer, now) : null;
    const own = player?.id === shop.user_id;
    const rows = storeReviewList(db,shop.id,player?.id || '');
    const reactions = db.prepare('SELECT reaction, COUNT(*) AS count FROM store_reactions WHERE business_id = ? GROUP BY reaction').all(shop.id);
    const lastHeist = player ? db.prepare('SELECT * FROM store_heists WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(player.id) : null;
    const storeHeist = db.prepare('SELECT MAX(created_at) AS last FROM store_heists WHERE business_id = ?').get(shop.id).last;
    const cooldownUntil = Math.max(lastHeist ? lastHeist.created_at + HEIST_COOLDOWN : 0, storeHeist === null ? 0 : storeHeist + STORE_HEIST_COOLDOWN);
    return { store: { ...publicCard(db, shop, player, now), own,
      stock: shopStock(db, shop.id, shop.type, shop.profit_margin, now).map(entry => ({ id: entry.id, price: entry.askingPrice,
        item: { title: entry.item.title, image: entry.item.image || null, rarity: entry.item.rarity || 'common' },
        theft: !own ? theftQuote(entry.referencePrice, shop.goose_guard, plotLocation(db, shop.plot_id)?.theftMultiplier ?? 1, skillEffects(db,shop.user_id).securityPercent) : null })),
      reviews: rows.map(row => ({ ...row, username: player ? row.username : maskUsername(row.username) })), reactions,
      canReview: Boolean(player && !own && db.prepare("SELECT 1 FROM store_receipts WHERE business_id = ? AND user_id = ? AND action = 'buy'").get(shop.id, player.id)),
      myReview: player ? db.prepare('SELECT stars, comment FROM store_reviews WHERE business_id = ? AND user_id = ?').get(shop.id, player.id) || null : null,
      myReactions: player ? db.prepare('SELECT reaction FROM store_reactions WHERE business_id = ? AND user_id = ? AND day = ?').all(shop.id, player.id, date(now)).map(r => r.reaction) : [],
      cooldownUntil, heist: lastHeist?.business_id === shop.id ? serializeHeist(lastHeist, now) : null } };
  }));
}
// Only caught attempts are recorded crimes. Successful, unresolved, tied and
// cancelled attempts are excluded; collection of the same fine adds no record.
export function playerCriminalRecord(dataDir, user, { offset = 0, limit = 10, now = Date.now() } = {}) {
  return atomic(dataDir,user,(db,player) => {
    const pageSize = Number.isSafeInteger(Number(limit)) ? Math.max(1,Math.min(50,Number(limit))) : 10;
    const requested = Number(offset), start = Number.isSafeInteger(requested) ? Math.max(0,requested) : 0;
    const summary = db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(fee),0) AS totalPenalties
      FROM store_heists WHERE user_id=? AND status='caught'`).get(player.id);
    const records = db.prepare(`SELECT id,fee AS fine,created_at AS attemptedAt,settled_at AS recordedAt,
      blackjack IS NULL AS legacyFee,COALESCE(json_extract(result,'$.abandoned'),0) AS abandoned
      FROM store_heists WHERE user_id=? AND status='caught'
      ORDER BY COALESCE(settled_at,created_at) DESC,id DESC LIMIT ? OFFSET ?`).all(player.id,pageSize,start)
      .map(row => ({...row,crime:'attempted_theft',legacyFee:Boolean(row.legacyFee),abandoned:Boolean(row.abandoned)}));
    return { ...summary,records,offset:start,limit:pageSize,hasMore:start+records.length<summary.total };
  },now);
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
    transferMoney(db, player.id, shop.user_id, entry.askingPrice);
    recordSale(db,shop.user_id,[entry.id],entry.askingPrice,`store:${id}`,now,shop.id);
    moveItem(db, shop, player, entry.id);
    acquireItems(db,player.id,[entry.id],entry.askingPrice,'purchase',now);
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
    const previous = db.prepare('SELECT stars,comment FROM store_reviews WHERE business_id=? AND user_id=?').get(shop.id,player.id);
    if (previous && (previous.stars !== stars || previous.comment !== comment.trim())) {
      db.prepare('DELETE FROM store_review_likes WHERE business_id=? AND reviewer_id=?').run(shop.id,player.id);
    }
    db.prepare(`INSERT INTO store_reviews VALUES (?, ?, ?, ?, ?) ON CONFLICT(business_id, user_id)
      DO UPDATE SET stars = excluded.stars, comment = excluded.comment, updated_at = excluded.updated_at`).run(shop.id, player.id, stars, comment.trim(), now);
    notify(db, shop, `review:${player.id}:${shop.id}`, 'A verified customer left a review', 'Ein Käufer hat eine Bewertung hinterlassen', `${player.username} rated your store ${stars}/5.`, `${player.username} hat deinen Laden mit ${stars}/5 bewertet.`, now);
    return { reviewed: true };
  }, now);
}
export function likeStoreReview(dataDir, user, { shopId, reviewerId, liked } = {}, { now = Date.now() } = {}) {
  if (typeof reviewerId !== 'string' || reviewerId.length > 100 || typeof liked !== 'boolean') fail('invalid_store_reaction');
  return atomic(dataDir,user,(db,player) => {
    const shop = store(db,shopId);
    if (reviewerId === player.id) fail('own_review',409);
    if (!db.prepare(`SELECT 1 FROM store_reviews r JOIN users u ON u.id=r.user_id
      WHERE r.business_id=? AND r.user_id=? AND u.banned=0`).get(shop.id,reviewerId)) fail('review_not_found',404);
    if (liked) db.prepare('INSERT OR IGNORE INTO store_review_likes VALUES(?,?,?,?)').run(shop.id,reviewerId,player.id,now);
    else db.prepare('DELETE FROM store_review_likes WHERE business_id=? AND reviewer_id=? AND user_id=?').run(shop.id,reviewerId,player.id);
    return { liked };
  },now);
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
  if (typeof payload?.name !== 'string' || payload.name.trim().length > 60 || typeof payload.motto !== 'string' || payload.motto.trim().length > 140 || typeof payload.gooseGuard !== 'boolean' || (payload.mischiefEnabled !== undefined && typeof payload.mischiefEnabled !== 'boolean')) fail('invalid_store_profile');
  return atomic(dataDir, user, (db, player) => receipt(db, player, payload, 'profile', now, id => {
    const shop = store(db, payload.shopId); if (shop.user_id !== player.id) fail('forbidden', 403);
    if (shop.goose_guard && !payload.gooseGuard) fail('guard_permanent', 409);
    const cost = payload.gooseGuard && !shop.goose_guard ? GOOSE_GUARD_COST : 0;
    if (cost && !db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(cost, player.id, cost).changes) fail('insufficient_tokens', 409);
    db.prepare('UPDATE businesses SET store_name = ?, store_motto = ?, goose_guard = ?, mischief_enabled = ? WHERE id = ?').run(payload.name.trim(), payload.motto.trim(), Number(payload.gooseGuard), payload.mischiefEnabled === undefined ? shop.mischief_enabled : Number(payload.mischiefEnabled), shop.id);
    return { id, amount: cost };
  }), now);
}
export function startStoreHeist(dataDir, user, payload, { now = Date.now(), draw = randomInt, policeDraw = randomInt } = {}) {
  return atomic(dataDir, user, (db, player) => receipt(db, player, payload, 'heist', now, id => {
    const shop = store(db, payload.shopId); otherStore(shop, player);
    if (assertPlayerFree(db,player.id,now).fineDue) fail('unpaid_fine',409);
    const last = db.prepare('SELECT created_at FROM store_heists WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(player.id);
    const target = db.prepare('SELECT MAX(created_at) AS last FROM store_heists WHERE business_id = ?').get(shop.id).last;
    if ((last && now < last.created_at + HEIST_COOLDOWN) || (target !== null && now < target + STORE_HEIST_COOLDOWN)) fail('heist_cooldown', 409);
    if (db.prepare("SELECT 1 FROM store_heists WHERE user_id=? AND status IN ('active','police')").get(player.id)) fail('heist_active',409);
    const entry = shelf(db, shop, payload.inventoryId, now);
    if (payload.expectedPrice !== entry.askingPrice) fail('store_price_changed', 409);
    const quote = theftQuote(entry.referencePrice, shop.goose_guard, plotLocation(db, shop.plot_id)?.theftMultiplier ?? 1, skillEffects(db,shop.user_id).securityPercent);
    if (payload.expectedFine !== quote.fine) fail('store_risk_changed', 409);
    const game = dealBlackjack(draw);
    db.prepare(`INSERT INTO store_heists (id,user_id,business_id,owner_id,inventory_id,sequence,roll,chance,fee,created_at,ready_at,expires_at,blackjack)
      VALUES (?,?,?,?,?,'[]',0,0,?,?,?,?,?)`).run(id,player.id,shop.id,shop.user_id,entry.id,quote.fine,now,now,now+HEIST_DURATION,JSON.stringify(game));
    if (game.outcome !== 'active') settleBlackjack(db,player,db.prepare('SELECT * FROM store_heists WHERE id=?').get(id),game,now,policeDraw);
    return { id, amount:0, heist:serializeHeist(db.prepare('SELECT * FROM store_heists WHERE id=?').get(id),now) };
  }), now);
}
function policeWheel(attempt, spun = false, autoSpun = false) {
  return { catchPercent: attempt.chance, escapePercent: 100 - attempt.chance, spun,
    ...(spun ? { sector: Math.floor(attempt.roll / 100000), outcome: attempt.roll < attempt.chance * 10000 ? 'caught' : 'escaped', autoSpun } : {}) };
}
function queuePoliceWheel(db,attempt,game,now,draw) {
  const roll = draw(1000000);
  if (!Number.isInteger(roll) || roll < 0 || roll >= 1000000) throw new Error('invalid_police_draw');
  const expiresAt = (game.abandoned ? attempt.expires_at : now) + POLICE_WHEEL_DURATION;
  const updated = { ...attempt, chance: POLICE_CATCH_PERCENT, roll, expires_at: expiresAt };
  const result = { id: attempt.id, outcome: 'police', fine: attempt.fee, expiresAt,
    blackjack: publicBlackjack(game), policeWheel: policeWheel(updated), abandoned: Boolean(game.abandoned) };
  db.prepare("UPDATE store_heists SET status='police',roll=?,chance=?,blackjack=?,expires_at=?,result=? WHERE id=?")
    .run(roll, POLICE_CATCH_PERCENT, JSON.stringify(game), expiresAt, JSON.stringify(result), attempt.id);
  return now >= expiresAt ? settlePoliceWheel(db,playerForHeist(db,attempt),updated,game,now,true) : result;
}
const playerForHeist = (db,attempt) => db.prepare('SELECT id,username FROM users WHERE id=?').get(attempt.user_id);
function settlePoliceWheel(db,player,attempt,game,now,autoSpun = false) {
  const outcome = attempt.roll < attempt.chance * 10000 ? 'caught' : 'escaped';
  return settleBlackjack(db,player,attempt,game,now,randomInt,{ outcome, policeWheel: policeWheel(attempt,true,autoSpun) });
}
function settleBlackjack(db,player,attempt,game,now,policeDraw = randomInt, policeResult = null) {
  if (game.outcome === 'lose' && !policeResult) return queuePoliceWheel(db,attempt,game,now,policeDraw);
  const shop = db.prepare(`SELECT b.*,u.banned FROM businesses b JOIN users u ON u.id=b.user_id WHERE b.id=?`).get(attempt.business_id);
  if (shop) advanceShop(db,shop,now);
  const present = shop && !shop.banned && db.prepare(`SELECT 1 FROM business_stock s JOIN inventory i ON i.id=s.inventory_id
    WHERE s.business_id=? AND s.inventory_id=? AND s.sold_at IS NULL AND i.sold_at IS NULL AND i.user_id=?`).get(shop.id,attempt.inventory_id,attempt.owner_id) && !inventoryIsLocked(db,attempt.inventory_id);
  const outcome = policeResult?.outcome ?? (game.outcome === 'push' ? 'push' : present ? 'stolen' : 'gone');
  let consequence = null;
  if (outcome === 'stolen') { moveItem(db,shop,player,attempt.inventory_id); acquireItems(db,player.id,[attempt.inventory_id],0,'mischief',now); }
  if (outcome === 'caught') consequence = imposeFine(db,player.id,attempt.fee,now);
  const result = { id:attempt.id,outcome,fine:attempt.fee,inventoryId:outcome==='stolen'?attempt.inventory_id:null,
    blackjack:publicBlackjack(game),consequence,abandoned:game.abandoned||false,
    ...(policeResult ? { policeWheel: policeResult.policeWheel } : {}) };
  db.prepare('UPDATE store_heists SET status=?,result=?,blackjack=?,settled_at=? WHERE id=?').run(outcome,JSON.stringify(result),JSON.stringify(game),now,attempt.id);
  if (shop) notify(db,shop,`${attempt.id}:end`,outcome==='stolen'?'A shelf item was stolen':'A theft attempt ended',outcome==='stolen'?'Ein Regalartikel wurde gestohlen':'Ein Diebstahlversuch endete',
    `${player.username}: ${outcome==='stolen'?'check your shelves.':outcome==='caught'?'caught and fined. No stock was stolen.':'no stock was stolen.'}`,
    `${player.username}: ${outcome==='stolen'?'Prüfe deine Regale.':outcome==='caught'?'erwischt und mit Bußgeld belegt. Keine Ware wurde gestohlen.':'Keine Ware wurde gestohlen.'}`,now);
  return result;
}
export function actStoreHeist(dataDir,user,payload,{now=Date.now(),policeDraw=randomInt}={}) {
  return atomic(dataDir,user,(db,player)=>{
    const attempt=db.prepare('SELECT * FROM store_heists WHERE id=? AND user_id=?').get(payload.heistId,player.id);
    if (!attempt) fail('heist_not_found',404);
    if (!attempt.blackjack) fail('legacy_heist',409);
    return receipt(db,player,{...payload,shopId:attempt.business_id},'blackjack',now,()=>{
      if (attempt.status==='police' && now>=attempt.expires_at) return settlePoliceWheel(db,player,attempt,JSON.parse(attempt.blackjack),now,true);
      if (attempt.status!=='active') return JSON.parse(attempt.result);
      const game=JSON.parse(attempt.blackjack);
      if (now>=attempt.expires_at) { game.outcome='lose';game.abandoned=true;return settleBlackjack(db,player,attempt,game,now,policeDraw); }
      if (!['hit','stand'].includes(payload.action)) fail('invalid_blackjack_action');
      if (payload.turn!==game.turn) fail('blackjack_turn_changed',409);
      playBlackjack(game,payload.action);
      if (game.outcome!=='active') return settleBlackjack(db,player,attempt,game,now,policeDraw);
      db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify(game),attempt.id);
      return {id:attempt.id,outcome:'active',fine:attempt.fee,expiresAt:attempt.expires_at,blackjack:publicBlackjack(game)};
    });
  },now);
}
export function spinStoreHeist(dataDir,user,payload,{now=Date.now()}={}) {
  return atomic(dataDir,user,(db,player)=>{
    const attempt=db.prepare('SELECT * FROM store_heists WHERE id=? AND user_id=?').get(typeof payload?.heistId==='string'&&payload.heistId.length<=100?payload.heistId:'',player.id);
    if (!attempt) fail('heist_not_found',404);
    return receipt(db,player,{...payload,shopId:attempt.business_id},'police-wheel',now,()=>{
      if (attempt.status!=='police') {
        const saved=attempt.result ? JSON.parse(attempt.result) : null;
        if (saved?.policeWheel?.spun) return saved;
        fail('police_spin_not_ready',409);
      }
      return settlePoliceWheel(db,player,attempt,JSON.parse(attempt.blackjack),now,now>=attempt.expires_at);
    });
  },now);
}
export function settleExpiredPlayerHeists(db,userId,now,{policeDraw=randomInt}={}) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='store_heists'").get()) return;
  ensureStoreSchema(db);
  for (const attempt of db.prepare("SELECT * FROM store_heists WHERE user_id=? AND status='active' AND blackjack IS NOT NULL AND expires_at<=?").all(userId,now)) {
    const player=db.prepare('SELECT id,username FROM users WHERE id=?').get(userId),game=JSON.parse(attempt.blackjack);
    game.outcome='lose';game.abandoned=true;settleBlackjack(db,player,attempt,game,now,policeDraw);
  }
  for (const attempt of db.prepare("SELECT * FROM store_heists WHERE user_id=? AND status='police' AND expires_at<=?").all(userId,now)) {
    settlePoliceWheel(db,playerForHeist(db,attempt),attempt,JSON.parse(attempt.blackjack),now,true);
  }
}
export function tickStoreJustice(dataDir,{now=Date.now(),policeDraw=randomInt}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='users'").get()) return {processed:0};
    ensureStoreSchema(db);
    const users=db.prepare(`SELECT id FROM users WHERE npc=0 AND (id IN (SELECT user_id FROM store_heists WHERE status IN ('active','police') AND blackjack IS NOT NULL AND expires_at<=?)
      OR id IN (SELECT user_id FROM player_justice WHERE fine_due>0))`).all(now);
    for(const user of users) {settleExpiredPlayerHeists(db,user.id,now,{policeDraw});collectFine(db,user.id,now);}
    return {processed:users.length};
  }));
}
export function finishStoreHeist(dataDir,user,payload,options={}) {
  const legacy=withDatabase(dataDir,db=>{ensureStoreSchema(db);return db.prepare('SELECT blackjack FROM store_heists WHERE id=? AND user_id=?').get(payload.heistId,user.id);});
  if (legacy?.blackjack) fail('blackjack_action_required',409);
  return finishLegacyStoreHeist(dataDir,user,payload,options);
}
function finishLegacyStoreHeist(dataDir, user, { heistId } = {}, { now = Date.now() } = {}) {
  return atomic(dataDir, user, (db, player) => {
    const attempt = db.prepare('SELECT * FROM store_heists WHERE id = ? AND user_id = ?').get(typeof heistId === 'string' ? heistId : '', player.id);
    if (!attempt) fail('heist_not_found', 404);
    if (attempt.status !== 'active') return JSON.parse(attempt.result);
    if (now < attempt.ready_at) fail('heist_not_ready', 409);
    const shop = db.prepare(`SELECT b.*, u.banned FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = ?`).get(attempt.business_id);
    if (shop) advanceShop(db, shop, now);
    const present = shop && !shop.banned && db.prepare(`SELECT 1 FROM business_stock s JOIN inventory i ON i.id = s.inventory_id
      WHERE s.inventory_id = ? AND s.business_id = ? AND s.sold_at IS NULL AND i.sold_at IS NULL AND i.user_id = ?`).get(attempt.inventory_id, shop.id, attempt.owner_id) && !inventoryIsLocked(db, attempt.inventory_id);
    const choice = attempt.choice || 'red', matched = attempt.roll < attempt.chance * 10000;
    const color = matched ? choice : choice === 'red' ? 'black' : 'red';
    const outcome = now >= attempt.expires_at ? 'expired' : !present ? 'gone' : !matched ? 'caught' : 'stolen';
    if (outcome === 'stolen') {
      moveItem(db, shop, player, attempt.inventory_id);
      acquireItems(db,player.id,[attempt.inventory_id],attempt.fee,'mischief',now);
    }
    const result = { id: attempt.id, outcome, choice, color, fee: attempt.fee, inventoryId: outcome === 'stolen' ? attempt.inventory_id : null };
    db.prepare('UPDATE store_heists SET status = ?, result = ?, settled_at = ? WHERE id = ?').run(outcome, JSON.stringify(result), now, attempt.id);
    if (shop) notify(db, shop, `${attempt.id}:end`, outcome === 'stolen' ? 'A shelf item vanished!' : 'The store survived some mischief', outcome === 'stolen' ? 'Ein Artikel ist verschwunden!' : 'Der Laden hat den Unfug überstanden',
      `${player.username}: ${outcome === 'stolen' ? 'one item was stolen. Check your shelves.' : 'the attempt failed. Your mischief fee is safe.'}`,
      `${player.username}: ${outcome === 'stolen' ? 'Ein Artikel wurde gestohlen. Schau in deine Regale.' : 'Der Versuch ist gescheitert. Die Unfuggebühr bleibt bei dir.'}`, now);
    return result;
  }, now);
}
