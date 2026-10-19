import { loanDebt } from './loan-ledger.mjs';
import { syncUserStatistics } from './user-statistics.mjs';
import { ensureStoreSchema } from './storefronts.mjs';
import { withDatabase, transaction } from './database.mjs';
import { levelForXp } from './progression.mjs';
import { AccountError } from './errors.mjs';
import { justiceStatus } from './justice.mjs';
import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { PRESTIGE_BUFFS, ensurePrestigeSchema, prestigeEffects } from './prestige-effects.mjs';

const has = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const fail = (code, status = 409) => { throw new AccountError(code, status); };
export function prestigeState(db, userId, xp, now = Date.now()) {
  const effects = prestigeEffects(db, userId);
  let blocked = null;
  const justice = justiceStatus(db, userId, now);
  if (justice.jailed || justice.fineDue) blocked = 'prestige_justice_pending';
  if (has(db, 'store_heists') && db.prepare("SELECT 1 FROM store_heists WHERE (user_id=? OR owner_id=?) AND status IN ('active','police') LIMIT 1").get(userId, userId)) blocked = 'prestige_heist_pending';
  if (has(db, 'resale_auctions') && db.prepare(`SELECT 1 FROM resale_auctions WHERE settled_at IS NULL AND status!='cancelled'
    AND current_bidder_id IS NOT NULL AND (current_bidder_id=? OR seller_id=?) LIMIT 1`).get(userId, userId)) blocked = 'prestige_auction_pending';
  if (has(db, 'primary_palette_auctions') && db.prepare('SELECT 1 FROM primary_palette_auctions WHERE current_bidder_id=? AND settled_at IS NULL LIMIT 1').get(userId)) blocked = 'prestige_auction_pending';
  if (loanDebt(db,userId,now)) blocked = 'prestige_loan_pending';
  return { ...effects, requiredLevel: 10, eligible: levelForXp(xp) >= 10 && effects.count < PRESTIGE_BUFFS.length && !blocked,
    blocked, choices: PRESTIGE_BUFFS.filter(buff => !effects.buffs.includes(buff)), startingTokens: ECONOMY_BALANCE.startingTokens };
}

export function prestigeAccount(dataDir, user, { buffId, expectedCount, requestId, confirmation } = {}, { now = Date.now() } = {}) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request', 400);
  if (!PRESTIGE_BUFFS.includes(buffId) || !Number.isSafeInteger(expectedCount) || expectedCount < 0) fail('invalid_prestige', 400);
  if (confirmation !== 'PRESTIGE') fail('invalid_prestige_confirmation', 400);
  return withDatabase(dataDir, db => transaction(db, () => {
    ensurePrestigeSchema(db); ensureStoreSchema(db);
    const row = db.prepare('SELECT id,xp FROM users WHERE id=? AND npc=0 AND banned=0 AND must_change_password=0').get(user?.id || '');
    if (!row) fail('login_required', 401);
    const prior = db.prepare('SELECT * FROM prestige_receipts WHERE user_id=? AND request_id=?').get(row.id, requestId);
    if (prior) {
      if (prior.buff_id !== buffId || prior.previous_count !== expectedCount) fail('request_conflict');
      return JSON.parse(prior.result);
    }
    const state = prestigeState(db, row.id, row.xp, now);
    if (state.count !== expectedCount) fail('prestige_changed');
    if (state.buffs.includes(buffId)) fail('prestige_buff_owned');
    if (levelForXp(row.xp) < 10) fail('prestige_level_required');
    if (state.blocked) fail(state.blocked);
    syncUserStatistics(db,row.id,now);
    // Preserve foreign purchase and crime receipts by retiring assets instead
    // of deleting rows referenced by another player's history.
    const retired = 'npc-prestige-retired';
    db.prepare("INSERT OR IGNORE INTO users(id,username,password_hash,npc,tokens,created_at) VALUES(?,'Retired Assets','disabled',1,0,?)").run(retired, now);
    db.prepare("UPDATE resale_auctions SET status='cancelled',closed_at=?,settled_at=? WHERE seller_id=? AND status='active' AND current_bidder_id IS NULL").run(now, now, row.id);
    db.prepare('DELETE FROM business_stock WHERE business_id IN (SELECT id FROM businesses WHERE user_id=?)').run(row.id);
    db.prepare('UPDATE businesses SET user_id=?,retired=1,plot_id=NULL,cash_balance=0,traffic_popularity=0 WHERE user_id=?').run(retired, row.id);
    db.prepare('UPDATE inventory SET user_id=?,sold_at=COALESCE(sold_at,?) WHERE user_id=?').run(retired, now, row.id);
    if (has(db, 'stock_palette_purchases')) db.prepare('UPDATE stock_palette_purchases SET seized_at=COALESCE(seized_at,?) WHERE user_id=? AND revealed_at IS NULL').run(now, row.id);
    if (has(db, 'primary_palette_mystery_stock')) db.prepare(`UPDATE primary_palette_mystery_stock SET seized_at=COALESCE(seized_at,?)
      WHERE auction_id IN (SELECT id FROM primary_palette_auctions WHERE winner_id=? AND settled_at IS NOT NULL AND revealed_at IS NULL)`).run(now,row.id);
    if (has(db, 'primary_palette_auctions')) db.prepare('UPDATE primary_palette_auctions SET revealed_at=? WHERE winner_id=? AND settled_at IS NOT NULL AND revealed_at IS NULL').run(now, row.id);
    for (const table of ['user_skills', 'trader_sales', 'item_acquisitions', 'trader_milestones', 'net_worth_snapshots', 'account_notifications', 'player_justice']) {
      if (has(db, table)) db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(row.id);
    }
    db.prepare('UPDATE store_heists SET retired=1 WHERE user_id=?').run(row.id);
    db.prepare('UPDATE daily_case_rewards SET opened_at=? WHERE user_id=? AND opened_at IS NULL').run(now,row.id);
    db.prepare(`DELETE FROM daily_rewards WHERE user_id=? AND earned=0 AND run_id IN
      (SELECT id FROM account_games WHERE user_id=? AND complete=0)`).run(row.id,row.id);
    db.prepare(`DELETE FROM account_games WHERE user_id=? AND complete=0
      AND id NOT IN (SELECT run_id FROM daily_rewards) AND id NOT IN (SELECT run_id FROM daily_case_rewards)`).run(row.id);
    // Keep Daily guards and economic receipts: reset cannot reclaim a free
    // Daily reward or re-execute a previously accepted payment.
    db.prepare('UPDATE users SET xp=0,tokens=?,grants_seen_at=? WHERE id=?').run(ECONOMY_BALANCE.startingTokens, now, row.id);
    const result = { count: state.count + 1, buffId, buffs: [...state.buffs, buffId], createdAt: now };
    db.prepare(`INSERT INTO user_prestige VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET buffs=excluded.buffs,count=excluded.count,updated_at=excluded.updated_at`)
      .run(row.id, JSON.stringify(result.buffs), result.count, now);
    db.prepare('INSERT INTO prestige_receipts VALUES(?,?,?,?,?)').run(row.id, requestId, buffId, expectedCount, JSON.stringify(result));
    return result;
  }));
}
