import { caseValuePool, caseOutcomeDistribution } from './case-outcomes.mjs';
import { discountedCaseCost } from './prestige-effects.mjs';
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

export function quoteCaseStore(catalog, indexes = {}, {luckPercent=0,caseDiscountPercent=0,rebates=[]} = {}) {
  const items = catalog.cases.find(box => box.id === 'fundkiste').items;
  let previousCost = 0;
  const cases = STORE_CASES.map(box => {
    const base = expectedItemValue(items, box.weights);
    const live = expectedItemValue(items, box.weights, item => estimatedValueTokens(item, indexes));
    // Even tiny or equal-valued pools retain a strictly increasing price ladder.
    const cost = Math.max(previousCost + 1, Math.ceil(Math.max(base, live) / ECONOMY_BALANCE.paidCaseReturn));
    previousCost = cost;
    const drawItems=caseValuePool(catalog,items,cost,indexes);
    const outcomes=caseOutcomeDistribution(drawItems,box.weights,{basis:cost,indexes,luckPercent});
    const regularCost=discountedCaseCost(cost,caseDiscountPercent);
    const rebate=rebates.filter(rebate=>rebate.caseId==='all'||rebate.caseId===box.id)
      .sort((a,b)=>b.percent-a.percent || b.endsAt-a.endsAt || a.id.localeCompare(b.id))[0] || null;
    const finalCost=rebate?Math.ceil(regularCost*(100-rebate.percent)/100):regularCost;
    return { id: box.id, name: box.name, nameDe: box.nameDe, badge: box.badge, cost:finalCost, regularCost, rebate, valueBasis:cost, items:drawItems,
      dropChances: RARITIES.map(rarity => ({rarity:rarity.id,percent:100*outcomes.filter(outcome=>outcome.item.rarity===rarity.id).reduce((sum,outcome)=>sum+outcome.probability,0)})) };
  });
  const revision = createHash('sha256').update(JSON.stringify({ version: 3, balance:[ECONOMY_BALANCE.caseOpeningReturnTarget,ECONOMY_BALANCE.caseUsualMinimumReturnPercent,ECONOMY_BALANCE.caseLowValueTailPercent], pools:cases.map(box=>box.items), bases:cases.map(box=>box.valueBasis), values:cases.map(box=>box.items.map(item=>estimatedValueTokens(item,indexes))), pool: catalog.revision,
    definitions: STORE_CASES, ...(luckPercent?{luckPercent}:{}), costs: cases.map(box => box.cost), ...(rebates.length?{rebates:cases.map(box=>box.rebate)}:{}) })).digest('hex');
  return { revision, luckPercent, caseDiscountPercent, rotationDate: catalog.rotationDate, rotatesAt: catalog.rotatesAt, cases };
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
