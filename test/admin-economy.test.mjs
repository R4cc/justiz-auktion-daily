import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { adminMarketDashboard } from '../src/admin-economy.mjs';
import { marketHistory, marketIndexes, marketMultiplierAt, marketState, setMarketIndex, tickMarketDrift } from '../src/market.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { businessDashboard, buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { listItem, getResale } from '../src/resale.mjs';

const day=Date.parse('2026-10-08T12:30:00Z'),hour=3600000;
async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-admin-market-')),accounts=new Accounts(dir,{now:()=>day});
  accounts.db(db=>{for(const [id,admin] of [['admin',1],['player',0]])db.prepare(`INSERT INTO users
    (id,username,password_hash,tokens,admin,created_at) VALUES(?,?,'disabled',100000,?,?)`).run(id,id,admin,day);});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const admin={id:'admin',admin:true},player={id:'player'};
  const index=(category,now=day)=>marketState(dir,{now}).categories.find(entry=>entry.category===category).currentIndex;
  // Fixture for an existing database: historical multipliers still contribute
  // to valuations after the admin write capability has been removed.
  const legacy=(category,multiplier,at=day)=>accounts.db(db=>{
    const beforeIndex=marketIndexes(db,at)[category],previous=marketMultiplierAt(db,category,at),afterIndex=beforeIndex/previous*multiplier;
    db.prepare(`INSERT INTO admin_market_adjustments
      (admin_id,request_id,category,action,percent,multiplier,before_index,after_index,created_at)
      VALUES('admin',?,?, 'adjust',10,?,?,?,?)`).run(`legacy-${category}-${at}`,category,multiplier,beforeIndex,afterIndex,at);
    db.prepare('INSERT OR REPLACE INTO market_snapshots(category,index_value,captured_at) VALUES(?,?,?)').run(category,afterIndex,new Date(at).toISOString());
    return {afterIndex,createdAt:at};
  });
  return {dir,accounts,admin,player,index,legacy};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('admin market overview reports current category indexes without adjustment controls or writes',async t=>{
  const f=await fixture(t);setMarketIndex(f.dir,'wine',123.45,{now:day});
  const before=f.accounts.db(db=>db.prepare('SELECT * FROM admin_market_adjustments').all());
  const dashboard=adminMarketDashboard(f.dir,f.admin,{now:day});
  assert.deepEqual(Object.keys(dashboard),['categories']);assert.equal(dashboard.categories.length,14);
  assert.equal(dashboard.categories.find(category=>category.id==='wine').currentIndex,123.45);
  assert.ok(dashboard.categories.every(category=>!('multiplier' in category)));
  assert.deepEqual(adminMarketDashboard(f.dir,f.admin,{now:day}),dashboard);
  assert.deepEqual(f.accounts.db(db=>db.prepare('SELECT * FROM admin_market_adjustments').all()),before);
});

test('read-only admin market overview requires current admin authority',async t=>{
  const f=await fixture(t);
  for(const user of [null,f.player,{...f.player,admin:true}])assert.throws(()=>adminMarketDashboard(f.dir,user,{now:day}),/forbidden/);
  for(const state of ['banned=1','banned=0,must_change_password=1','must_change_password=0,npc=1','npc=0,admin=0']){
    f.accounts.db(db=>db.prepare('UPDATE users SET '+state+" WHERE id='admin'").run());
    assert.throws(()=>adminMarketDashboard(f.dir,f.admin,{now:day}),/forbidden/);
  }
});

test('existing adjustment history keeps its time-specific multipliers through sparse drift backfills',async t=>{
  const f=await fixture(t);tickMarketDrift(f.dir,{now:day});const original=f.index('wine');
  const first=f.legacy('wine',.2,day+10*60000),second=f.legacy('wine',.22,day+2*hour+10*60000);
  assert.equal(f.index('wine',day-1),original);assert.ok(f.index('wine',day+5*60000)>50);
  const later=day+4*hour;tickMarketDrift(f.dir,{now:later});
  const history=marketHistory(f.dir,'wine',{now:later}),intraday=marketHistory(f.dir,'wine',{now:later,range:'1d'});
  for(const receipt of [first,second])for(const samples of [history,intraday]){
    const point=samples.find(point=>point.capturedAt===new Date(receipt.createdAt).toISOString());
    near(point.indexValue,Math.round(receipt.afterIndex*100)/100);
  }
  assert.ok(history.find(point=>point.capturedAt==='2026-10-08T13:00:00.000Z').indexValue<30);
  assert.ok(history.find(point=>point.capturedAt==='2026-10-08T15:00:00.000Z').indexValue<35);
  closeDataStore(f.dir);assert.deepEqual(marketHistory(f.dir,'wine',{now:later}),history);
});

test('existing multipliers remain consistent across inventory, resale, shelf prices and new case quotes',async t=>{
  const f=await fixture(t);
  upsertAuctions(f.dir,Array.from({length:24},(_,n)=>({id:1000+n,title:`Laptop ${1000+n}`,category:'Elektronik',currentBid:(n+1)*20,image:'/favicon.png'})));
  f.accounts.db(db=>{for(const id of ['wine-inventory','wine-shelf'])db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
    .run(id,f.player.id,JSON.stringify({title:'Bordeaux',price:100,category:'Getränke',marketCategory:'wine',rarity:'common'}),day);});
  const shop=buyBusiness(f.dir,f.player,'wine','popup',{now:day}).shop;stockBusiness(f.dir,f.player,shop.id,['wine-shelf'],{now:day});
  const listing=listItem(f.dir,f.player,{inventoryId:'wine-inventory',startPrice:10,endsAt:new Date(day+hour).toISOString()},{now:day});
  f.legacy('wine',.2);
  assert.equal(f.accounts.inventory(f.player).find(item=>item.id==='wine-inventory').estimatedValueTokens,20);
  assert.equal(getResale(f.dir,listing.id,{now:day}).estimatedValueTokens,20);
  assert.equal(businessDashboard(f.dir,f.player,{now:day}).shops[0].stock[0].askingPrice,24);
  const catalog=loadCaseStoreCatalog(f.dir,day),quote=()=>f.accounts.db(db=>quoteCaseStore(catalog,marketIndexes(db,day)));
  const neutral=quote();f.legacy('electronics',1.5);
  assert.ok(quote().cases.every((box,index)=>box.cost>neutral.cases[index].cost));
});
