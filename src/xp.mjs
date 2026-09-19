// Deliberately small ledger: callers already own the economic transaction.
export function ensureXpSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS xp_events (
    user_id TEXT NOT NULL REFERENCES users(id),
    source_type TEXT NOT NULL CHECK(source_type IN ('daily','resale')),
    source_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
    created_at INTEGER NOT NULL, PRIMARY KEY(user_id, source_type, source_id)
  ) STRICT`);
}

export const resaleXp = price => Math.max(10, Math.min(200, Math.round(20 * Math.log2(1 + price / 100))));

export function awardXp(db, userId, sourceType, sourceId, amount, now) {
  ensureXpSchema(db);
  const inserted = db.prepare(`INSERT OR IGNORE INTO xp_events VALUES (?, ?, ?, ?, ?)`)
    .run(userId, sourceType, sourceId, amount, now).changes;
  if (inserted) db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
  return Boolean(inserted);
}
