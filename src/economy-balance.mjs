// Shared economic targets. Values are game currency, never real-money prices.
export const ECONOMY_BALANCE = Object.freeze({
  startingTokens: 1000,
  daily: 1000,
  dailyScoreBonus: 0,
  dailyCaseMaxItemValue: 1000,
  higherLowerPerCorrect: 25,
  higherLowerMax: 250,
  minimumStreak: 3,
  paidCaseReturn: .82,
  sealedCaseValueRate: .80,
  paletteReserveRate: .70,
  wholesaleReserveRate: .85,
  // Fair blackjack is balanced through the loss fine, never deck manipulation.
  theftFineMultiplier: 4,
  theftFineScale: .5,
  theftFineMinimumMultiplier: 1.5,
  theftPoliceCatchPercent: 30,
  securityGuardCatchPercent: 50,
  securityGuardProfitPercent: 5,
  businessDefaultMargin: 20,
  reviewPricePerReview: 60,
  purchasedReviewWeight: .25,
  purchasedReviewWeightCap: 10,
  reviewTrafficMaxBonus: .125,
  businessVisitorMultiplier: 1.25,
  npcResaleActivityMultiplier: 1.2,
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
