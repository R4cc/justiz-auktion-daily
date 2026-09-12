import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { withDatabase, transaction } from './database.mjs';
import { drawItem } from './cases.mjs';
import { scoreGuess } from './core.mjs';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const day = now => new Date(now).toISOString().slice(0, 10);
const SESSION_MS = 30 * 86400000;
export class AccountError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
const fail = (code, status) => { throw new AccountError(code, status); };

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
  constructor(dataDir, { now = Date.now } = {}) {
    this.dataDir = dataDir;
    this.now = now;
    this.db(db => db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0 CHECK(tokens >= 0), created_at INTEGER NOT NULL
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
    `));
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
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
        db.prepare('DELETE FROM account_sessions WHERE user_id = ?').run(existing.id);
      } else db.prepare('INSERT INTO users (id, username, password_hash, admin, created_at) VALUES (?, ?, ?, 1, ?)')
        .run(randomUUID(), username, hash, this.now());
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
      WHERE hash = ? AND expires > ?`).get(digest(token), this.now())) || null;
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
      db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, username, hash, this.now());
      return this.session(db, id);
    });
  }
  async login({ username, password }) {
    credentials(username, password);
    this.throttle(`login:${username.toLowerCase()}`, 15);
    const row = this.db(db => db.prepare('SELECT * FROM users WHERE username = ?').get(username));
    const stored = row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await passwordMatches(password, stored) || !row) fail('invalid_login', 401);
    return this.atomic(db => this.session(db, row.id));
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
  profile(user) {
    return this.db(db => {
      const row = db.prepare('SELECT id, username, admin, tokens FROM users WHERE id = ?').get(user.id);
      const reward = db.prepare(`SELECT daily_rewards.earned, account_games.mode, account_games.complete FROM daily_rewards
        JOIN account_games ON run_id = account_games.id WHERE daily_rewards.user_id = ? AND daily_rewards.date = ?`).get(user.id, day(this.now()));
      return { ...row, ...this.summary(db, user.id), admin: Boolean(row.admin), reward: reward || null, date: day(this.now()) };
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
    const daily = { status: run?.complete ? 'completed' : run?.answers.length ? 'in_progress' : 'not_started',
      completedRounds: run?.answers.length || 0,
      score: run?.complete ? run.answers.reduce((total, guess, i) => total + scoreGuess(guess, run.auctions[i].actualBid), 0) : null };
    return { inventoryValueEur: inventory.cents / 100, accountValueEur: inventory.cents / 100,
      itemCount: inventory.itemCount, daily };
  }
  friends(user) {
    return this.db(db => {
      const rows = db.prepare(`SELECT u.id, u.username, f.requested_by, f.accepted FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
        WHERE f.user_a = ? OR f.user_b = ? ORDER BY u.username COLLATE NOCASE`).all(user.id, user.id, user.id);
      return { date: day(this.now()), friends: rows.map(row => ({ id: row.id, username: row.username,
        status: row.accepted ? 'accepted' : row.requested_by === user.id ? 'outgoing' : 'incoming',
        ...(row.accepted ? this.summary(db, row.id) : {}) })) };
    });
  }
  requestFriend(user, username) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(username.trim())) fail('invalid_username');
    return this.atomic(db => {
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
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
      const result = db.prepare('UPDATE friendships SET accepted = 1 WHERE user_a = ? AND user_b = ? AND requested_by != ?')
        .run(...pair, user.id);
      if (!result.changes) fail('friend_request_not_found', 404);
    });
  }
  removeFriend(user, friendId) {
    const pair = [user.id, String(friendId)].sort();
    this.db(db => db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(...pair));
  }
  inventory(user) {
    return this.db(db => db.prepare('SELECT id, item, created_at FROM inventory WHERE user_id = ? AND sold_at IS NULL ORDER BY created_at DESC, id')
      .all(user.id).map(row => ({ ...JSON.parse(row.item), id: row.id, createdAt: row.created_at })));
  }
  openCase(user, catalog, caseId, requestId, revision = catalog.revision) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
    return this.atomic(db => {
      const previous = db.prepare('SELECT case_id, item FROM case_openings WHERE user_id = ? AND request_id = ?').get(user.id, requestId);
      if (previous) {
        if (previous.case_id !== caseId) fail('request_conflict', 409);
        return JSON.parse(previous.item);
      }
      if (revision !== catalog.revision) fail('catalog_changed', 409);
      const box = catalog.cases.find(box => box.id === caseId);
      if (!box) fail('invalid_case');
      if (!box.weights.some(Boolean)) fail('empty_catalog', 503);
      if (!db.prepare('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?').run(box.cost, user.id, box.cost).changes) fail('insufficient_tokens', 409);
      const item = { ...drawItem(catalog, box), id: randomUUID(), caseId, createdAt: this.now() };
      db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)').run(item.id, user.id, JSON.stringify(item), this.now());
      db.prepare('INSERT INTO case_openings VALUES (?, ?, ?, ?)').run(user.id, requestId, caseId, JSON.stringify(item));
      return item;
    });
  }
  sell(user, id) {
    return this.atomic(db => {
      const row = db.prepare('SELECT * FROM inventory WHERE id = ? AND user_id = ?').get(String(id), user.id);
      if (!row) fail('item_not_found', 404);
      const item = JSON.parse(row.item);
      if (row.sold_at === null) {
        db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ?').run(this.now(), row.id);
        db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(item.sellValue, user.id);
      }
      return { sold: row.id, value: item.sellValue };
    });
  }
  startGame(user, mode, makeAuctions) {
    if (!['daily', 'higher-lower'].includes(mode)) fail('invalid_mode');
    return this.atomic(db => {
      const existing = db.prepare(`SELECT payload FROM account_games WHERE user_id = ? AND date = ? AND mode = ?
        ${mode === 'daily' ? '' : 'AND complete = 0'} ORDER BY rowid DESC LIMIT 1`).get(user.id, day(this.now()), mode);
      if (existing) return this.publicGame(JSON.parse(existing.payload));
      const auctions = makeAuctions();
      if (auctions.length < 2 || (mode === 'daily' && auctions.length !== 5)) fail('game_unavailable', 503);
      const run = { id: randomUUID(), date: day(this.now()), mode, auctions, answers: [], streak: 0, complete: false, earned: 0 };
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
        if (typeof answer !== 'number' || !Number.isFinite(answer) || answer < 0 || answer > 1e12) fail('invalid_guess');
        run.answers.push(answer);
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
        run.earned = run.mode === 'daily' ? 100 : run.streak >= 3 ? Math.min(200, run.streak * 20) : 0;
        db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(run.earned, user.id);
        db.prepare('UPDATE daily_rewards SET earned = ? WHERE user_id = ? AND date = ?').run(run.earned, user.id, run.date);
      }
      db.prepare('UPDATE account_games SET complete = ?, payload = ? WHERE id = ?').run(Number(run.complete), JSON.stringify(run), run.id);
      return this.publicGame(run);
    });
  }
}
