import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { GUESS_TIME_LIMIT_MS, publicDailySummary } from '../src/game-rounds.mjs';
import { createGuestGameApi } from '../src/guest-game-api.mjs';
import { listItem, placeBid, settleAuction } from '../src/resale.mjs';
import { resaleXp } from '../src/xp.mjs';

const password = 'regression-test-password-123';
const lots = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Test ${i}`,
  image: '/test.png', description: 'Current price EUR 100', actualBid: 100 + i,
  correctPrice: 100 + i, currentBid: 100 + i, finalPrice: 100 + i,
  startBid: 10, url: 'https://www.justiz-auktion.de/example', privateAnswer: 100 + i }));
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jg-exploit-regression-'));
  let time = Date.parse('2026-10-13T10:00:00Z');
  const accounts = new Accounts(dir, { now: () => time });
  const alice = { id: 'alice' }, bob = { id: 'bob' };
  accounts.db(db => {
    for (const user of [alice, bob]) db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES (?,?,'disabled',1000,?)")
      .run(user.id, user.id, time);
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, alice, bob, now: () => time, advance: ms => time += ms };
}

test('Daily allowlist seals all answer aliases and unreached lots; only answered rounds reveal prices', async t => {
  const f = await fixture(t);
  assert.deepEqual(publicDailySummary({ date: '2026-10-13', gameNumber: 286, auctions: lots }),
    { date: '2026-10-13', gameNumber: 286, generatedAt: undefined, auctionCount: 5 });
  let run = f.accounts.startGame(f.alice, 'daily', () => lots);
  for (const key of ['actualBid','correctPrice','currentBid','finalPrice','privateAnswer','startBid','url'])
    assert.ok(!(key in run.auctions[0]), key);
  assert.doesNotMatch(run.auctions[0].description, /100/);
  assert.deepEqual(run.auctions.slice(1), [{},{},{},{}]);
  run = f.accounts.answer(f.alice, run.id, 0, 100);
  assert.equal(run.auctions[0].actualBid, 100);
  assert.equal(run.auctions[0].startBid, 10);
  assert.deepEqual(run.auctions[1], {});
  assert.throws(() => f.accounts.answer(f.alice, run.id, 1, 101), /round_not_started/);
  run = f.accounts.startRound(f.alice, run.id, 1);
  assert.equal(run.auctions[1].title, lots[1].title);
  assert.ok(!('actualBid' in run.auctions[1]));
  assert.throws(() => f.accounts.startRound(f.bob, run.id, 1), /game_not_found/);
  assert.throws(() => f.accounts.startRound(f.alice, run.id, 4), /invalid_position/);
  const hl = f.accounts.startGame(f.alice, 'higher-lower', () => lots);
  assert.equal(hl.auctions[0].actualBid, 100);
  for (const key of ['actualBid','correctPrice','currentBid','finalPrice','privateAnswer'])
    assert.ok(!(key in hl.auctions[1]), key);
});

test('Daily deadlines survive resume/restart and late guesses score zero with stable retries', async t => {
  const f = await fixture(t);
  let run = f.accounts.startGame(f.alice, 'daily', () => lots);
  const deadline = run.roundDeadlineAt;
  f.advance(GUESS_TIME_LIMIT_MS - 1);
  closeDataStore(f.dir);
  const reopened = new Accounts(f.dir, { now: f.now });
  assert.equal(reopened.startGame(f.alice, 'daily', () => []).roundDeadlineAt, deadline);
  run = reopened.answer(f.alice, run.id, 0, 100);
  assert.equal(run.answers[0], 100);
  f.advance(120000); // Reading the previous result does not spend the next clock.
  run = reopened.startRound(f.alice, run.id, 1);
  assert.equal(run.roundDeadlineAt, f.now() + GUESS_TIME_LIMIT_MS);
  f.advance(GUESS_TIME_LIMIT_MS);
  assert.equal(reopened.startRound(f.alice, run.id, 1).roundDeadlineAt, run.roundDeadlineAt);
  run = reopened.answer(f.alice, run.id, 1, 101);
  assert.equal(run.answers[1], null);
  assert.equal(reopened.answer(f.alice, run.id, 1, 101).answers[1], null);
  assert.throws(() => reopened.answer(f.alice, run.id, 1, 102), /answer_conflict/);
  for (let position = 2; position < 5; position++) {
    reopened.startRound(f.alice, run.id, position);
    f.advance(120000);
    run = reopened.answer(f.alice, run.id, position, lots[position].actualBid);
  }
  assert.equal(run.complete, true);
  assert.equal(reopened.profile(f.alice).daily.score, 1000);
  assert.equal(run.earned, 1000);
});

test('saved Daily guesses survive restart, freeze at expiry and never reveal future answers', async t => {
  const f=await fixture(t);
  let run=f.accounts.startGame(f.alice,'daily',()=>lots);
  const deadline=run.roundDeadlineAt;
  assert.throws(()=>f.accounts.saveRoundDraft(f.bob,run.id,0,100,1),/game_not_found/);
  assert.throws(()=>f.accounts.saveRoundDraft(f.alice,run.id,1,100,1),/invalid_position/);
  assert.throws(()=>f.accounts.saveRoundDraft(f.alice,run.id,0,'100',1),/invalid_guess/);
  assert.throws(()=>f.accounts.saveRoundDraft(f.alice,run.id,0,100,0),/invalid_request/);
  assert.equal(f.accounts.saveRoundDraft(f.alice,run.id,0,50,1).saved,true);
  assert.equal(f.accounts.saveRoundDraft(f.alice,run.id,0,100,2).saved,true);
  assert.equal(f.accounts.saveRoundDraft(f.alice,run.id,0,999,1).saved,false);
  assert.equal(f.accounts.profile(f.alice).tokens,1000);
  closeDataStore(f.dir);
  const reopened=new Accounts(f.dir,{now:f.now});
  run=reopened.startGame(f.alice,'daily',()=>[]);
  assert.equal(run.roundDraft.answer,100);assert.equal(run.roundDeadlineAt,deadline);
  assert.ok(!('actualBid' in run.auctions[0]));assert.deepEqual(run.auctions[1],{});
  f.advance(GUESS_TIME_LIMIT_MS);
  assert.equal(reopened.saveRoundDraft(f.alice,run.id,0,999,3).saved,false);
  run=reopened.answer(f.alice,run.id,0,999);
  assert.equal(run.answers[0],100);assert.equal(run.roundDraft,undefined);
  assert.equal(reopened.answer(f.alice,run.id,0,999).answers[0],100);
  assert.throws(()=>reopened.answer(f.alice,run.id,0,998),/answer_conflict/);
  for(let position=1;position<5;position++){
    run=reopened.startRound(f.alice,run.id,position);
    assert.equal(run.roundDraft,undefined);
    reopened.saveRoundDraft(f.alice,run.id,position,lots[position].actualBid,1);
    f.advance(GUESS_TIME_LIMIT_MS);
    run=reopened.answer(f.alice,run.id,position,lots[position].actualBid);
  }
  assert.equal(reopened.profile(f.alice).daily.score,5000);
  assert.equal(run.earned,1000);
  assert.equal(reopened.answer(f.alice,run.id,4,104).earned,1000);
  assert.equal(reopened.profile(f.alice).tokens,2000);
});

test('cleared or invalid current guesses do not revive a saved number at expiry', async t => {
  const f=await fixture(t),run=f.accounts.startGame(f.alice,'daily',()=>lots);
  f.accounts.saveRoundDraft(f.alice,run.id,0,100,1);
  f.accounts.saveRoundDraft(f.alice,run.id,0,null,2);
  f.advance(GUESS_TIME_LIMIT_MS);
  assert.equal(f.accounts.answer(f.alice,run.id,0,100).answers[0],null);
  f.accounts.startRound(f.alice,run.id,1);
  f.accounts.saveRoundDraft(f.alice,run.id,1,101,1);
  f.advance(GUESS_TIME_LIMIT_MS);
  assert.equal(f.accounts.answer(f.alice,run.id,1,null).answers[1],null);
});

test('concurrent temporary logins consume the password once and a password change revokes old sessions', async t => {
  const f = await fixture(t);
  await f.accounts.bootstrap('admin', password);
  const admin = f.accounts.user(await f.accounts.login({ username: 'admin', password }));
  const reset = await f.accounts.resetPassword(admin, f.alice.id);
  const results = await Promise.allSettled(Array.from({ length: 2 }, () =>
    f.accounts.login({ username: 'alice', password: reset.temporaryPassword })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.message, 'temporary_password_used');
  const token = results.find(result => result.status === 'fulfilled').value;
  const otherSession = f.accounts.atomic(db => f.accounts.session(db, f.alice.id));
  const nextToken = await f.accounts.changePassword(f.accounts.user(token), {
    currentPassword: reset.temporaryPassword, newPassword: 'replacement-password-456' });
  assert.equal(f.accounts.user(token), null);
  assert.equal(f.accounts.user(otherSession), null);
  assert.equal(f.accounts.user(nextToken).must_change_password, 0);
});

test('cycling the same physical item through different accounts cannot create repeated resale XP', async t => {
  const f = await fixture(t);
  const id = 'wash-item';
  f.accounts.db(db => db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
    .run(id, f.alice.id, JSON.stringify({ title: 'Find', price: 1, sellValue: 1, rarity: 'common' }), f.now()));
  for (let cycle = 0; cycle < 4; cycle++) {
    const seller = cycle % 2 ? f.bob : f.alice, buyer = cycle % 2 ? f.alice : f.bob;
    const auction = listItem(f.dir, seller, { inventoryId: id, startPrice: 1,
      endsAt: new Date(f.now() + 60000).toISOString() }, { now: f.now() });
    placeBid(f.dir, buyer, auction.id, 1, { now: f.now() + 1 });
    f.advance(60001);
    settleAuction(f.dir, auction.id, { now: f.now() });
    if (cycle === 0) { // Rebuild the new ledger from a pre-upgrade database.
      f.accounts.db(db => db.exec('DROP TABLE resale_xp_items'));
      closeDataStore(f.dir);
      new Accounts(f.dir, { now: f.now });
    }
  }
  const rows = f.accounts.db(db => db.prepare('SELECT id,tokens,xp FROM users ORDER BY id').all());
  assert.deepEqual(rows.map(row => ({ ...row })), [{ id: 'alice', tokens: 1000, xp: 10 }, { id: 'bob', tokens: 1000, xp: 0 }]);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM resale_xp_items').get().n), 1);
});

test('resale XP claims roll back with settlement and mixed batches reward only new units', async t => {
  const f = await fixture(t);
  f.accounts.db(db => {
    for (const id of ['new','used']) db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
      .run(id, f.alice.id, JSON.stringify({ title: 'Same find', price: 100, sellValue: 100, rarity: 'common' }), f.now());
  });
  const lot = listItem(f.dir, f.alice, { inventoryId: 'new', quantity: 2, startPrice: 100,
    endsAt: new Date(f.now() + 60000).toISOString() }, { now: f.now() });
  f.accounts.db(db => {
    db.prepare('INSERT INTO resale_xp_items VALUES (?,?)').run('used', lot.id);
    db.exec("CREATE TRIGGER fail_xp BEFORE INSERT ON xp_events BEGIN SELECT RAISE(ABORT,'xp fault'); END");
  });
  placeBid(f.dir, f.bob, lot.id, 100, { now: f.now() + 1 });
  f.advance(60001);
  assert.throws(() => settleAuction(f.dir, lot.id, { now: f.now() }), /xp fault/);
  assert.equal(f.accounts.db(db => db.prepare("SELECT 1 FROM resale_xp_items WHERE inventory_id='new'").get()), undefined);
  f.accounts.db(db => db.exec('DROP TRIGGER fail_xp'));
  settleAuction(f.dir, lot.id, { now: f.now() });
  assert.equal(f.accounts.db(db => db.prepare("SELECT xp FROM users WHERE id='alice'").get().xp), resaleXp(50));
});

test('guest Daily HTTP sessions seal prices, enforce ownership/deadlines and resume after reload', async t => {
  const f = await fixture(t);
  const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const api = createGuestGameApi({ dataDir: f.dir, now: f.now, json, env: { COOKIE_SECURE: 'true' },
    dailyPayload: async () => ({ date: '2026-10-13', auctions: lots }),
    randomPayload: async () => ({ auctions: lots }), higherLowerPayload: async () => ({ auctions: lots }) });
  const server = createServer(async (request, response) => {
    if (!await api(request, response, new URL(request.url, 'http://localhost'))) json(response, 404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/games/`;
  const post = (route, body, cookie = '', headers = {}) => fetch(base + route, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR', cookie, ...headers }, body: JSON.stringify(body) });
  const started = await post('start', { mode: 'daily' });
  const cookie = started.headers.get('set-cookie').split(';')[0];
  assert.match(started.headers.get('set-cookie'), /HttpOnly; SameSite=Strict;.*Secure/);
  let run = (await started.json()).run;
  assert.ok(!('correctPrice' in run.auctions[0]) && !('actualBid' in run.auctions[0]));
  assert.equal((await post('answer', { id: run.id, position: 0, answer: 100 })).status, 404);
  assert.equal((await post('answer', { id: run.id, position: 0, answer: 100 }, cookie, { 'sec-fetch-site': 'cross-site' })).status, 403);
  f.advance(120000);
  const resumed = (await (await post('start', { mode: 'daily' }, cookie)).json()).run;
  assert.equal(resumed.id, run.id);
  assert.equal(resumed.roundDeadlineAt, run.roundDeadlineAt);
  run = (await (await post('answer', { id: run.id, position: 0, answer: 100 }, cookie)).json()).run;
  assert.equal(run.answers[0], null);
  assert.equal(run.auctions[0].actualBid, 100);
  assert.deepEqual(run.auctions[1], {});
  assert.equal((await post('answer', { id: run.id, position: 1, answer: 101 }, cookie)).status, 409);
  run = (await (await post('round/start', { id: run.id, position: 1 }, cookie)).json()).run;
  assert.equal(run.roundDeadlineAt, f.now() + GUESS_TIME_LIMIT_MS);
  const draft={id:run.id,position:1,answer:101,revision:1};
  assert.equal((await post('round/draft',draft)).status,404);
  assert.equal((await post('round/draft',draft,cookie,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await post('round/draft',draft,cookie)).status,200);
  f.advance(GUESS_TIME_LIMIT_MS);
  await post('round/draft',{...draft,answer:999,revision:2},cookie);
  run = (await (await post('answer', { id: run.id, position: 1, answer: 101 }, cookie)).json()).run;
  assert.equal(run.answers[1], 101);
  assert.equal(run.earned, 0);
  assert.equal(f.accounts.inventory(f.alice).length, 0);
  let random = (await (await post('start', { mode: 'random' }, cookie)).json()).run;
  assert.equal(random.mode, 'random');
  assert.deepEqual(random.auctions.slice(1), [{},{},{},{}]);
  assert.ok(!('actualBid' in random.auctions[0]));
  random = (await (await post('answer', { id: random.id, position: 0, answer: 100 }, cookie)).json()).run;
  assert.equal(random.auctions[0].actualBid, 100);
  let hl = (await (await post('start', { mode: 'higher-lower' }, cookie)).json()).run;
  assert.equal(hl.auctions[0].actualBid, 100);
  assert.ok(!('actualBid' in hl.auctions[1]) && !('correctPrice' in hl.auctions[1]));
  hl = (await (await post('answer', { id: hl.id, position: 0, answer: 'higher' }, cookie)).json()).run;
  assert.equal(hl.correct, true);
  assert.equal(hl.streak, 1);
  assert.equal(hl.auctions[1].actualBid, 101);
  assert.ok(!('actualBid' in hl.auctions[2]));
  assert.equal(hl.earned, 0);
  for (let attempt = 0; attempt < 9; attempt++) assert.equal((await post('start', { mode: 'daily' })).status, 200);
  assert.equal((await post('start', { mode: 'daily' })).status, 429);
  assert.equal((await post('start', { mode: 'daily' }, cookie)).status, 200);
});
