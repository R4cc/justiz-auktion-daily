import { randomInt, randomUUID } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { transaction, withDatabase } from './database.mjs';
import { RARITIES } from './cases.mjs';
import { marketIndexAt } from './market.mjs';
import { bundleReferencePricing, ensurePaletteEditionSchema } from './palette-definitions.mjs';

// Sealed primary palette auctions: the system sells frozen palette editions
// as sealed lots. This is deliberately NOT the resale domain and there is no
// shared auction framework — primary auctions differ in kind:
//  - contents are system-issued and sealed: three rewards are drawn WITH
//    replacement at creation and persisted hidden; nobody (including admins)
//    may see them through any public surface before settlement — only the
//    recorded winner may retrieve them afterwards;
//  - the winning payment is a currency SINK: the escrowed bid is consumed at
//    settlement, no seller is paid, tokens leave the economy;
//  - settlement creates exactly three inventory rows from reserved UUIDs
//    (never INSERT OR IGNORE — a conflicting id must abort everything);
//  - creation is a trusted server-only operation with a globally unique
//    requestId, not a player-facing route.
// Bidding escrow matches resale accounting exactly (first bid debits in
// full, an outbid refunds the prior holder, the leader raising pays only the
// difference), but implemented here standalone.
// Not in this package: HTTP routes, schedulers/batch settlement, NPCs,
// automatic lot generation, bid or auction cancellation.
export const PALETTE_AUCTION_DURATION_MS = 3600_000;
export const XP_LEVEL_LIMIT = 20;
const fail = (code, status) => { throw new AccountError(code, status); };

// Level thresholds: reaching level L requires xp >= 100·(L−1)², levels 1..20.
export function levelForXp(xp) {
  let level = 1;
  while (level < XP_LEVEL_LIMIT && xp >= 100 * level * level) level++;
  return level;
}

export function ensurePaletteAuctionSchema(db, now = Date.now()) {
  // Editions (and their market/news dependencies) must exist for the FK and
  // for creation-time valuation.
  ensurePaletteEditionSchema(db, now);
  db.exec(`CREATE TABLE IF NOT EXISTS primary_palette_auctions (
    id TEXT PRIMARY KEY,
    creation_request_id TEXT NOT NULL UNIQUE,
    edition_id TEXT NOT NULL REFERENCES palette_editions(id),
    reserve INTEGER NOT NULL CHECK(reserve > 0),
    current_bid INTEGER NULL,
    current_bidder_id TEXT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK(status IN ('active','ended')),
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    closed_at INTEGER NULL,
    settled_at INTEGER NULL,
    winner_id TEXT NULL REFERENCES users(id),
    valuation_at INTEGER NOT NULL,
    required_level INTEGER NOT NULL,
    public_snapshot_json TEXT NOT NULL CHECK(json_valid(public_snapshot_json))
  ) STRICT`);
  db.exec(`CREATE INDEX IF NOT EXISTS primary_palette_auctions_active
    ON primary_palette_auctions(status, ends_at)`);
  db.exec(`CREATE TABLE IF NOT EXISTS primary_palette_rewards (
    auction_id TEXT NOT NULL REFERENCES primary_palette_auctions(id),
    position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 2),
    inventory_id TEXT NOT NULL UNIQUE,
    item_json TEXT NOT NULL CHECK(json_valid(item_json)),
    PRIMARY KEY(auction_id, position)
  ) STRICT`);
  db.exec(`CREATE TABLE IF NOT EXISTS primary_palette_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id TEXT NOT NULL REFERENCES primary_palette_auctions(id),
    bidder_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK(amount > 0),
    created_at INTEGER NOT NULL
  ) STRICT`);
  db.exec(`CREATE INDEX IF NOT EXISTS primary_palette_bids_auction ON primary_palette_bids(auction_id, id)`);
}

// The frozen public view of a lot. Explicit allowlist: the candidate pool is
// public, the drawn outcome never is. No reserved inventory ids, no reward
// snapshots, no randomness, no private payload fields.
function publicSnapshot(payload) {
  return {
    paletteId: payload.paletteId, name: payload.name, nameDe: payload.nameDe,
    badge: payload.badge, kind: payload.kind, type: payload.legacyTheme,
    story: payload.story, allowedMarketCategories: payload.allowedMarketCategories ?? null,
    rewardCount: payload.rewardCount,
    items: payload.items.map(item => ({ auctionId: item.auctionId, title: item.title,
      image: item.image || null, price: item.price, familySize: item.familySize,
      category: item.category, rarity: item.rarity, marketCategory: item.marketCategory }))
  };
}

function serializePublicAuction(db, row) {
  const snapshot = JSON.parse(row.public_snapshot_json);
  const bidCount = db.prepare('SELECT COUNT(*) AS count FROM primary_palette_bids WHERE auction_id = ?').get(row.id).count;
  return {
    id: row.id, editionId: row.edition_id, paletteId: snapshot.paletteId,
    name: snapshot.name, nameDe: snapshot.nameDe, badge: snapshot.badge,
    kind: snapshot.kind, type: snapshot.type, story: snapshot.story,
    allowedMarketCategories: snapshot.allowedMarketCategories,
    rewardCount: snapshot.rewardCount, items: snapshot.items,
    reserve: row.reserve, currentBid: row.current_bid, bidCount,
    requiredLevel: row.required_level, status: row.status,
    startedAt: row.started_at, endsAt: row.ends_at, closedAt: row.closed_at || null,
    settledAt: row.settled_at || null, winnerId: row.winner_id || null
  };
}

const loadAuction = (db, auctionId) => {
  const row = db.prepare('SELECT * FROM primary_palette_auctions WHERE id = ?').get(String(auctionId));
  if (!row) fail('palette_auction_not_found', 404);
  return row;
};

// One sealed draw from the frozen pool: tier by weight, then uniform within
// the tier — the same semantics as the legacy drawItem. `random` is injected
// for deterministic tests; production uses crypto.randomInt. Timestamps and
// public ids are never used as randomness.
function drawReward(items, weights, random) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) fail('palette_edition_unavailable', 409);
  let roll = random(total), tier = 0;
  while (roll >= weights[tier]) roll -= weights[tier++];
  const pool = items.filter(item => item.rarity === RARITIES[tier].id);
  if (!pool.length) fail('palette_auction_inconsistent', 500);
  return pool[random(pool.length)];
}

// Trusted, server-only lot creation. Deterministic on (requestId): a replay
// returns the original lot unchanged — same draws, same reserve — even after
// expiry; a conflicting editionId for the same requestId is rejected.
export function createPaletteAuction(dataDir, { editionId, requestId }, { now = Date.now(), random = randomInt } = {}) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request', 400);
  if (typeof editionId !== 'string' || !editionId) fail('invalid_request', 400);
  return withDatabase(dataDir, db => transaction(db, () => {
    ensurePaletteAuctionSchema(db, now);
    const existing = db.prepare('SELECT * FROM primary_palette_auctions WHERE creation_request_id = ?').get(requestId);
    if (existing) {
      if (existing.edition_id !== editionId) fail('request_conflict', 409);
      return serializePublicAuction(db, existing);
    }
    const edition = db.prepare('SELECT * FROM palette_editions WHERE id = ?').get(editionId);
    if (!edition) fail('palette_edition_not_found', 404);
    const payload = JSON.parse(edition.payload_json);
    if (!payload.available || !Array.isArray(payload.items) || payload.items.length < 5) fail('palette_edition_unavailable', 409);
    if (now < edition.starts_at || now >= edition.ends_at) fail('palette_edition_inactive', 409);
    // Exactly one hour, never shortened at the end of a palette window: the
    // whole auction must fit inside the edition's availability window.
    const endsAt = now + PALETTE_AUCTION_DURATION_MS;
    if (endsAt > edition.ends_at) fail('palette_window_closes_early', 409);
    // Recompute bundle pricing against the global unrounded indexes right
    // now; the frozen edition values are not trusted for the reserve.
    const pricing = bundleReferencePricing(payload.items,
      item => marketIndexAt(db, item.marketCategory, now), payload.rewardCount);
    if (!pricing.spreadOk) fail('insufficient_value_spread', 409);
    const reserve = pricing.referenceReserve;
    if (!Number.isSafeInteger(reserve) || reserve < 1) fail('palette_auction_inconsistent', 500);
    const auctionId = randomUUID();
    db.prepare(`INSERT INTO primary_palette_auctions
      (id, creation_request_id, edition_id, reserve, current_bid, current_bidder_id, status,
       started_at, ends_at, valuation_at, required_level, public_snapshot_json)
      VALUES (?, ?, ?, ?, NULL, NULL, 'active', ?, ?, ?, ?, ?)`)
      .run(auctionId, requestId, editionId, reserve, now, endsAt, now,
        payload.requiredLevel, JSON.stringify(publicSnapshot(payload)));
    // Draw the three sealed rewards now, with replacement, and reserve their
    // inventory UUIDs. Nothing is minted yet and none of this is public.
    const insertReward = db.prepare(`INSERT INTO primary_palette_rewards
      (auction_id, position, inventory_id, item_json) VALUES (?, ?, ?, ?)`);
    const usedIds = new Set();
    for (let position = 0; position < payload.rewardCount; position++) {
      const item = drawReward(payload.items, payload.weights, random);
      const inventoryId = randomUUID();
      if (usedIds.has(inventoryId)) fail('palette_auction_inconsistent', 500);
      usedIds.add(inventoryId);
      insertReward.run(auctionId, position, inventoryId, JSON.stringify(item));
    }
    return serializePublicAuction(db, db.prepare('SELECT * FROM primary_palette_auctions WHERE id = ?').get(auctionId));
  }));
}

function currentUser(db, userId) {
  const account = db.prepare('SELECT tokens, xp, banned FROM users WHERE id = ?').get(userId);
  if (!account) fail('login_required', 401);
  if (account.banned) fail('account_banned', 403);
  return account;
}

export function bidOnPaletteAuction(dataDir, user, auctionId, amount, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(amount) || amount < 1) fail('invalid_bid', 400);
  return withDatabase(dataDir, db => transaction(db, () => {
    ensurePaletteAuctionSchema(db, now);
    const row = loadAuction(db, auctionId);
    if (now >= row.ends_at) fail('palette_auction_ended', 409);
    const account = currentUser(db, user.id);
    // The frozen requiredLevel gates bidding; the level derives from the
    // persisted users.xp, never from a client-supplied level.
    if (levelForXp(account.xp) < row.required_level) fail('level_required', 403);
    const minimum = row.current_bid === null ? row.reserve : row.current_bid + 1;
    if (amount < minimum) fail('bid_too_low', 409);
    // Escrow accounting, identical in semantics to resale: the leader raising
    // pays only the difference; a different bidder pays in full and refunds
    // the previous holder; a rejected bid changes nothing at all.
    const raise = row.current_bidder_id === user.id;
    const charge = raise ? amount - row.current_bid : amount;
    if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?')
      .run(charge, user.id, charge).changes) fail('insufficient_tokens', 409);
    if (!raise && row.current_bidder_id !== null) {
      const previous = db.prepare('SELECT tokens FROM users WHERE id = ?').get(row.current_bidder_id);
      if (!previous || !Number.isSafeInteger(previous.tokens + row.current_bid)) fail('token_balance_limit', 409);
      db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(row.current_bid, row.current_bidder_id);
    }
    db.prepare('INSERT INTO primary_palette_bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(row.id, user.id, amount, now);
    db.prepare('UPDATE primary_palette_auctions SET current_bid = ?, current_bidder_id = ? WHERE id = ?')
      .run(amount, user.id, row.id);
    return serializePublicAuction(db, db.prepare('SELECT * FROM primary_palette_auctions WHERE id = ?').get(row.id));
  }));
}

// The settlement inventory item and the winner's later reveal are built by
// the same composition: frozen snapshot + palette provenance. bundleCostTokens
// is the entire winning bid, not a per-item cost; no legacy caseId/caseCost
// fields are fabricated.
function composeRewardItem(snapshotJson, auction, reward, winningBid) {
  return { ...JSON.parse(snapshotJson), paletteAuctionId: auction.id,
    paletteEditionId: auction.edition_id, rewardPosition: reward.position, bundleCostTokens: winningBid };
}

// Terminal settlement. The winning escrow is consumed (a currency sink: no
// seller payout, no second debit for the winner); exactly the three reserved
// inventory rows are created for the winner with full provenance. Idempotent:
// repeat calls return the same terminal state and create nothing further.
function settleAuctionRow(db, row, now) {
  if (row.settled_at !== null) return row;
  const winnerId = row.current_bidder_id;
  const winningBid = row.current_bid;
  if (winnerId === null) {
    // No bids: the lot simply ends. No inventory, no token movement.
    db.prepare(`UPDATE primary_palette_auctions SET status = 'ended', closed_at = ?, winner_id = NULL,
      settled_at = ? WHERE id = ? AND settled_at IS NULL`).run(now, now, row.id);
    return db.prepare('SELECT * FROM primary_palette_auctions WHERE id = ?').get(row.id);
  }
  if (!Number.isSafeInteger(winningBid) || winningBid < 1) fail('palette_auction_inconsistent', 500);
  const rewards = db.prepare(`SELECT position, inventory_id, item_json FROM primary_palette_rewards
    WHERE auction_id = ? ORDER BY position`).all(row.id);
  if (rewards.length !== 3 || rewards.some((reward, index) => reward.position !== index)) {
    fail('palette_auction_inconsistent', 500);
  }
  for (const reward of rewards) {
    let snapshot;
    try { snapshot = JSON.parse(reward.item_json); } catch { snapshot = null; }
    if (!snapshot || typeof snapshot !== 'object' || !Number.isFinite(snapshot.price)) fail('palette_auction_inconsistent', 500);
  }
  db.prepare(`UPDATE primary_palette_auctions SET status = 'ended', closed_at = ?, winner_id = ? WHERE id = ?`)
    .run(now, winnerId, row.id);
  // Plain INSERTs: a conflicting reserved inventory id aborts the whole
  // settlement (rolled back), never silently skipped.
  const insertInventory = db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)');
  for (const reward of rewards) {
    insertInventory.run(reward.inventory_id, winnerId,
      JSON.stringify(composeRewardItem(reward.item_json, row, reward, winningBid)), now);
  }
  if (!db.prepare('UPDATE primary_palette_auctions SET settled_at = ? WHERE id = ? AND settled_at IS NULL')
    .run(now, row.id).changes) fail('palette_auction_inconsistent', 500);
  return db.prepare('SELECT * FROM primary_palette_auctions WHERE id = ?').get(row.id);
}

export function settlePaletteAuction(dataDir, auctionId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensurePaletteAuctionSchema(db, now);
    const row = loadAuction(db, auctionId);
    if (row.settled_at === null && now < row.ends_at) fail('auction_still_active', 409);
    return serializePublicAuction(db, settleAuctionRow(db, row, now));
  }));
}

export function getPaletteAuction(dataDir, auctionId, { now = Date.now() } = {}) {
  // Public reads settle their own due lot so the response is terminal truth.
  const due = withDatabase(dataDir, db => {
    ensurePaletteAuctionSchema(db, now);
    const row = loadAuction(db, auctionId);
    return row.settled_at === null && now >= row.ends_at;
  });
  if (due) return settlePaletteAuction(dataDir, auctionId, { now });
  return withDatabase(dataDir, db => {
    ensurePaletteAuctionSchema(db, now);
    return serializePublicAuction(db, loadAuction(db, auctionId));
  });
}

// Default view: active, unexpired lots. Bounded integer pagination.
export function listPaletteAuctions(dataDir, { now = Date.now(), limit = 50, offset = 0 } = {}) {
  return withDatabase(dataDir, db => {
    ensurePaletteAuctionSchema(db, now);
    return db.prepare(`SELECT * FROM primary_palette_auctions
      WHERE status = 'active' AND ends_at > ?
      ORDER BY ends_at ASC, id LIMIT ? OFFSET ?`)
      .all(now, Math.max(1, Math.min(200, Math.floor(limit) || 50)), Math.max(0, Math.floor(offset) || 0))
      .map(row => serializePublicAuction(db, row));
  });
}

// Winner-only reveal of the sealed rewards. Authenticates against fresh
// database state (banned users are out), refuses before the deadline without
// revealing anything, settles if needed, and returns the same three original
// historical snapshots on every call — later resale of a reward changes
// ownership, never this reveal. Retrieval never mints or debits anything.
export function getPaletteAuctionRewards(dataDir, user, auctionId, { now = Date.now() } = {}) {
  const needsSettlement = withDatabase(dataDir, db => {
    ensurePaletteAuctionSchema(db, now);
    currentUser(db, user.id);
    const row = loadAuction(db, auctionId);
    if (now < row.ends_at) fail('rewards_unavailable', 409);
    return row.settled_at === null;
  });
  if (needsSettlement) settlePaletteAuction(dataDir, auctionId, { now });
  return withDatabase(dataDir, db => {
    ensurePaletteAuctionSchema(db, now);
    const row = loadAuction(db, auctionId);
    // Non-winners (including admins and the no-bid case) get the same
    // generic response; existence of rewards is not confirmed to them.
    if (!row.winner_id || row.winner_id !== user.id) fail('palette_rewards_not_found', 404);
    const rewards = db.prepare(`SELECT position, inventory_id, item_json FROM primary_palette_rewards
      WHERE auction_id = ? ORDER BY position`).all(row.id);
    if (rewards.length !== 3) fail('palette_auction_inconsistent', 500);
    // Revealed from the frozen creation-time snapshots, composed exactly like
    // settlement did — later inventory changes (resale, sale) cannot alter
    // the historical reveal, and retrieval never mints or debits anything.
    const reveal = rewards.map(reward => ({ position: reward.position, inventoryId: reward.inventory_id,
      item: composeRewardItem(reward.item_json, row, reward, row.current_bid) }));
    return { auctionId: row.id, editionId: row.edition_id, winnerId: row.winner_id,
      settledAt: row.settled_at, bundleCostTokens: row.current_bid, rewards: reveal };
  });
}
