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

export function weightedStoreRating(db, shopId) {
  ensureSkillsSchema(db);
  // Re-evaluate existing verified reviews when their author improves Influence.
  // One review per customer remains enforced by the existing primary key.
  const weight = `CASE COALESCE(s.rank,0) WHEN 1 THEN 125 WHEN 2 THEN 150 WHEN 3 THEN 175 ELSE 100 END`;
  return db.prepare(`SELECT COUNT(*) AS count, SUM(r.stars * (${weight})) * 1.0 / SUM(${weight}) AS average
    FROM store_reviews r JOIN users u ON u.id=r.user_id
    LEFT JOIN user_skills s ON s.user_id=r.user_id AND s.skill_id='influence'
    WHERE r.business_id=? AND u.banned=0`).get(shopId);
}
