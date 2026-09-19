import { randomUUID } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { transaction, withDatabase } from './database.mjs';
import { awardXp, resaleXp } from './xp.mjs';
import { estimatedValueTokens, marketIndexes, marketCategoryForItem } from './market.mjs';

// Player resale auctions: eBay-like listings of single inventory items.
//
// Ownership rules enforced here and in accounts.mjs:
//  - A listing always references the original inventory row; the item is never
//    copied or minted. Ownership moves only at settlement, by updating that
//    same row's user_id.
//  - An item is resale-locked while its auction is active, or ended with a
//    winner while settlement is still pending (see RESALE_LOCK_SQL, the single
//    lock condition shared with the instant-sell paths in accounts.mjs).
//    Settled, cancelled and bid-less lost auctions release the item; after a
//    settled sale only the winner, as the new owner, may relist it.
//  - A partial unique index guarantees at most one active listing per item.
//
// Escrow invariant (escrow at bid time): an auction row's current_bid together
// with its current_bidder_id IS the escrow. Those tokens were deducted from the
// bidder's users.tokens balance the moment the bid was placed and are held by
// the auction row until settlement — users.tokens is always spendable balance
// and never counts tokens locked in bids. Bidding therefore moves tokens
// bidder → auction (a first bid or another bidder's outbid reserves the full
// amount, the current bidder raising their own bid reserves only the
// difference, an outbid refunds the previous holder's exact amount), and
// settlement moves the held amount auction → seller. Normal bid transitions
// and settlement never create or destroy tokens, and the winner is never
// charged a second time at settlement.
//
// Runtime and lazy reads both settle due listings through the same path.
// NPC buyers reuse placeBid, escrow and settlement; fees are out of scope.
export const RESALE_STATUSES = ['active', 'ended', 'cancelled'];
export const MIN_LISTING_MS = 60_000;
export const MAX_LISTING_MS = 30 * 86_400_000;
const fail = (code, status) => { throw new AccountError(code, status); };

export function ensureResaleSchema(db, now = Date.now()) {
  db.exec(`CREATE TABLE IF NOT EXISTS resale_auctions (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES users(id),
    inventory_id TEXT NOT NULL REFERENCES inventory(id),
    start_price INTEGER NOT NULL CHECK(start_price > 0),
    current_bid INTEGER,
    current_bidder_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','cancelled')),
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    winner_id TEXT REFERENCES users(id),
    closed_at INTEGER,
    settled_at INTEGER
  ) STRICT`);
  // One live listing per item, ever; cancelled or lost auctions release the item.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS resale_auctions_inventory_active
    ON resale_auctions(inventory_id) WHERE status = 'active'`);
  db.exec(`CREATE INDEX IF NOT EXISTS resale_auctions_open ON resale_auctions(status, ends_at)`);
  db.exec(`CREATE TABLE IF NOT EXISTS resale_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id TEXT NOT NULL REFERENCES resale_auctions(id) ON DELETE CASCADE,
    bidder_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK(amount > 0),
    created_at INTEGER NOT NULL
  ) STRICT`);
  db.exec(`CREATE INDEX IF NOT EXISTS resale_bids_auction ON resale_bids(auction_id, amount)`);
  const columns = db.prepare('PRAGMA table_info(resale_auctions)').all().map(column => column.name);
  if (!columns.includes('settled_at')) {
    db.exec('ALTER TABLE resale_auctions ADD COLUMN settled_at INTEGER');
    // One-time cleanup for foundation-version rows: their bids were advisory
    // only, so no tokens were ever escrowed for them, and settling them under
    // escrow rules would mint tokens out of thin air. Any auction that already
    // has a high bidder is therefore cancelled outright — since foundation
    // bids never moved tokens, there is nothing to refund; the resale_bids
    // history rows stay untouched. Bid-free auctions simply keep running
    // under the new escrow rules. The resale feature is flag-gated and has
    // never been live, so at most development data is affected.
    db.prepare(`UPDATE resale_auctions SET status = 'cancelled', closed_at = ?
      WHERE current_bidder_id IS NOT NULL`).run(now);
  }
}

// The single lock condition for inventory disposal paths (instant sell, sell
// all, relisting): an item is locked while its auction is live, or ended with
// a winner while settlement is still pending — until then the item still
// belongs to the seller and the winner's tokens sit in escrow. A settled sale
// no longer blocks anything: ownership has moved to the winner, whose future
// listings reference the same inventory row without touching history.
const RESALE_LOCK_SQL = `(status = 'active' OR (status = 'ended' AND winner_id IS NOT NULL AND settled_at IS NULL))`;

export function inventoryIsLocked(db, inventoryId) {
  return Boolean(db.prepare(`SELECT 1 FROM resale_auctions WHERE inventory_id = ? AND ${RESALE_LOCK_SQL}`)
    .get(String(inventoryId)));
}

export function lockedInventoryIds(db) {
  return new Set(db.prepare(`SELECT inventory_id AS id FROM resale_auctions WHERE ${RESALE_LOCK_SQL}`)
    .all().map(row => row.id));
}

// Deterministic lazy close: the highest bid wins; the escrow stays held by the
// auction row until settlement. Kept separate from settlement so a future
// scheduler can close and settle as distinct (or combined) steps.
function closeDueListings(db, now) {
  db.prepare(`UPDATE resale_auctions SET status = 'ended', winner_id = current_bidder_id, closed_at = ?
    WHERE status = 'active' AND ends_at <= ?`).run(now, now);
}

function serializeListing(db, row, { bids = false, now = Date.now(), indexes = marketIndexes(db, now) } = {}) {
  const item = JSON.parse(db.prepare('SELECT item FROM inventory WHERE id = ?').get(row.inventory_id).item);
  const seller = db.prepare('SELECT username FROM users WHERE id = ?').get(row.seller_id);
  const bidCount = db.prepare('SELECT COUNT(*) AS count FROM resale_bids WHERE auction_id = ?').get(row.id).count;
  return {
    id: row.id, sellerId: row.seller_id, sellerUsername: seller?.username || null,
    inventoryId: row.inventory_id,
    item: { title: item.title, image: item.image || null, price: item.price,
      rarity: item.rarity, marketCategory: marketCategoryForItem(item) },
    estimatedValueTokens: estimatedValueTokens(item, indexes),
    currentBidderId: row.current_bidder_id,
    startPrice: row.start_price, currentBid: row.current_bid, bidCount,
    status: row.status, startedAt: row.started_at, endsAt: row.ends_at,
    winnerId: row.winner_id || null, closedAt: row.closed_at || null,
    settledAt: row.settled_at || null,
    ...(bids ? { bids: db.prepare(`SELECT b.id, b.amount, b.created_at AS createdAt, u.id AS bidderId, u.username AS bidderUsername
      FROM resale_bids b JOIN users u ON u.id = b.bidder_id WHERE b.auction_id = ?
      ORDER BY b.amount DESC, b.created_at ASC, b.id ASC`).all(row.id) } : {})
  };
}

function loadListing(db, auctionId, now) {
  closeDueListings(db, now);
  const row = db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(String(auctionId));
  if (!row) fail('auction_not_found', 404);
  return row;
}

export function listItem(dataDir, user, { inventoryId, startPrice, endsAt }, { now = Date.now() } = {}) {
  if (typeof inventoryId !== 'string' || !inventoryId) fail('invalid_listing');
  if (!Number.isSafeInteger(startPrice) || startPrice < 1) fail('invalid_listing');
  const end = Date.parse(endsAt ?? '');
  if (!Number.isFinite(end) || end < now + MIN_LISTING_MS || end > now + MAX_LISTING_MS) fail('invalid_listing');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now);
    closeDueListings(db, now);
    const seller = db.prepare('SELECT npc, banned FROM users WHERE id = ?').get(user.id);
    if (!seller) fail('login_required', 401);
    if (seller.npc || seller.banned) fail('forbidden', 403);
    if (db.prepare("SELECT COUNT(*) AS count FROM resale_auctions WHERE seller_id = ? AND status = 'active'").get(user.id).count >= 5) fail('listing_limit', 409);
    const row = db.prepare('SELECT id, sold_at FROM inventory WHERE id = ? AND user_id = ?').get(inventoryId, user.id);
    if (!row) fail('item_not_found', 404);
    if (row.sold_at !== null) fail('item_sold', 409);
    if (inventoryIsLocked(db, inventoryId)) fail('item_listed', 409);
    const id = randomUUID();
    db.prepare(`INSERT INTO resale_auctions
      (id, seller_id, inventory_id, start_price, current_bid, current_bidder_id, status, started_at, ends_at)
      VALUES (?, ?, ?, ?, NULL, NULL, 'active', ?, ?)`).run(id, user.id, inventoryId, startPrice, now, end);
    return serializeListing(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(id), { bids: true, now });
  }));
}

export function cancelListing(dataDir, user, auctionId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now);
    const row = loadListing(db, auctionId, now);
    if (row.seller_id !== user.id) fail('auction_not_found', 404);
    if (row.status !== 'active') fail('auction_ended', 409);
    if (db.prepare('SELECT 1 FROM resale_bids WHERE auction_id = ?').get(row.id)) fail('auction_has_bids', 409);
    db.prepare(`UPDATE resale_auctions SET status = 'cancelled', closed_at = ? WHERE id = ?`).run(now, row.id);
    return serializeListing(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(row.id), { bids: true, now });
  }));
}

export function placeBid(dataDir, user, auctionId, amount, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(amount) || amount < 1) fail('invalid_bid');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now);
    const row = loadListing(db, auctionId, now);
    if (row.status !== 'active') fail('auction_ended', 409);
    if (row.seller_id === user.id) fail('own_auction', 409);
    const minimum = row.current_bid === null ? row.start_price : row.current_bid + 1;
    if (amount < minimum) fail('bid_too_low', 409);
    const bidder = db.prepare('SELECT npc FROM users WHERE id = ? AND banned = 0').get(user.id);
    if (!bidder) fail('login_required', 401);
    // Persistent timing guard, inside the economic write lock. Replaying a
    // runtime tick (or running two processes) cannot cause a bidding burst.
    if (bidder.npc && db.prepare(`SELECT 1 FROM resale_bids b JOIN users u ON u.id = b.bidder_id
      WHERE b.auction_id = ? AND u.npc = 1 AND b.created_at > ? LIMIT 1`).get(row.id, now - 30_000)) {
      fail('npc_bid_wait', 409);
    }
    // Escrow at bid time. The conditional UPDATE is the debit itself, so an
    // insufficient balance fails atomically without touching anything else.
    // Raising your own bid reserves only the difference; a different bidder
    // reserves the full amount and releases the previous holder's escrow in
    // the same transaction — a rejected bid can never leave tokens moved,
    // bids recorded, or the current bidder changed.
    const raise = row.current_bidder_id === user.id;
    const charge = raise ? amount - row.current_bid : amount;
    if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?')
      .run(charge, user.id, charge).changes) fail('insufficient_tokens', 409);
    if (!raise && row.current_bidder_id !== null) {
      const previous = db.prepare('SELECT tokens FROM users WHERE id = ?').get(row.current_bidder_id);
      if (!Number.isSafeInteger(previous.tokens + row.current_bid)) fail('token_balance_limit', 409);
      db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(row.current_bid, row.current_bidder_id);
    }
    db.prepare('INSERT INTO resale_bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(row.id, user.id, amount, now);
    db.prepare('UPDATE resale_auctions SET current_bid = ?, current_bidder_id = ? WHERE id = ?')
      .run(amount, user.id, row.id);
    return serializeListing(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(row.id), { bids: true, now });
  }));
}

// Settle one ended auction row inside the caller's transaction. Every check
// runs before any write, so a failure rolls back with nothing half-settled.
// Idempotent: an already-settled row returns unchanged and writes nothing.
function settleListingRow(db, row, now) {
  if (row.settled_at !== null) return row;
  if (row.status !== 'ended') fail('auction_still_active', 409);
  if (row.winner_id === null) {
    // Expired without bids: nothing was ever escrowed and the seller keeps
    // the item. Only the settlement bookkeeping is recorded so the listing
    // reaches its terminal state exactly once.
    if (!db.prepare(`UPDATE resale_auctions SET settled_at = ? WHERE id = ? AND settled_at IS NULL`)
      .run(now, row.id).changes) fail('settlement_conflict', 409);
    return db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(row.id);
  }
  // The winner must be the escrow holder of a positive winning amount.
  if (row.current_bidder_id !== row.winner_id || !Number.isSafeInteger(row.current_bid)
    || row.current_bid < 1 || row.winner_id === row.seller_id) fail('escrow_inconsistent', 500);
  const item = db.prepare('SELECT user_id, sold_at FROM inventory WHERE id = ?').get(row.inventory_id);
  if (!item || item.user_id !== row.seller_id || item.sold_at !== null) fail('settlement_conflict', 409);
  const seller = db.prepare('SELECT tokens FROM users WHERE id = ?').get(row.seller_id);
  if (!seller || !Number.isSafeInteger(seller.tokens + row.current_bid)) fail('token_balance_limit', 409);
  // Transfer the existing inventory row — never insert or mint a copy — and
  // release the escrow (paid by the winner at bid time) to the seller.
  db.prepare('UPDATE inventory SET user_id = ? WHERE id = ?').run(row.winner_id, row.inventory_id);
  db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(row.current_bid, row.seller_id);
  awardXp(db, row.seller_id, 'resale', row.id, resaleXp(row.current_bid), now);
  // The guarded UPDATE plus the surrounding transaction is the database-level
  // idempotency guarantee: a second settlement can never pay or transfer again.
  if (!db.prepare(`UPDATE resale_auctions SET settled_at = ? WHERE id = ? AND settled_at IS NULL`)
    .run(now, row.id).changes) fail('settlement_conflict', 409);
  return db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(row.id);
}

// Close (if due) and settle a single auction. Safe to invoke any number of
// times: repeat calls return the settled state unchanged — no second payout,
// transfer, or winner-balance change. This and settleDueListings are the
// explicit entry points for a future scheduler.
export function settleAuction(dataDir, auctionId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now);
    closeDueListings(db, now);
    const row = db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(String(auctionId));
    if (!row) fail('auction_not_found', 404);
    // Cancelled auctions are terminal and hold no escrow; nothing to settle.
    if (row.status === 'cancelled') return serializeListing(db, row, { bids: true, now });
    return serializeListing(db, settleListingRow(db, row, now), { bids: true, now });
  }));
}

// Close and settle every due auction, each in its own transaction so one
// corrupted listing can neither block nor partially corrupt the others.
// Failures are reported, not thrown: the affected listing stays ended but
// unsettled — and therefore locked — until its state is inspected and fixed;
// it can never silently destroy tokens. Reads trigger this lazily; a future
// scheduler can call it on a cadence.
export function settleDueListings(dataDir, { now = Date.now(), limit = 100 } = {}) {
  return withDatabase(dataDir, db => {
    ensureResaleSchema(db, now);
    closeDueListings(db, now);
    const due = db.prepare(`SELECT id FROM resale_auctions WHERE status = 'ended' AND settled_at IS NULL
      ORDER BY closed_at, ends_at LIMIT ?`).all(Math.max(1, Math.min(1000, Math.floor(limit) || 100)));
    let settled = 0;
    const failed = [];
    for (const { id } of due) {
      try {
        transaction(db, () => settleListingRow(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(id), now));
        settled++;
      } catch (error) {
        if (!(error instanceof AccountError)) throw error;
        failed.push(id);
      }
    }
    return { settled, failed };
  });
}

export function getResale(dataDir, auctionId, { now = Date.now() } = {}) {
  settleDueListings(dataDir, { now });
  return withDatabase(dataDir, db => {
    ensureResaleSchema(db, now);
    return serializeListing(db, loadListing(db, auctionId, now), { bids: true, now });
  });
}

export function listResales(dataDir, { now = Date.now(), limit = 50, offset = 0, sellerId = null, status = 'active' } = {}) {
  settleDueListings(dataDir, { now });
  return withDatabase(dataDir, db => {
    ensureResaleSchema(db, now);
    const conditions = [];
    if (status) conditions.push('r.status = ?');
    if (sellerId !== null) conditions.push('r.seller_id = ?');
    const params = [...(status ? [status] : []), ...(sellerId !== null ? [sellerId] : []),
      Math.max(1, Math.min(200, Math.floor(limit) || 50)), Math.max(0, Math.floor(offset) || 0)];
    const indexes = marketIndexes(db, now);
    return db.prepare(`SELECT r.* FROM resale_auctions r
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY (r.status = 'active') DESC, r.ends_at DESC, r.id LIMIT ? OFFSET ?`).all(...params)
      .map(row => serializeListing(db, row, { now, indexes }));
  });
}

export function listingsByUser(dataDir, userId, { now = Date.now(), limit = 100 } = {}) {
  return listResales(dataDir, { now, limit, sellerId: userId, status: null });
}
