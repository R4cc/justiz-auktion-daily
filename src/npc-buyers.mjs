import { createHash } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { estimatedValueTokens, marketCategoryForItem, marketIndexes } from './market.mjs';
import { ensureResaleSchema, placeBid } from './resale.mjs';
import { AccountError } from './errors.mjs';

export const NPC_BALANCE = 1_000_000_000;
export const NPC_BUYERS = [
  ['mira', 'Mira_Fund', ['electronics', 'household'], 1.00, 45],
  ['oskar', 'Oskar_Werk', ['tools', 'bicycles'], .97, 60],
  ['lena', 'Lena_Keller', ['wine'], 1.06, 90],
  ['bruno', 'Bruno_Motor', ['vehicles'], 1.02, 75],
  ['ida', 'Ida_Silber', ['watches_jewelry', 'luxury_goods'], 1.04, 60],
  ['theo', 'Theo_Sammler', ['collectibles', 'books_media'], 1.12, 90],
  ['nora', 'Nora_Atelier', ['fashion', 'cosmetics'], .98, 45],
  ['emil', 'Emil_Garten', ['household', 'tools'], .95, 75],
  ['alma', 'Alma_Sport', ['sport_leisure', 'bicycles'], 1.02, 60],
  ['finn', 'Finn_Flohmarkt', ['other', 'books_media'], .92, 90],
  ['rosa', 'Rosa_Raritaet', ['collectibles', 'wine'], 1.03, 45],
  ['paul', 'Paul_Fundus', ['electronics', 'vehicles'], .96, 75]
].map(([id, username, categories, willingness, delaySeconds]) =>
  ({ id: `npc-${id}`, username, categories, willingness, delaySeconds, collector: id === 'theo' }));

export const deterministicUnit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;

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
    for (const npc of NPC_BUYERS) insert.run(npc.id, npc.username.replaceAll('_', ' '), NPC_BALANCE, now);
  }));
}

export function npcValuation(item, indexes, npc, auctionId, unit = deterministicUnit) {
  const category = marketCategoryForItem(item), index = indexes[category] ?? 100;
  const preferred = npc.categories.includes(category);
  const variation = (unit(`${auctionId}:${npc.id}:value`) - .5) * .10;
  const cap = npc.collector && preferred ? 1.25 : 1.15;
  const multiplier = Math.max(.70, Math.min(cap, npc.willingness + (preferred ? .08 : -.12) + variation));
  const probability = Math.max(.05, Math.min(.92, (preferred ? .64 : .20) * (index / 100) ** 3));
  return { maxBid: Math.max(1, Math.round(estimatedValueTokens(item, indexes) * multiplier)),
    interested: unit(`${auctionId}:${npc.id}:interest`) < probability, probability };
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
    for (const row of auctions) for (const npc of NPC_BUYERS) {
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
    const delay = interest.ends_at - now <= 120_000 ? 30_000 : npc.delaySeconds * 1000;
    if (minimum > interest.max_bid) {
      withDatabase(dataDir, db => db.prepare('UPDATE resale_npc_interest SET active = 0 WHERE auction_id = ? AND npc_id = ?')
        .run(interest.auction_id, npc.id));
      continue;
    }
    if (interest.current_bidder_id !== npc.id) {
      try {
        placeBid(dataDir, npc, interest.auction_id, minimum, { now });
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
