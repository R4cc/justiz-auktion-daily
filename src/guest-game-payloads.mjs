import { buildAuctionFamilies } from './auction-selection.mjs';
import { selectDailySet, selectRandomSet } from './core.mjs';
import { readArchive, readRandomUsage, recordRandomGame } from './database.mjs';
import { higherLowerDeck } from './higher-lower.mjs';

// Every anonymous mode draws outside the rewarded Daily's product families.
// Removing whole families also excludes relisted copies with different IDs.
export function createGuestGamePayloads({ dataDir, dailyPayload, now = Date.now }) {
  async function pool() {
    const daily = await dailyPayload();
    const archive = readArchive(dataDir).auctions || [];
    const protectedIds = new Set(daily.auctions.map(item => String(item.id)));
    const archived = new Map(archive.map(item => [String(item.id), item]));
    const auctions = buildAuctionFamilies([...archive, ...daily.auctions])
      .filter(family => !family.some(item => protectedIds.has(String(item.id))))
      .flat().map(item => archived.get(String(item.id))).filter(Boolean);
    return { daily, auctions };
  }
  const playable = game => ({ ...game,
    auctions: game.auctions.map(item => ({ ...item, actualBid: item.correctPrice })) });
  return {
    dailyPayload: async () => {
      const { daily, auctions } = await pool();
      return playable(selectDailySet(auctions, daily.date));
    },
    randomPayload: async () => {
      const { auctions } = await pool();
      const game = selectRandomSet(auctions, 5, Math.random, readRandomUsage(dataDir));
      recordRandomGame(dataDir, game);
      return playable(game);
    },
    higherLowerPayload: async () => higherLowerDeck((await pool()).auctions, Math.random, now())
  };
}
