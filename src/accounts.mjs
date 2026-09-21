import { randomBytes, randomInt, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { withDatabase, transaction } from './database.mjs';
import { drawItem, tokenValue } from './cases.mjs';
import { scoreGuess } from './core.mjs';
import { AccountError } from './errors.mjs';
import { ensureResaleSchema, inventoryIsLocked, lockedInventoryIds } from './resale.mjs';
import { marketCategoryForItem } from './market.mjs';
import { awardXp, ensureXpSchema } from './xp.mjs';
import { featureFlags } from './features.mjs';
import { estimatedValueTokens, marketIndexes } from './market.mjs';
import { progressionForXp } from './progression.mjs';
import { ensureNotificationSchema, pushNotification } from './notifications.mjs';

export { AccountError };

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const day = now => new Date(now).toISOString().slice(0, 10);
const SESSION_MS = 30 * 86400000;
export const STARTING_TOKENS = 1000;
const DEFAULT_REWARDS = { daily: 100, higherLowerPerCorrect: 20, higherLowerMax: 200, minimumStreak: 3 };
const fail = (code, status) => { throw new AccountError(code, status); };
const currentItemValue = item => ({ ...item, sellValue: tokenValue(item.price), marketCategory: marketCategoryForItem(item) });
const collectibleIdentity = item => JSON.stringify([item.auctionId, item.title, item.image, item.price, item.rarity, tokenValue(item.price)]);
const rewardRates = value => Object.fromEntries(Object.entries(DEFAULT_REWARDS).map(([key, fallback]) =>
  [key, Number.isSafeInteger(value?.[key]) && value[key] > 0 ? value[key] : fallback]));

function credentials(username, password) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) fail('invalid_username');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('invalid_password');
  return username.toLowerCase();
}
let hashing = 0;
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (hashing >= 4) fail('try_later', 429);
  hashing++;
  try { return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`; }
  finally { hashing--; }
}
async function passwordMatches(password, stored) {
  const result = await passwordHash(password, stored.split(':')[0]);
  return timingSafeEqual(Buffer.from(result), Buffer.from(stored));
}

export class Accounts {
  constructor(dataDir, { now = Date.now, flags = featureFlags() } = {}) {
    this.dataDir = dataDir;
    this.now = now;
    this.flags = flags;
    this.db(db => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
        grants_seen_at INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0 CHECK(tokens >= 0), xp INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS registration_codes (
        hash TEXT PRIMARY KEY, label TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL, used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_attempts (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_games (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL,
        mode TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL CHECK(json_valid(payload))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS account_games_user ON account_games(user_id, date, mode);
      CREATE TABLE IF NOT EXISTS daily_rewards (
        user_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES account_games(id),
        earned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, date)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS inventory (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), item TEXT NOT NULL CHECK(json_valid(item)),
        created_at INTEGER NOT NULL, sold_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS inventory_user ON inventory(user_id, created_at);
      CREATE TABLE IF NOT EXISTS case_openings (
        user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, case_id TEXT NOT NULL,
        item TEXT NOT NULL CHECK(json_valid(item)), PRIMARY KEY(user_id, request_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS friendships (
        user_a TEXT NOT NULL REFERENCES users(id), user_b TEXT NOT NULL REFERENCES users(id),
        requested_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
        accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted IN (0, 1)),
        PRIMARY KEY(user_a, user_b), CHECK(user_a < user_b),
        CHECK(requested_by = user_a OR requested_by = user_b)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS friendships_user_b ON friendships(user_b);
      CREATE TABLE IF NOT EXISTS token_grants (
        admin_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0), recipients INTEGER NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(admin_id, request_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS user_token_grants (
        admin_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount > 0),
        created_at INTEGER NOT NULL, PRIMARY KEY(admin_id, request_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS economy_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
        player_count INTEGER NOT NULL, inventory_count INTEGER NOT NULL,
        game_count INTEGER NOT NULL, resale_count INTEGER NOT NULL,
        palette_auction_count INTEGER NOT NULL
      ) STRICT;
      `);
      const columns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
      if (!columns.includes('npc')) db.exec('ALTER TABLE users ADD COLUMN npc INTEGER NOT NULL DEFAULT 0');
      ensureXpSchema(db);
      if (!columns.includes('banned')) db.exec('ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
      if (!columns.includes('xp')) {
        // The reserved XP column was part of the CREATE TABLE but never ALTERed
        // in, so databases created before the economy foundation lack it.
        // Existing users start at zero XP; existing values are never touched.
        db.exec('ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
      }
      if (!columns.includes('grants_seen_at')) {
        db.exec('ALTER TABLE users ADD COLUMN grants_seen_at INTEGER NOT NULL DEFAULT 0');
        // Grants that predate the migration stay unannounced.
        db.prepare('UPDATE users SET grants_seen_at = ?').run(this.now());
      }
      if (!columns.includes('must_change_password')) {
        // Admin password resets set this flag: 1 = temporary password armed,
        // 2 = consumed by its single login, waiting for the new password.
        db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
      }
      // Resale listings reference inventory rows; creating the tables here keeps
      // the sell/list locking consistent for every database this class opens.
      ensureResaleSchema(db, this.now());
      ensureNotificationSchema(db);
    });
  }
  db(work) { return withDatabase(this.dataDir, work); }
  atomic(work) { return this.db(db => transaction(db, () => work(db))); }
  async bootstrap(username, password) {
    if (!username && !password) return;
    if (!username || !password) throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must both be set');
    credentials(username, password);
    const existing = this.db(db => db.prepare('SELECT * FROM users WHERE username = ?').get(username));
    // Never promote an existing registered account through a configuration typo.
    if (existing && !existing.admin) throw new Error('Configured admin username belongs to a regular account');
    if (existing && await passwordMatches(password, existing.password_hash)) return;
    const hash = await passwordHash(password);
    this.atomic(db => {
      if (existing) {
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, existing.id);
        db.prepare('DELETE FROM account_sessions WHERE user_id = ?').run(existing.id);
      } else db.prepare('INSERT INTO users (id, username, password_hash, admin, tokens, created_at, grants_seen_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
        .run(randomUUID(), username, hash, STARTING_TOKENS, this.now(), this.now());
    });
  }
  throttle(key, limit = 30) {
    this.atomic(db => {
      db.prepare('DELETE FROM account_attempts WHERE expires <= ?').run(this.now());
      const row = db.prepare('SELECT count FROM account_attempts WHERE key = ?').get(digest(key));
      if (row?.count >= limit) fail('try_later', 429);
      db.prepare(`INSERT INTO account_attempts VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET count = count + 1`).run(digest(key), this.now() + 15 * 60000);
    });
  }
  session(db, userId) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND npc = 0 AND banned = 0').get(userId)) fail('invalid_login', 401);
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM account_sessions WHERE expires <= ?').run(this.now());
    // Bound sessions per account without discarding the newly issued session.
    db.prepare(`DELETE FROM account_sessions WHERE user_id = ? AND hash NOT IN
      (SELECT hash FROM account_sessions WHERE user_id = ? ORDER BY expires DESC LIMIT 9)`).run(userId, userId);
    db.prepare('INSERT INTO account_sessions VALUES (?, ?, ?)').run(digest(token), userId, this.now() + SESSION_MS);
    return token;
  }
  user(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db(db => db.prepare(`SELECT users.* FROM users JOIN account_sessions ON users.id = user_id
      WHERE hash = ? AND expires > ? AND banned = 0 AND npc = 0`).get(digest(token), this.now())) || null;
  }
  logout(token) { this.db(db => db.prepare('DELETE FROM account_sessions WHERE hash = ?').run(digest(token || ''))); }
  async register({ username, password, code }) {
    credentials(username, password);
    if (typeof code !== 'string' || !/^[a-f0-9]{32}$/i.test(code.trim())) fail('invalid_code');
    const codeHash = digest(code.trim().toLowerCase());
    // Check before expensive hashing, and again inside the registration transaction.
    if (!this.db(db => db.prepare('SELECT 1 FROM registration_codes WHERE hash = ? AND used_at IS NULL AND revoked = 0').get(codeHash))) fail('invalid_code');
    const hash = await passwordHash(password);
    return this.atomic(db => {
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail('username_taken', 409);
      const result = db.prepare('UPDATE registration_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL AND revoked = 0')
        .run(this.now(), codeHash);
      if (!result.changes) fail('invalid_code');
      const id = randomUUID();
      db.prepare('INSERT INTO users (id, username, password_hash, tokens, created_at, grants_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, username, hash, STARTING_TOKENS, this.now(), this.now());
      return this.session(db, id);
    });
  }
  async login({ username, password }) {
    credentials(username, password);
    this.throttle(`login:${username.toLowerCase()}`, 15);
    const row = this.db(db => db.prepare('SELECT * FROM users WHERE username = ?').get(username));
    if (row?.npc) fail('invalid_login', 401);
    const stored = row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await passwordMatches(password, stored) || !row) fail('invalid_login', 401);
    if (row.banned) fail('account_banned', 403);
    return this.atomic(db => {
      // A temporary password from an admin reset works for exactly one login;
      // the session it creates may do nothing but set a real password.
      if (row.must_change_password === 2) fail('temporary_password_used', 403);
      if (row.must_change_password === 1) db.prepare('UPDATE users SET must_change_password = 2 WHERE id = ?').run(row.id);
      return this.session(db, row.id);
    });
  }
  // Admin-issued temporary password. It replaces the account password (old
  // sessions are dropped), works for exactly one login and forces the player
  // to set a real password before the account can be used again. Admin
  // accounts are excluded so a compromised admin session cannot lock other
  // admins out of recovery.
  async resetPassword(admin, userId) {
    if (!admin.admin) fail('forbidden', 403);
    // 16 characters from a lookalike-free alphabet; typed once from the admin screen.
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const temporaryPassword = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
    const hash = await passwordHash(temporaryPassword);
    return this.atomic(db => {
      const target = db.prepare('SELECT id, username FROM users WHERE id = ? AND npc = 0 AND admin = 0').get(String(userId));
      if (!target) fail('user_not_found', 404);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, target.id);
      // Everywhere the player is signed in stops working the moment the
      // temporary password replaces the real one.
      db.prepare('DELETE FROM account_sessions WHERE user_id = ?').run(target.id);
      pushNotification(db, target.id, {
        type: 'security', sourceKey: `password-reset:${randomUUID()}`, href: '/login',
        titleEn: 'Your password was reset', titleDe: 'Dein Passwort wurde zurückgesetzt',
        bodyEn: 'An administrator issued a temporary password. Sign in once with it and set a new password.',
        bodyDe: 'Ein Admin hat ein temporäres Passwort vergeben. Melde dich einmal damit an und setze ein neues Passwort.'
      }, this.now());
      return { userId: target.id, username: target.username, temporaryPassword };
    });
  }
  // The single permitted action on a temporary-password session: verify the
  // temporary password, store the new one and clear the forced state. The
  // guarded UPDATE keeps a second tab from racing the same change.
  async changePassword(user, { currentPassword, newPassword } = {}) {
    if (!user.must_change_password) fail('no_password_change_pending', 409);
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) fail('invalid_password');
    this.throttle(`password-change:${user.id}`, 30);
    const row = this.db(db => db.prepare('SELECT password_hash FROM users WHERE id = ? AND must_change_password != 0').get(user.id));
    const stored = row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await passwordMatches(String(currentPassword ?? ''), stored)) fail('wrong_password', 403);
    const hash = await passwordHash(newPassword);
    return this.atomic(db => {
      if (!db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND must_change_password != 0')
        .run(hash, user.id).changes) fail('no_password_change_pending', 409);
    });
  }
  codes(user, count) {
    if (!user.admin) fail('forbidden', 403);
    if (!Number.isInteger(count) || count < 1 || count > 50) fail('invalid_count');
    return this.atomic(db => Array.from({ length: count }, () => {
      const code = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO registration_codes (hash, label, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(digest(code), code.slice(-8), user.id, this.now());
      return code;
    }));
  }
  listCodes(user) {
    if (!user.admin) fail('forbidden', 403);
    return this.db(db => db.prepare('SELECT hash AS id, label, created_at, used_at, revoked FROM registration_codes ORDER BY created_at DESC LIMIT 500').all());
  }
  revokeCode(user, id) {
    if (!user.admin) fail('forbidden', 403);
    this.db(db => db.prepare('UPDATE registration_codes SET revoked = 1 WHERE hash = ? AND used_at IS NULL').run(String(id)));
  }
  adminOverview(user) {
    if (!user.admin) fail('forbidden', 403);
    return this.db(db => ({
      playerCount: db.prepare('SELECT COUNT(*) AS count FROM users WHERE npc = 0').get().count,
      users: db.prepare('SELECT id, username, admin, banned, tokens FROM users WHERE npc = 0 ORDER BY username COLLATE NOCASE').all()
        .map(row => ({ ...row, admin: Boolean(row.admin), banned: Boolean(row.banned) })),
      grants: db.prepare('SELECT amount, recipients, created_at AS createdAt FROM token_grants ORDER BY created_at DESC, rowid DESC LIMIT 20').all(),
      lastReset: db.prepare(`SELECT created_at AS createdAt, player_count AS playerCount,
        inventory_count AS inventoryCount, game_count AS gameCount,
        resale_count AS resaleCount, palette_auction_count AS paletteAuctionCount
        FROM economy_resets ORDER BY id DESC LIMIT 1`).get() || null
    }));
  }
  resetEconomy(user, confirmation) {
    if (!user.admin) fail('forbidden', 403);
    if (confirmation !== 'RESET ECONOMY') fail('invalid_reset_confirmation');
    return this.atomic(db => {
      const hasTable = name => Boolean(db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(name));
      const count = name => hasTable(name) ? db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count : 0;
      const result = {
        playerCount: db.prepare('SELECT COUNT(*) AS count FROM users WHERE npc = 0').get().count,
        inventoryCount: count('inventory'), gameCount: count('account_games'),
        resaleCount: count('resale_auctions'), paletteAuctionCount: count('primary_palette_auctions'),
        createdAt: this.now()
      };

      // Auction state goes first so escrow and inventory locks disappear in the
      // same transaction that restores balances. Authentication/social tables,
      // registration codes, passwords, bans and account_sessions are untouched.
      for (const table of ['resale_npc_interest', 'resale_bids', 'resale_auctions',
        'primary_palette_bids', 'primary_palette_rewards', 'primary_palette_auctions',
        'daily_rewards', 'xp_events', 'case_openings', 'inventory', 'account_games',
        'user_token_grants', 'token_grants', 'account_notifications']) {
        if (hasTable(table)) db.prepare(`DELETE FROM ${table}`).run();
      }
      // NPCs are runtime-owned and are recreated with their full configured
      // balance. Human ids and every login/session credential stay stable.
      db.prepare('DELETE FROM users WHERE npc = 1').run();
      db.prepare('UPDATE users SET tokens = ?, xp = 0, grants_seen_at = ? WHERE npc = 0')
        .run(STARTING_TOKENS, result.createdAt);
      db.prepare(`INSERT INTO economy_resets
        (admin_id, created_at, player_count, inventory_count, game_count, resale_count, palette_auction_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(user.id, result.createdAt, result.playerCount,
        result.inventoryCount, result.gameCount, result.resaleCount, result.paletteAuctionCount);
      return result;
    });
  }
  banUser(user, userId, banned) {
    if (!user.admin) fail('forbidden', 403);
    if (typeof banned !== 'boolean') fail('invalid_ban_state');
    return this.atomic(db => {
      const target = db.prepare('SELECT id, username, admin FROM users WHERE id = ? AND npc = 0').get(String(userId));
      if (!target) fail('user_not_found', 404);
      // Admins are the recovery path for mistakes; they can never lock each other out.
      if (target.admin) fail('ban_admin', 403);
      db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(Number(banned), target.id);
      // Drop sessions so a stale token cannot log straight back in after an unban.
      db.prepare('DELETE FROM account_sessions WHERE user_id = ?').run(target.id);
      return { userId: target.id, username: target.username, banned };
    });
  }
  grantTokens(user, amount, requestId) {
    if (!user.admin) fail('forbidden', 403);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) fail('invalid_grant_amount');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
    return this.atomic(db => {
      const previous = db.prepare('SELECT amount, recipients, created_at AS createdAt FROM token_grants WHERE admin_id = ? AND request_id = ?').get(user.id, requestId);
      if (previous) {
        if (previous.amount !== amount) fail('request_conflict', 409);
        return { ...previous };
      }
      const highest = db.prepare('SELECT MAX(tokens) AS tokens FROM users WHERE npc = 0').get().tokens || 0;
      if (!Number.isSafeInteger(highest + amount)) fail('token_balance_limit', 409);
      // One transaction snapshots the recipients at execution time. No grant is applied at registration.
      const recipients = db.prepare('UPDATE users SET tokens = tokens + ? WHERE npc = 0').run(amount).changes;
      const createdAt = this.now();
      db.prepare('INSERT INTO token_grants VALUES (?, ?, ?, ?, ?)').run(user.id, requestId, amount, recipients, createdAt);
      return { amount, recipients, createdAt };
    });
  }
  grantUserTokens(user, userId, amount, requestId) {
    if (!user.admin) fail('forbidden', 403);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) fail('invalid_grant_amount');
    if (typeof userId !== 'string' || !userId) fail('invalid_grant_user');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
    return this.atomic(db => {
      const previous = db.prepare(`SELECT g.user_id AS userId, g.amount, g.created_at AS createdAt, u.username
        FROM user_token_grants g JOIN users u ON u.id = g.user_id
        WHERE g.admin_id = ? AND g.request_id = ?`).get(user.id, requestId);
      if (previous) {
        if (previous.userId !== userId || previous.amount !== amount) fail('request_conflict', 409);
        return { ...previous };
      }
      const target = db.prepare('SELECT id, username, tokens FROM users WHERE id = ? AND npc = 0').get(userId);
      if (!target) fail('user_not_found', 404);
      if (!Number.isSafeInteger(target.tokens + amount)) fail('token_balance_limit', 409);
      db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(amount, target.id);
      const createdAt = this.now();
      db.prepare('INSERT INTO user_token_grants VALUES (?, ?, ?, ?, ?)').run(user.id, requestId, target.id, amount, createdAt);
      return { userId: target.id, username: target.username, amount, createdAt };
    });
  }
  profile(user) {
    return this.db(db => {
      const row = db.prepare('SELECT id, username, admin, tokens, xp, created_at, grants_seen_at, must_change_password FROM users WHERE id = ?').get(user.id);
      const reward = db.prepare(`SELECT daily_rewards.earned, account_games.mode, account_games.complete FROM daily_rewards
        JOIN account_games ON run_id = account_games.id WHERE daily_rewards.user_id = ? AND daily_rewards.date = ?`).get(user.id, day(this.now()));
      // Token gifts are consumed on read, so every grant is announced exactly once.
      const gifts = [...db.prepare('SELECT amount, created_at FROM user_token_grants WHERE user_id = ? AND created_at > ?').all(user.id, row.grants_seen_at),
        ...db.prepare('SELECT amount, created_at FROM token_grants WHERE created_at > ? AND created_at >= ?').all(row.grants_seen_at, row.created_at)]
        .sort((left, right) => left.created_at - right.created_at).map(gift => ({ amount: gift.amount, createdAt: gift.created_at }));
      db.prepare('UPDATE users SET grants_seen_at = ? WHERE id = ?').run(this.now(), user.id);
      const { created_at, grants_seen_at, xp, must_change_password, ...publicRow } = row;
      // Progression derives from the freshly read users.xp through the shared
      // curve — no level arithmetic lives in this class.
      return { ...publicRow, mustChangePassword: Boolean(must_change_password),
        progression: progressionForXp(xp), ...this.summary(db, user.id), admin: Boolean(row.admin), reward: reward || null, gifts, date: day(this.now()) };
    });
  }
  summary(db, userId) {
    // Sum saved item values in cents; sold items and tokens do not count as euros.
    const inventory = db.prepare(`SELECT COUNT(*) AS itemCount,
      COALESCE(SUM(CAST(ROUND(json_extract(item, '$.price') * 100) AS INTEGER)), 0) AS cents
      FROM inventory WHERE user_id = ? AND sold_at IS NULL`).get(userId);
    const game = db.prepare(`SELECT payload FROM account_games WHERE user_id = ? AND date = ? AND mode = 'daily'
      ORDER BY rowid DESC LIMIT 1`).get(userId, day(this.now()));
    const run = game ? JSON.parse(game.payload) : null;
    const indexes = marketIndexes(db, this.now());
    const inventoryMarketValue = db.prepare(`SELECT item FROM inventory WHERE user_id = ? AND sold_at IS NULL`)
      .all(userId).reduce((total, row) => total + estimatedValueTokens(currentItemValue(JSON.parse(row.item)), indexes), 0);
    const hasTable = name => Boolean(db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(name));
    let activeBids = 0;
    if (hasTable('primary_palette_auctions') && hasTable('primary_palette_bids')) {
      activeBids += db.prepare(`SELECT COUNT(*) AS count FROM primary_palette_auctions a
        WHERE a.status = 'active' AND a.ends_at > ? AND EXISTS
        (SELECT 1 FROM primary_palette_bids b WHERE b.auction_id = a.id AND b.bidder_id = ?)`).get(this.now(), userId).count;
    }
    if (hasTable('resale_auctions') && hasTable('resale_bids')) {
      activeBids += db.prepare(`SELECT COUNT(*) AS count FROM resale_auctions a
        WHERE a.status = 'active' AND a.ends_at > ? AND EXISTS
        (SELECT 1 FROM resale_bids b WHERE b.auction_id = a.id AND b.bidder_id = ?)`).get(this.now(), userId).count;
    }
    const daily = { status: run?.complete ? 'completed' : run?.answers.length ? 'in_progress' : 'not_started',
      completedRounds: run?.answers.length || 0,
      score: run?.complete ? run.answers.reduce((total, guess, i) => total + scoreGuess(guess, run.auctions[i].actualBid), 0) : null };
    return { inventoryValueEur: inventory.cents / 100, accountValueEur: inventory.cents / 100,
      inventoryMarketValue, activeBids, itemCount: inventory.itemCount, daily };
  }
  leaderboard() {
    return this.db(db => {
      const players = db.prepare(`SELECT u.id, u.username,
        COALESCE((SELECT SUM(CAST(ROUND(json_extract(i.item, '$.price') * 100) AS INTEGER))
          FROM inventory i WHERE i.user_id = u.id AND i.sold_at IS NULL), 0) AS cents
        FROM users u WHERE u.banned = 0 AND u.npc = 0 ORDER BY cents DESC, u.username COLLATE NOCASE LIMIT 100`).all();
      const scores = new Map();
      for (const row of db.prepare(`SELECT user_id, payload FROM account_games WHERE date = ? AND mode = 'daily' AND complete = 1`)
        .all(day(this.now()))) {
        const run = JSON.parse(row.payload);
        scores.set(row.user_id, run.answers.reduce((total, guess, i) => total + scoreGuess(guess, run.auctions[i].actualBid), 0));
      }
      return { date: day(this.now()), leaders: players.map((row, index) => ({ rank: index + 1, id: row.id,
        username: row.username, inventoryValueEur: row.cents / 100, score: scores.get(row.id) ?? null })) };
    });
  }
  friends(user) {
    return this.db(db => {
      const rows = db.prepare(`SELECT u.id, u.username, f.requested_by, f.accepted FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
        WHERE u.npc = 0 AND (f.user_a = ? OR f.user_b = ?) ORDER BY u.username COLLATE NOCASE`).all(user.id, user.id, user.id);
      return { date: day(this.now()), friends: rows.map(row => ({ id: row.id, username: row.username,
        status: row.accepted ? 'accepted' : row.requested_by === user.id ? 'outgoing' : 'incoming',
        ...(row.accepted ? this.summary(db, row.id) : {}) })) };
    });
  }
  requestFriend(user, username) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(username.trim())) fail('invalid_username');
    return this.atomic(db => {
      const target = db.prepare('SELECT id FROM users WHERE username = ? AND npc = 0').get(username.trim());
      if (!target) fail('user_not_found', 404);
      if (target.id === user.id) fail('friend_self');
      const pair = [user.id, target.id].sort();
      if (db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').get(...pair)) return;
      for (const id of pair) {
        const count = db.prepare('SELECT COUNT(*) AS count FROM friendships WHERE user_a = ? OR user_b = ?').get(id, id).count;
        if (count >= 100) fail('friend_limit', 409);
      }
      db.prepare('INSERT INTO friendships (user_a, user_b, requested_by, created_at) VALUES (?, ?, ?, ?)')
        .run(...pair, user.id, this.now());
    });
  }
  acceptFriend(user, friendId) {
    const pair = [user.id, String(friendId)].sort();
    this.atomic(db => {
      const result = db.prepare('UPDATE friendships SET accepted = 1 WHERE user_a = ? AND user_b = ? AND requested_by != ? AND NOT EXISTS (SELECT 1 FROM users WHERE npc = 1 AND id IN (user_a, user_b))')
        .run(...pair, user.id);
      if (!result.changes) fail('friend_request_not_found', 404);
    });
  }
  removeFriend(user, friendId) {
    const pair = [user.id, String(friendId)].sort();
    this.db(db => db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(...pair));
  }
  inventory(user) {
    return this.db(db => {
      const indexes = this.flags.resales || this.flags.market ? marketIndexes(db, this.now()) : null;
      const locked = lockedInventoryIds(db);
      return db.prepare('SELECT id, item, created_at FROM inventory WHERE user_id = ? AND sold_at IS NULL ORDER BY created_at DESC, id')
      .all(user.id).map(row => {
        const item = currentItemValue(JSON.parse(row.item));
        return { ...item, id: row.id, createdAt: row.created_at,
          ...(indexes ? { estimatedValueTokens: estimatedValueTokens(item, indexes),
            // Current category index (100 = neutral): lets the inventory card
            // show the market-adjusted euro value and the ±% since the last
            // market update.
            marketIndex: item.marketCategory ? indexes[item.marketCategory] ?? null : null,
            listed: locked.has(row.id) } : {}) };
      });
    });
  }
  openCase(user, catalog, caseId, requestId, revision = catalog.revision) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
    return this.atomic(db => {
      const previous = db.prepare('SELECT case_id, item FROM case_openings WHERE user_id = ? AND request_id = ?').get(user.id, requestId);
      if (previous) {
        if (previous.case_id !== caseId) fail('request_conflict', 409);
        return currentItemValue(JSON.parse(previous.item));
      }
      if (revision !== catalog.revision) fail('catalog_changed', 409);
      const box = catalog.cases.find(box => box.id === caseId);
      if (!box) fail('invalid_case');
      if (!box.weights.some(Boolean)) fail('empty_catalog', 503);
      if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(box.cost, user.id, box.cost).changes) fail('insufficient_tokens', 409);
      // marketCategory is frozen with the item, like rarity and sellValue.
      const drawn = drawItem(catalog, box);
      const item = { ...drawn, id: randomUUID(), caseId, caseCost: box.cost,
        marketCategory: marketCategoryForItem(drawn),
        edition: catalog.rotationDate, createdAt: this.now() };
      db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)').run(item.id, user.id, JSON.stringify(item), this.now());
      db.prepare('INSERT INTO case_openings VALUES (?, ?, ?, ?)').run(user.id, requestId, caseId, JSON.stringify(item));
      return item;
    });
  }
  sell(user, id) {
    if (this.flags.resales) fail('instant_sell_disabled', 409);
    return this.atomic(db => {
      const row = db.prepare('SELECT * FROM inventory WHERE id = ? AND user_id = ?').get(String(id), user.id);
      if (!row) fail('item_not_found', 404);
      // Items in a live or ended-but-unsettled resale auction are locked; the
      // listing owns their fate until settlement moves the item to the winner.
      if (inventoryIsLocked(db, row.id)) fail('item_listed', 409);
      const item = currentItemValue(JSON.parse(row.item));
      if (row.sold_at === null) {
        db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ?').run(this.now(), row.id);
        db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(item.sellValue, user.id);
      }
      return { sold: row.id, value: item.sellValue };
    });
  }
  sellAll(user, id) {
    if (this.flags.resales) fail('instant_sell_disabled', 409);
    return this.atomic(db => {
      const selected = db.prepare('SELECT item FROM inventory WHERE id = ? AND user_id = ?').get(String(id), user.id);
      if (!selected) fail('item_not_found', 404);
      const identity = collectibleIdentity(JSON.parse(selected.item));
      const rows = db.prepare('SELECT id, item FROM inventory WHERE user_id = ? AND sold_at IS NULL').all(user.id)
        .filter(row => collectibleIdentity(JSON.parse(row.item)) === identity);
      const listed = lockedInventoryIds(db);
      if (rows.some(row => listed.has(row.id))) fail('item_listed', 409);
      const value = rows.reduce((sum, row) => sum + currentItemValue(JSON.parse(row.item)).sellValue, 0);
      const balance = db.prepare('SELECT tokens FROM users WHERE id = ?').get(user.id).tokens;
      if (!Number.isSafeInteger(balance + value)) fail('token_balance_limit', 409);
      if (rows.length) {
        const markSold = db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ? AND sold_at IS NULL');
        for (const row of rows) markSold.run(this.now(), row.id);
        db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(value, user.id);
      }
      return { sold: rows.map(row => row.id), value };
    });
  }
  startGame(user, mode, makeAuctions, rewards = DEFAULT_REWARDS) {
    if (!['daily', 'higher-lower'].includes(mode)) fail('invalid_mode');
    return this.atomic(db => {
      const existing = db.prepare(`SELECT payload FROM account_games WHERE user_id = ? AND date = ? AND mode = ?
        ${mode === 'daily' ? '' : 'AND complete = 0'} ORDER BY rowid DESC LIMIT 1`).get(user.id, day(this.now()), mode);
      if (existing) return this.publicGame(JSON.parse(existing.payload));
      const auctions = makeAuctions();
      if (auctions.length < 2 || (mode === 'daily' && auctions.length !== 5)) fail('game_unavailable', 503);
      const run = { id: randomUUID(), date: day(this.now()), mode, auctions, answers: [], streak: 0, complete: false, earned: 0,
        rewards: rewardRates(rewards) };
      db.prepare('INSERT INTO account_games (id, user_id, date, mode, payload) VALUES (?, ?, ?, ?, ?)')
        .run(run.id, user.id, run.date, mode, JSON.stringify(run));
      return this.publicGame(run);
    });
  }
  publicGame(run) {
    return { ...run, auctions: run.auctions.map((auction, i) => {
      if (run.mode === 'daily' || i <= run.answers.length) return auction;
      const { actualBid, ...hidden } = auction;
      return hidden;
    }) };
  }
  answer(user, id, position, answer) {
    return this.atomic(db => {
      const row = db.prepare('SELECT payload FROM account_games WHERE id = ? AND user_id = ?').get(String(id), user.id);
      if (!row) fail('game_not_found', 404);
      const run = JSON.parse(row.payload);
      if (run.date !== day(this.now())) fail('daily_reset', 409);
      if (!Number.isInteger(position) || position < 0 || position > run.answers.length) fail('invalid_position', 409);
      if (position < run.answers.length) {
        if (run.answers[position] !== answer) fail('answer_conflict', 409);
        return this.publicGame(run);
      }
      if (run.complete) fail('game_complete', 409);
      if (run.mode === 'daily') {
        // null records a round whose 25-second guess clock expired with an
        // empty box: it counts toward completion but scores zero everywhere,
        // because scoreGuess treats non-finite guesses as 0.
        const timedOut = answer === null;
        if (!timedOut && (typeof answer !== 'number' || !Number.isFinite(answer) || answer < 0 || answer > 1e12)) fail('invalid_guess');
        run.answers.push(timedOut ? null : answer);
        run.complete = run.answers.length === 5;
      } else {
        if (!['higher', 'lower'].includes(answer)) fail('invalid_guess');
        const difference = run.auctions[position + 1].actualBid - run.auctions[position].actualBid;
        run.correct = difference === 0 || (answer === 'higher' ? difference > 0 : difference < 0);
        if (run.correct) run.streak++;
        run.answers.push(answer);
        run.complete = !run.correct || run.answers.length === run.auctions.length - 1;
      }
      db.prepare('INSERT OR IGNORE INTO daily_rewards (user_id, date, run_id) VALUES (?, ?, ?)').run(user.id, run.date, run.id);
      const reward = db.prepare('SELECT * FROM daily_rewards WHERE user_id = ? AND date = ?').get(user.id, run.date);
      run.rewardEligible = reward.run_id === run.id;
      if (run.complete && run.rewardEligible) {
        const rates = rewardRates(run.rewards);
        run.earned = run.mode === 'daily' ? rates.daily : run.streak >= rates.minimumStreak ?
          Math.min(rates.higherLowerMax, run.streak * rates.higherLowerPerCorrect) : 0;
        db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(run.earned, user.id);
        db.prepare('UPDATE daily_rewards SET earned = ? WHERE user_id = ? AND date = ?').run(run.earned, user.id, run.date);
      }
      if (run.complete && run.mode === 'daily') awardXp(db, user.id, 'daily', run.id, 150, this.now());
      db.prepare('UPDATE account_games SET complete = ?, payload = ? WHERE id = ?').run(Number(run.complete), JSON.stringify(run), run.id);
      return this.publicGame(run);
    });
  }
}
