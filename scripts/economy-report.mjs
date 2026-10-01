import { readFileSync } from 'node:fs';
import { caseCatalog, priceCaseCatalog, CASE_WEIGHTS, dailyCaseWeights, drawItem, dailyRewardCatalog } from '../src/cases.mjs';
import { CASE_TIERS } from '../src/sealed-cases.mjs';
import { ECONOMY_BALANCE as balance, expectedItemValue } from '../src/economy-balance.mjs';
import { estimatedValueTokens } from '../src/market.mjs';
import { bundleReferencePricing } from '../src/palette-definitions.mjs';
import { NPC_BUYERS, npcValuation, paletteBidCeiling } from '../src/npc-buyers.mjs';
import { businessItemSaleChance, SHOP_TYPES } from '../src/businesses.mjs';

// Read-only, reproducible balance audit. Pass a JSON archive to use its stock,
// or --stress for a wide synthetic archive with expensive tail items.
const input = process.argv[2] || 'seed/auctions.json';
const syntheticThemes = [
  ['BMW PKW', 'Fahrzeuge', 500], ['Riesling Wein', 'Getränke', 10],
  ['Laptop Lenovo', 'Elektronik', 50], ['Bohrhammer Makita', 'Werkzeuge', 25],
  ['Gold Armbanduhr', 'Schmuck & Uhren', 100], ['Lego Modell', 'Sammlerstücke', 20]
];
const archive = input === '--stress' ? syntheticThemes.flatMap(([title, category, base], t) =>
  Array.from({ length: 60 }, (_, n) => ({ id: 1000 + t * 100 + n, title: `${title} ${1000 + t * 100 + n}`,
    category, finalPrice: Math.round(base * (n + 1) ** 1.35), image: '/assets/synthetic.jpg' })))
  : JSON.parse(readFileSync(input, 'utf8')).auctions;
const start = Date.parse('2026-10-01T12:00:00Z');
const average = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
const percent = n => `${(100 * n).toFixed(1)}%`;
let state = 123456789;
const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 2 ** 32 * max); };

console.log(`# Economy balance audit\n\nSource: ${input}; ${archive.length} lots; 30 UTC rotations from 2026-10-01. `
  + 'Expected values are exact; palette outcomes use 2,000 seeded three-item openings per offer and market regime. '
  + 'These are reference-value scenarios, not live player telemetry.\n');
console.log('| Market index | Offers examined | Paid case reference return | Palette reserve / live EV | Palette profit chance at reserve | Palette median return at reserve |\n|---|---:|---:|---:|---:|---:|');
for (const index of [50, 100, 150]) {
  const paidReturns = [], reserves = [], profits = [], returns = [];
  for (let day = 0; day < 30; day++) {
    const catalog = caseCatalog(archive, start + day * 86400000);
    const indexes = Object.fromEntries(['electronics', 'vehicles', 'wine', 'tools', 'watches_jewelry', 'collectibles', 'other'].map(id => [id, index]));
    for (const box of priceCaseCatalog(catalog, indexes).cases.filter(box => box.available)) {
      paidReturns.push(expectedItemValue(box.items, box.weights, item => estimatedValueTokens(item, indexes)) / box.cost);
      const pricing = bundleReferencePricing(box.items, () => index);
      if (!pricing.spreadOk) continue;
      reserves.push(pricing.referenceReserve / pricing.et);
      let profitable = 0;
      const outcomes = [];
      for (let n = 0; n < 2000; n++) {
        let value = 0;
        for (let draw = 0; draw < 3; draw++) value += estimatedValueTokens(drawItem(catalog, box, random), indexes);
        outcomes.push(value / pricing.referenceReserve);
        if (value > pricing.referenceReserve) profitable++;
      }
      outcomes.sort((a, b) => a - b);
      profits.push(profitable / 2000); returns.push(outcomes[1000]);
    }
  }
  console.log(`| ${index} | ${paidReturns.length} | ${percent(average(paidReturns))} | ${percent(average(reserves))} | ${percent(average(profits))} | ${percent(average(returns))} |`);
}
const pool = dailyRewardCatalog(caseCatalog(archive, start), [], start).cases.find(box => box.id === 'fundkiste');
if (pool?.available) {
  console.log('\n| Daily score | Currency | Free case expected reference value | Legendary item probability (both draws combined) |\n|---:|---:|---:|---:|');
  for (const score of [0, 2500, 5000]) {
    const weights = dailyCaseWeights(score);
    const value = weights.reduce((sum, weight, n) => sum + weight / 10000 * expectedItemValue(pool.items, CASE_TIERS[n].weights), 0);
    const jackpot = weights.reduce((sum, weight, n) => sum + weight / 10000 * CASE_TIERS[n].weights[4] / 10000, 0);
    console.log(`| ${score} | ${balance.daily + Math.round(balance.dailyScoreBonus * score / 5000)} | ${value.toFixed(1)} | ${(jackpot * 100).toFixed(4)}% |`);
  }
}
console.log('\n| Market index | Ordinary NPC resale ceilings / live value | Collector ceiling / live value | Average interested share | Palette NPC ceilings / live EV |\n|---|---:|---:|---:|---:|');
const example = { price: 10000, marketCategory: 'electronics' };
const items = ['common', 'uncommon', 'rare', 'epic', 'legendary'].map((rarity, n) => ({ ...example, rarity, price: [10, 20, 50, 100, 1000][n] }));
for (const index of [50, 100, 150]) {
  const regular = [], collectors = [], shares = [], ceilings = [];
  const snapshot = { items, rewardCount: 3, allowedMarketCategories: ['electronics'] };
  const ev = expectedItemValue(items, CASE_WEIGHTS) * 3 * index / 100;
  for (const npc of NPC_BUYERS) {
    const value = npcValuation(example, { electronics: index }, npc, 'audit-lot');
    (npc.collector && npc.categories.includes('electronics') ? collectors : regular).push(value.maxBid / (example.price * index / 100));
    shares.push(value.probability);
    ceilings.push(paletteBidCeiling(snapshot, { electronics: index }, npc, 'audit-lot').maxBid / ev);
  }
  console.log(`| ${index} | ${percent(Math.min(...regular))}–${percent(Math.max(...regular))} | ${percent(Math.max(...collectors))} | ${percent(average(shares))} | ${percent(Math.min(...ceilings))}–${percent(Math.max(...ceilings))} |`);
}
console.log('\n| Store margin | Typical wine buying chance / visitor | Gross profit / unit at 85% wholesale cost | Expected profit / visitor (reference units) |\n|---:|---:|---:|---:|');
const wine = SHOP_TYPES.find(type => type.id === 'wine');
for (const margin of [0, 20, 30, 60, 100]) {
  const chance = businessItemSaleChance(wine, margin, wine.typicalValue);
  const profit = 1 + margin / 100 - balance.wholesaleReserveRate;
  console.log(`| ${margin}% | ${percent(chance)} | ${percent(profit)} | ${(chance * profit).toFixed(3)} |`);
}
console.log('\nCurrency flow: starting grant J€1,000; Daily J€200–350 plus one case; Higher or Lower best-streak top-ups capped at J€250 per UTC day. '
  + 'Paid cases and primary palette payments remove currency. Wholesale purchases remove player currency; '
  + 'NPC resale and store customers return currency only while consuming inventory. Player resale transfers currency and existing items. '
  + 'All supply schedules and escrow settlement remain bounded and idempotent.\n');
