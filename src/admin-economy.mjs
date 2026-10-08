import { AccountError } from './errors.mjs';
import { transaction, withDatabase } from './database.mjs';
import { isMarketCategory, MARKET_CATEGORIES, marketIndexes, marketMultiplierAt, roundIndex } from './market.mjs';

export const ADMIN_MARKET_PRESETS = [-80, -50, -25, -10, -5, 5, 10, 25, 50];
const fail = (code, status = 400) => { throw new AccountError(code, status); };

function requireAdmin(db, user) {
  if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND admin = 1 AND npc = 0
    AND banned = 0 AND must_change_password = 0`).get(user?.id || '')) fail('forbidden', 403);
}

export function adminMarketDashboard(dataDir, user, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => {
    requireAdmin(db, user);
    const indexes = marketIndexes(db, now);
    return { presets: ADMIN_MARKET_PRESETS,
      categories: MARKET_CATEGORIES.map(({ id, name, nameDe }) => ({ id, name, nameDe,
        currentIndex: roundIndex(indexes[id]), multiplier: marketMultiplierAt(db, id, now) })),
      history: db.prepare(`SELECT a.category, a.action, a.percent, a.before_index AS beforeIndex,
        a.after_index AS afterIndex, a.created_at AS createdAt, u.username
        FROM admin_market_adjustments a LEFT JOIN users u ON u.id = a.admin_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 20`).all() };
  });
}

export function adjustAdminMarket(dataDir, user, { category, percent, action = 'adjust', requestId } = {}, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    requireAdmin(db, user);
    if (!isMarketCategory(category)) fail('unknown_category', 404);
    if (!['adjust', 'reset'].includes(action)) fail('invalid_market_adjustment');
    if (action === 'adjust' && (!Number.isSafeInteger(percent) || percent < -99 || percent > 100 || percent === 0)) fail('invalid_market_adjustment');
    if (action === 'reset' && percent != null) fail('invalid_market_adjustment');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
    const indexes = marketIndexes(db, now);
    const previous = db.prepare(`SELECT category, action, percent, multiplier,
      before_index AS beforeIndex, after_index AS afterIndex, created_at AS createdAt
      FROM admin_market_adjustments WHERE admin_id = ? AND request_id = ?`).get(user.id, requestId);
    if (previous) {
      if (previous.category !== category || previous.action !== action || previous.percent !== (percent ?? null)) fail('request_conflict', 409);
      return { ...previous };
    }
    const beforeIndex = indexes[category], oldMultiplier = marketMultiplierAt(db, category, now);
    const multiplier = action === 'reset' ? 1 : oldMultiplier * (1 + percent / 100);
    if (!Number.isFinite(multiplier) || multiplier < .001 || multiplier > 100) fail('market_adjustment_limit', 409);
    const afterIndex = beforeIndex / oldMultiplier * multiplier;
    db.prepare(`INSERT INTO admin_market_adjustments
      (admin_id, request_id, category, action, percent, multiplier, before_index, after_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, requestId, category, action, percent ?? null, multiplier, beforeIndex, afterIndex, now);
    db.prepare('UPDATE market_categories SET updated_at = ? WHERE category = ?').run(new Date(now).toISOString(), category);
    db.prepare(`INSERT OR REPLACE INTO market_snapshots (category, index_value, captured_at) VALUES (?, ?, ?)`)
      .run(category, afterIndex, new Date(now).toISOString());
    return { category, action, percent: percent ?? null, multiplier, beforeIndex, afterIndex, createdAt: now };
  }));
}
