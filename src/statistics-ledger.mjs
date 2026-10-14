// Durable, actor-scoped counters backed by receipts. Callers own transactions.
export function ensureStatisticsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_statistics_events (
    user_id TEXT NOT NULL REFERENCES users(id), event_key TEXT NOT NULL, kind TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0, quantity INTEGER NOT NULL DEFAULT 0,
    value INTEGER NOT NULL DEFAULT 0, cost INTEGER, rarity TEXT, reward INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, PRIMARY KEY(user_id,event_key)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS user_statistics_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id), started_at INTEGER NOT NULL
  ) STRICT`);
}
export function statisticEvent(db,userId,key,kind,{amount=0,quantity=0,value=0,cost=null,rarity=null,reward=0,at=Date.now()}={}) {
  ensureStatisticsSchema(db);
  db.prepare(`INSERT INTO user_statistics_events VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,event_key) DO UPDATE SET kind=excluded.kind,amount=excluded.amount,
    quantity=excluded.quantity,value=excluded.value,cost=COALESCE(excluded.cost,user_statistics_events.cost),rarity=excluded.rarity,
    reward=excluded.reward WHERE excluded.created_at>=user_statistics_events.created_at`)
    .run(userId,key,kind,amount,quantity,value,cost,rarity,Number(Boolean(reward)),at);
}
