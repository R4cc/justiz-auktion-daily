import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Accounts, STARTING_TOKENS } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { buyStoreItem, visitStore, startStoreHeist, playerCriminalRecord } from '../src/storefronts.mjs';
import { listItem, placeBid, settleAuction, getResale } from '../src/resale.mjs';
import { ensurePaletteAuctionSchema, getPaletteAuctionRewards } from '../src/palette-auctions.mjs';
import { borrowLoan, loanDashboard, LOAN_TERMS_VERSION } from '../src/loans.mjs';
import { upgradeSkill } from '../src/skill-tree.mjs';
import { userStatistics } from '../src/user-statistics.mjs';
import { acquireItems } from '../src/trader.mjs';
import { playAnswer } from './helpers/play-answer.mjs';

const password = 'player-reset-test-password';
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-player-reset-'));
  const now = Date.now(), accounts = new Accounts(dir, { now: () => now, flags: { resales: true } });
  await accounts.bootstrap('admin', password);
  const adminToken = await accounts.login({ username: 'admin', password }), admin = accounts.user(adminToken);
  const token = await accounts.register({ username: 'ResetMe', password, code: accounts.codes(admin, 1)[0] });
  const user = accounts.user(token);
  const otherToken = await accounts.register({ username: 'Neighbor', password, code: accounts.codes(admin, 1)[0] });
  const other = accounts.user(otherToken);
  accounts.db(db => db.prepare('UPDATE users SET tokens=100000,xp=10000 WHERE admin=0').run());
  const lots = Array.from({ length: 5 }, (_, id) => ({ id: id + 1, title: 'Wine ' + id, category: 'Getränke', currentBid: 20, actualBid: 20 }));
  upsertAuctions(dir, lots);
  const item = (id, owner = user) => accounts.db(db => {
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id, owner.id, JSON.stringify({ title: 'Wine ' + id, price: 100, marketCategory: 'wine', rarity: 'rare' }), now);
    acquireItems(db, owner.id, [id], 20, 'purchase', now);
  });
  const listing = (id, owner = user) => { item(id, owner); return listItem(dir, owner, { inventoryId: id, startPrice: 100, endsAt: new Date(now + 60000).toISOString() }, { now }); };
  const payload = (requestId = 'reset-player-request-0001') => ({ userId: user.id, confirmation: user.username, requestId });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, now, accounts, admin, adminToken, user, token, other, otherToken, lots, item, listing, payload };
}

test('Reset Player clears all personal state, preserves credentials, and keeps foreign purchased items and receipts', async t => {
  const f = await fixture(t), { accounts: a, user, other, admin, dir, now } = f;
  a.requestFriend(user, other.username); a.acceptFriend(other, user.id);
  a.grantTokens(admin, 200, 'reset-global-gift-0001');
  a.grantUserTokens(admin, user.id, 300, 'reset-personal-gift-0001');
  const shop = buyBusiness(dir, user, 'wine', 'popup', { now }).shop;
  f.item('keep-foreign'); f.item('remove-stock');
  stockBusiness(dir, user, shop.id, ['keep-foreign', 'remove-stock'], { now });
  const entry = visitStore(dir, other, shop.id, { now }).store.stock.find(item => item.id === 'keep-foreign');
  buyStoreItem(dir, other, { shopId: shop.id, inventoryId: entry.id, expectedPrice: entry.price, requestId: 'reset-foreign-purchase-0001' }, { now });
  const remaining = visitStore(dir, other, shop.id, { now }).store.stock[0];
  startStoreHeist(dir, other, { shopId: shop.id, inventoryId: remaining.id, expectedPrice: remaining.price, expectedFine: remaining.theft.fine, requestId: 'reset-foreign-heist-0001' }, { now, draw: max => max - 1 });
  upgradeSkill(dir, user, { skillId: 'luck', rank: 1, requestId: 'reset-skill-upgrade-0001' }, { now });
  borrowLoan(dir, user, { offerId: 'starter', termsVersion: LOAN_TERMS_VERSION, requestId: 'reset-loan-borrow-0001' }, { now });
  const run = a.startGame(user, 'daily', () => f.lots);
  for (let i = 0; i < 5; i++) playAnswer(a, user, run.id, i, 20);
  a.db(db => {
    db.prepare('INSERT INTO user_prestige VALUES(?,?,1,?)').run(user.id, '["profit"]', now);
    db.prepare('INSERT INTO player_heat VALUES(?,8,?)').run(user.id, now);
    db.prepare('INSERT INTO player_justice(user_id,fine_due,offences,jailed_until) VALUES(?,250,3,?)').run(user.id, now + 600000);
    db.prepare('UPDATE businesses SET upgrade_size=?,upgrade_started_at=?,upgrade_ends_at=?,upgrade_cost=100 WHERE id=?').run('small', now, now + 60000, shop.id);
  });
  const credentials = a.db(db => db.prepare('SELECT username,password_hash,created_at,banned,admin FROM users WHERE id=?').get(user.id));
  const otherBalance = a.profile(other).tokens;
  const originalStats = userStatistics(dir, user, { now }); assert.ok(originalStats.money.earned > 0);
  const reset = a.resetPlayer(admin, f.payload());
  assert.equal(reset.userId, user.id);
  assert.deepEqual(a.db(db => db.prepare('SELECT username,password_hash,created_at,banned,admin FROM users WHERE id=?').get(user.id)), credentials);
  assert.equal(a.user(f.token), null); assert.equal(a.user(f.otherToken).id, other.id);
  const profile = a.profile(user);
  assert.equal(profile.tokens, STARTING_TOKENS); assert.equal(profile.progression.xp, 0);
  assert.deepEqual(profile.skills.ranks, {}); assert.equal(profile.prestige.count, 0);
  assert.equal(profile.itemCount, 0); assert.equal(profile.daily.status, 'not_started');
  assert.equal(profile.heldInBids, 0); assert.equal(profile.heat.stars, 0);
  assert.equal(profile.justice.fineDue, 0); assert.equal(profile.justice.offences, 0); assert.equal(profile.justice.jailed, false);
  assert.equal(a.friends(user).friends.length, 0); assert.equal(a.friends(other).friends.length, 0);
  assert.equal(businessDashboard(dir, user, { now }).shops.length, 0);
  assert.equal(loanDashboard(dir, user, { now }).active, null);
  assert.equal(playerCriminalRecord(dir, user, { now }).total, 0);
  const stats = userStatistics(dir, user, { now });
  assert.equal(stats.money.earned, 0); assert.equal(stats.money.spent, 0); assert.equal(stats.cases.opened, 0);
  assert.throws(() => a.grantUserTokens(admin, user.id, 300, 'reset-personal-gift-0001'), /request_conflict/);
  assert.equal(a.profile(user).tokens, STARTING_TOKENS, 'retrying an older admin grant cannot restore it');
  assert.equal(a.profile(other).tokens, otherBalance);
  assert.ok(a.inventory(other).some(item => item.id === 'keep-foreign'));
  assert.equal(a.db(db => db.prepare("SELECT COUNT(*) AS n FROM store_receipts WHERE user_id=? AND action='buy'").get(other.id).n), 1);
  assert.equal(a.db(db => db.prepare("SELECT COUNT(*) AS n FROM store_heists WHERE user_id=? AND status IN ('active','police')").get(other.id).n), 0);
  assert.deepEqual(a.db(db => db.prepare('PRAGMA foreign_key_check').all()), []);
  closeDataStore(dir);
  const reopened = new Accounts(dir);
  assert.equal(reopened.user(await reopened.login({ username: 'ResetMe', password })).id, user.id);
  assert.equal(reopened.profile(user).tokens, STARTING_TOKENS);
  assert.equal(userStatistics(dir, user, { now }).money.earned, 0);
  reopened.grantTokens(admin, 50, 'reset-new-global-gift-0001');
  assert.equal(userStatistics(dir, user, { now }).money.earned, 50, 'a new gift at the same timestamp still counts');
});

test('reset refunds full foreign proxy escrow, withdraws the target lead, preserves settled sales and is atomic and retry-safe', async t => {
  const f = await fixture(t), { accounts: a, user, other, admin, now, dir } = f;
  const sold = f.listing('settled-sale'); placeBid(dir, other, sold.id, 500, { now }); settleAuction(dir, sold.id, { now: now + 60001 });
  const selling = f.listing('cancel-selling'), bidding = f.listing('withdraw-bidding', other), untouched = f.listing('untouched', other);
  placeBid(dir, other, selling.id, 750, { now }); placeBid(dir, user, bidding.id, 600, { now });
  const otherBalance = a.profile(other).tokens, userBalance = a.profile(user).tokens;
  a.db(db => db.exec(`CREATE TRIGGER reset_failure BEFORE UPDATE OF xp ON users WHEN OLD.id='${user.id}' BEGIN SELECT RAISE(ABORT,'reset fault'); END`));
  assert.throws(() => a.resetPlayer(admin, f.payload()), /reset fault/);
  assert.equal(a.profile(other).tokens, otherBalance); assert.equal(a.profile(user).tokens, userBalance);
  assert.equal(a.user(f.token).id, user.id); assert.equal(getResale(dir, selling.id, { now }).status, 'active');
  a.db(db => db.exec('DROP TRIGGER reset_failure'));
  const result = a.resetPlayer(admin, f.payload());
  assert.equal(a.profile(other).tokens, otherBalance + 750);
  assert.equal(getResale(dir, selling.id, { now }).status, 'cancelled');
  assert.equal(a.db(db => db.prepare('SELECT current_bidder_id FROM resale_auctions WHERE id=?').get(bidding.id).current_bidder_id), null);
  assert.equal(getResale(dir, untouched.id, { now }).status, 'active');
  assert.ok(a.inventory(other).some(item => item.id === 'settled-sale'));
  const otherEarned = userStatistics(dir, other, { now }).money.spent; assert.ok(otherEarned >= 100);
  assert.equal(userStatistics(dir, user, { now }).money.earned, 0);
  a.db(db => db.prepare('UPDATE users SET tokens=1777,xp=100 WHERE id=?').run(user.id));
  assert.deepEqual(a.resetPlayer(admin, f.payload()), result);
  assert.equal(a.profile(user).tokens, 1777); assert.equal(a.profile(user).progression.xp, 100);
  assert.equal(a.profile(other).tokens, otherBalance + 750);
  assert.throws(() => a.resetPlayer(admin, { ...f.payload(), userId: other.id, confirmation: other.username }), /request_conflict/);
  settleAuction(dir, selling.id, { now: now + 60001 }); settleAuction(dir, bidding.id, { now: now + 60001 });
  assert.equal(a.profile(other).tokens, otherBalance + 750);
  assert.deepEqual(a.db(db => db.prepare('PRAGMA foreign_key_check').all()), []);
  a.resetEconomy(admin, 'RESET ECONOMY');
  assert.equal(a.profile(user).tokens, STARTING_TOKENS);
  a.grantTokens(admin, 75, 'reset-after-global-reset-0001');
  assert.equal(userStatistics(dir, user, { now }).money.earned, 75);
});

test('current admin authority, exact confirmation, and protected accounts are enforced by the reset domain', async t => {
  const f = await fixture(t), { accounts: a, user, admin } = f;
  assert.throws(() => a.resetPlayer({ ...user, admin: true }, f.payload()), { status: 403 });
  assert.throws(() => a.resetPlayer(admin, { ...f.payload(), confirmation: 'resetme' }), /invalid_player_reset_confirmation/);
  assert.throws(() => a.resetPlayer(admin, { ...f.payload(), userId: admin.id, confirmation: admin.username }), /user_not_found/);
  assert.throws(() => a.resetPlayer(admin, { ...f.payload(), userId: 'missing' }), /user_not_found/);
  assert.throws(() => a.resetPlayer(admin, { ...f.payload(), requestId: 'bad' }), /invalid_request/);
  a.db(db => db.prepare('UPDATE users SET banned=1 WHERE id=?').run(user.id));
  a.resetPlayer(admin, f.payload());
  assert.equal(a.db(db => db.prepare('SELECT banned FROM users WHERE id=?').get(user.id).banned), 1);
  await assert.rejects(() => a.login({ username: user.username, password }), /account_banned/);
  a.db(db => db.prepare('UPDATE users SET admin=0 WHERE id=?').run(admin.id));
  assert.throws(() => a.resetPlayer(admin, f.payload('reset-player-request-0002')), { status: 403 });
});

test('reset withdraws sealed palette and legacy wholesale leads and prevents old hidden winnings from being claimed', async t => {
  const f = await fixture(t), { accounts: a, user, other, admin, now, dir } = f;
  a.db(db => {
    ensurePaletteAuctionSchema(db, now);
    db.prepare('INSERT INTO palette_editions(id,palette_id,rotation_date,starts_at,ends_at,payload_json) VALUES(?,?,?,?,?,?)')
      .run('reset-edition', 'fundkiste', new Date(now).toISOString().slice(0,10), now, now + 7200000, '{}');
    for (const [id, bidder, settled] of [['active', user.id, null], ['won', user.id, now], ['foreign', other.id, null]]) {
      db.prepare(`INSERT INTO primary_palette_auctions(id,creation_request_id,edition_id,reserve,current_bid,max_bid,current_bidder_id,
        status,started_at,ends_at,valuation_at,required_level,public_snapshot_json,settled_at,winner_id)
        VALUES(?,?,'reset-edition',100,100,500,?,'active',?,?,?,1,'{}',?,?)`)
        .run(id, id, bidder, now, now + 60000, now, settled, settled === null ? null : bidder);
      db.prepare('INSERT INTO primary_palette_bids(auction_id,bidder_id,amount,created_at) VALUES(?,?,500,?)').run(id, bidder, now);
    }
    db.prepare('INSERT INTO primary_palette_mystery_stock VALUES(?,?,?,NULL)').run('won', '{}', '[]');
    db.prepare('INSERT INTO wholesale_auctions VALUES(?,?,?, ?,100,200,?,NULL,NULL)').run('legacy', 'wine', now, now + 60000, user.id);
  });
  a.resetPlayer(admin, f.payload());
  const rows = a.db(db => db.prepare('SELECT id,current_bidder_id,max_bid,winner_id,revealed_at FROM primary_palette_auctions ORDER BY id').all());
  assert.equal(rows.find(row => row.id === 'active').current_bidder_id, null);
  assert.equal(rows.find(row => row.id === 'active').max_bid, null);
  assert.equal(rows.find(row => row.id === 'foreign').current_bidder_id, other.id);
  assert.notEqual(rows.find(row => row.id === 'won').winner_id, user.id);
  assert.equal(rows.find(row => row.id === 'won').revealed_at, now);
  assert.equal(a.db(db => db.prepare('SELECT bidder_id FROM wholesale_auctions WHERE id=?').get('legacy').bidder_id), null);
  assert.throws(() => getPaletteAuctionRewards(dir, user, 'won', { now: now + 60001 }), /palette_rewards_not_found/);
  assert.equal(a.profile(user).heldInBids, 0);
  assert.deepEqual(a.db(db => db.prepare('PRAGMA foreign_key_check').all()), []);
});

test('Reset Player HTTP endpoint requires admin and CSRF, revokes old sessions and preserves password login', async t => {
  const f = await fixture(t);
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const api = await createAccountApi({ dataDir: f.dir, json, env: {}, dailyPayload: async () => ({ auctions: f.lots }) });
  const server = createServer(async (req, res) => { if (!await api(req, res, new URL(req.url, 'http://localhost'))) json(res, 404, {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/account/`;
  const post = (route, token, payload, csrf = true) => fetch(base + route, { method: 'POST', headers: {
    cookie: `jg_session=${token || ''}`, 'content-type': 'application/json', ...(csrf ? { 'x-requested-with': 'JUSTIZGUESSR' } : {})
  }, body: JSON.stringify(payload) });
  assert.equal((await post('admin/reset-player', null, f.payload())).status, 401);
  assert.equal((await post('admin/reset-player', f.token, f.payload())).status, 403);
  assert.equal((await post('admin/reset-player', f.adminToken, f.payload(), false)).status, 403);
  assert.equal((await post('admin/reset-player', f.adminToken, { ...f.payload(), confirmation: 'wrong' })).status, 400);
  const response = await post('admin/reset-player', f.adminToken, f.payload());
  assert.equal(response.status, 200); assert.equal((await response.json()).reset.username, 'ResetMe');
  assert.equal((await post('friends/request', f.token, { username: 'Neighbor' })).status, 401);
  assert.equal((await post('login', null, { username: 'ResetMe', password })).status, 200);
});
