import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { caseCatalog, loadCaseCatalog, RARITIES } from './cases.mjs';
import { ECONOMY_BALANCE, expectedItemValue } from './economy-balance.mjs';
import { estimatedValueTokens } from './market.mjs';
import { ensureCaseStockSchema } from './case-stock.mjs';

// Every store case can draw every rarity. Moving up the price ladder shifts
// probability toward rarer finds, rather than guaranteeing a minimum tier.
export const STORE_CASES = [
  { id: 'lost-property', name: 'Lost Property Case', nameDe: 'Fundbüro-Kiste', badge: 'LP',
    weights: [7500, 2000, 450, 49, 1] },
  { id: 'evidence-locker', name: 'Evidence Locker Case', nameDe: 'Asservaten-Kiste', badge: 'EL',
    weights: [5500, 3000, 1200, 280, 20] },
  { id: 'seizure', name: 'Seized Treasure Case', nameDe: 'Schatzfund-Kiste', badge: 'ST',
    weights: [3500, 3200, 2500, 700, 100] },
  { id: 'vault', name: 'Vault Case', nameDe: 'Tresor-Kiste', badge: 'VT',
    weights: [1800, 2700, 3500, 1700, 300] },
  { id: 'collectors-cache', name: "Collector's Cache", nameDe: 'Sammlertruhe', badge: 'CC',
    weights: [800, 1700, 3500, 3000, 1000] }
];

const starterArchive = JSON.parse(readFileSync(new URL('../seed/auctions.json', import.meta.url), 'utf8')).auctions;

// Reuse the frozen mixed edition. A thin archive uses a deterministic starter
// edition so every case remains purchasable, including after a fresh install.
export function loadCaseStoreCatalog(dataDir, now = Date.now()) {
  const catalog = loadCaseCatalog(dataDir, now);
  const mixed = catalog.cases.find(box => box.id === 'fundkiste');
  return mixed?.available && RARITIES.every(rarity => mixed.items.some(item => item.rarity === rarity.id))
    ? catalog : caseCatalog(starterArchive, now);
}

export function quoteCaseStore(catalog, indexes = {}) {
  const items = catalog.cases.find(box => box.id === 'fundkiste').items;
  let previousCost = 0;
  const cases = STORE_CASES.map(box => {
    const base = expectedItemValue(items, box.weights);
    const live = expectedItemValue(items, box.weights, item => estimatedValueTokens(item, indexes));
    // Even tiny or equal-valued pools retain a strictly increasing price ladder.
    const cost = Math.max(previousCost + 1, Math.ceil(Math.max(base, live) / ECONOMY_BALANCE.paidCaseReturn));
    previousCost = cost;
    const total = box.weights.reduce((sum, weight) => sum + weight, 0);
    return { id: box.id, name: box.name, nameDe: box.nameDe, badge: box.badge, cost, items,
      dropChances: RARITIES.map((rarity, index) => ({ rarity: rarity.id, percent: box.weights[index] / (total / 100) })) };
  });
  const revision = createHash('sha256').update(JSON.stringify({ version: 2, pool: catalog.revision,
    definitions: STORE_CASES, costs: cases.map(box => box.cost) })).digest('hex');
  return { revision, rotationDate: catalog.rotationDate, rotatesAt: catalog.rotatesAt, cases };
}

// The legacy column name 'tier' stores the purchased case id; retain it so
// old receipts stay readable and idempotent through the store redesign.
export function ensureCaseStoreSchema(db) {
  ensureCaseStockSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS case_purchases (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    tier TEXT NOT NULL, item TEXT NOT NULL CHECK(json_valid(item)),
    PRIMARY KEY(user_id, request_id)
  ) STRICT`);
}
