import { randomUUID } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { transaction, withDatabase } from './database.mjs';
import { marketCategoryForItem } from './market.mjs';

// Player resale auctions: eBay-like listings of single inventory items.
//
// Ownership rules enforced here and in accounts.mjs:
//  - A listing always references the original inventory row; the item is never
//    copied or minted, and it stays owned by the seller until a future
//    settlement step transfers it (see docs/auction-economy-foundation.md).
//  - While a listing is active the item cannot be sold (accounts.sell/sellAll
//    refuse with 'item_listed'), so an item can never exist twice.
//  - A partial unique index guarantees at most one active listing per item.
//
// Deliberately NOT implemented yet: token escrow, NPC bidders, fees, automatic
// scheduling/closing timers, settlement (item transfer + payout). Listings
// expire lazily: reads and bids close due auctions deterministically.
export const RESALE_STATUSES = ['active', 'ended', 'cancelled'];
export const MIN_LISTING_MS = 60_000;
export const MAX_LISTING_MS = 30 * 86_400_000;
const fail = (code, status) => { throw new AccountError(code, status); };

export function ensureResaleSchema(db) {
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
    closed_at INTEGER
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
}

// Deterministic lazy close: the highest bid wins; nothing is paid or moved yet.
function closeDueListings(db, now) {
  db.prepare(`UPDATE resale_auctions SET status = 'ended', winner_id = current_bidder_id, closed_at = ?
    WHERE status = 'active' AND ends_at <= ?`).run(now, now);
}

function serializeListing(db, row, { bids = false } = {}) {
  const item = JSON.parse(db.prepare('SELECT item FROM inventory WHERE id = ?').get(row.inventory_id).item);
  const seller = db.prepare('SELECT username FROM users WHERE id = ?').get(row.seller_id);
  const bidCount = db.prepare('SELECT COUNT(*) AS count FROM resale_bids WHERE auction_id = ?').get(row.id).count;
  return {
    id: row.id, sellerId: row.seller_id, sellerUsername: seller?.username || null,
    inventoryId: row.inventory_id,
    item: { title: item.title, image: item.image || null, price: item.price,
      rarity: item.rarity, marketCategory: marketCategoryForItem(item) },
    startPrice: row.start_price, currentBid: row.current_bid, bidCount,
    status: row.status, startedAt: row.started_at, endsAt: row.ends_at,
    winnerId: row.winner_id || null, closedAt: row.closed_at || null,
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
    ensureResaleSchema(db);
    closeDueListings(db, now);
    const row = db.prepare('SELECT id, sold_at FROM inventory WHERE id = ? AND user_id = ?').get(inventoryId, user.id);
    if (!row) fail('item_not_found', 404);
    if (row.sold_at !== null) fail('item_sold', 409);
    const blocking = db.prepare(`SELECT status FROM resale_auctions WHERE inventory_id = ?
      AND (status = 'active' OR (status = 'ended' AND winner_id IS NOT NULL))`).get(inventoryId);
    if (blocking) fail('item_listed', 409);
    const id = randomUUID();
    db.prepare(`INSERT INTO resale_auctions
      (id, seller_id, inventory_id, start_price, current_bid, current_bidder_id, status, started_at, ends_at)
      VALUES (?, ?, ?, ?, NULL, NULL, 'active', ?, ?)`).run(id, user.id, inventoryId, startPrice, now, end);
    return serializeListing(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(id), { bids: true });
  }));
}

export function cancelListing(dataDir, user, auctionId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db);
    const row = loadListing(db, auctionId, now);
    if (row.seller_id !== user.id) fail('auction_not_found', 404);
    if (row.status !== 'active') fail('auction_ended', 409);
    if (db.prepare('SELECT 1 FROM resale_bids WHERE auction_id = ?').get(row.id)) fail('auction_has_bids', 409);
    db.prepare(`UPDATE resale_auctions SET status = 'cancelled', closed_at = ? WHERE id = ?`).run(now, row.id);
    return serializeListing(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(row.id), { bids: true });
  }));
}

export function placeBid(dataDir, user, auctionId, amount, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(amount) || amount < 1) fail('invalid_bid');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db);
    const row = loadListing(db, auctionId, now);
    if (row.status !== 'active') fail('auction_ended', 409);
    if (row.seller_id === user.id) fail('own_auction', 409);
    const minimum = row.current_bid === null ? row.start_price : row.current_bid + 1;
    if (amount < minimum) fail('bid_too_low', 409);
    // Advisory only: tokens are not escrowed yet (a deliberate gap for the
    // economy implementation to design). The check just rejects nonsense bids.
    const balance = db.prepare('SELECT tokens FROM users WHERE id = ?').get(user.id)?.tokens;
    if (balance === undefined) fail('login_required', 401);
    if (balance < amount) fail('insufficient_tokens', 409);
    db.prepare('INSERT INTO resale_bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(row.id, user.id, amount, now);
    db.prepare('UPDATE resale_auctions SET current_bid = ?, current_bidder_id = ? WHERE id = ?')
      .run(amount, user.id, row.id);
    return serializeListing(db, db.prepare('SELECT * FROM resale_auctions WHERE id = ?').get(row.id), { bids: true });
  }));
}

export function getResale(dataDir, auctionId, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => {
    ensureResaleSchema(db);
    return serializeListing(db, loadListing(db, auctionId, now), { bids: true });
  });
}

export function listResales(dataDir, { now = Date.now(), limit = 50, offset = 0, sellerId = null, status = 'active' } = {}) {
  return withDatabase(dataDir, db => {
    ensureResaleSchema(db);
    closeDueListings(db, now);
    const conditions = [];
    if (status) conditions.push('r.status = ?');
    if (sellerId !== null) conditions.push('r.seller_id = ?');
    const params = [...(status ? [status] : []), ...(sellerId !== null ? [sellerId] : []),
      Math.max(1, Math.min(200, Math.floor(limit) || 50)), Math.max(0, Math.floor(offset) || 0)];
    return db.prepare(`SELECT r.* FROM resale_auctions r
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY r.ends_at ASC, r.id LIMIT ? OFFSET ?`).all(...params)
      .map(row => serializeListing(db, row));
  });
}

export function listingsByUser(dataDir, userId, { now = Date.now(), limit = 100 } = {}) {
  return listResales(dataDir, { now, limit, sellerId: userId, status: null });
}
