import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness, businessDashboard, stockBusiness, unstockBusiness } from '../src/businesses.mjs';
import { adjustAdminMarket } from '../src/admin-economy.mjs';
import { ensureStoreSchema, listStores, visitStore, recordStoreVisit, buyStoreItem, reviewStore, reactToStore, tipStore, customizeStore,
  theftQuote, startStoreHeist, finishStoreHeist, HEIST_COOLDOWN, STORE_HEIST_COOLDOWN } from '../src/storefronts.mjs';

const now = Date.parse('2026-10-08T12:30:00Z');
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-storefront-'));
  const accounts = new Accounts(dir, { now: () => now });
  const owner = { id: 'owner', admin: true }, buyer = { id: 'buyer' }, rival = { id: 'rival' };
  accounts.db(db => {
    for (const user of [owner, buyer, rival]) db.prepare(`INSERT INTO users (id, username, password_hash, tokens, admin, created_at)
      VALUES (?, ?, 'disabled', 100000, ?, ?)`).run(user.id, user.id + 'Name', Number(Boolean(user.admin)), now);
    for (let n = 0; n < 8; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`wine-${n}`, owner.id, JSON.stringify({ title: `Wine ${n}`, price: 100, marketCategory: 'wine', rarity: 'rare', category: 'Getränke' }), now);
  });
  const shop = buyBusiness(dir, owner, 'wine', 'popup', { now }).shop;
  stockBusiness(dir, owner, shop.id, Array.from({ length: 8 }, (_, n) => `wine-${n}`), { now });
  accounts.db(ensureStoreSchema);
  accounts.db(db=>db.prepare('UPDATE businesses SET mischief_enabled=1 WHERE id=?').run(shop.id));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  let next = 0;
  const payload = (inventoryId = 'wine-0') => ({ shopId: shop.id, inventoryId, expectedPrice: 120, expectedFee: 97, expectedChance: 29, choice: 'red', requestId: `store-request-${++next}-0001` });
  const balance = user => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id = ?').get(user.id).tokens);
  const itemOwner = id => accounts.db(db => db.prepare('SELECT user_id FROM inventory WHERE id = ?').get(id).user_id);
  const view = (user = buyer, at = now) => visitStore(dir, user, shop.id, { now: at }).store;
  return { dir, accounts, owner, buyer, rival, shop, payload, balance, itemOwner, view };
}
const success = () => 0;
const caught = max => max === 4 ? 0 : 999999;

test('public store directory filters, paginates and masks guests; visits and reactions count once per day', async t => {
  const f = await fixture(t);
  const profile = { shopId: f.shop.id, name: 'The Cork & Goose', motto: 'Unexpected finds', gooseGuard: false, requestId: 'store-profile-000001' };
  customizeStore(f.dir, f.owner, profile, { now });
  buyBusiness(f.dir, f.rival, 'electronics', 'popup', { now });
  const all = listStores(f.dir, null, { now, limit: 1 });
  assert.equal(all.total, 2); assert.equal(all.stores.length, 1);
  assert.equal(listStores(f.dir, null, { now, offset: 1, limit: 1 }).stores.length, 1);
  assert.equal(listStores(f.dir, null, { now, offset: Infinity, limit: 500 }).offset, 0);
  assert.equal(listStores(f.dir, null, { now, limit: 500 }).limit, 48);
  const searched = listStores(f.dir, null, { now, query: 'Cork', type: 'wine' }).stores;
  assert.equal(searched[0].owner, 'ow****'); assert.equal(searched[0].name, profile.name);
  assert.equal(listStores(f.dir, f.buyer, { now, type: 'wine' }).stores[0].owner, 'ownerName');
  assert.equal(f.view(null).stock.length, 8); assert.equal(f.view(null).own, false);
  assert.doesNotMatch(JSON.stringify(f.view(null)), /password_hash|tokens|roll|sequence/);
  for (let n = 0; n < 3; n++) recordStoreVisit(f.dir, f.buyer, f.shop.id, { now });
  recordStoreVisit(f.dir, f.owner, f.shop.id, { now });
  assert.equal(f.view().playerVisits, 1);
  recordStoreVisit(f.dir, f.buyer, f.shop.id, { now: now + 86400000 });
  assert.equal(f.view().playerVisits, 2);
  for (let n = 0; n < 3; n++) reactToStore(f.dir, f.buyer, { shopId: f.shop.id, reaction: 'joke' }, { now });
  assert.deepEqual(f.view().myReactions, ['joke']); assert.equal(f.view().reactions[0].count, 1);
  assert.throws(() => reactToStore(f.dir, f.owner, { shopId: f.shop.id, reaction: 'bell' }, { now }), /own_store/);
  assert.throws(() => reactToStore(f.dir, f.buyer, { shopId: f.shop.id, reaction: 'bogus' }, { now }), /invalid_store_reaction/);
});

test('purchases transfer one real item and money atomically, preserve sale history through restocking and replay without double payment', async t => {
  const f = await fixture(t), payload = f.payload(), beforeBuyer = f.balance(f.buyer), beforeOwner = f.balance(f.owner);
  const purchase = buyStoreItem(f.dir, f.buyer, payload, { now });
  assert.equal(f.itemOwner('wine-0'), f.buyer.id);
  assert.equal(f.balance(f.buyer), beforeBuyer - 120); assert.equal(f.balance(f.owner), beforeOwner + 120);
  assert.equal(f.view().stock.length, 7);
  const dashboard = businessDashboard(f.dir, f.owner, { now }).shops[0];
  assert.equal(dashboard.salesToday, 1); assert.equal(dashboard.revenueToday, 120); assert.equal(dashboard.sales, 1);
  const buyerShop = buyBusiness(f.dir, f.buyer, 'wine', 'popup', { now }).shop;
  stockBusiness(f.dir, f.buyer, buyerShop.id, ['wine-0'], { now });
  assert.deepEqual(buyStoreItem(f.dir, f.buyer, payload, { now }), purchase);
  assert.equal(businessDashboard(f.dir, f.owner, { now }).shops[0].revenueToday, 120);
  assert.throws(() => buyStoreItem(f.dir, f.rival, f.payload(), { now }), /stock_not_found/);
  assert.throws(() => buyStoreItem(f.dir, f.buyer, { ...payload, inventoryId: 'wine-1' }, { now }), /request_conflict/);
  const crossAction = { ...f.payload('wine-1'), action: 'tip', amount: 5 };
  buyStoreItem(f.dir, f.buyer, crossAction, { now });
  const paid = f.balance(f.buyer);
  assert.throws(() => tipStore(f.dir, f.buyer, crossAction, { now }), /request_conflict/);
  assert.equal(f.balance(f.buyer), paid);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), 8);
});

test('existing NPC shelf sale history migrates once and remains stable through restarts', async t => {
  const f = await fixture(t);
  f.accounts.db(db => {
    db.exec('DROP TABLE business_sales');
    db.prepare('UPDATE business_stock SET sold_at = ?, sold_price = 150 WHERE inventory_id = ?').run(now - 1, 'wine-0');
    db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ?').run(now - 1, 'wine-0');
    db.prepare('UPDATE businesses SET sales = 1, revenue = 150 WHERE id = ?').run(f.shop.id);
  });
  const shop = () => businessDashboard(f.dir, f.owner, { now }).shops[0];
  assert.equal(shop().salesToday, 1); assert.equal(shop().revenueToday, 150);
  closeDataStore(f.dir);
  assert.equal(shop().revenueToday, 150);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM business_sales').get().n), 1);
});

test('buy rejects own stock, stale quotes, missing items and insufficient funds without side effects', async t => {
  const f = await fixture(t), before = f.balance(f.owner);
  assert.throws(() => buyStoreItem(f.dir, f.owner, f.payload(), { now }), /own_store/);
  assert.throws(() => buyStoreItem(f.dir, f.buyer, { ...f.payload(), expectedPrice: 119 }, { now }), /store_price_changed/);
  assert.throws(() => buyStoreItem(f.dir, f.buyer, f.payload('missing'), { now }), /stock_not_found/);
  assert.throws(() => buyStoreItem(f.dir, f.buyer, f.payload({}), { now }), /invalid_stock/);
  f.accounts.db(db => db.prepare('UPDATE users SET tokens = 1 WHERE id = ?').run(f.buyer.id));
  assert.throws(() => buyStoreItem(f.dir, f.buyer, f.payload(), { now }), /insufficient_tokens/);
  assert.equal(f.itemOwner('wine-0'), f.owner.id); assert.equal(f.balance(f.owner), before);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM store_receipts').get().n), 0);
  adjustAdminMarket(f.dir, f.owner, { category: 'wine', percent: -80, requestId: 'store-market-adjust-001' }, { now });
  assert.equal(f.view().stock[0].price, 24);
  assert.throws(() => buyStoreItem(f.dir, f.rival, f.payload(), { now }), /store_price_changed/);
});

test('only verified buyers can review; editing replaces their review and tips have retry protection', async t => {
  const f = await fixture(t), review = { shopId: f.shop.id, stars: 5, comment: '<img src=x onerror=alert(1)>' };
  assert.throws(() => reviewStore(f.dir, f.buyer, review, { now }), /purchase_required/);
  buyStoreItem(f.dir, f.buyer, f.payload(), { now });
  reviewStore(f.dir, f.buyer, review, { now });
  reviewStore(f.dir, f.buyer, { ...review, stars: 3, comment: 'Nice shelves.' }, { now });
  assert.equal(f.view().reviewCount, 1); assert.equal(f.view().rating, 3); assert.equal(f.view().reviews[0].comment, 'Nice shelves.');
  assert.equal(f.view(null).reviews[0].username, 'bu****');
  assert.throws(() => reviewStore(f.dir, f.buyer, { ...review, stars: 6 }, { now }), /invalid_store_review/);
  assert.throws(() => reviewStore(f.dir, f.buyer, { ...review, comment: 'x'.repeat(241) }, { now }), /invalid_store_review/);
  const tip = { shopId: f.shop.id, amount: 25, requestId: 'store-tip-retry-0001' }, balance = f.balance(f.buyer), seller = f.balance(f.owner);
  tipStore(f.dir, f.buyer, tip, { now }); tipStore(f.dir, f.buyer, tip, { now });
  assert.equal(f.balance(f.buyer), balance - 25); assert.equal(f.balance(f.owner), seller + 25);
  assert.throws(() => tipStore(f.dir, f.buyer, { ...tip, amount: 10 }, { now }), /request_conflict/);
});

test('goose guard is owner-only, charges once, reduces theft odds and rolls back on unaffordable setup', async t => {
  const f = await fixture(t), profile = { shopId: f.shop.id, name: 'HONK', motto: '', gooseGuard: true, requestId: 'store-goose-retry-0001' };
  assert.throws(() => customizeStore(f.dir, f.buyer, profile, { now }), /forbidden/);
  const unguarded = f.view().stock[0].theft.chancePercent, balance = f.balance(f.owner);
  customizeStore(f.dir, f.owner, profile, { now }); customizeStore(f.dir, f.owner, profile, { now });
  assert.equal(f.balance(f.owner), balance - 250); assert.equal(f.view().gooseGuard, true);
  assert.ok(f.view().stock[0].theft.chancePercent <= unguarded / 2);
  const buyerBalance = f.balance(f.buyer);
  assert.throws(() => startStoreHeist(f.dir, f.buyer, f.payload(), { now }), /store_risk_changed/);
  assert.equal(f.balance(f.buyer), buyerBalance);
  assert.throws(() => customizeStore(f.dir, f.owner, { ...profile, gooseGuard: false, requestId: 'unguard-attempt-00001' }, { now }), /guard_permanent/);
  const other = buyBusiness(f.dir, f.owner, 'wine', 'popup', { now }).shop;
  f.accounts.db(db => db.prepare('UPDATE users SET tokens = 0 WHERE id = ?').run(f.owner.id));
  assert.throws(() => customizeStore(f.dir, f.owner, { ...profile, shopId: other.id, requestId: 'new-goose-attempt-0001' }, { now }), /insufficient_tokens/);
  assert.equal(visitStore(f.dir, f.owner, other.id, { now }).store.gooseGuard, false);
});

test('heists persist and charge once, freeze the color choice, hide rolls and transfer existing stock only on a winning roll', async t => {
  const f = await fixture(t), payload = f.payload(), buyer = f.balance(f.buyer), owner = f.balance(f.owner);
  assert.throws(() => startStoreHeist(f.dir, f.buyer, { ...payload, expectedFee: 5 }, { now }), /store_risk_changed/);
  const started = startStoreHeist(f.dir, f.buyer, payload, { now, draw: success });
  assert.deepEqual(startStoreHeist(f.dir, f.buyer, payload, { now: now + 1, draw: caught }), started);
  assert.equal(f.balance(f.buyer), buyer - 97); assert.equal(f.balance(f.owner), owner + 97);
  const challenge = f.view().heist;
  assert.equal(challenge.choice, 'red'); assert.ok(!('sequence' in challenge)); assert.ok(!('roll' in challenge));
  assert.equal(f.view(null).heist, null); assert.equal(f.view(f.rival).heist, null);
  closeDataStore(f.dir); assert.deepEqual(f.view().heist, challenge);
  assert.throws(() => finishStoreHeist(f.dir, f.rival, { heistId: started.id, moves: challenge.sequence }, { now: now + 6000 }), /heist_not_found/);
  assert.throws(() => startStoreHeist(f.dir, f.buyer, { ...payload, choice: 'black' }, { now }), /request_conflict/);
  const result = finishStoreHeist(f.dir, f.buyer, { heistId: started.id, moves: challenge.sequence }, { now: now + 6000 });
  assert.equal(result.outcome, 'stolen'); assert.equal(result.choice, 'red'); assert.equal(result.color, 'red'); assert.equal(f.itemOwner('wine-0'), f.buyer.id);
  assert.deepEqual(finishStoreHeist(f.dir, f.buyer, { heistId: started.id, moves: [1,1,1,1,1,1] }, { now: now + 7000 }), result);
  assert.equal(f.view(f.buyer, now + 7000).stock.length, 7);
  assert.equal(businessDashboard(f.dir, f.owner, { now }).shops[0].sales, 0);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), 8);
});

test('theft failure, chance, expiry and sold-out races cannot be forged or rerolled, and cooldowns cover players and stores', async t => {
  for (const expected of ['caught', 'expired', 'gone']) {
    const f = await fixture(t), started = startStoreHeist(f.dir, f.buyer, f.payload(), { now, draw: expected === 'caught' ? caught : success });
    const moves = expected === 'fumbled' ? [1,1,1,1,1,1] : [0,0,0,0,0,0];
    if (expected === 'gone') unstockBusiness(f.dir, f.owner, f.shop.id, 'wine-0', { now });
    const result = finishStoreHeist(f.dir, f.buyer, { heistId: started.id, moves, won: true }, { now: now + (expected === 'expired' ? 65000 : 6000) });
    assert.equal(result.outcome, expected); assert.equal(f.itemOwner('wine-0'), f.owner.id);
    assert.throws(() => startStoreHeist(f.dir, f.buyer, f.payload('wine-1'), { now: now + 7000 }), /heist_cooldown/);
    assert.throws(() => startStoreHeist(f.dir, f.rival, f.payload('wine-1'), { now: now + 7000 }), /heist_cooldown/);
    startStoreHeist(f.dir, f.rival, f.payload('wine-1'), { now: now + STORE_HEIST_COOLDOWN + 1, draw: caught });
    const other = buyBusiness(f.dir, f.owner, 'wine', 'popup', { now }).shop;
    f.accounts.db(db=>db.prepare('UPDATE businesses SET mischief_enabled=1 WHERE id=?').run(other.id));
    unstockBusiness(f.dir, f.owner, f.shop.id, 'wine-2', { now });
    stockBusiness(f.dir, f.owner, other.id, ['wine-2'], { now });
    assert.throws(() => startStoreHeist(f.dir, f.buyer, { ...f.payload('wine-2'), shopId: other.id }, { now: now + 8000 }), /heist_cooldown/);
    assert.equal(f.view(f.buyer, now + HEIST_COOLDOWN).cooldownUntil, now + HEIST_COOLDOWN);
  }
});

test('stock transfer failures roll back payment, sale history and notifications; live authority and economy reset apply to new store state', async t => {
  const f = await fixture(t), buyer = f.balance(f.buyer), owner = f.balance(f.owner);
  f.accounts.db(db => db.exec(`CREATE TRIGGER fail_store_transfer BEFORE UPDATE OF user_id ON inventory BEGIN SELECT RAISE(ABORT, 'unavailable'); END`));
  assert.throws(() => buyStoreItem(f.dir, f.buyer, f.payload(), { now }), /unavailable/);
  assert.equal(f.balance(f.buyer), buyer); assert.equal(f.balance(f.owner), owner); assert.equal(f.view().stock.length, 8);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM business_sales').get().n), 0);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM store_receipts').get().n), 0);
  f.accounts.db(db => { db.exec('DROP TRIGGER fail_store_transfer'); db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(f.buyer.id); });
  assert.throws(() => tipStore(f.dir, f.buyer, { shopId: f.shop.id, amount: 5, requestId: 'banned-store-tip-0001' }, { now }), /login_required/);
  f.accounts.db(db => db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(f.buyer.id));
  recordStoreVisit(f.dir, f.buyer, f.shop.id, { now }); buyStoreItem(f.dir, f.buyer, f.payload(), { now });
  reviewStore(f.dir, f.buyer, { shopId: f.shop.id, stars: 5 }, { now });
  startStoreHeist(f.dir, f.rival, f.payload('wine-1'), { now, draw: success });
  f.accounts.resetEconomy(f.owner, 'RESET ECONOMY');
  for (const table of ['business_sales','store_receipts','store_visits','store_reviews','store_heists','businesses']) assert.equal(f.accounts.db(db => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n), 0);
});

test('roulette rejects invalid colors before charging and gives identical odds to either pick', async t => {
  for (const choice of [undefined, null, 'green', 'RED', 1, {}]) {
    const f = await fixture(t), balance = f.balance(f.buyer);
    assert.throws(() => startStoreHeist(f.dir, f.buyer, { ...f.payload(), choice }, { now }), /invalid_heist_choice/);
    assert.equal(f.balance(f.buyer), balance);
    assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM store_heists').get().n), 0);
  }
  for (const choice of ['red', 'black']) {
    for (const won of [true, false]) {
      const f = await fixture(t), started = startStoreHeist(f.dir, f.buyer, { ...f.payload(), choice }, { now, draw: won ? success : caught });
      const result = finishStoreHeist(f.dir, f.buyer, { heistId: started.id, choice: choice === 'red' ? 'black' : 'red', won: !won, roll: 0 }, { now });
      assert.equal(result.choice, choice);
      assert.equal(result.color, won ? choice : choice === 'red' ? 'black' : 'red');
      assert.equal(result.outcome, won ? 'stolen' : 'caught');
      assert.equal(f.itemOwner('wine-0'), won ? f.buyer.id : f.owner.id);
      assert.deepEqual(finishStoreHeist(f.dir, f.buyer, { heistId: started.id }, { now: now + 1000 }), result);
    }
  }
});

test('theft fees lose value in expectation even at current maximum store and collector payouts', () => {
  for (const value of [1, 5, 50, 100, 500, 1000, 10000, 1000000]) {
    for (const guarded of [false, true]) {
      for (const location of [.65, 1, 1.8, 10]) {
        const quote = theftQuote(value, guarded, location);
        assert.ok(Number.isSafeInteger(quote.fee) && quote.fee >= 5);
        const expectedMarketValue = value * quote.chancePercent / 100;
        const maxCurrentPayout = value * 2 * 1.5; // 100% store markup, 150% collector event.
        assert.ok(expectedMarketValue <= quote.fee * .30 + 1e-8);
        assert.ok(maxCurrentPayout * quote.chancePercent / 100 <= quote.fee * .90 + 1e-8);
      }
    }
  }
});

test('old paid attempts migrate without exposing the memory sequence or changing their frozen fee', async t => {
  const f = await fixture(t);
  f.accounts.db(db => {
    db.exec('ALTER TABLE store_heists DROP COLUMN choice');
    db.prepare(`INSERT INTO store_heists (id,user_id,business_id,owner_id,inventory_id,sequence,roll,chance,fee,created_at,ready_at,expires_at)
      VALUES ('legacy-paid',?,?,?,?,?,0,29,10,?,?,?)`).run(f.buyer.id, f.shop.id, f.owner.id, 'wine-0', '[0,1,2,3,0,1]', now, now + 5000, now + 65000);
  });
  assert.equal(f.view().heist.choice, 'red'); assert.ok(!('sequence' in f.view().heist));
  assert.throws(() => finishStoreHeist(f.dir, f.buyer, { heistId: 'legacy-paid' }, { now }), /heist_not_ready/);
  const result = finishStoreHeist(f.dir, f.buyer, { heistId: 'legacy-paid' }, { now: now + 6000 });
  assert.equal(result.fee, 10); assert.equal(result.outcome, 'stolen');
});

test('failed winning transfers remain retryable without a reroll or another fee', async t => {
  const f = await fixture(t), started = startStoreHeist(f.dir, f.buyer, { ...f.payload(), choice: 'black' }, { now, draw: success });
  const paid = f.balance(f.buyer);
  f.accounts.db(db => db.exec(`CREATE TRIGGER fail_roulette_transfer BEFORE UPDATE OF user_id ON inventory BEGIN SELECT RAISE(ABORT, 'unavailable'); END`));
  assert.throws(() => finishStoreHeist(f.dir, f.buyer, { heistId: started.id }, { now }), /unavailable/);
  assert.equal(f.itemOwner('wine-0'), f.owner.id); assert.equal(f.balance(f.buyer), paid);
  assert.equal(f.view().heist.outcome, 'active');
  f.accounts.db(db => db.exec('DROP TRIGGER fail_roulette_transfer'));
  const result = finishStoreHeist(f.dir, f.buyer, { heistId: started.id }, { now });
  assert.equal(result.color, 'black'); assert.equal(result.outcome, 'stolen'); assert.equal(f.balance(f.buyer), paid);
});
