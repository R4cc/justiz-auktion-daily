import { estimatedValueTokens, marketIndexes } from './market.mjs';

// Keep live quotes separate from the saved draws: market movement must never
// change a reward, its quantity, the winning bid or its inventory identity.
export function paletteMarketValue(db, palette, { now = Date.now() } = {}) {
  const indexes = marketIndexes(db, now);
  const rewards = palette.rewards.map(reward => {
    const unitValueTokens = estimatedValueTokens(reward.item, indexes);
    return { unitValueTokens, totalValueTokens: unitValueTokens * (reward.quantity ?? 1) };
  });
  const costTokens = palette.bundleCostTokens ?? palette.cost;
  const totalValueTokens = rewards.reduce((sum, reward) => sum + reward.totalValueTokens, 0);
  return { costTokens, totalValueTokens, profitLossTokens: totalValueTokens - costTokens, rewards };
}
