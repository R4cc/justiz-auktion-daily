import { createHash } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { estimatedValueTokens, marketCategoryForItem, marketIndexes } from './market.mjs';
import { ensureResaleSchema, placeBid } from './resale.mjs';
import { AccountError } from './errors.mjs';
export { NPC_BUYERS, SPECIAL_NPC_BUYERS } from './npc-roster.mjs';
import { NPC_BUYERS } from './npc-roster.mjs';

export const NPC_BALANCE = 1_000_000_000;
export const NPC_COHORT_SIZE = 16;

export const deterministicUnit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;

export function npcCohort(auctionId, size = NPC_COHORT_SIZE) {
  return NPC_BUYERS.map(npc => ({ npc, score: deterministicUnit(`${auctionId}:${npc.id}:cohort`) }))
    .sort((a, b) => a.score - b.score || a.npc.id.localeCompare(b.npc.id))
    .slice(0, Math.max(1, Math.min(NPC_BUYERS.length, Math.floor(size) || NPC_COHORT_SIZE)))
    .map(entry => entry.npc);
}

export function ensureNpcSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS resale_npc_interest (
    auction_id TEXT NOT NULL REFERENCES resale_auctions(id), npc_id TEXT NOT NULL REFERENCES users(id),
    max_bid INTEGER NOT NULL, next_bid_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    last_bid_at INTEGER, active INTEGER NOT NULL, PRIMARY KEY(auction_id, npc_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS resale_npc_due ON resale_npc_interest(active, next_bid_at)`);
}

export function seedNpcBuyers(dataDir, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now); ensureNpcSchema(db);
    // Spaces are outside the human-registration username alphabet, so even
    // before seeding nobody can reserve a registry name. No password can log in.
    const insert = db.prepare(`INSERT OR IGNORE INTO users
      (id, username, password_hash, npc, tokens, created_at) VALUES (?, ?, 'disabled', 1, ?, ?)`);
    const existing = new Set(db.prepare('SELECT id FROM users WHERE npc = 1').all().map(row => row.id));
    for (const npc of NPC_BUYERS) if (!existing.has(npc.id)) insert.run(npc.id, npc.username, NPC_BALANCE, now);
  }));
}

export function npcValuation(item, indexes, npc, auctionId, unit = deterministicUnit) {
  const category = marketCategoryForItem(item), index = indexes[category] ?? 100;
  const preferred = npc.categories.includes(category);
  const variation = (unit(`${auctionId}:${npc.id}:value`) - .5) * .10;
  const cap = npc.collector && preferred ? 1.25 : 1.15;
  const multiplier = Math.max(.70, Math.min(cap, npc.willingness + (preferred ? .08 : -.12) + variation));
  const personality = .62 + npc.aggressiveness * .58 + (npc.collector && preferred ? .12 : 0);
  const probability = Math.max(.05, Math.min(.94, (preferred ? .58 : .18) * personality * (index / 100) ** 3));
  return { maxBid: Math.max(1, Math.round(estimatedValueTokens(item, indexes) * multiplier)),
    interested: unit(`${auctionId}:${npc.id}:interest`) < probability, probability };
}

export function npcBidAmount(interest, npc, now, unit = deterministicUnit) {
  const minimum = interest.current_bid === null ? interest.start_price : interest.current_bid + 1;
  const headroom = interest.max_bid - minimum;
  if (headroom <= 0 || unit(`${interest.auction_id}:${npc.id}:${interest.current_bid}:cheap`) < npc.cheapness) return minimum;
  const pressure = .015 + npc.aggressiveness * .11 + (interest.ends_at - now <= 120_000 ? .05 : 0);
  const maximumJump = Math.max(1, Math.min(headroom, Math.round(interest.max_bid * pressure)));
  const jump = 1 + Math.floor(unit(`${interest.auction_id}:${npc.id}:${interest.current_bid}:jump`) * maximumJump);
  return Math.min(interest.max_bid, minimum + jump);
}

export function tickNpcBuyers(dataDir, { now = Date.now(), unit = deterministicUnit } = {}) {
  seedNpcBuyers(dataDir, { now });
  withDatabase(dataDir, db => transaction(db, () => {
    const indexes = marketIndexes(db, now);
    const auctions = db.prepare(`SELECT a.*, i.item FROM resale_auctions a JOIN inventory i ON i.id = a.inventory_id
      WHERE a.status = 'active' AND a.ends_at > ? AND NOT EXISTS
      (SELECT 1 FROM resale_npc_interest n WHERE n.auction_id = a.id) ORDER BY a.started_at, a.id LIMIT 200`).all(now);
    const insert = db.prepare(`INSERT OR IGNORE INTO resale_npc_interest
      (auction_id, npc_id, max_bid, next_bid_at, created_at, active) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const row of auctions) for (const npc of npcCohort(row.id)) {
      const value = npcValuation(JSON.parse(row.item), indexes, npc, row.id, unit);
      insert.run(row.id, npc.id, value.maxBid, now + npc.delaySeconds * 1000, now, Number(value.interested));
    }
    db.prepare(`UPDATE resale_npc_interest SET active = 0 WHERE active = 1 AND auction_id IN
      (SELECT id FROM resale_auctions WHERE status != 'active' OR ends_at <= ?)`).run(now);
  }));
  const due = withDatabase(dataDir, db => db.prepare(`SELECT n.*, a.current_bid, a.current_bidder_id, a.start_price, a.ends_at
    FROM resale_npc_interest n JOIN resale_auctions a ON a.id = n.auction_id
    WHERE n.active = 1 AND n.next_bid_at <= ? AND a.status = 'active' AND a.ends_at > ?
    ORDER BY n.next_bid_at, n.auction_id, n.npc_id LIMIT 1000`).all(now, now));
  const touched = new Set();
  let bids = 0;
  for (const interest of due) {
    if (touched.has(interest.auction_id)) continue;
    const npc = NPC_BUYERS.find(entry => entry.id === interest.npc_id);
    if (!npc) continue;
    const minimum = interest.current_bid === null ? interest.start_price : interest.current_bid + 1;
    const lastMinuteDelay = Math.round(10_000 + npc.patience * 20_000 + (1 - npc.aggressiveness) * 10_000);
    const delay = interest.ends_at - now <= 120_000 ? lastMinuteDelay : npc.delaySeconds * 1000;
    if (minimum > interest.max_bid) {
      withDatabase(dataDir, db => db.prepare('UPDATE resale_npc_interest SET active = 0 WHERE auction_id = ? AND npc_id = ?')
        .run(interest.auction_id, npc.id));
      continue;
    }
    if (interest.current_bidder_id !== npc.id) {
      try {
        placeBid(dataDir, npc, interest.auction_id, npcBidAmount(interest, npc, now, unit), { now });
        bids++; touched.add(interest.auction_id);
        withDatabase(dataDir, db => db.prepare('UPDATE resale_npc_interest SET last_bid_at = ? WHERE auction_id = ? AND npc_id = ?')
          .run(now, interest.auction_id, npc.id));
      } catch (error) {
        if (!(error instanceof AccountError) || !['bid_too_low', 'auction_ended', 'insufficient_tokens', 'npc_bid_wait'].includes(error.message)) throw error;
        if (error.message === 'npc_bid_wait') touched.add(interest.auction_id);
      }
    }
    withDatabase(dataDir, db => db.prepare('UPDATE resale_npc_interest SET next_bid_at = ? WHERE auction_id = ? AND npc_id = ?')
      .run(now + delay, interest.auction_id, npc.id));
  }
  return { bids };
}
