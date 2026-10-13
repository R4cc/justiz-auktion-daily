import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness, stockBusiness, businessDashboard, unstockBusiness } from '../src/businesses.mjs';
import { checkStoreEvents, acknowledgeStoreEvents, STORE_EVENT_INTERVAL, STORE_EVENTS, ensureStoreEventSchema } from '../src/store-events.mjs';
import { visitStore, buyStoreItem, startStoreHeist, actStoreHeist } from '../src/storefronts.mjs';
const now = Date.parse('2026-10-08T12:30:00Z'), due = now + STORE_EVENT_INTERVAL;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jg-store-events-')), accounts = new Accounts(dir, { now: () => now });
  const owner = { id: 'owner', admin: true }, rival = { id: 'rival' };
  accounts.db(db => {
    for (const user of [owner, rival]) db.prepare("INSERT INTO users(id, username, password_hash, tokens, created_at, admin) VALUES (?, ?, 'disabled', 100000, ?, ?)").run(user.id, user.id, now, Number(Boolean(user.admin)));
    for (let n=0;n<9;n++) db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)').run(`wine-${n}`,owner.id,JSON.stringify({title:'Event wine',price:100,marketCategory:'wine'}),now);
  });
  const shop = buyBusiness(dir,owner,'wine','popup',{now}).shop;
  stockBusiness(dir,owner,shop.id,Array.from({length:8},(_,n)=>`wine-${n}`),{now});
  // Remove ordinary NPC traffic to isolate the event's financial effects.
  accounts.db(db=>db.prepare('UPDATE businesses SET traffic_popularity=0').run());
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  accounts.db(ensureStoreEventSchema);
  const query=(sql,...args)=>accounts.db(db=>db.prepare(sql).all(...args));
  return {dir,accounts,owner,rival,shop,query,balance:()=>query('SELECT tokens FROM users WHERE id=?',owner.id)[0].tokens};
}
const rolls=(...values)=>()=>{assert.ok(values.length,'unexpected random roll');return values.shift();};
const run=(f,roll,extra=1)=>checkStoreEvents(f.dir,f.owner,{now:due,random:rolls(0,roll,extra)}).events[0];

test('store limit is atomic, covers every category and leaves legacy stores intact', async t=>{
  const f=await fixture(t);
  buyBusiness(f.dir,f.owner,'electronics','popup',{now});buyBusiness(f.dir,f.owner,'toys','popup',{now});
  const balance=f.balance();
  assert.throws(()=>buyBusiness(f.dir,f.owner,'wine','popup',{now}),{message:'store_limit_reached',status:409});
  assert.equal(f.balance(),balance);assert.equal(businessDashboard(f.dir,f.owner,{now}).maxStores,3);
  f.accounts.db(db=>db.prepare("INSERT INTO businesses(id,user_id,type,size,bought_at,last_tick_at) VALUES ('legacy',?,'wine','popup',?,?)").run(f.owner.id,now,now));
  assert.equal(businessDashboard(f.dir,f.owner,{now}).shops.length,4);
  assert.throws(()=>buyBusiness(f.dir,f.owner,'cars','popup',{now}),/store_limit_reached/);
  assert.ok(buyBusiness(f.dir,f.rival,'wine','popup',{now}).shop);
});
for(const [name,roll] of [['bombing',0],['heist',3]]) test(`${name} is cosmetic, preserves shelves and cannot be replayed`,async t=>{
  const f=await fixture(t), before=f.balance(), event=run(f,roll);
  assert.equal(event.type,name);assert.equal(event.itemsLost,0);assert.equal(event.money,0);assert.equal(f.balance(),before);
  assert.equal(f.query('SELECT * FROM business_stock WHERE sold_at IS NULL').length,8);
  assert.equal(f.query('SELECT * FROM business_sales').length,0);
  assert.equal(f.query("SELECT * FROM inventory WHERE sold_at IS NULL AND user_id='owner'").length,9);
  assert.equal(f.query('SELECT * FROM businesses').length,1);

  closeDataStore(f.dir);
  assert.deepEqual(checkStoreEvents(f.dir,f.owner,{now:due+1,random:()=>{throw Error('rerolled');}}).events,[event]);
  acknowledgeStoreEvents(f.dir,f.rival,[event.id],{now:due});
  assert.equal(checkStoreEvents(f.dir,f.owner,{now:due+1}).events.length,1);
  acknowledgeStoreEvents(f.dir,f.owner,[event.id],{now:due});
  assert.equal(checkStoreEvents(f.dir,f.owner,{now:due+1}).events.length,0);
  unstockBusiness(f.dir,f.owner,f.shop.id,'wine-0',{now:due+1});
  stockBusiness(f.dir,f.owner,f.shop.id,['wine-8'],{now:due+1});
  assert.equal(visitStore(f.dir,f.rival,f.shop.id,{now:due+1}).store.stock.length,8);
});
test('rich buyer pays frozen current shelf prices exactly once and records normal sales',async t=>{
  const f=await fixture(t), before=f.balance(), event=run(f,10);
  assert.equal(event.type,'rich_buyer');assert.equal(event.itemsSold,8);assert.equal(event.money,960);
  assert.equal(f.balance(),before);assert.equal(f.query('SELECT * FROM business_sales').length,8);
  const shop=businessDashboard(f.dir,f.owner,{now:due}).shops[0];
  assert.equal(shop.sales,8);assert.equal(shop.revenue,960);assert.equal(shop.salesToday,8);assert.equal(shop.revenueToday,960);
  assert.equal(shop.cashReady,960);
  assert.equal(shop.stock.length,0);assert.equal(f.query('SELECT * FROM account_notifications WHERE source_key LIKE ?', 'store-event:%').length,1);
  checkStoreEvents(f.dir,f.owner,{now:due+1});assert.equal(f.balance(),before);assert.equal(businessDashboard(f.dir,f.owner,{now:due+1}).shops[0].cashReady,960);
});
test('partial disasters, collector premium, fine and windfall have bounded real effects',async t=>{
  for(const [type,roll,lost,sold,money] of [['flood',35,0,0,0],['goose_rampage',45,0,0,0],['tax_raid',53,0,0,-100],['collector',65,0,3,540],['windfall',85,0,0,200]]) {
    const f=await fixture(t), before=f.balance(),event=run(f,roll);
    assert.equal(event.type,type);assert.equal(event.itemsLost,lost);assert.equal(event.itemsSold,sold);assert.equal(event.money,money);
    assert.equal(f.balance(),before+Math.min(0,money));assert.equal(businessDashboard(f.dir,f.owner,{now:due}).shops[0].cashReady,Math.max(0,money));assert.equal(visitStore(f.dir,f.rival,f.shop.id,{now:due}).store.stock.length,8-lost-sold);
  }
  const f=await fixture(t);f.accounts.db(db=>db.prepare("UPDATE users SET tokens=7 WHERE id='owner'").run());
  assert.equal(run(f,53).money,-7);assert.equal(f.balance(),0);
});
test('new-store grace, empty shelves, failed rolls and skipped days cannot be farmed',async t=>{
  const f=await fixture(t);
  assert.equal(STORE_EVENTS.reduce((sum,event)=>sum+event.weight,0),100);
  assert.deepEqual(checkStoreEvents(f.dir,f.owner,{now:due-1,random:()=>{throw Error('too early');}}).events,[]);
  checkStoreEvents(f.dir,f.owner,{now:due,random:rolls(99)});
  checkStoreEvents(f.dir,f.owner,{now:due+1,random:()=>{throw Error('reroll after miss');}});
  const events=checkStoreEvents(f.dir,f.owner,{now:due+30*STORE_EVENT_INTERVAL,random:rolls(0,85)}).events;
  assert.equal(events.length,1);assert.equal(events[0].type,'windfall');
  f.accounts.db(db=>db.prepare('DELETE FROM business_stock').run());
  assert.equal(checkStoreEvents(f.dir,f.owner,{now:due+31*STORE_EVENT_INTERVAL,random:()=>{throw Error('empty stock');}}).events.length,1);
});
test('cosmetic heists preserve guarded shelves and live player purchases',async t=>{
  const f=await fixture(t);f.accounts.db(db=>db.prepare('UPDATE businesses SET goose_guard=1').run());
  assert.equal(run(f,3,0).type,'heist');assert.equal(f.query('SELECT * FROM inventory WHERE sold_at IS NULL').length,9);
  const g=await fixture(t);g.accounts.db(db=>db.prepare('UPDATE businesses SET mischief_enabled=1').run());
  buyStoreItem(g.dir,g.rival,{shopId:g.shop.id,inventoryId:'wine-0',expectedPrice:120,requestId:'event-purchase-0001'},{now});
  const attempt=startStoreHeist(g.dir,g.rival,{shopId:g.shop.id,inventoryId:'wine-1',expectedPrice:120,expectedFine:400,requestId:'event-heist-start-001'},{now,draw:max=>max-1});
  assert.equal(run(g,0).itemsLost,0);
  assert.equal(g.query("SELECT user_id, sold_at FROM inventory WHERE id='wine-0'")[0].user_id,g.rival.id);
  assert.equal(g.query("SELECT sold_at FROM inventory WHERE id='wine-0'")[0].sold_at,null);
  // This overdue hand also auto-spins its wheel. Fix the police draw to land
  // on caught rather than relying on the live 20% catch chance.
  const ended=actStoreHeist(g.dir,g.rival,{heistId:attempt.id,action:'stand',turn:0,requestId:'expired-event-hand-0001'},{now:due,policeDraw:()=>0});
  assert.equal(ended.outcome,'caught');
});
test('event failures roll back stock, money, check, sale history and modal result; live authority and economy reset apply',async t=>{
  const f=await fixture(t);f.accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,f.shop.id));
  assert.throws(()=>run(f,10),/token_balance_limit/);
  assert.equal(f.query('SELECT * FROM business_stock').length,8);assert.equal(f.query('SELECT * FROM store_event_checks').length,0);
  assert.equal(f.query('SELECT * FROM store_events').length,0);assert.equal(f.query('SELECT * FROM business_sales').length,0);
  f.accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=0 WHERE id=?').run(f.shop.id));run(f,85);
  f.accounts.db(db=>db.prepare("UPDATE users SET banned=1 WHERE id='owner'").run());
  assert.throws(()=>checkStoreEvents(f.dir,f.owner,{now:due}),/login_required/);
  assert.throws(()=>acknowledgeStoreEvents(f.dir,f.owner,[],{now:due}),/invalid_store_events/);
  f.accounts.db(db=>db.prepare("UPDATE users SET banned=0 WHERE id='owner'").run());
  f.accounts.resetEconomy(f.owner,'RESET ECONOMY');
  for(const table of ['store_events','store_event_checks','businesses']) assert.equal(f.query(`SELECT * FROM ${table}`).length,0);
});

test('historical stock-loss outcomes remain byte-for-byte unchanged after the risk migration',async t=>{
  const f=await fixture(t),result={id:'old-event',shopId:f.shop.id,type:'bombing',itemsLost:8,itemsSold:0,money:0,titleEn:'Historical outcome'};
  f.accounts.db(db=>db.prepare('INSERT INTO store_events VALUES (?,?,?,?,?,NULL)').run(result.id,f.shop.id,f.owner.id,JSON.stringify(result),now));
  assert.deepEqual(checkStoreEvents(f.dir,f.owner,{now:now+1}).events,[result]);
});
