import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Accounts } from '../src/accounts.mjs';
import { caseCatalog, itemRarity, drawItem } from '../src/cases.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { createAccountApi } from '../src/account-api.mjs';

const password = 'test-only-password-123';
const lots = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `Product ${i + 100}`,
  category: 'Werkzeug', image: `/assets/${i}.jpg`, currentBid: [1, 20, 100, 1000, 10000, 100000, 50, 500][i], actualBid: (i + 1) * 10 }));
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-accounts-'));
  let now = Date.parse('2026-09-12T12:00:00Z');
  const service = new Accounts(dir, { now: () => now });
  await service.bootstrap('admin', password);
  const admin = service.user(await service.login({ username: 'admin', password }));
  const register = async username => service.user(await service.register({ username, password, code: service.codes(admin, 1)[0] }));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, service, admin, register, nextDay: () => now += 86400000 };
}

test('registration codes are single-use and admin-only; credentials, sessions and bootstrap persist safely', async t => {
  const { service, dir, admin, register } = await fixture(t);
  const [code] = service.codes(admin, 2);
  const results = await Promise.allSettled(['Alice', 'Bob'].map(username => service.register({ username, password, code })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const token = results.find(result => result.status === 'fulfilled').value;
  const user = service.user(token);
  assert.equal(user.tokens, 0);
  assert.notEqual(user.password_hash, password);
  assert.throws(() => service.codes(user, 2), { status: 403 });
  assert.throws(() => service.listCodes(user), { status: 403 });
  assert.throws(() => service.revokeCode(user, 'x'), { status: 403 });
  await assert.rejects(service.login({ username: user.username, password: 'wrong-password-123' }), { message: 'invalid_login' });
  const login = await service.login({ username: user.username.toUpperCase(), password });
  assert.equal(service.user(login).id, user.id);
  await assert.rejects(service.bootstrap(user.username, password), /regular account/);
  const revoke = service.codes(admin, 1)[0];
  const row = service.listCodes(admin).find(row => row.label === revoke.slice(-8));
  service.revokeCode(admin, row.id);
  await assert.rejects(service.register({ username: 'Charlie', password, code: revoke }), /invalid_code/);
  const unused = service.codes(admin, 1)[0];
  await assert.rejects(service.register({ username: user.username.toLowerCase(), password, code: unused }), /username_taken/);
  await service.register({ username: 'Delta', password, code: unused });
  closeDataStore(dir);
  const reopened = new Accounts(dir);
  assert.equal(reopened.user(login).id, user.id);
  reopened.logout(login);
  assert.equal(reopened.user(login), null);
  await service.bootstrap('admin', 'changed-password-123');
  await assert.rejects(service.login({ username: 'admin', password }), /invalid_login/);
  await register('Echo');
});

test('daily rewards are once per account per UTC day across modes, survive replay and resume, and reject foreign runs', async t => {
  const { service, admin, register, nextDay } = await fixture(t);
  const other = await register('other');
  let run = service.startGame(admin, 'daily', () => lots.slice(0, 5));
  assert.equal(service.startGame(admin, 'daily', () => []).id, run.id);
  assert.throws(() => service.answer(other, run.id, 0, 10), { status: 404 });
  assert.throws(() => service.answer(admin, run.id, 1, 10), /invalid_position/);
  assert.throws(() => service.answer(admin, run.id, 0, '100'), /invalid_guess/);
  for (let i = 0; i < 5; i++) run = service.answer(admin, run.id, i, 10);
  assert.equal(run.earned, 100);
  assert.equal(service.answer(admin, run.id, 4, 10).earned, 100);
  assert.equal(service.profile(admin).tokens, 100);
  assert.throws(() => service.answer(admin, run.id, 4, 20), /answer_conflict/);
  const hl = service.startGame(admin, 'higher-lower', () => lots);
  assert.equal(hl.auctions[0].actualBid, 10);
  assert.ok(hl.auctions.slice(1).every(item => !('actualBid' in item)));
  let result;
  for (let i = 0; i < 7; i++) result = service.answer(admin, hl.id, i, 'higher');
  assert.equal(result.earned, 0);
  assert.equal(service.profile(admin).tokens, 100);
  nextDay();
  assert.equal(service.profile(admin).reward, null);
  assert.throws(() => service.answer(admin, run.id, 0, 10), /daily_reset/);
  const fresh = service.startGame(admin, 'higher-lower', () => lots);
  assert.notEqual(fresh.id, hl.id);
  for (let i = 0; i < 7; i++) result = service.answer(admin, fresh.id, i, 'higher');
  assert.equal(result.earned, 140);
  assert.equal(service.profile(admin).tokens, 240);
});

test('first answer reserves the run, low streaks earn zero, ties count and another mode cannot replace a failed run', async t => {
  const { service, admin, nextDay } = await fixture(t);
  const hl = service.startGame(admin, 'higher-lower', () => lots);
  service.startGame(admin, 'daily', () => lots.slice(0, 5));
  assert.equal(service.profile(admin).reward, null);
  const ended = service.answer(admin, hl.id, 0, 'lower');
  assert.equal(ended.complete, true);
  assert.equal(ended.earned, 0);
  const daily = service.startGame(admin, 'daily', () => []);
  for (let i = 0; i < 5; i++) service.answer(admin, daily.id, i, 10);
  assert.equal(service.profile(admin).tokens, 0);
  nextDay();
  const tie = service.startGame(admin, 'higher-lower', () => Array.from({ length: 15 }, () => ({ ...lots[0], actualBid: 10 })));
  let result;
  for (let i = 0; i < 14; i++) result = service.answer(admin, tie.id, i, i % 2 ? 'higher' : 'lower');
  assert.equal(result.streak, 14);
  assert.equal(result.earned, 200);
});

test('case debits, item ownership, idempotent openings and sales remain atomic across restart', async t => {
  const { service, dir, admin, register } = await fixture(t);
  const other = await register('other');
  const catalog = caseCatalog(lots);
  assert.throws(() => service.openCase(admin, catalog, 'fundkiste', 'test-request-00001'), /insufficient_tokens/);
  const daily = service.startGame(admin, 'daily', () => lots.slice(0, 5));
  for (let i = 0; i < 5; i++) service.answer(admin, daily.id, i, 10);
  assert.throws(() => service.openCase(admin, catalog, 'fundkiste', 'test-request-00001', 'stale'), /catalog_changed/);
  assert.equal(service.profile(admin).tokens, 100);
  const item = service.openCase(admin, catalog, 'fundkiste', 'test-request-00001');
  assert.equal(service.profile(admin).tokens, 0);
  assert.deepEqual(service.openCase(admin, catalog, 'fundkiste', 'test-request-00001'), item);
  assert.throws(() => service.openCase(admin, catalog, 'schatzkiste', 'test-request-00001'), /request_conflict/);
  assert.throws(() => service.openCase(admin, catalog, 'fundkiste', 'test-request-00002'), /insufficient_tokens/);
  assert.equal(service.inventory(admin).length, 1);
  assert.equal(service.inventory(other).length, 0);
  assert.throws(() => service.sell(other, item.id), { status: 404 });
  service.sell(admin, item.id); service.sell(admin, item.id);
  assert.equal(service.profile(admin).tokens, item.sellValue);
  assert.equal(service.inventory(admin).length, 0);
  closeDataStore(dir);
  const reopened = new Accounts(dir);
  assert.equal(reopened.profile(admin).tokens, item.sellValue);
  assert.equal(reopened.inventory(admin).length, 0);
  assert.deepEqual(reopened.openCase(admin, catalog, 'fundkiste', 'test-request-00001'), item);
});

test('rarity reflects price and uniqueness; catalog collapses families and normalizes unavailable odds', () => {
  assert.equal(itemRarity(1, 1).id, 'common');
  assert.equal(itemRarity(100000, 1).id, 'legendary');
  assert.notEqual(itemRarity(100, 1).id, itemRarity(100, 25).id);
  const catalog = caseCatalog([...lots, { ...lots[0], id: 999 }]);
  assert.equal(catalog.items.length, lots.length);
  assert.equal(catalog.items.find(item => item.auctionId === 1).familySize, 2);
  for (const box of catalog.cases) {
    assert.ok(Math.abs(box.odds.reduce((sum, rarity) => sum + rarity.chance, 0) - 100) < 1e-9);
    const total = box.weights.reduce((sum, value) => sum + value, 0);
    for (let roll = 0; roll < total; roll++) {
      let calls = 0;
      const item = drawItem(catalog, box, () => calls++ ? 0 : roll);
      assert.ok(catalog.items.includes(item));
    }
  }
  const onlyCommon = caseCatalog([lots[0]]);
  assert.equal(onlyCommon.cases[0].odds[0].chance, 100);
  assert.ok(caseCatalog([]).cases.every(box => box.odds.every(rarity => rarity.chance === 0)));
});

test('HTTP API enforces authentication, CSRF headers, admin permissions and session cookies without exposing secrets', async t => {
  const { dir } = await fixture(t);
  upsertAuctions(dir, lots);
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const api = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: lots.slice(0, 5) }), json,
    env: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true' } });
  const server = createServer(async (req, res) => { if (!await api(req, res, new URL(req.url, 'http://localhost'))) json(res, 404, {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/account/`;
  const post = (route, value, cookie = '', extra = {}) => fetch(base + route, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR', cookie, ...extra }, body: JSON.stringify(value) });
  assert.equal((await fetch(base + 'inventory')).status, 401);
  assert.equal((await post('login', { username: 'admin', password }, '', { 'x-requested-with': '' })).status, 403);
  assert.equal((await post('login', { username: 'admin', password }, '', { 'sec-fetch-site': 'cross-site' })).status, 403);
  const response = await post('login', { username: 'admin', password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /Secure/);
  const profile = await response.json();
  assert.ok(!JSON.stringify(profile).includes('password'));
  assert.equal(profile.user.tokens, 0);
  const codes = await (await post('codes', { count: 3 }, cookie)).json();
  assert.equal(codes.codes.length, 3);
  const registered = await post('register', { username: 'player', password, code: codes.codes[0] });
  const playerCookie = registered.headers.get('set-cookie');
  assert.equal(registered.status, 200);
  assert.equal((await post('codes', { count: 1 }, playerCookie)).status, 403);
  assert.equal((await fetch(base + 'codes', { headers: { cookie: playerCookie } })).status, 403);
  assert.equal((await post('logout', {}, playerCookie)).status, 200);
  assert.equal((await (await fetch(base + 'me', { headers: { cookie: playerCookie } })).json()).user, null);
  assert.equal((await post('login', { username: 'admin', password: 'x'.repeat(9000) })).status, 413);
});
