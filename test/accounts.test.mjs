import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Accounts, STARTING_TOKENS } from '../src/accounts.mjs';
import { caseCatalog, publicCaseCatalog, itemRarity, drawItem } from '../src/cases.mjs';
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

test('friend requests require recipient acceptance, hide pending statistics and persist without duplicates', async t => {
  const { service, admin, register, dir } = await fixture(t);
  const alice = await register('Alice'), bob = await register('Bob');
  assert.throws(() => service.requestFriend(alice, 'alice'), /friend_self/);
  assert.throws(() => service.requestFriend(alice, 'Missing'), /user_not_found/);
  service.requestFriend(alice, ' bOB ');
  service.requestFriend(alice, 'Bob');
  service.requestFriend(bob, 'Alice');
  assert.deepEqual(service.friends(alice).friends, [{ id: bob.id, username: 'Bob', status: 'outgoing' }]);
  assert.equal(service.friends(bob).friends[0].status, 'incoming');
  assert.equal(service.friends(admin).friends.length, 0);
  assert.throws(() => service.acceptFriend(alice, bob.id), /friend_request_not_found/);
  assert.throws(() => service.acceptFriend(admin, alice.id), /friend_request_not_found/);
  service.acceptFriend(bob, alice.id);
  service.acceptFriend(bob, alice.id);
  assert.equal(service.friends(alice).friends[0].status, 'accepted');
  assert.equal(service.friends(bob).friends[0].inventoryValueEur, 0);
  closeDataStore(dir);
  assert.equal(new Accounts(dir).friends(alice).friends.length, 1);
  service.removeFriend(admin, bob.id);
  assert.equal(service.friends(alice).friends.length, 1);
  service.removeFriend(bob, alice.id);
  assert.equal(service.friends(alice).friends.length, 0);
  service.requestFriend(alice, 'Bob'); service.removeFriend(alice, bob.id);
  assert.equal(service.friends(bob).friends.length, 0);
  service.requestFriend(alice, 'Bob'); service.removeFriend(bob, alice.id);
  assert.equal(service.friends(alice).friends.length, 0);
});

test('account and friend euro values count retained copies, exclude sold items and tokens, and daily scores reset in UTC', async t => {
  const { service, admin, register, nextDay } = await fixture(t);
  const friend = await register('Friend');
  service.requestFriend(admin, 'Friend'); service.acceptFriend(friend, admin.id);
  let daily = service.startGame(admin, 'daily', () => lots.slice(0, 5));
  assert.equal(service.profile(admin).daily.status, 'not_started');
  service.answer(admin, daily.id, 0, lots[0].actualBid);
  assert.deepEqual(service.friends(friend).friends[0].daily, { status: 'in_progress', completedRounds: 1, score: null });
  for (let i = 1; i < 5; i++) service.answer(admin, daily.id, i, lots[i].actualBid);
  assert.equal(service.friends(friend).friends[0].daily.score, 5000);
  const catalog = caseCatalog(lots.slice(0, 5).map(item => ({ ...item, currentBid: 123.45 })));
  const item = service.openCase(admin, catalog, 'fundkiste', 'value-request-0001');
  assert.equal(service.profile(admin).accountValueEur, 123.45);
  nextDay();
  assert.equal(service.friends(friend).friends[0].daily.score, null);
  assert.equal(service.friends(friend).friends[0].daily.status, 'not_started');
  daily = service.startGame(admin, 'daily', () => lots.slice(0, 5));
  for (let i = 0; i < 5; i++) service.answer(admin, daily.id, i, 0);
  service.openCase(admin, catalog, 'fundkiste', 'value-request-0002');
  assert.equal(service.profile(admin).accountValueEur, 246.9);
  assert.equal(service.friends(friend).friends[0].itemCount, 2);
  service.sell(admin, item.id);
  const summary = service.friends(friend).friends[0];
  assert.equal(summary.inventoryValueEur, 123.45);
  assert.equal(summary.itemCount, 1);
  assert.ok(!('tokens' in summary) && !('password_hash' in summary) && !('auctions' in summary.daily));
});

test('registration codes are single-use and admin-only; credentials, sessions and bootstrap persist safely', async t => {
  const { service, dir, admin, register } = await fixture(t);
  const [code] = service.codes(admin, 2);
  const results = await Promise.allSettled(['Alice', 'Bob'].map(username => service.register({ username, password, code })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const token = results.find(result => result.status === 'fulfilled').value;
  const user = service.user(token);
  assert.equal(user.tokens, STARTING_TOKENS);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS);
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
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 100);
  assert.throws(() => service.answer(admin, run.id, 4, 20), /answer_conflict/);
  const hl = service.startGame(admin, 'higher-lower', () => lots);
  assert.equal(hl.auctions[0].actualBid, 10);
  assert.ok(hl.auctions.slice(1).every(item => !('actualBid' in item)));
  let result;
  for (let i = 0; i < 7; i++) result = service.answer(admin, hl.id, i, 'higher');
  assert.equal(result.earned, 0);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 100);
  nextDay();
  assert.equal(service.profile(admin).reward, null);
  assert.throws(() => service.answer(admin, run.id, 0, 10), /daily_reset/);
  const fresh = service.startGame(admin, 'higher-lower', () => lots);
  assert.notEqual(fresh.id, hl.id);
  for (let i = 0; i < 7; i++) result = service.answer(admin, fresh.id, i, 'higher');
  assert.equal(result.earned, 140);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 240);
});

test('game rewards freeze the current case-priced schedule for each run', async t => {
  const { service, admin, nextDay } = await fixture(t);
  const rewards = { daily: 24, higherLowerPerCorrect: 5, higherLowerMax: 48, minimumStreak: 3 };
  let run = service.startGame(admin, 'daily', () => lots.slice(0, 5), rewards);
  for (let i = 0; i < 5; i++) run = service.answer(admin, run.id, i, lots[i].actualBid);
  assert.equal(run.earned, 24);
  assert.deepEqual(run.rewards, rewards);
  nextDay();
  run = service.startGame(admin, 'higher-lower', () => lots, rewards);
  for (let i = 0; i < 7; i++) run = service.answer(admin, run.id, i, 'higher');
  assert.equal(run.earned, 35);
  assert.deepEqual(run.rewards, rewards);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 59);
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
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS);
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
  const cost = catalog.cases[0].cost;
  const daily = service.startGame(admin, 'daily', () => lots.slice(0, 5));
  for (let i = 0; i < 5; i++) service.answer(admin, daily.id, i, 10);
  assert.throws(() => service.openCase(admin, catalog, 'fundkiste', 'test-request-00001', 'stale'), /catalog_changed/);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 100);
  const item = service.openCase(admin, catalog, 'fundkiste', 'test-request-00001');
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 100 - cost);
  assert.deepEqual(service.openCase(admin, catalog, 'fundkiste', 'test-request-00001'), item);
  assert.throws(() => service.openCase(admin, catalog, 'schatzkiste', 'test-request-00001'), /request_conflict/);
  assert.equal(service.inventory(admin).length, 1);
  assert.equal(service.inventory(other).length, 0);
  assert.throws(() => service.sell(other, item.id), { status: 404 });
  service.sell(admin, item.id); service.sell(admin, item.id);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS + 100 - cost + item.sellValue);
  assert.equal(service.inventory(admin).length, 0);
  closeDataStore(dir);
  const reopened = new Accounts(dir);
  assert.equal(reopened.profile(admin).tokens, STARTING_TOKENS + 100 - cost + item.sellValue);
  assert.equal(reopened.inventory(admin).length, 0);
  assert.deepEqual(reopened.openCase(admin, catalog, 'fundkiste', 'test-request-00001'), item);
});

test('rarity reflects price and uniqueness; case contents collapse duplicate families and require all rarity tiers', () => {
  assert.equal(itemRarity(1, 1).id, 'common');
  assert.equal(itemRarity(100000, 1).id, 'legendary');
  assert.notEqual(itemRarity(100, 1).id, itemRarity(100, 25).id);
  const catalog = caseCatalog([...lots, { ...lots[0], id: 999 }]);
  const allItems = catalog.cases.flatMap(box => box.items);
  assert.ok(allItems.some(item => item.familySize === 2));
  for (const box of catalog.cases.filter(box => box.available)) {
    assert.equal(new Set(box.items.map(item => item.title)).size, box.items.length);
    const total = box.weights.reduce((sum, value) => sum + value, 0);
    for (let roll = 0; roll < total; roll++) {
      let calls = 0;
      const item = drawItem(catalog, box, () => calls++ ? 0 : roll);
      assert.ok(box.items.includes(item));
    }
  }
  assert.ok(caseCatalog([lots[0]]).cases.every(box => !box.available));
  assert.ok(caseCatalog([]).cases.every(box => box.weights.every(weight => weight === 0)));
});

test('bulk grants credit only existing accounts, survive restart and never double-credit retries or later signups', async t => {
  const { service, admin, register, dir } = await fixture(t);
  const alice = await register('Alice'), bob = await register('Bob');
  const request = 'bulk-grant-test-0001';
  const grant = service.grantTokens(admin, 735, request);
  assert.equal(grant.recipients, 3);
  for (const user of [admin, alice, bob]) assert.equal(service.profile(user).tokens, STARTING_TOKENS + 735);
  const newcomer = await register('Newcomer');
  assert.equal(service.profile(newcomer).tokens, STARTING_TOKENS);
  assert.deepEqual(service.grantTokens(admin, 735, request), grant);
  assert.throws(() => service.grantTokens(admin, 736, request), /request_conflict/);
  closeDataStore(dir);
  const reopened = new Accounts(dir);
  assert.deepEqual(reopened.grantTokens(admin, 735, request), grant);
  assert.equal(reopened.profile(newcomer).tokens, STARTING_TOKENS);
  assert.equal(reopened.profile(alice).tokens, STARTING_TOKENS + 735);
  assert.equal(reopened.grantTokens(admin, 15, 'bulk-grant-test-0002').recipients, 4);
  assert.equal(reopened.profile(newcomer).tokens, STARTING_TOKENS + 15);
  assert.equal(reopened.profile(alice).tokens, STARTING_TOKENS + 750);
  assert.equal(reopened.adminOverview(admin).playerCount, 4);
  assert.equal(reopened.adminOverview(admin).grants.length, 2);
});

test('bulk grants reject regular users and invalid amounts without changing balances', async t => {
  const { service, admin, register } = await fixture(t);
  const player = await register('Player');
  assert.throws(() => service.adminOverview(player), { status: 403 });
  assert.throws(() => service.grantTokens(player, 100, 'bulk-grant-test-0001'), { status: 403 });
  for (const amount of [0, -1, 1.5, 1_000_001, Infinity, NaN, '100', null]) {
    assert.throws(() => service.grantTokens(admin, amount, 'bulk-grant-test-0001'), /invalid_grant_amount/);
  }
  assert.throws(() => service.grantTokens(admin, 100, 'bad'), { status: 400 });
  assert.equal(service.profile(player).tokens, STARTING_TOKENS);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS);
  assert.equal(service.adminOverview(admin).grants.length, 0);
});

test('public case editions expose their prices and contents without draw probabilities', () => {
  const catalog = publicCaseCatalog(caseCatalog(lots));
  assert.deepEqual(catalog.cases.slice(0, 2).map(box => box.name), ['Seized Goods Case', 'Contraband Case']);
  assert.deepEqual(catalog.cases.slice(0, 2).map(box => box.id), ['fundkiste', 'schatzkiste']);
  assert.ok(catalog.cases.some(box => box.available));
  assert.doesNotMatch(JSON.stringify(catalog), /"(?:odds|weights|chance)":/);
  assert.ok(publicCaseCatalog(caseCatalog([])).cases.every(box => !box.available));
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
  assert.equal((await fetch(base + 'admin')).status, 401);
  assert.equal((await post('admin/grant-tokens', { amount: 400, requestId: 'bulk-grant-api-0001' })).status, 401);
  const publicCatalog = await (await fetch(base + 'cases')).json();
  assert.equal(publicCatalog.cases[0].name, 'Seized Goods Case');
  assert.doesNotMatch(JSON.stringify(publicCatalog), /"(?:odds|weights|chance)":/);
  assert.equal((await post('login', { username: 'admin', password }, '', { 'x-requested-with': '' })).status, 403);
  assert.equal((await post('login', { username: 'admin', password }, '', { 'sec-fetch-site': 'cross-site' })).status, 403);
  const response = await post('login', { username: 'admin', password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /Secure/);
  const profile = await response.json();
  assert.ok(!JSON.stringify(profile).includes('password'));
  assert.equal(profile.user.tokens, STARTING_TOKENS);
  const codes = await (await post('codes', { count: 3 }, cookie)).json();
  assert.equal(codes.codes.length, 3);
  const registered = await post('register', { username: 'player', password, code: codes.codes[0] });
  const playerCookie = registered.headers.get('set-cookie');
  assert.equal(registered.status, 200);
  const player = (await registered.json()).user;
  assert.equal((await fetch(base + 'friends')).status, 401);
  assert.equal((await post('friends/request', { username: 'player' }, cookie, { 'x-requested-with': '' })).status, 403);
  const pending = await (await post('friends/request', { username: 'player' }, cookie)).json();
  assert.equal(pending.friends[0].status, 'outgoing');
  assert.ok(!('inventoryValueEur' in pending.friends[0]));
  assert.equal((await post('friends/accept', { id: player.id }, cookie)).status, 404);
  const accepted = await (await post('friends/accept', { id: profile.user.id }, playerCookie)).json();
  assert.equal(accepted.friends[0].status, 'accepted');
  assert.equal(accepted.friends[0].inventoryValueEur, 0);
  assert.equal((await (await post('friends/remove', { id: player.id }, cookie)).json()).friends.length, 0);
  assert.equal((await post('codes', { count: 1 }, playerCookie)).status, 403);
  assert.equal((await fetch(base + 'codes', { headers: { cookie: playerCookie } })).status, 403);
  const grantBody = { amount: 400, requestId: 'bulk-grant-api-0001' };
  assert.equal((await fetch(base + 'admin', { headers: { cookie: playerCookie } })).status, 403);
  assert.equal((await post('admin/grant-tokens', grantBody, playerCookie)).status, 403);
  assert.equal((await post('admin/grant-tokens', grantBody, cookie, { 'x-requested-with': '' })).status, 403);
  const grant = await (await post('admin/grant-tokens', grantBody, cookie)).json();
  assert.equal(grant.grant.recipients, 2);
  assert.equal(grant.user.tokens, STARTING_TOKENS + 400);
  const later = await (await post('register', { username: 'later', password, code: codes.codes[1] })).json();
  assert.equal(later.user.tokens, STARTING_TOKENS);
  assert.deepEqual((await (await post('admin/grant-tokens', grantBody, cookie)).json()).grant, grant.grant);
  assert.equal((await (await fetch(base + 'admin', { headers: { cookie } })).json()).playerCount, 3);
  let rewarded = (await (await post('games/start', { mode: 'daily' }, playerCookie)).json()).run;
  assert.deepEqual(rewarded.rewards, publicCatalog.rewards);
  for (let i = 0; i < 5; i++) rewarded = (await (await post('games/answer', { id: rewarded.id, position: i, answer: lots[i].actualBid }, playerCookie)).json()).run;
  assert.equal(rewarded.earned, publicCatalog.rewards.daily);
  assert.equal((await post('logout', {}, playerCookie)).status, 200);
  assert.equal((await (await fetch(base + 'me', { headers: { cookie: playerCookie } })).json()).user, null);
  assert.equal((await post('login', { username: 'admin', password: 'x'.repeat(9000) })).status, 413);
});
