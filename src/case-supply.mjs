import { createHash } from 'node:crypto';
import { loadCaseCatalog } from './cases.mjs';
import { transaction, withDatabase } from './database.mjs';
import { ensureResaleSchema } from './resale.mjs';
import { chooseCaseTier, ensureSealedCaseSchema, insertSealedCase, prepareSealedCase } from './sealed-cases.mjs';

export const CASE_SUPPLY_PERIOD_MS = 4 * 3_600_000;
export const CASE_SUPPLY_DURATION_MS = 2 * 3_600_000;
export const CASE_SUPPLIER_ID = 'npc-case-supply';

const unit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;

// A deterministic four-hour window offers a case about half the time. A
// window creates at most one mixed-category case and ends on its own schedule.
export function supplyCaseAuctions(dataDir, { now = Date.now() } = {}) {
  const bucket = Math.floor(now / CASE_SUPPLY_PERIOD_MS);
  const startsAt = bucket * CASE_SUPPLY_PERIOD_MS;
  const endsAt = startsAt + CASE_SUPPLY_DURATION_MS;
  if (now >= endsAt || unit(`case-drop:${bucket}`) >= .6) return { supplied: 0 };
  const catalog = loadCaseCatalog(dataDir, now);
  if (!catalog.cases.find(box => box.id === 'fundkiste')?.available) return { supplied: 0 };
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureResaleSchema(db, now); ensureSealedCaseSchema(db);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, npc, tokens, created_at)
      VALUES (?, 'Case Supply', 'disabled', 1, 0, ?)`).run(CASE_SUPPLIER_ID, now);
    const id = `npc-case:${bucket}`;
    if (db.prepare('SELECT 1 FROM resale_auctions WHERE id = ?').get(id)) return { supplied: 0 };
    const tier = chooseCaseTier([4500, 3000, 1600, 800, 100], max => Math.floor(unit(`case-tier:${bucket}`) * max));
    const prepared = prepareSealedCase(catalog, tier, { now });
    insertSealedCase(db, CASE_SUPPLIER_ID, prepared, now);
    const reserve = Math.max(1, Math.round(prepared.item.price * .85));
    db.prepare(`INSERT INTO resale_auctions
      (id, seller_id, inventory_id, start_price, status, started_at, ends_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(id, CASE_SUPPLIER_ID, prepared.item.id, reserve, startsAt, endsAt);
    db.prepare('INSERT INTO resale_auction_items (auction_id, inventory_id, position) VALUES (?, ?, 0)')
      .run(id, prepared.item.id);
    return { supplied: 1, id };
  }));
}
