import { ECONOMY_BALANCE } from './economy-balance.mjs';
// Shared db-scoped effects. No client-supplied rank or effect is authoritative.
export const SKILL_COSTS = [1, 3, 6, 12];
export const LUCK_BONUSES = [0, 3, 5, 7];
export const SECURITY_BONUSES = [0, 10, 20, 30];
const REVIEW_WEIGHTS = [100, 125, 150, 175];

export function ensureSkillsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_skills (
    user_id TEXT NOT NULL REFERENCES users(id), skill_id TEXT NOT NULL,
    rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3), updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,skill_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS skill_purchases (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    skill_id TEXT NOT NULL, rank INTEGER NOT NULL, cost INTEGER NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY(user_id,request_id)
  ) STRICT`);
}
export function skillRanks(db, userId) {
  ensureSkillsSchema(db);
  return Object.fromEntries(db.prepare('SELECT skill_id,rank FROM user_skills WHERE user_id=?').all(userId || '').map(row => [row.skill_id,row.rank]));
}
export function skillEffects(db, userId) {
  const ranks = skillRanks(db,userId);
  return { luckPercent: LUCK_BONUSES[ranks.luck || 0], securityPercent: SECURITY_BONUSES[ranks.security || 0],
    reviewWeight: REVIEW_WEIGHTS[ranks.influence || 0] };
}

// Only tiers above the lowest populated tier receive a relative boost.
// Exact integer scaling preserves tiny jackpot odds without rounding them up.
// If E is the baseline positive reward expectation, E' <= (1 + bonus/100)E:
// each outcome's unnormalized weight grows by at most that factor, while the
// normalizing total cannot shrink. This holds for any archive/value spread.
export function luckWeights(weights, bonus = 0) {
  if (!LUCK_BONUSES.includes(bonus)) throw new Error('invalid_luck_bonus');
  if (!bonus) return [...weights];
  const first = weights.findIndex(weight => weight > 0);
  return weights.map((weight,index) => weight * (index > first ? 100 + bonus : 100));
}

// A paid star has a quarter of an ordinary customer's weight, with a shared
// ceiling of ten ordinary reviews per store. Actual counts remain visible.
export const PURCHASED_REVIEW_WEIGHT = ECONOMY_BALANCE.purchasedReviewWeight;
export const PURCHASED_REVIEW_WEIGHT_CAP = ECONOMY_BALANCE.purchasedReviewWeightCap;
export function storeRatingWeights(db, shopId, now = Number.MAX_SAFE_INTEGER) {
  ensureSkillsSchema(db);
  const weight = `CASE COALESCE(s.rank,0) WHEN 1 THEN 1.25 WHEN 2 THEN 1.5 WHEN 3 THEN 1.75 ELSE 1 END`;
  const organic = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(r.stars * (${weight})),0) AS stars,
    COALESCE(SUM(${weight}),0) AS weight FROM store_reviews r JOIN users u ON u.id=r.user_id
    LEFT JOIN user_skills s ON s.user_id=r.user_id AND s.skill_id='influence'
    WHERE r.business_id=? AND u.banned=0 AND r.updated_at<=?`).get(shopId,now);
  const purchasedCount = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='store_review_packs'").get()
    ? db.prepare('SELECT COALESCE(SUM(review_count),0) AS count FROM store_review_packs WHERE business_id=? AND redeemed_at<=?').get(shopId,now).count : 0;
  const boughtWeight = Math.min(PURCHASED_REVIEW_WEIGHT_CAP, purchasedCount * PURCHASED_REVIEW_WEIGHT);
  return { count: organic.count + purchasedCount, purchasedCount, stars: organic.stars + 5 * boughtWeight, weight: organic.weight + boughtWeight };
}
export function weightedStoreRating(db, shopId) {
  const rating = storeRatingWeights(db,shopId);
  return { count: rating.count, average: rating.weight ? rating.stars / rating.weight : null };
}
