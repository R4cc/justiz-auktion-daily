import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stockPaletteCatalog } from '../src/stock-palettes.mjs';
import { mysteryStockOffer, referenceQuantityOdds, expectedQuantity } from '../src/mystery-stock.mjs';
import { upsertAuctions, closeDataStore } from '../src/database.mjs';
import { estimatedValueTokens } from '../src/market.mjs';
import { expectedItemValue } from '../src/economy-balance.mjs';

// Exact probability for three independent item/quantity draws. Aggregate
// identical unit totals, then sum two draws and look up the third draw's CDF.
// This avoids sampled jackpot noise and the O(n^3) exhaustive triple loop.
export function openingProfitChance(items, weights, odds, cost, valueOf = item => item.referenceValue) {
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const tierCounts = rarities.map(rarity => items.filter(item => item.rarity === rarity).length);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const quantityTotal = odds.reduce((sum, entry) => sum + entry.weight, 0);
  const outcomes = new Map();
  for (const item of items) {
    const tier = rarities.indexOf(item.rarity), itemChance = weights[tier] / total / tierCounts[tier];
    for (const { quantity, weight } of odds) {
      const value = valueOf(item) * quantity;
      outcomes.set(value, (outcomes.get(value) || 0) + itemChance * weight / quantityTotal);
    }
  }
  const entries = [...outcomes].sort((a, b) => a[0] - b[0]);
  const cumulative = []; let sum = 0;
  for (const [, probability] of entries) cumulative.push(sum += probability);
  let chance = 0;
  for (const [a, pa] of entries) for (const [b, pb] of entries) {
    let low = 0, high = entries.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (entries[mid][0] <= cost - a - b) low = mid + 1;
      else high = mid;
    }
    chance += pa * pb * (1 - (cumulative[low - 1] || 0));
  }
  return Math.max(0, Math.min(1, chance));
}

export async function paletteProfitReport(input = 'seed/auctions.json') {
  const themes = [['BMW PKW','Fahrzeuge',500],['Riesling Wein','Getränke',10],['Laptop Lenovo','Elektronik',50],
    ['Bohrhammer Makita','Werkzeuge',25],['Gold Armbanduhr','Schmuck & Uhren',100],['Lego Modell','Sammlerstücke',20]];
  const archive = input === '--stress' ? themes.flatMap(([title, category, base], i) => Array.from({ length: 60 }, (_, n) => ({
    id: 1000 + i * 100 + n, title: `${title} ${1000 + i * 100 + n}`, category,
    finalPrice: Math.round(base * (n + 1) ** 1.35), image: '/assets/synthetic.jpg'
  }))) : JSON.parse(readFileSync(input, 'utf8')).auctions;
  const dir = mkdtempSync('/tmp/jg-palette-profit-report-'), rows = [];
  try {
    upsertAuctions(dir, archive);
    for (let day = 0; day < 3; day++) {
      const quoted = stockPaletteCatalog(dir, { now: Date.parse('2026-10-15T12:00:00Z') + day * 86400000 });
      for (const index of [50, 100, 150]) {
        const indexes = Object.fromEntries(['vehicles','wine','electronics','tools','watches_jewelry','collectibles','other'].map(id => [id, index]));
        for (const quote of quoted.offers) {
          const offer = mysteryStockOffer(quote, indexes), referenceOdds = referenceQuantityOdds(offer.tier);
          const unitValue = expectedItemValue(offer.items, offer.weights, item => estimatedValueTokens(item, indexes));
          rows.push({ index, tier: offer.tier,
            before: openingProfitChance(offer.items, offer.weights, referenceOdds, offer.cost),
            after: openingProfitChance(offer.items, offer.weights, offer.quantityOdds, offer.cost),
            oldReturn: unitValue * expectedQuantity(referenceOdds) / offer.cost,
            newReturn: offer.expectedMarket / offer.cost });
        }
      }
    }
  } finally { closeDataStore(dir); rmSync(dir, { recursive: true, force: true }); }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] || 'seed/auctions.json', rows = await paletteProfitReport(input);
  const percent = value => (value * 100).toFixed(2) + '%';
  console.log(`Exact mystery-palette profit audit: ${input}; 3 daily rotations; no Luck; same starting prices and NPC risk budgets.\nReference values at opening, not realized sale proceeds.\n`);
  console.log('| Index | Size | Old profit chance | New profit chance | Relative increase | Old EV / price | New EV / price |\n|---|---|---:|---:|---:|---:|---:|');
  for (const index of [50, 100, 150]) for (const tier of ['budget','standard','premium']) {
    const selected = rows.filter(row => row.index === index && row.tier === tier);
    if (!selected.length) continue;
    const mean = key => selected.reduce((sum, row) => sum + row[key], 0) / selected.length;
    console.log(`| ${index} | ${tier} | ${percent(mean('before'))} | ${percent(mean('after'))} | ${percent(mean('after') / mean('before') - 1)} | ${percent(mean('oldReturn'))} | ${percent(mean('newReturn'))} |`);
  }
}
