export const PRESTIGE_BUFFS = ['profit', 'stealth', 'cases', 'luck', 'restocker'];
export function ensurePrestigeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_prestige (
    user_id TEXT PRIMARY KEY REFERENCES users(id), buffs TEXT NOT NULL CHECK(json_valid(buffs)),
    count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS prestige_receipts (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, buff_id TEXT NOT NULL,
    previous_count INTEGER NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)),
    PRIMARY KEY(user_id,request_id)
  ) STRICT`);
}
export function prestigeEffects(db, userId) {
  ensurePrestigeSchema(db);
  const row = db.prepare('SELECT * FROM user_prestige WHERE user_id=?').get(userId || '');
  const buffs = row ? JSON.parse(row.buffs) : [];
  return { count: row?.count || 0, since: row?.updated_at || 0, buffs,
    profitPercent: buffs.includes('profit') ? 25 : 0,
    catchReductionPercent: buffs.includes('stealth') ? 25 : 0,
    caseDiscountPercent: buffs.includes('cases') ? 50 : 0,
    luckPercent: buffs.includes('luck') ? 25 : 0,
    autoRestock: buffs.includes('restocker') };
}
export const discountedCaseCost = (cost, discount = 0) => Math.max(1, Math.ceil(cost * (100 - discount) / 100));
