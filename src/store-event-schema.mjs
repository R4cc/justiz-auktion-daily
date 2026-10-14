// Shared persisted activity for daily store events and runtime NPC theft.
// The caller initializes businesses before creating these foreign keys.
export function ensureStoreActivitySchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS store_event_checks (
    business_id TEXT PRIMARY KEY REFERENCES businesses(id), checked_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_events (
    id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), owner_id TEXT NOT NULL REFERENCES users(id),
    result TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS store_events_pending ON store_events(owner_id, acknowledged_at, created_at)`);
}
