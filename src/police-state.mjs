export function ensurePoliceSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS police_activity_checks (
    user_id TEXT NOT NULL REFERENCES users(id), event_key TEXT NOT NULL,
    checked_at INTEGER NOT NULL, heat INTEGER NOT NULL, chance INTEGER NOT NULL, performed INTEGER NOT NULL,
    PRIMARY KEY(user_id,event_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS police_checks_time ON police_activity_checks(user_id,performed,checked_at DESC);
  CREATE TABLE IF NOT EXISTS police_encounters (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),event_key TEXT NOT NULL,
    heat INTEGER NOT NULL,chance INTEGER NOT NULL,base_fine INTEGER NOT NULL,fine INTEGER NOT NULL,
    fine_multiplier REAL NOT NULL,jail_ms INTEGER NOT NULL,created_at INTEGER NOT NULL,
    resolved_at INTEGER,resolution TEXT,result TEXT,retired INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id,event_key)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS police_one_pending ON police_encounters(user_id) WHERE resolved_at IS NULL`);
}
export function publicPoliceEncounter(row) {
  return row?{id:row.id,heatStars:row.heat/2,chancePercent:row.chance,fine:row.fine,fineMultiplier:row.fine_multiplier,
    sentenceMinutes:row.jail_ms/60000,createdAt:row.created_at}:null;
}
export function pendingPoliceEncounter(db,userId) {
  ensurePoliceSchema(db);
  return publicPoliceEncounter(db.prepare('SELECT * FROM police_encounters WHERE user_id=? AND resolved_at IS NULL').get(userId));
}
