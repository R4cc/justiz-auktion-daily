import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness, stockBusiness, unstockBusiness, businessDashboard } from '../src/businesses.mjs';
import { tickNpcStoreThefts, NPC_STORE_THEFT_INTERVAL as day } from '../src/npc-store-theft.mjs';
import { npcStoreTheftChance } from '../src/economy-balance.mjs';
import { checkStoreEvents, acknowledgeStoreEvents } from '../src/store-events.mjs';
import { startStoreHeist } from '../src/storefronts.mjs';
import { listItem } from '../src/resale.mjs';
import { tickEconomy } from '../src/economy-runtime.mjs';
import { userStatistics } from '../src/user-statistics.mjs';

const now=Date.parse('2026-10-14T12:00:00Z');
async function fixture(t,{plotId='leopoldstadt-1',guard=false}={}) {
 const dir=await mkdtemp(join(tmpdir(),'jg-npc-theft-')),accounts=new Accounts(dir,{now:()=>now}),owner={id:'owner',admin:true},visitor={id:'visitor'};
 accounts.db(db=>{for(const actor of [owner,visitor])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at,admin) VALUES(?,?,'disabled',1000000,8100,?,?)").run(actor.id,actor.id,now,Number(Boolean(actor.admin)));for(let i=0;i<3;i++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('wine-'+i,owner.id,JSON.stringify({title:'Shelf wine '+i,price:100,marketCategory:'wine'}),now);});
 const shop=buyBusiness(dir,owner,'wine',null,{now,plotId}).shop;stockBusiness(dir,owner,shop.id,['wine-0','wine-1'],{now});
 accounts.db(db=>db.prepare('UPDATE businesses SET traffic_popularity=0,security_guard=?,cash_balance=123 WHERE id=?').run(Number(guard),shop.id));
 const rows=(sql,...args)=>accounts.db(db=>db.prepare(sql).all(...args));
 const tick=(at,random)=>tickNpcStoreThefts(dir,{now:at,random});
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 return {dir,accounts,owner,visitor,shop,rows,tick};
}
const draws=(...values)=>max=>{assert.ok(values.length,'unexpected random draw');const n=values.shift();assert.ok(n>=0&&n<max,'draw range');return n;};
const noDraw=()=>{throw Error('must not roll');};

test('NPC shoplifting has low district-scaled odds and guards reduce them by 60%',()=>{
 for(const [multiplier,unguarded,guarded] of [[1,2,.8],[1.8,3.6,1.44],[.65,1.3,.52],[.8,1.6,.64],[.75,1.5,.6]]){
  assert.equal(npcStoreTheftChance(false,multiplier),unguarded);assert.equal(npcStoreTheftChance(true,multiplier),guarded);
 }
});

test('first tracking grants a day; successful theft removes one real shelf item without earnings or sales',async t=>{
 const f=await fixture(t),balance=f.rows("SELECT tokens FROM users WHERE id='owner'")[0].tokens;
 assert.deepEqual(f.tick(now,noDraw).events,[]);assert.deepEqual(f.tick(now+day-1,noDraw).events,[]);
 const event=f.tick(now+day,draws(199,1)).events[0];assert.equal(event.type,'npc_theft');assert.equal(event.itemsLost,1);assert.equal(event.inventoryId,'wine-1');assert.equal(event.chancePercent,2);assert.equal(event.money,0);
 assert.equal(f.rows('SELECT * FROM business_stock WHERE sold_at IS NULL').length,1);assert.equal(f.rows("SELECT sold_at FROM inventory WHERE id='wine-1'")[0].sold_at,now+day);assert.equal(f.rows("SELECT sold_at FROM inventory WHERE id='wine-2'")[0].sold_at,null);
 assert.equal(f.rows('SELECT * FROM business_sales').length,0);assert.equal(f.rows('SELECT * FROM trader_sales').length,0);assert.equal(f.rows("SELECT tokens FROM users WHERE id='owner'")[0].tokens,balance);
 const shop=businessDashboard(f.dir,f.owner,{now:now+day}).shops[0];assert.equal(shop.sales,0);assert.equal(shop.revenue,0);assert.equal(shop.cashReady,123);
 const stats=userStatistics(f.dir,f.owner,{now:now+day});assert.equal(stats.trading.itemsSold,0);assert.equal(stats.money.earned,0);
 const notifications=f.rows("SELECT * FROM account_notifications WHERE source_key LIKE 'store-event:%'");assert.equal(notifications.length,1);assert.match(notifications[0].body_en,/Shelf wine 1/);
 closeDataStore(f.dir);assert.deepEqual(f.tick(now+day+1,noDraw).events,[]);assert.equal(f.rows('SELECT * FROM store_events').length,1);
 const activity=checkStoreEvents(f.dir,f.owner,{now:now+day+1,random:()=>99}).events;assert.deepEqual(activity,[event]);acknowledgeStoreEvents(f.dir,f.visitor,[event.id]);assert.equal(f.rows('SELECT acknowledged_at FROM store_events')[0].acknowledged_at,null);acknowledgeStoreEvents(f.dir,f.owner,[event.id]);assert.ok(f.rows('SELECT acknowledged_at FROM store_events')[0].acknowledged_at);
});

test('Favoriten and security guards change the actual runtime roll boundary',async t=>{
 for(const [plotId,guard,boundary] of [['favoriten-1',false,360],['favoriten-1',true,144],['hietzing-1',false,130]]){
  const f=await fixture(t,{plotId,guard});f.tick(now,noDraw);assert.equal(f.tick(now+day,draws(boundary)).events.length,0);assert.equal(f.tick(now+2*day,draws(boundary-1,0)).events.length,1);
  assert.equal(businessDashboard(f.dir,f.owner,{now:now+2*day}).shops[0].npcTheftChancePercent,boundary/100);
 }
});

test('misses, empty shelves, downtime and repeated runtime calls cannot reroll or accumulate losses',async t=>{
 const f=await fixture(t);f.tick(now,noDraw);assert.equal(f.tick(now+day,draws(200)).events.length,0);f.tick(now+day+1,noDraw);
 assert.equal(f.tick(now+31*day,draws(0,0)).events.length,1);assert.equal(f.rows('SELECT * FROM business_stock WHERE sold_at IS NULL').length,1);f.tick(now+31*day+1,noDraw);
 f.accounts.db(db=>db.prepare('DELETE FROM business_stock').run());f.tick(now+32*day,noDraw);stockBusiness(f.dir,f.owner,f.shop.id,['wine-2'],{now:now+32*day});f.tick(now+32*day+1,noDraw);
});

test('auction locks and pending player theft targets are protected, as are off-shelf items',async t=>{
 const f=await fixture(t);const hand=startStoreHeist(f.dir,f.visitor,{shopId:f.shop.id,inventoryId:'wine-0',expectedPrice:120,expectedFine:200,requestId:'npc-theft-protected-player-hand'},{now,draw:max=>max-1});assert.equal(hand.heist.outcome,'active');
 unstockBusiness(f.dir,f.owner,f.shop.id,'wine-1',{now});const auction=listItem(f.dir,f.owner,{inventoryId:'wine-1',startPrice:100,endsAt:new Date(now+3*day).toISOString()},{now});
 // A legacy/corrupt shelf-listing overlap must still honor the auction lock.
 f.accounts.db(db=>db.prepare('INSERT INTO business_stock(inventory_id,business_id,stocked_at,asking_price) VALUES(?,?,?,120)').run('wine-1',f.shop.id,now));
 f.tick(now,noDraw);f.tick(now+day,noDraw);assert.equal(f.rows('SELECT * FROM store_events').length,0);
 f.accounts.db(db=>db.prepare("UPDATE store_heists SET status='escaped' WHERE id=?").run(hand.id));const loss=f.tick(now+2*day,draws(0,0)).events[0];assert.equal(loss.inventoryId,'wine-0');assert.equal(f.rows('SELECT status FROM resale_auctions WHERE id=?',auction.id)[0].status,'active');assert.equal(f.rows("SELECT sold_at FROM inventory WHERE id='wine-1'")[0].sold_at,null);assert.equal(f.rows("SELECT sold_at FROM inventory WHERE id='wine-2'")[0].sold_at,null);
});

test('failed receipt persistence rolls back the check and item removal together',async t=>{
 const f=await fixture(t);f.tick(now,noDraw);f.accounts.db(db=>db.exec("CREATE TRIGGER reject_npc_event BEFORE INSERT ON store_events BEGIN SELECT RAISE(ABORT,'event_storage_failure'); END"));
 assert.throws(()=>f.tick(now+day,draws(0,0)),/event_storage_failure/);assert.equal(f.rows('SELECT checked_at FROM npc_store_theft_checks')[0].checked_at,now);assert.equal(f.rows('SELECT * FROM business_stock').length,2);assert.equal(f.rows("SELECT sold_at FROM inventory WHERE id='wine-0'")[0].sold_at,null);
 f.accounts.db(db=>db.exec('DROP TRIGGER reject_npc_event'));assert.equal(f.tick(now+day,draws(0,0)).events.length,1);assert.equal(f.rows('SELECT * FROM store_events').length,1);
});

test('the business runtime tracks offline stores; feature flags gate it and reset clears its ledger',async t=>{
 const f=await fixture(t);assert.deepEqual(tickEconomy(f.dir,{now,flags:{}}),{failures:[]});assert.equal(f.rows("SELECT * FROM sqlite_schema WHERE name='npc_store_theft_checks'").length,0);
 const result=tickEconomy(f.dir,{now,flags:{businesses:true}});assert.deepEqual(result.failures,[]);assert.deepEqual(result.npcStoreTheft.events,[]);assert.equal(f.rows('SELECT * FROM npc_store_theft_checks').length,1);
 assert.equal(f.tick(now+day,draws(0,0)).events.length,1);const again=tickEconomy(f.dir,{now:now+day+1,flags:{businesses:true}});assert.deepEqual(again.failures,[]);assert.equal(again.npcStoreTheft.events.length,0);
 f.accounts.resetEconomy(f.owner,'RESET ECONOMY');assert.equal(f.rows('SELECT * FROM npc_store_theft_checks').length,0);assert.equal(f.rows('SELECT * FROM store_events').length,0);
});

test('retired and NPC-owned stores cannot generate NPC theft',async t=>{
 const f=await fixture(t);f.tick(now,noDraw);f.accounts.db(db=>db.prepare('UPDATE businesses SET retired=1 WHERE id=?').run(f.shop.id));f.tick(now+day,noDraw);
 f.accounts.db(db=>{db.prepare("INSERT INTO users(id,username,password_hash,npc,tokens,created_at) VALUES('npc-owner','NPC','disabled',1,0,?)").run(now);db.prepare("UPDATE businesses SET retired=0,user_id='npc-owner' WHERE id=?").run(f.shop.id);});f.tick(now+2*day,noDraw);assert.equal(f.rows('SELECT * FROM store_events').length,0);
});
