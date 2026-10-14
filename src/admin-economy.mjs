import { AccountError } from './errors.mjs';
import { withDatabase } from './database.mjs';
import { MARKET_CATEGORIES, marketIndexes, roundIndex } from './market.mjs';

const fail = (code, status = 400) => { throw new AccountError(code, status); };

function requireAdmin(db, user) {
  if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND admin = 1 AND npc = 0
    AND banned = 0 AND must_change_password = 0`).get(user?.id || '')) fail('forbidden', 403);
}

export function adminMarketDashboard(dataDir, user, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => {
    requireAdmin(db, user);
    const indexes = marketIndexes(db, now);
    return { categories: MARKET_CATEGORIES.map(({ id, name, nameDe }) => ({ id, name, nameDe,
      currentIndex: roundIndex(indexes[id]) })) };
  });
}
