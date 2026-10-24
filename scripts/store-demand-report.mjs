// Analytical demand comparison. No live data, inventory or balances are read.
import { ECONOMY_BALANCE } from '../src/economy-balance.mjs';
import { SHOP_TYPES, businessSaleChance, businessItemSaleChance } from '../src/businesses.mjs';

const previous = (type, value, margin = 20) => businessSaleChance(type.conversion, margin) * Math.min(1, Math.sqrt(type.typicalValue / Math.max(1, value)));
const percent = chance => `${(chance * 100).toFixed(2)}%`;
console.log('# Store demand balance — 24 October 2026\n');
console.log(`Buying chance = min(${percent(ECONOMY_BALANCE.businessMaximumBuyChance)}, base conversion × exp(−3 × (markup − 20) / 100) × sqrt(${ECONOMY_BALANCE.businessDemandReferenceValue} / live item value)).\n`);
console.log('Markup is 20% for these comparisons. Figures are analytical expectations per 100 visitors with continuously available stock; actual visitors, stock capacity, reviews and location still determine realized sales.\n');
console.log('## Typical-value stock by store\n');
console.log('| Store | Item value J€ | Previous buyers | New buyers | Expected units / 100 visitors | Expected gross proceeds / 100 visitors J€ |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const type of SHOP_TYPES) {
  const chance = businessItemSaleChance(type, 20, type.typicalValue);
  console.log(`| ${type.name} | ${type.typicalValue} | ${percent(previous(type, type.typicalValue))} | ${percent(chance)} | ${(chance * 100).toFixed(2)} | ${(chance * 100 * type.typicalValue * 1.2).toFixed(2)} |`);
}
console.log('\n## Same item values across categories\n');
console.log('| Live value J€ | ' + SHOP_TYPES.map(type => type.id).join(' | ') + ' |');
console.log('| ---: | ' + SHOP_TYPES.map(() => '---:').join(' | ') + ' |');
for (const value of [1, 10, 25, 35, 50, 100, 120, 250, 1000, 2500, 10000, 1000000])
  console.log(`| ${value} | ${SHOP_TYPES.map(type => percent(businessItemSaleChance(type, 20, value))).join(' | ')} |`);
console.log('\n## Markup still matters\n');
const wine = SHOP_TYPES.find(type => type.id === 'wine');
console.log('| Markup | J€35 wine item buying chance |');
console.log('| ---: | ---: |');
for (const margin of [0, 20, 30, 60, 100]) console.log(`| ${margin}% | ${percent(businessItemSaleChance(wine, margin, 35))} |`);
const current = SHOP_TYPES.map(type => businessItemSaleChance(type, 20, type.typicalValue) * type.typicalValue);
const old = SHOP_TYPES.map(type => previous(type, type.typicalValue) * type.typicalValue);
console.log(`\nAt each store's typical stock value, the highest/lowest expected gross proceeds per visitor narrow from ${(Math.max(...old)/Math.min(...old)).toFixed(2)}× to ${(Math.max(...current)/Math.min(...current)).toFixed(2)}×. This compares equal traffic and markup, and excludes acquisition cost, guard fees, capacity and losses; it does not promise equal profit or payback time.`);
console.log('\nThe shared curve applies to each candidate item, not the store average. A rare expensive bottle remains harder to sell than everyday wine. The dashboard averages the same per-item probabilities; empty shops show a typical-value estimate. Player purchases, prices, foot traffic, popularity and historical sale receipts are unchanged.');
