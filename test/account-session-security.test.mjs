import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore } from '../src/database.mjs';
import { featureFlags } from '../src/features.mjs';
import { buyBusiness } from '../src/businesses.mjs';

async function fixture(t, dailyPayload = async () => ({ auctions: [] })) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jg-session-security-'));
  const accounts = new Accounts(dir);
  accounts.db(db => {
    for (const id of ['admin', 'player']) db.prepare(`INSERT INTO users
      (id,username,password_hash,admin,tokens,created_at) VALUES (?,?,'disabled',?,100000,?)`)
      .run(id, id, id === 'admin' ? 1 : 0, Date.now());
  });
  const token = accounts.atomic(db => accounts.session(db, 'player'));
  const cookie = `jg_session=${token}`;
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const api = await createAccountApi({ dataDir: dir, dailyPayload, json, env: {} });
  const economy = createEconomyApi({ dataDir: dir, json, flags: featureFlags({}) });
  let onHeaders;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pending = api(req, res, url);
    onHeaders?.(); onHeaders = null;
    if (await pending || economy(req, res, url)) return;
    json(res, 404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    closeDataStore(dir);
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function delayedMutation(route, payload) {
    const body = JSON.stringify(payload);
    const ready = new Promise(resolve => { onHeaders = resolve; });
    let request;
    const result = new Promise((resolve, reject) => {
      request = httpRequest(`${base}/api/account/${route}`, { method: 'POST', headers: {
        cookie, 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR',
        'content-length': Buffer.byteLength(body)
      } }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      });
      request.on('error', reject);
      request.flushHeaders();
    });
    await ready;
    return { finish: () => request.end(body), result };
  }
  return { dir, accounts, token, cookie, base, delayedMutation };
}

test('mutations recheck session revocation and restrictions after a delayed body', async t => {
  for (const kind of ['logout', 'ban', 'password-reset', 'player-reset', 'expired', 'forced-change', 'jailed']) await t.test(kind, async t => {
    const f = await fixture(t);
    const pending = await f.delayedMutation('friends/request', { username: 'admin' });
    if (kind === 'logout') f.accounts.logout(f.token);
    else if (kind === 'ban') f.accounts.banUser({ id: 'admin', admin: true }, 'player', true);
    else if (kind === 'password-reset') await f.accounts.resetPassword({ id: 'admin', admin: true }, 'player');
    else if (kind === 'player-reset') f.accounts.resetPlayer({ id: 'admin' }, { userId: 'player', confirmation: 'player', requestId: 'security-player-reset-0001' });
    else if (kind === 'expired') f.accounts.db(db => db.prepare('UPDATE account_sessions SET expires=0').run());
    else if (kind === 'forced-change') f.accounts.db(db => db.prepare('UPDATE users SET must_change_password=2 WHERE id=?').run('player'));
    else f.accounts.db(db => db.prepare('INSERT INTO player_justice(user_id,jailed_until,offences) VALUES (?,?,1)').run('player', Date.now() + 60000));
    pending.finish();
    const response = await pending.result;
    assert.equal(response.status, kind === 'jailed' ? 423 : kind === 'forced-change' ? 403 : 401);
    assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) n FROM friendships').get().n), 0);
    assert.equal(f.accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get('player').tokens), kind === 'player-reset' ? 1000 : 100000);
  });
});

test('game creation rechecks the session after awaiting the Daily provider', async t => {
  let started, resume;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const lots = Array.from({ length: 5 }, (_, id) => ({ id, title: `Lot ${id}`, actualBid: 100 }));
  const f = await fixture(t, async () => { started(); await gate; return { auctions: lots }; });
  const result = fetch(`${f.base}/api/account/games/start`, { method: 'POST', headers: {
    cookie: f.cookie, 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR'
  }, body: JSON.stringify({ mode: 'daily' }) });
  await ready;
  f.accounts.logout(f.token);
  resume();
  assert.equal((await result).status, 401);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) n FROM account_games').get().n), 0);
});

test('temporary sessions cannot use account GET routes', async t => {
  const f = await fixture(t);
  f.accounts.db(db => db.prepare('UPDATE users SET must_change_password=2 WHERE id=?').run('player'));
  for (const route of ['cases', 'case-store', 'leaderboard', 'inventory']) {
    const response = await fetch(`${f.base}/api/account/${route}`, { headers: { cookie: f.cookie } });
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).error, 'password_change_required');
  }
  assert.equal((await fetch(`${f.base}/api/account/me`, { headers: { cookie: f.cookie } })).status, 200);
});

test('temporary sessions receive anonymous public storefronts', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, { id: 'admin' }, 'wine', 'popup').shop;
  f.accounts.db(db => db.prepare('UPDATE users SET must_change_password=2 WHERE id=?').run('player'));
  for (const cookie of ['', f.cookie]) {
    const response = await fetch(`${f.base}/api/stores`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stores[0].owner, 'ad****');
    const detail = await fetch(`${f.base}/api/stores/${shop.id}`, { headers: { cookie } });
    assert.equal(detail.status, 200);
    const store = (await detail.json()).store;
    assert.equal(store.owner, 'ad****');
    assert.equal(store.heist, null);
    assert.equal(store.myReview, null);
  }
});
