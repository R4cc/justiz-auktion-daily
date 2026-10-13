import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { AccountError } from './errors.mjs';
import { clientIp } from './client-ip.mjs';
import { dailyAnswer, publicRunAuctions, startDailyRound } from './game-rounds.mjs';
import { jsonBody } from './json-body.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const day = now => new Date(now).toISOString().slice(0, 10);
const fail = (code, status = 400) => { throw new AccountError(code, status); };

// Guest rounds have no account, inventory or currency side effects. Daily
// owns one resumable run per session/day; practice runs have bounded storage.
export function createGuestGameApi({ dataDir, dailyPayload, randomPayload, higherLowerPayload, json, env = process.env, now = Date.now }) {
  const atomic = work => withDatabase(dataDir, db => transaction(db, () => work(db)));
  const secure = env.COOKIE_SECURE !== 'false' && (env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production');
  atomic(db => db.exec(`CREATE TABLE IF NOT EXISTS guest_game_runs (
    id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, date TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('daily','random','higher-lower')),
    payload TEXT NOT NULL CHECK(json_valid(payload)), expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS guest_daily_session ON guest_game_runs(session_hash,date) WHERE mode='daily';
  CREATE TABLE IF NOT EXISTS guest_game_limits (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
  ) STRICT;`));
  function throttle(request, kind, limit, window = 15 * 60_000) {
    atomic(db => {
      const at = now(), key = digest(`${kind}:${clientIp(request, env.TRUST_CLOUDFLARE_IP === 'true')}`);
      db.prepare('DELETE FROM guest_game_limits WHERE expires_at <= ?').run(at);
      const previous = db.prepare('SELECT count FROM guest_game_limits WHERE key = ?').get(key);
      if (previous?.count >= limit) fail('try_later', 429);
      db.prepare(`INSERT INTO guest_game_limits VALUES (?,1,?) ON CONFLICT(key)
        DO UPDATE SET count=count+1`).run(key, at + window);
    });
  }
  const view = run => {
    const { submittedAnswers, ...result } = run;
    return { ...result, guest: true, serverNow: now(), auctions: publicRunAuctions(run) };
  };
  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/games/')) return false;
    try {
      if (request.method !== 'POST') fail('method_not_allowed', 405);
      if (request.headers['x-requested-with'] !== 'JUSTIZGUESSR' || request.headers['sec-fetch-site'] === 'cross-site') fail('forbidden', 403);
      const route = url.pathname.slice('/api/games/'.length);
      if (!['start','round/start','answer'].includes(route)) fail('not_found', 404);
      throttle(request, 'mutate', 500);
      const payload = await jsonBody(request);
      let token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jg_guest='))?.slice(9);
      if (!/^[a-f0-9]{64}$/.test(token || '')) token = null;
      let run;
      if (route === 'start') {
        if (!['daily','random','higher-lower'].includes(payload.mode)) fail('invalid_mode');
        const session = token || randomBytes(32).toString('hex');
        const previousRun = db => db.prepare(`SELECT payload FROM guest_game_runs WHERE session_hash=? AND date=? AND mode=?
          AND (mode='daily' OR (mode='higher-lower' AND json_extract(payload,'$.complete')=0)) ORDER BY rowid DESC LIMIT 1`)
          .get(digest(session), day(now()), payload.mode);
        const existing = atomic(previousRun);
        if (!existing) throttle(request, `start:${payload.mode}`, payload.mode === 'higher-lower' ? 60 : 10,
          payload.mode === 'random' ? 60_000 : 15 * 60_000);
        const maker = payload.mode === 'daily' ? dailyPayload : payload.mode === 'random' ? randomPayload : higherLowerPayload;
        if (!maker) fail('game_unavailable', 503);
        const game = existing ? null : await maker();
        run = atomic(db => {
          const at = now(), date = day(at), hash = digest(session);
          const previous = previousRun(db);
          if (previous) return JSON.parse(previous.payload);
          if (!game || !Array.isArray(game.auctions) || game.auctions.length < 2 ||
              (payload.mode !== 'higher-lower' && game.auctions.length !== 5)) fail('game_unavailable', 503);
          db.prepare('DELETE FROM guest_game_runs WHERE expires_at <= ?').run(at);
          // Retain at most 2,000 anonymous runs including this insertion.
          db.exec('DELETE FROM guest_game_runs WHERE rowid NOT IN (SELECT rowid FROM guest_game_runs ORDER BY rowid DESC LIMIT 1999)');
          const next = { id: randomUUID(), date, mode: payload.mode, auctions: game.auctions,
            answers: [], streak: 0, complete: false, earned: 0 };
          if (next.mode !== 'higher-lower') startDailyRound(next, 0, at);
          db.prepare('INSERT INTO guest_game_runs VALUES (?,?,?,?,?,?)')
            .run(next.id, hash, date, next.mode, JSON.stringify(next), at + 2 * 86400_000);
          return next;
        });
        response.setHeader('set-cookie', `jg_guest=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`);
      } else {
        if (!token) fail('game_not_found', 404);
        run = atomic(db => {
          const at = now();
          const row = db.prepare('SELECT payload FROM guest_game_runs WHERE id=? AND session_hash=? AND expires_at>?')
            .get(String(payload.id), digest(token), at);
          if (!row) fail('game_not_found', 404);
          const next = JSON.parse(row.payload);
          if (next.date !== day(at)) fail('daily_reset', 409);
          const position = payload.position;
          if (route === 'round/start') {
            if (next.mode === 'higher-lower') fail('invalid_mode');
            startDailyRound(next, position, at);
          }
          else {
            if (!Number.isInteger(position) || position < 0 || position > next.answers.length) fail('invalid_position', 409);
            if (position < next.answers.length) {
              if (next.answers[position] !== payload.answer && next.submittedAnswers?.[position] !== payload.answer) fail('answer_conflict', 409);
              return next;
            }
            if (next.complete) fail('game_complete', 409);
            if (next.mode === 'higher-lower') {
              if (!['higher','lower'].includes(payload.answer)) fail('invalid_guess');
              const difference = next.auctions[position + 1].actualBid - next.auctions[position].actualBid;
              next.correct = difference === 0 || (payload.answer === 'higher' ? difference > 0 : difference < 0);
              if (next.correct) next.streak++;
              next.answers.push(payload.answer);
              next.complete = !next.correct || next.answers.length === next.auctions.length - 1;
            } else {
              const accepted = dailyAnswer(next, payload.answer, at);
              next.submittedAnswers ||= [];
              next.submittedAnswers.push(payload.answer);
              next.answers.push(accepted);
              next.roundDeadlineAt = null;
              next.complete = next.answers.length === next.auctions.length;
            }
          }
          db.prepare('UPDATE guest_game_runs SET payload=? WHERE id=?').run(JSON.stringify(next), next.id);
          return next;
        });
      }
      json(response, 200, { run: view(run) });
    } catch (error) {
      if (error instanceof AccountError) json(response, error.status, { error: error.message });
      else if (error.code === 'insufficient_variety') json(response, 503, { error: 'insufficient_variety' });
      else { console.error('Guest game API failed'); json(response, 500, { error: 'internal_error' }); }
    }
    return true;
  };
}
