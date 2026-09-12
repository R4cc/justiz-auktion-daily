import { randomInt, createHash } from 'node:crypto';
import { auctionGallery } from './auction-images.mjs';
import { buildAuctionFamilies } from './auction-selection.mjs';

export const RARITIES = [
  { id: 'common', name: 'Gewöhnlich', sell: 10 },
  { id: 'uncommon', name: 'Ungewöhnlich', sell: 100 },
  { id: 'rare', name: 'Selten', sell: 250 },
  { id: 'epic', name: 'Episch', sell: 750 },
  { id: 'legendary', name: 'Legendär', sell: 2500 }
];
export const CASES = [
  { id: 'fundkiste', name: 'Seized Goods Case', cost: 100, weights: [5000, 3000, 1400, 550, 50] },
  { id: 'schatzkiste', name: 'Contraband Case', cost: 250, weights: [3500, 1500, 3000, 1950, 50] }
];

// A transparent heuristic: 80% logarithmic price, 20% uniqueness among similar lots.
export function itemRarity(price, familySize) {
  const score = .8 * Math.min(1, Math.log10(Math.max(0, price) + 1) / 5) + .2 / Math.sqrt(familySize);
  return RARITIES[[.32, .46, .60, .78].filter(threshold => score >= threshold).length];
}

export function caseCatalog(auctions) {
  const eligible = auctions.filter(item => item.title && auctionGallery(item).length &&
    Number.isFinite(item.finalPrice ?? item.currentBid) && (item.finalPrice ?? item.currentBid) > 0);
  const items = buildAuctionFamilies(eligible).map(family => {
    const auction = family[0];
    const price = auction.finalPrice ?? auction.currentBid;
    const rarity = itemRarity(price, family.length);
    return { auctionId: auction.id, title: auction.title, image: auctionGallery(auction)[0],
      price, rarity: rarity.id, sellValue: rarity.sell, familySize: family.length };
  });
  const revision = createHash('sha256').update(JSON.stringify({ items, cases: CASES })).digest('hex');
  return { revision, items, rarities: RARITIES, cases: CASES.map(box => {
    const weights = box.weights.map((weight, i) => items.some(item => item.rarity === RARITIES[i].id) ? weight : 0);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return { ...box, weights, odds: weights.map((weight, i) => ({ ...RARITIES[i], chance: total ? weight / total * 100 : 0 })) };
  }) };
}

export function publicCaseCatalog(catalog) {
  return { revision: catalog.revision, items: catalog.items, rarities: catalog.rarities,
    cases: catalog.cases.map(({ id, name, cost, weights }) => ({ id, name, cost, available: weights.some(Boolean) })) };
}

export function drawItem(catalog, box, random = randomInt) {
  const total = box.weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) throw new Error('empty_catalog');
  let roll = random(total), index = 0;
  while (roll >= box.weights[index]) roll -= box.weights[index++];
  const pool = catalog.items.filter(item => item.rarity === RARITIES[index].id);
  return pool[random(pool.length)];
}
