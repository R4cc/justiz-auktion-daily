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
  playerCriminalRecord, theftQuote, startStoreHeist, finishStoreHeist, actStoreHeist, tickStoreJustice, HEIST_DURATION, HEIST_COOLDOWN, STORE_HEIST_COOLDOWN } from '../src/storefronts.mjs';

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
  const payload = (inventoryId = 'wine-0') => ({ shopId: shop.id, inventoryId, expectedPrice: 120, expectedFine:400, requestId: `store-request-${++next}-0001` });
  const balance = user => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id = ?').get(user.id).tokens);
  const itemOwner = id => accounts.db(db => db.prepare('SELECT user_id FROM inventory WHERE id = ?').get(id).user_id);
  const view = (user = buyer, at = now) => visitStore(dir, user, shop.id, { now: at }).store;
  return { dir, accounts, owner, buyer, rival, shop, payload, balance, itemOwner, view };
}
const success = max => max-1;

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

test('goose guard is owner-only, charges once, increases the fine without changing cards and rolls back on unaffordable setup', async t => {
  const f = await fixture(t), profile = { shopId: f.shop.id, name: 'HONK', motto: '', gooseGuard: true, requestId: 'store-goose-retry-0001' };
  assert.throws(() => customizeStore(f.dir, f.buyer, profile, { now }), /forbidden/);
  const unguarded = f.view().stock[0].theft.fine, balance = f.balance(f.owner);
  customizeStore(f.dir, f.owner, profile, { now }); customizeStore(f.dir, f.owner, profile, { now });
  assert.equal(f.balance(f.owner), balance - 250); assert.equal(f.view().gooseGuard, true);
  assert.ok(f.view().stock[0].theft.fine === unguarded * 2);
  const buyerBalance = f.balance(f.buyer);
  assert.throws(() => startStoreHeist(f.dir, f.buyer, f.payload(), { now }), /store_risk_changed/);
  assert.equal(f.balance(f.buyer), buyerBalance);
  assert.throws(() => customizeStore(f.dir, f.owner, { ...profile, gooseGuard: false, requestId: 'unguard-attempt-00001' }, { now }), /guard_permanent/);
  const other = buyBusiness(f.dir, f.owner, 'wine', 'popup', { now }).shop;
  f.accounts.db(db => db.prepare('UPDATE users SET tokens = 0 WHERE id = ?').run(f.owner.id));
  assert.throws(() => customizeStore(f.dir, f.owner, { ...profile, shopId: other.id, requestId: 'new-goose-attempt-0001' }, { now }), /insufficient_tokens/);
  assert.equal(visitStore(f.dir, f.owner, other.id, { now }).store.gooseGuard, false);
});

function setHand(f,id,{player=[9,8],dealer=[6,10],deck}={}) {
  const used=new Set([...player,...dealer]);
  const game={player,dealer,deck:deck||Array.from({length:52},(_,n)=>n).filter(n=>!used.has(n)),turn:0,outcome:'active'};
  f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify(game),id));
}
const action=(f,id,move='stand',turn=0,at=now)=>actStoreHeist(f.dir,f.buyer,{heistId:id,action:move,turn,requestId:`blackjack-${id}-${turn}-${move}`},{now:at});
test('free blackjack persists; deck and hole card remain private; replay cannot redraw or transfer twice',async t=>{
  const f=await fixture(t),payload=f.payload(),buyer=f.balance(f.buyer),owner=f.balance(f.owner);
  assert.throws(()=>startStoreHeist(f.dir,f.buyer,{...payload,expectedFine:5},{now}),/store_risk_changed/);
  const started=startStoreHeist(f.dir,f.buyer,payload,{now,draw:success});
  assert.deepEqual(startStoreHeist(f.dir,f.buyer,payload,{now:now+1,draw:()=>{throw Error('redraw');}}),started);
  assert.equal(f.balance(f.buyer),buyer);assert.equal(f.balance(f.owner),owner);
  const challenge=f.view().heist;assert.equal(challenge.blackjack.dealer[1],null);assert.ok(!JSON.stringify(challenge).includes('deck'));
  assert.equal(f.view(null).heist,null);assert.equal(f.view(f.rival).heist,null);closeDataStore(f.dir);assert.deepEqual(f.view().heist,challenge);
  assert.throws(()=>actStoreHeist(f.dir,f.rival,{heistId:started.id,action:'stand',turn:0,requestId:'foreign-hand-action-001'},{now}),/heist_not_found/);
  setHand(f,started.id);const result=action(f,started.id);assert.equal(result.outcome,'stolen');assert.equal(result.consequence,null);assert.equal(f.itemOwner('wine-0'),f.buyer.id);
  assert.deepEqual(action(f,started.id),result);assert.equal(f.balance(f.buyer),buyer);assert.equal(f.view().stock.length,7);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n),8);
});
test('hit and stand are authoritative, stale turns cannot consume cards, pushes incur no fine, payload cannot force a win',async t=>{
  const f=await fixture(t),id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;
  setHand(f,id,{player:[1,2],dealer:[8,23],deck:[3,4,5,6,7]});
  const hit=action(f,id,'hit');assert.equal(hit.blackjack.playerTotal,9);assert.equal(hit.blackjack.dealer[1],null);
  assert.deepEqual(action(f,id,'hit'),hit);
  assert.throws(()=>actStoreHeist(f.dir,f.buyer,{heistId:id,action:'hit',turn:0,requestId:'stale-turn-attempt-0001'},{now}),/blackjack_turn_changed/);
  assert.throws(()=>actStoreHeist(f.dir,f.buyer,{heistId:id,action:'cheat',turn:1,requestId:'cheat-turn-attempt-0001'},{now}),/invalid_blackjack_action/);
  const result=actStoreHeist(f.dir,f.buyer,{heistId:id,action:'stand',turn:1,won:true,dealer:[26],requestId:'stand-final-hand-00001'},{now});
  assert.equal(result.outcome,'caught');assert.equal(result.consequence.paidCash,400);assert.equal(f.balance(f.buyer),99600);
  const g=await fixture(t),tie=startStoreHeist(g.dir,g.buyer,g.payload(),{now,draw:success}).id;setHand(g,tie,{player:[9,7],dealer:[22,20]});
  assert.equal(action(g,tie).outcome,'push');assert.equal(g.balance(g.buyer),100000);assert.equal(g.itemOwner('wine-0'),g.owner.id);
});
test('no-money losses seize available inventory, cancel unbid listings, remove shelved stock and return excess value',async t=>{
  const f=await fixture(t);f.accounts.db(db=>{
    db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(f.buyer.id);
    for(const [id,price] of [['small',50],['listed',100],['shelved',100],['large',500]])db.prepare('INSERT INTO inventory VALUES (?,?,?,?,NULL)').run(id,f.buyer.id,JSON.stringify({title:id,price,marketCategory:'wine'}),now);
  });
  // A store can hold debtor-owned inventory; property itself is not inventory.
  f.accounts.db(db=>db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(f.buyer.id));
  const own=buyBusiness(f.dir,f.buyer,'wine','popup',{now}).shop;f.accounts.db(db=>db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(f.buyer.id));stockBusiness(f.dir,f.buyer,own.id,['shelved'],{now});
  const {listItem}=await import('../src/resale.mjs');const listed=listItem(f.dir,f.buyer,{inventoryId:'listed',startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});
  const id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;setHand(f,id,{player:[2,3],dealer:[9,8]});
  const result=action(f,id);assert.equal(result.outcome,'caught');assert.equal(result.consequence.seized.length,4);assert.equal(result.consequence.remainingFine,0);assert.equal(f.balance(f.buyer),350);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT status FROM resale_auctions WHERE id=?').get(listed.id).status),'cancelled');
  assert.equal(businessDashboard(f.dir,f.buyer,{now}).shops[0].stock.length,0);assert.equal(result.consequence.jailedUntil,0);
});
test('unpaid fines protect live bidder escrow; debt blocks new theft and collects future money once',async t=>{
  const f=await fixture(t);f.accounts.db(db=>db.prepare('INSERT INTO inventory VALUES (?,?,?, ?,NULL)').run('pledged',f.buyer.id,JSON.stringify({title:'pledged',price:100,marketCategory:'wine'}),now));
  const {listItem,placeBid}=await import('../src/resale.mjs');const listed=listItem(f.dir,f.buyer,{inventoryId:'pledged',startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});placeBid(f.dir,f.rival,listed.id,200,{now});
  f.accounts.db(db=>db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(f.buyer.id));
  const id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;setHand(f,id,{player:[2,3],dealer:[9,8]});const result=action(f,id);
  assert.equal(result.consequence.remainingFine,400);assert.equal(f.accounts.profile(f.buyer).justice.fineDue,400);assert.equal(f.accounts.profile(f.buyer).justice.jailed,false);
  const {netWorthHistory}=await import('../src/net-worth.mjs');const worth=netWorthHistory(f.dir,f.buyer,{now});assert.equal(worth.current.fineDebt,400);assert.equal(worth.current.total,-300);assert.equal(worth.points.at(-1).total,-300);
  assert.equal(f.itemOwner('pledged'),f.buyer.id);assert.equal(f.accounts.db(db=>db.prepare('SELECT max_bid FROM resale_auctions WHERE id=?').get(listed.id).max_bid),200);
  assert.throws(()=>startStoreHeist(f.dir,f.buyer,f.payload('wine-1'),{now:now+HEIST_COOLDOWN}),/unpaid_fine/);
  f.accounts.db(db=>db.prepare('UPDATE users SET tokens=450 WHERE id=?').run(f.buyer.id));const user=f.accounts.profile(f.buyer);assert.equal(user.tokens,50);assert.equal(user.justice.fineDue,0);assert.equal(f.accounts.profile(f.buyer).tokens,50);
});
test('abandoned hands are caught offline; insolvency causes persisted, escalating jail without permanent debt loops',async t=>{
  const f=await fixture(t);f.accounts.db(db=>db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(f.buyer.id));
  startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success});const end=now+HEIST_DURATION;
  tickStoreJustice(f.dir,{now:end});closeDataStore(f.dir);const status=f.accounts.profile(f.buyer).justice;
  assert.equal(status.offences,1);assert.equal(status.fineDue,0);assert.equal(status.jailedUntil,end+5*60000);assert.equal(status.lastConsequence.convertedToSentence,400);
  assert.throws(()=>visitStore(f.dir,f.buyer,f.shop.id,{now:end+1}),/player_jailed/);
  tickStoreJustice(f.dir,{now:end+1});assert.equal(f.accounts.profile(f.buyer).justice.offences,1);
  const next=now+HEIST_COOLDOWN+1;startStoreHeist(f.dir,f.buyer,f.payload('wine-1'),{now:next,draw:success});tickStoreJustice(f.dir,{now:next+HEIST_DURATION});
  const again=f.accounts.profile(f.buyer).justice;assert.equal(again.offences,2);assert.equal(again.jailedUntil,next+HEIST_DURATION+15*60000);
});
test('stock races grant no missing item or fine on a win, and cooldowns cover player and store',async t=>{
  const f=await fixture(t),id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;setHand(f,id);unstockBusiness(f.dir,f.owner,f.shop.id,'wine-0',{now});
  assert.equal(action(f,id).outcome,'gone');assert.equal(f.balance(f.buyer),100000);
  assert.throws(()=>startStoreHeist(f.dir,f.buyer,f.payload('wine-1'),{now:now+1}),/heist_cooldown/);
  assert.throws(()=>startStoreHeist(f.dir,f.rival,f.payload('wine-1'),{now:now+1}),/heist_cooldown/);
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

test('winning transfer and fine collection failures roll back all consequences and remain retryable',async t=>{
  const f=await fixture(t),id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;setHand(f,id);
  f.accounts.db(db=>db.exec("CREATE TRIGGER fail_theft BEFORE UPDATE OF user_id ON inventory BEGIN SELECT RAISE(ABORT,'unavailable'); END"));
  assert.throws(()=>action(f,id),/unavailable/);assert.equal(f.view().heist.outcome,'active');assert.equal(f.balance(f.buyer),100000);
  f.accounts.db(db=>db.exec('DROP TRIGGER fail_theft'));assert.equal(action(f,id).outcome,'stolen');
  const g=await fixture(t);g.accounts.db(db=>{db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(g.buyer.id);db.prepare('INSERT INTO inventory VALUES (?,?,?, ?,NULL)').run('seize',g.buyer.id,JSON.stringify({title:'seize',price:100}),now);});
  const caught=startStoreHeist(g.dir,g.buyer,g.payload(),{now,draw:success}).id;setHand(g,caught,{player:[2,3],dealer:[9,8]});
  g.accounts.db(db=>db.exec("CREATE TRIGGER fail_seize BEFORE UPDATE OF sold_at ON inventory BEGIN SELECT RAISE(ABORT,'seizure unavailable'); END"));
  assert.throws(()=>action(g,caught),/seizure unavailable/);assert.equal(g.view().heist.outcome,'active');assert.equal(g.accounts.profile(g.buyer).justice.offences,0);
  g.accounts.db(db=>db.exec('DROP TRIGGER fail_seize'));assert.equal(action(g,caught).outcome,'caught');
});


test('criminal record captures each caught attempt at settlement, exact fines and no duplicate on retries or collection',async t=>{
 const f=await fixture(t),records=(user=f.buyer,options={})=>playerCriminalRecord(f.dir,user,{now,...options});
 assert.equal(records().total,0);
 const id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;
 assert.equal(records().total,0);setHand(f,id,{player:[2,3],dealer:[9,8]});
 const at=now+6000;assert.equal(action(f,id,'stand',0,at).outcome,'caught');
 const first=records();assert.equal(first.total,1);assert.equal(first.totalPenalties,400);
 assert.deepEqual(first.records[0],{id,fine:400,attemptedAt:now,recordedAt:at,legacyFee:false,abandoned:false,crime:'attempted_theft'});
 action(f,id,'stand',0,at);f.accounts.profile(f.buyer);f.accounts.profile(f.buyer);
 assert.equal(records().total,1);assert.equal(f.balance(f.buyer),99600);assert.equal(records(f.owner).total,0);
 closeDataStore(f.dir);assert.equal(records().records[0].recordedAt,at);
 f.accounts.resetEconomy(f.owner,'RESET ECONOMY');assert.equal(records().total,0);
});
test('criminal record includes abandoned offenses once; non-criminal outcomes are excluded and fine rollback leaves no entry',async t=>{
 const f=await fixture(t),id=startStoreHeist(f.dir,f.buyer,f.payload(),{now,draw:success}).id;
 tickStoreJustice(f.dir,{now:now+HEIST_DURATION+60000});tickStoreJustice(f.dir,{now:now+HEIST_DURATION+120000});
 const record=playerCriminalRecord(f.dir,f.buyer,{now:now+HEIST_DURATION+120000});
 assert.equal(record.total,1);assert.equal(record.records[0].abandoned,true);assert.equal(record.records[0].recordedAt,now+HEIST_DURATION+60000);
 for(const status of ['stolen','push','gone','expired','active']){
  f.accounts.db(db=>db.prepare('UPDATE store_heists SET status=? WHERE id=?').run(status,id));
  assert.equal(playerCriminalRecord(f.dir,f.buyer,{now}).total,0);
 }
 const g=await fixture(t),attempt=startStoreHeist(g.dir,g.buyer,g.payload(),{now,draw:success}).id;
 setHand(g,attempt,{player:[2,3],dealer:[9,8]});
 g.accounts.db(db=>db.exec("CREATE TRIGGER reject_fine BEFORE UPDATE OF tokens ON users BEGIN SELECT RAISE(ABORT,'fine_failed'); END"));
 assert.throws(()=>action(g,attempt),/fine_failed/);
 assert.equal(playerCriminalRecord(g.dir,g.buyer,{now}).total,0);
 assert.equal(g.accounts.db(db=>db.prepare('SELECT settled_at FROM store_heists WHERE id=?').get(attempt).settled_at),null);
});
test('historical catch dates migrate from receipts; unknown timestamps stay unknown; history is fully pageable',async t=>{
 const f=await fixture(t);
 f.accounts.db(db=>{
  db.exec('ALTER TABLE store_heists DROP COLUMN settled_at');
  const insert=db.prepare(`INSERT INTO store_heists(id,user_id,business_id,owner_id,inventory_id,sequence,roll,chance,fee,created_at,ready_at,expires_at,status,result,blackjack)
    VALUES(?,?,?,?,?,'[]',0,0,?,?,?,?, 'caught',?,?)`);
  for(let n=0;n<13;n++)insert.run('historical-'+n,f.buyer.id,f.shop.id,f.owner.id,'wine-0',100+n,now+n,now+5000,now+HEIST_DURATION,
    JSON.stringify({id:'historical-'+n,outcome:'caught',abandoned:n===1}),n===2?null:'{}');
  db.prepare(`INSERT INTO store_receipts(id,user_id,request_id,business_id,action,payload,result,created_at)
    VALUES('receipt',?,?,?,'blackjack','{}',?,?)`).run(f.buyer.id,'historical-catch-receipt',f.shop.id,JSON.stringify({id:'historical-0',outcome:'caught'}),now+6000);
 });
 const first=playerCriminalRecord(f.dir,f.buyer,{now}),second=playerCriminalRecord(f.dir,f.buyer,{offset:10,now});
 assert.equal(first.total,13);assert.equal(first.records.length,10);assert.equal(first.hasMore,true);
 assert.equal(second.records.length,3);assert.equal(second.hasMore,false);
 const all=[...first.records,...second.records];assert.equal(new Set(all.map(r=>r.id)).size,13);
 assert.equal(all[0].id,'historical-0');assert.equal(all.find(r=>r.id==='historical-1').recordedAt,null);
 assert.equal(all.find(r=>r.id==='historical-0').recordedAt,now+6000);
 assert.equal(all.find(r=>r.id==='historical-2').recordedAt,null);assert.equal(all.find(r=>r.id==='historical-2').legacyFee,true);
 assert.equal(first.totalPenalties,all.reduce((sum,r)=>sum+r.fine,0));
 assert.equal(playerCriminalRecord(f.dir,f.buyer,{offset:Infinity,limit:Infinity,now}).records.length,10);
 assert.equal(playerCriminalRecord(f.dir,f.buyer,{limit:1000,now}).limit,50);
 f.accounts.db(db=>db.prepare("UPDATE users SET banned=1 WHERE id='buyer'").run());
 assert.throws(()=>playerCriminalRecord(f.dir,f.buyer,{now}),/login_required/);
});
