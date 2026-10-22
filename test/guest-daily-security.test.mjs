import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createGuestGameApi } from '../src/guest-game-api.mjs';
import { createGuestGamePayloads } from '../src/guest-game-payloads.mjs';
import { selectDailySet } from '../src/core.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';

const at = Date.parse('2026-10-13T10:00:00Z');
const stock = Array.from({ length: 36 }, (_, n) => ({ id: 1000 + n, title: `Auction item ${n}`,
  category: ['Vehicles', 'Tools', 'Jewelry', 'Electronics', 'Furniture', 'Fashion'][n % 6],
  image: `/assets/${n}.jpg`, sourceImages: [`https://www.justiz-auktion.de/uplimg/${n}.jpg`],
  currentBid: 100 + n * 7, finalPrice: 100 + n * 7,
  endAt: '2026-10-11T00:00:00Z', capturedAt: '2026-10-12T00:00:00Z' }));

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jg-guest-daily-security-'));
  const accounts = new Accounts(dir, { now: () => at });
  accounts.db(db => db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES ('player','Player','disabled',1000,?)").run(at));
  const token = accounts.atomic(db => accounts.session(db, 'player'));
  const daily = selectDailySet(stock, '2026-10-13');
  daily.auctions = daily.auctions.map(item => ({ ...item, actualBid: item.correctPrice }));
  // The relisted duplicate must stay protected even though its ID changed.
  const original = stock.find(item => item.id === daily.auctions[0].id);
  upsertAuctions(dir, [...stock, { ...original, id: 9000, title: 'Relisted lot' }]);
  const dailyPayload = async () => daily;
  const providers = createGuestGamePayloads({ dataDir: dir, dailyPayload, now: () => at });
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let guest = createGuestGameApi({ dataDir: dir, ...providers, json, env: {}, now: () => at });
  const account = await createAccountApi({ dataDir: dir, dailyPayload, json, env: {} });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await guest(req, res, url) || await account(req, res, url)) return;
    json(res, 404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    closeDataStore(dir); await rm(dir, { recursive: true, force: true });
  });
  const post = (route, body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR' }, body: JSON.stringify(body)
  });
  return { dir, accounts, token, daily, providers, post,
    restart: () => { guest = createGuestGameApi({ dataDir: dir, ...providers, json, env: {}, now: () => at }); } };
}

test('anonymous modes exclude rewarded Daily families, including relisted duplicates', async t => {
  const f = await fixture(t);
  const protectedIds = new Set([...f.daily.auctions.map(item => item.id), 9000]);
  for (const maker of Object.values(f.providers)) {
    const game = await maker();
    assert.ok(game.auctions.length >= 5);
    assert.ok(game.auctions.every(item => !protectedIds.has(item.id)));
  }
  const first = await f.providers.dailyPayload(), second = await f.providers.dailyPayload();
  assert.deepEqual(first.auctions, second.auctions);
});

test('guest-first play reveals separate answers and leaves the rewarded Daily attempt untouched', async t => {
  const f = await fixture(t);
  const started = await f.post('games/start', { mode: 'daily' });
  assert.equal(started.status, 200);
  const cookie = started.headers.get('set-cookie').split(';')[0];
  let run = (await started.json()).run;
  const guestId = run.id, deadline = run.roundDeadlineAt;
  f.restart();
  run = (await (await f.post('games/start', { mode: 'daily' }, cookie)).json()).run;
  assert.equal(run.id, guestId); assert.equal(run.roundDeadlineAt, deadline);
  for (let position = 0; position < 5; position++) {
    if (position) assert.equal((await f.post('games/round/start', { id: run.id, position }, cookie)).status, 200);
    const response = await f.post('games/answer', { id: run.id, position, answer: 0 }, cookie);
    assert.equal(response.status, 200); run = (await response.json()).run;
    assert.ok(Number.isFinite(run.auctions[position].actualBid));
    assert.ok(!f.daily.auctions.some(item => item.id === run.auctions[position].id));
    assert.equal('questionSetVersion' in run, false);
  }
  assert.equal(run.complete, true);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) n FROM account_games').get().n), 0);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) n FROM daily_case_rewards').get().n), 0);
  const account = await f.post('account/games/start', { mode: 'daily' }, `jg_session=${f.token}`);
  assert.equal(account.status, 200);
  const rewarded = (await account.json()).run;
  assert.equal(rewarded.auctions[0].id, f.daily.auctions[0].id);
  assert.equal('actualBid' in rewarded.auctions[0], false);
  assert.deepEqual(rewarded.answers, []);
});

test('startup expires legacy guest questions and sparse pools never fall back to Daily answers', async t => {
  const f = await fixture(t);
  f.accounts.db(db => db.prepare('INSERT INTO guest_game_runs VALUES (?,?,?,?,?,?)').run('legacy', 'old-session', f.daily.date, 'daily',
    JSON.stringify({ auctions: f.daily.auctions, answers: [] }), at + 86400_000));
  f.restart();
  assert.equal(f.accounts.db(db => db.prepare("SELECT COUNT(*) n FROM guest_game_runs WHERE id='legacy'").get().n), 0);
  f.accounts.db(db => db.prepare('DELETE FROM auctions').run());
  upsertAuctions(f.dir, stock.filter(item => f.daily.auctions.some(daily => daily.id === item.id)));
  for (const mode of ['daily', 'random', 'higher-lower']) {
    const response = await f.post('games/start', { mode });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'insufficient_variety');
  }
});
