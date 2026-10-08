import { randomInt, randomUUID } from 'node:crypto';
import { RARITIES, drawItem, tokenValue } from './cases.mjs';
import { ECONOMY_BALANCE, expectedItemValue } from './economy-balance.mjs';
import { marketCategoryForItem } from './market.mjs';

export const CASE_TIERS = [
  { id: 'common', name: 'Standard Case', nameDe: 'Standard-Kiste', weights: [7500, 2000, 450, 49, 1] },
  { id: 'uncommon', name: 'Improved Case', nameDe: 'Verbesserte Kiste', weights: [0, 8000, 1750, 245, 5] },
  { id: 'rare', name: 'Rare Case', nameDe: 'Seltene Kiste', weights: [0, 0, 9000, 980, 20] },
  { id: 'epic', name: 'Epic Case', nameDe: 'Epische Kiste', weights: [0, 0, 0, 9950, 50] },
  { id: 'legendary', name: 'Legendary Case', nameDe: 'Legendäre Kiste', weights: [0, 0, 0, 0, 10000] }
];

export function ensureSealedCaseSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sealed_cases (
    inventory_id TEXT PRIMARY KEY REFERENCES inventory(id),
    reward TEXT NOT NULL CHECK(json_valid(reward)),
    opened_at INTEGER
  ) STRICT`);
}

export function chooseCaseTier(weights, random = randomInt) {
  let roll = random(weights.reduce((sum, weight) => sum + weight, 0));
  for (let index = 0; index < weights.length; index++) {
    if (roll < weights[index]) return CASE_TIERS[index].id;
    roll -= weights[index];
  }
  throw new Error('invalid_case_weights');
}

function mixedPool(catalog, fallback) {
  const mixed = catalog?.cases?.find(box => box.id === 'fundkiste');
  if (mixed?.available && RARITIES.every(rarity => mixed.items.some(item => item.rarity === rarity.id)))
    return mixed.items;
  if (!fallback?.length) return [];
  const ranked = [...fallback].sort((a, b) => (a.actualBid ?? a.currentBid ?? a.price ?? 0) - (b.actualBid ?? b.currentBid ?? b.price ?? 0));
  return RARITIES.map((rarity, index) => {
    const auction = ranked[Math.round(index * (ranked.length - 1) / 4)];
    const price = Math.max(1, Number(auction.actualBid ?? auction.currentBid ?? auction.finalPrice ?? auction.price) || 1);
    return { auctionId: auction.id, title: auction.title, image: auction.image || auction.images?.[0] || null,
      price, sellValue: tokenValue(price), rarity: rarity.id, category: auction.category };
  });
}

// Store cases and tiered rewards share the same sealed draw and valuation.
// The winner is private and frozen when the case is created.
export function prepareMysteryCase(catalog, definition, { fallback = [], now = Date.now(), random = randomInt } = {}) {
  const items = mixedPool(catalog, fallback);
  if (!items.length) throw new Error('empty_catalog');
  const winner = drawItem(catalog, { items, weights: definition.weights }, random);
  const price = Math.max(1, Math.round(expectedItemValue(items, definition.weights) * ECONOMY_BALANCE.sealedCaseValueRate));
  return {
    item: { id: randomUUID(), kind: 'case', caseType: definition.id, caseBadge: definition.badge,
      title: definition.name, titleDe: definition.nameDe,
      price, sellValue: price, image: null, createdAt: now },
    reward: { ...winner, id: randomUUID(), caseId: 'sealed', caseCost: 0,
      marketCategory: marketCategoryForItem(winner), edition: catalog?.rotationDate || new Date(now).toISOString().slice(0, 10),
      createdAt: now }
  };
}

// Daily rewards and occasional auction supply retain their existing tiers.
export function prepareSealedCase(catalog, tierId, options = {}) {
  const tier = CASE_TIERS.find(entry => entry.id === tierId);
  if (!tier) throw new Error('invalid_case_tier');
  const prepared = prepareMysteryCase(catalog, tier, options);
  delete prepared.item.caseType;
  delete prepared.item.caseBadge;
  return { ...prepared, item: { ...prepared.item, caseTier: tier.id, rarity: tier.id } };
}

export function insertSealedCase(db, ownerId, prepared, now = Date.now()) {
  ensureSealedCaseSchema(db);
  db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
    .run(prepared.item.id, ownerId, JSON.stringify(prepared.item), now);
  db.prepare('INSERT INTO sealed_cases (inventory_id, reward) VALUES (?, ?)')
    .run(prepared.item.id, JSON.stringify(prepared.reward));
  return prepared.item;
}
