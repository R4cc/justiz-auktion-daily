// Shared economic targets. Values are game currency, never real-money prices.
export const ECONOMY_BALANCE = Object.freeze({
  startingTokens: 1000,
  daily: 200,
  dailyScoreBonus: 150,
  dailyCaseMaxItemValue: 1000,
  higherLowerPerCorrect: 25,
  higherLowerMax: 250,
  minimumStreak: 3,
  paidCaseReturn: .82,
  sealedCaseValueRate: .80,
  paletteReserveRate: .70,
  wholesaleReserveRate: .85,
  businessDefaultMargin: 20,
  businessMarginElasticity: 3,
  npcResaleMinimum: .60,
  npcResaleMaximum: .96,
  npcCollectorMaximum: 1.05,
  npcPaletteMinimum: .64,
  npcPaletteMaximum: .84
});

export const GAME_REWARDS = Object.freeze(Object.fromEntries(
  ['daily', 'dailyScoreBonus', 'higherLowerPerCorrect', 'higherLowerMax', 'minimumStreak']
    .map(key => [key, ECONOMY_BALANCE[key]])));

// Exact tier expectation, using the same tier-then-uniform-within-tier draw
// as cases and palettes. Zero-weight pools are irrelevant; a missing active
// tier is an invalid offer rather than an excuse to redistribute its odds.
export function expectedItemValue(items, weights, valueOf = item => Math.max(1, Math.round(item.price))) {
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) return 0;
  return weights.reduce((sum, weight, index) => {
    if (!weight) return sum;
    const pool = items.filter(item => item.rarity === rarities[index]);
    if (!pool.length) throw new Error('empty_catalog');
    return sum + weight / total * pool.reduce((value, item) => value + valueOf(item), 0) / pool.length;
  }, 0);
}

export function scoreReward(score, maximum) {
  return Math.round(maximum * Math.max(0, Math.min(1, Number(score) / 5000 || 0)));
}

// Small resale lots remain accessible; expensive lots cannot crawl in J€1
// steps. The reserve fixes the increment for the life of the auction.
export function resaleBidIncrement(reserve) {
  if (reserve < 100) return 1;
  if (reserve < 500) return 5;
  if (reserve < 1000) return 10;
  return Math.max(25, Math.ceil(reserve * .005 / 25) * 25);
}
