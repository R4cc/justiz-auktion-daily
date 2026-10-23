export const HEAT_MAX = 10;
export const HEAT_PER_ATTEMPT = 1;
export const HEAT_DECAY_INTERVAL = 30 * 60000;
export const HEAT_CATCH_BONUS = 5;

export function ensureHeatSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS player_heat (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 10),
    updated_at INTEGER NOT NULL
  ) STRICT`);
}

// Reads never reset the decay clock. Each full thirty minutes removes half a star,
// including time offline; sub-interval time carries across subsequent attempts.
export function playerHeat(db, userId, now = Date.now()) {
  ensureHeatSchema(db);
  const row = db.prepare('SELECT value,updated_at FROM player_heat WHERE user_id=?').get(userId || '');
  const elapsed = row ? Math.max(0, Math.floor((now - row.updated_at) / HEAT_DECAY_INTERVAL)) : 0;
  const value = Math.max(0, (row?.value || 0) - elapsed);
  return { value, stars: value / 2, maxStars: 5, perAttemptStars: .5, decayMinutes: 30,
    catchBonusPercent: value * HEAT_CATCH_BONUS,
    nextDecayAt: value ? row.updated_at + (elapsed + 1) * HEAT_DECAY_INTERVAL : null };
}

export function increasePlayerHeat(db, userId, now, amount = HEAT_PER_ATTEMPT) {
  const heat = playerHeat(db, userId, now);
  const updatedAt = heat.value ? heat.nextDecayAt - HEAT_DECAY_INTERVAL : now;
  db.prepare(`INSERT INTO player_heat VALUES(?,?,?) ON CONFLICT(user_id)
    DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(userId, Math.min(HEAT_MAX, heat.value + amount), updatedAt);
  return playerHeat(db, userId, now);
}

// Successful theft adds another half-star per item, with larger value bands
// adding more. Shelf markups never determine the wanted level.
export function stolenItemHeat(referencePrice, quantity = 1) {
  const perItem = referencePrice < 500 ? 1 : referencePrice < 2500 ? 2 : referencePrice < 10000 ? 3 : 4;
  return Math.min(HEAT_MAX, perItem * quantity);
}
