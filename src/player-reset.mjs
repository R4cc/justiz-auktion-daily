import { randomUUID } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { pushNotification } from './notifications.mjs';

const fail = (code, status = 400) => { throw new AccountError(code, status); };
const quote = name => `"${name.replaceAll('"', '""')}"`;

export function ensurePlayerResetSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS player_resets (
    admin_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id), retired_id TEXT NOT NULL,
    global_grant_rowid INTEGER NOT NULL,
    created_at INTEGER NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)),
    PRIMARY KEY(admin_id,request_id)
  ) STRICT`);
}

// Accounts owns the transaction. Shared trade receipts keep their referenced
// assets under a retired NPC; they must never repopulate the reset player's state.
export function resetPlayer(db, admin, { userId, confirmation, requestId } = {}, now = Date.now()) {
  const actor = db.prepare('SELECT * FROM users WHERE id=?').get(admin?.id || '');
  if (!actor?.admin || actor.npc || actor.banned || actor.must_change_password) fail('forbidden', 403);
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
  const target = db.prepare('SELECT * FROM users WHERE id=? AND npc=0 AND admin=0').get(typeof userId === 'string' ? userId : '');
  if (!target) fail('user_not_found', 404);
  if (confirmation !== target.username) fail('invalid_player_reset_confirmation');
  const prior = db.prepare('SELECT * FROM player_resets WHERE admin_id=? AND request_id=?').get(actor.id, requestId);
  if (prior) {
    if (prior.user_id !== target.id) fail('request_conflict', 409);
    return JSON.parse(prior.result);
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
  const run = (table, sql, ...args) => tables.has(table) && db.prepare(sql).run(...args);
  const result = { userId: target.id, username: target.username, createdAt: now,
    inventoryCount: db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE user_id=?').get(target.id).n,
    storeCount: db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE user_id=?').get(target.id).n };

  // Cancel the seller's unsettled lots and return other bidders' full escrow.
  for (const lot of db.prepare("SELECT * FROM resale_auctions WHERE seller_id=? AND settled_at IS NULL AND status!='cancelled'").all(target.id)) {
    if (lot.current_bidder_id && lot.current_bidder_id !== target.id) {
      const held = lot.max_bid ?? lot.current_bid ?? 0;
      const bidder = db.prepare('SELECT tokens FROM users WHERE id=?').get(lot.current_bidder_id);
      if (!Number.isSafeInteger(bidder.tokens + held)) fail('token_balance_limit', 409);
      db.prepare('UPDATE users SET tokens=tokens+? WHERE id=?').run(held, lot.current_bidder_id);
      pushNotification(db, lot.current_bidder_id, { type: 'auction', sourceKey: `player-reset:${lot.id}`, href: '/auction-house',
        titleEn: 'Auction cancelled', titleDe: 'Auktion abgebrochen',
        bodyEn: 'The seller was reset. Your full reserved bid was returned.',
        bodyDe: 'Der Verkäufer wurde zurückgesetzt. Dein reserviertes Gebot wurde vollständig erstattet.' }, now);
    }
    db.prepare("UPDATE resale_auctions SET status='cancelled',closed_at=?,settled_at=?,current_bid=NULL,max_bid=NULL,current_bidder_id=NULL,winner_id=NULL WHERE id=?").run(now, now, lot.id);
  }
  // Withdrawing the reset player's lead does not promote an already-refunded bid.
  for (const table of ['resale_auctions', 'primary_palette_auctions']) {
    run(table, `UPDATE ${table} SET current_bid=NULL,max_bid=NULL,current_bidder_id=NULL,winner_id=NULL WHERE current_bidder_id=? AND settled_at IS NULL`, target.id);
  }
  run('wholesale_auctions', 'UPDATE wholesale_auctions SET current_bid=NULL,bidder_id=NULL,winner_id=NULL WHERE bidder_id=? AND settled_at IS NULL', target.id);
  run('store_heists', "UPDATE store_heists SET status='cancelled',settled_at=? WHERE (user_id=? OR owner_id=?) AND status IN ('active','police')", now, target.id, target.id);
  run('primary_palette_auctions', 'UPDATE primary_palette_auctions SET revealed_at=COALESCE(revealed_at,?) WHERE winner_id=? AND settled_at IS NOT NULL', now, target.id);

  db.prepare('DELETE FROM business_stock WHERE business_id IN (SELECT id FROM businesses WHERE user_id=?) OR inventory_id IN (SELECT id FROM inventory WHERE user_id=?)').run(target.id, target.id);
  db.prepare('UPDATE businesses SET retired=1,plot_id=NULL,cash_balance=0,traffic_popularity=0,upgrade_size=NULL,upgrade_started_at=NULL,upgrade_ends_at=NULL,upgrade_cost=NULL WHERE user_id=?').run(target.id);
  db.prepare('UPDATE inventory SET sold_at=COALESCE(sold_at,?) WHERE user_id=?').run(now, target.id);
  db.prepare('DELETE FROM friendships WHERE user_a=? OR user_b=?').run(target.id, target.id);
  // Delete personal progress and authentication state before retiring histories
  // that may also belong to another player (purchases, reviews and auctions).
  for (const table of ['account_sessions', 'daily_rewards', 'daily_case_rewards', 'account_games',
    'case_openings', 'case_purchases', 'stock_palette_purchases', 'skill_purchases', 'user_skills',
    'prestige_receipts', 'user_prestige', 'loan_receipts', 'player_loans', 'justice_seizures', 'player_justice',
    'police_activity_checks', 'police_encounters', 'player_heat', 'xp_events', 'trader_sales', 'item_acquisitions',
    'trader_milestones', 'net_worth_snapshots', 'user_statistics_events', 'user_statistics_state',
    'account_notifications', 'store_review_likes', 'store_reviews', 'store_visits', 'store_reactions']) {
    run(table, `DELETE FROM ${table} WHERE user_id=?`, target.id);
  }

  const retired = `npc-reset-${randomUUID()}`;
  const sequence = db.prepare('SELECT COUNT(*) AS n FROM player_resets WHERE user_id=?').get(target.id).n + 1;
  db.prepare("INSERT INTO users(id,username,password_hash,npc,tokens,created_at) VALUES(?,?,'disabled',1,0,?)")
    .run(retired, `Retired ${target.username} #${sequence}`, now);
  // Discover all remaining user references so new receipt tables cannot restore
  // old rewards or activity on a later read. The audit keeps the human identity.
  for (const table of tables) {
    if (table === 'users' || table === 'player_resets') continue;
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all()) {
      if (fk.table === 'users') db.prepare(`UPDATE ${quote(table)} SET ${quote(fk.from)}=? WHERE ${quote(fk.from)}=?`).run(retired, target.id);
    }
  }
  db.prepare('UPDATE users SET tokens=?,xp=0,grants_seen_at=? WHERE id=?').run(ECONOMY_BALANCE.startingTokens, now, target.id);
  db.prepare('INSERT INTO player_resets VALUES(?,?,?,?,(SELECT COALESCE(MAX(rowid),0) FROM token_grants),?,?)')
    .run(actor.id, requestId, target.id, retired, now, JSON.stringify(result));
  return result;
}
