import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { caseCatalog, loadCaseCatalog, RARITIES } from './cases.mjs';
import { CASE_TIERS } from './sealed-cases.mjs';
import { ECONOMY_BALANCE, expectedItemValue } from './economy-balance.mjs';
import { estimatedValueTokens } from './market.mjs';

const starterArchive = JSON.parse(readFileSync(new URL('../seed/auctions.json', import.meta.url), 'utf8')).auctions;

// Reuse the frozen mixed edition. A thin archive uses a deterministic starter
// edition so every tier remains purchasable, including after a fresh install.
export function loadCaseStoreCatalog(dataDir, now = Date.now()) {
  const catalog = loadCaseCatalog(dataDir, now);
  const mixed = catalog.cases.find(box => box.id === 'fundkiste');
  return mixed?.available && RARITIES.every(rarity => mixed.items.some(item => item.rarity === rarity.id))
    ? catalog : caseCatalog(starterArchive, now);
}

export function quoteCaseStore(catalog, indexes = {}) {
  const items = catalog.cases.find(box => box.id === 'fundkiste').items;
  const cases = CASE_TIERS.map(tier => {
    const base = expectedItemValue(items, tier.weights);
    const live = expectedItemValue(items, tier.weights, item => estimatedValueTokens(item, indexes));
    return { id: tier.id, name: tier.name, nameDe: tier.nameDe,
      cost: Math.max(1, Math.ceil(Math.max(base, live) / ECONOMY_BALANCE.paidCaseReturn)),
      items: items.filter(item => tier.weights[RARITIES.findIndex(rarity => rarity.id === item.rarity)] > 0) };
  });
  const revision = createHash('sha256').update(JSON.stringify({ version: 1, pool: catalog.revision,
    tiers: CASE_TIERS, costs: cases.map(box => box.cost) })).digest('hex');
  return { revision, rotationDate: catalog.rotationDate, rotatesAt: catalog.rotatesAt, cases };
}

export function ensureCaseStoreSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS case_purchases (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    tier TEXT NOT NULL, item TEXT NOT NULL CHECK(json_valid(item)),
    PRIMARY KEY(user_id, request_id)
  ) STRICT`);
}
