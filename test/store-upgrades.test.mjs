import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness, upgradeBusiness, businessDashboard, advanceShop, tickBusinesses, stockBusiness, SHOP_TYPES, SHOP_SIZES, takeOverBusiness } from '../src/businesses.mjs';
import { visitStore } from '../src/storefronts.mjs';
import { townMap } from '../src/town-map.mjs';
import { currentNetWorth } from '../src/net-worth.mjs';
import { userStatistics } from '../src/user-statistics.mjs';
import { prestigeAccount } from '../src/prestige.mjs';
import { createAccountApi } from '../src/account-api.mjs';

const HOUR=3600000, now=Date.parse('2026-10-20T12:00:00Z');
async function fixture(t, size='tiny', type='wine') {
  const dir=await mkdtemp('/tmp/jg-upgrades-'),accounts=new Accounts(dir,{now:()=>now}),user={id:'owner',admin:true};
  accounts.db(db=>{
    for(const id of ['owner','other'])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at,admin) VALUES(?,?,'disabled',1000000,36100,?,?)").run(id,id,now,Number(id==='owner'));
  });
  const shop=buyBusiness(dir,user,type,size,{now}).shop;
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const view=(at=now)=>businessDashboard(dir,user,{now:at}).shops.find(entry=>entry.id===shop.id);
  const raw=()=>accounts.db(db=>db.prepare('SELECT * FROM businesses WHERE id=?').get(shop.id));
  const balance=()=>accounts.db(db=>db.prepare("SELECT tokens FROM users WHERE id='owner'").get().tokens);
  const payload=(offer=view().nextUpgrade)=>({shopId:shop.id,targetSize:offer.targetSize,expectedPrice:offer.cost,requestId:randomUUID()});
  return {dir,accounts,user,shop,view,raw,balance,payload,start:(p=payload(),at=now)=>upgradeBusiness(dir,user,p,{now:at})};
}

test('every type and district quotes a 10% discount, next size, real build time and target level',async t=>{
  const f=await fixture(t), plot=f.shop.location.plotId;
  for(const multiplier of [1,.85,1.7,2])for(const type of SHOP_TYPES)for(const [i,size] of SHOP_SIZES.entries()){
    f.accounts.db(db=>{
      const district={1:'leopoldstadt','0.85':'favoriten','1.7':'hietzing',2:'innere-stadt'}[multiplier];
      db.prepare('UPDATE town_plots SET district_id=?,size=? WHERE id=?').run(district,size.id,plot);
      db.prepare('UPDATE businesses SET type=?,size=? WHERE id=?').run(type.id,size.id,f.shop.id);
    });
    const offer=f.view().nextUpgrade,target=SHOP_SIZES[i+1];
    if(!target){assert.equal(offer,null);continue;}
    assert.equal(offer.targetSize,target.id);assert.equal(offer.purchaseCost,Math.round(target.cost*type.costFactor*multiplier));
    assert.equal(offer.cost,Math.round(offer.purchaseCost*.9));assert.equal(offer.discountPercent,10);
    assert.equal(offer.durationHours,[2,8,48][i]);assert.equal(offer.requiredLevel,target.requiredLevel);
    assert.equal(offer.capacity,type.id==='cars'?target.carCapacity:target.capacity);
  }
});

test('S to M charges once, preserves identity and stock, and activates at eight hours after restart',async t=>{
  const f=await fixture(t),before=f.balance(),plot=f.shop.location.plotId,p=f.payload();
  f.accounts.db(db=>{
    db.prepare("UPDATE businesses SET store_name='Named shop',store_motto='Original motto',security_guard=1,cash_balance=444 WHERE id=?").run(f.shop.id);
    db.prepare("INSERT INTO inventory(id,user_id,item,created_at) VALUES('stock','owner',?,?)").run(JSON.stringify({title:'Riesling Wein',category:'Getränke',price:100}),now);
  });
  stockBusiness(f.dir,f.user,f.shop.id,['stock'],{now});
  const result=f.start(p);
  assert.equal(result.cost,13500);assert.equal(result.completesAt,now+8*HOUR);
  assert.equal(f.balance(),before-13500);assert.deepEqual(f.start(p),result);assert.equal(f.balance(),before-13500);
  assert.equal(f.view().capacity,25);assert.equal(f.view().size,'tiny');assert.equal(f.view().nextUpgrade,null);
  assert.equal(f.view(now+8*HOUR-1).size,'tiny');closeDataStore(f.dir);
  const complete=f.view(now+8*HOUR);
  assert.equal(complete.size,'medium');assert.equal(complete.capacity,60);assert.equal(complete.upgrade,null);
  assert.equal(complete.name,'Named shop');assert.equal(complete.motto,'Original motto');assert.equal(complete.securityGuard,true);
  assert.equal(complete.location.plotId,plot);assert.equal(complete.location.size,'medium');assert.ok(complete.cashReady>=444);
  assert.equal(f.accounts.db(db=>db.prepare("SELECT user_id FROM inventory WHERE id='stock'").get().user_id),'owner');
  assert.deepEqual(f.start(p,now+8*HOUR),result);assert.equal(f.balance(),before-13500);
  assert.equal(townMap(f.dir,f.user,{now:now+8*HOUR}).plots.find(p=>p.id===plot).size,'medium');
  assert.equal(visitStore(f.dir,f.user,f.shop.id,{now:now+8*HOUR}).store.size,'medium');
  f.view(now+9*HOUR);
  assert.equal(f.accounts.db(db=>db.prepare("SELECT COUNT(*) n FROM account_notifications WHERE type='store' AND source_key LIKE 'store-upgrade:%'").get().n),1);
});

test('M to L requires 48 hours and raises car-lot capacity only on completion',async t=>{
  const f=await fixture(t,'medium','cars'),p=f.payload(),receipt=f.start(p);
  assert.equal(receipt.cost,112500);assert.equal(receipt.completesAt,now+48*HOUR);
  assert.equal(f.view(now+48*HOUR-1).capacity,8);
  tickBusinesses(f.dir,{now:now+48*HOUR});
  assert.equal(f.view(now+48*HOUR).capacity,20);assert.equal(f.view(now+48*HOUR).nextUpgrade,null);
  assert.throws(()=>f.start({...p,requestId:randomUUID()},now+48*HOUR),/invalid_store_upgrade/);
});

test('pop-up upgrades take two hours and all progression, ownership, price and cash checks are atomic',async t=>{
  const f=await fixture(t,'popup'),p=f.payload(),tokens=f.balance();
  assert.equal(f.view().nextUpgrade.durationHours,2);
  assert.throws(()=>f.start({...p,targetSize:'large'}),/invalid_store_upgrade/);
  assert.throws(()=>f.start({...p,expectedPrice:p.expectedPrice-1}),/store_upgrade_price_changed/);
  assert.throws(()=>upgradeBusiness(f.dir,{id:'other'},p,{now}),/business_not_found/);
  f.accounts.db(db=>db.prepare("UPDATE users SET xp=0 WHERE id='owner'").run());
  assert.equal(f.view().nextUpgrade.unlocked,false);assert.throws(()=>f.start(p),/store_level_required/);
  f.accounts.db(db=>db.prepare("UPDATE users SET xp=36100,tokens=0 WHERE id='owner'").run());
  assert.throws(()=>f.start(p),/insufficient_tokens/);assert.equal(f.raw().upgrade_size,null);
  f.accounts.db(db=>db.prepare("UPDATE users SET tokens=? WHERE id='owner'").run(tokens));
  f.start(p);assert.equal(f.view(now+2*HOUR-1).size,'popup');assert.equal(f.view(now+2*HOUR).size,'tiny');
});

test('pending upgrades reject new requests and stale receipt payloads without charging again',async t=>{
  const f=await fixture(t),p=f.payload();f.start(p);const tokens=f.balance();
  assert.throws(()=>f.start({...p,requestId:randomUUID()}),/store_upgrade_pending/);
  assert.throws(()=>f.start({...p,expectedPrice:p.expectedPrice+1}),/request_conflict/);
  assert.equal(f.balance(),tokens);assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM business_upgrade_requests').get().n),1);
});

test('a failed receipt rolls back payment and construction together',async t=>{
  const f=await fixture(t),p=f.payload(),tokens=f.balance();
  f.accounts.db(db=>db.exec("CREATE TRIGGER fail_upgrade BEFORE INSERT ON business_upgrade_requests BEGIN SELECT RAISE(ABORT,'receipt_failed'); END"));
  assert.throws(()=>f.start(p),/receipt_failed/);assert.equal(f.balance(),tokens);assert.equal(f.raw().upgrade_size,null);
  f.accounts.db(db=>db.exec('DROP TRIGGER fail_upgrade'));f.start(p);assert.equal(f.balance(),tokens-p.expectedPrice);
});

test('offline completion settles old-size hours before switching and matches frequent ticks',async t=>{
  const snapshots=[];
  for(const incremental of [false,true]){
    const f=await fixture(t);f.accounts.db(db=>{
      db.prepare("UPDATE businesses SET id='traffic-upgrade',traffic_popularity=1 WHERE id=?").run(f.shop.id);
      for(let n=0;n<25;n++){
        db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(`traffic-${n}`,'owner',JSON.stringify({title:'Riesling Wein',category:'Getränke',price:1000000}),now);
        db.prepare("INSERT INTO business_stock(inventory_id,business_id,stocked_at,asking_price) VALUES(?,'traffic-upgrade',?,1200000)").run(`traffic-${n}`,now);
      }
    });f.shop.id='traffic-upgrade';f.start();
    if(incremental)f.accounts.db(db=>advanceShop(db,f.raw(),now+8*HOUR));
    f.accounts.db(db=>advanceShop(db,f.raw(),now+12*HOUR));
    const row=f.raw();assert.equal(row.size,'medium');assert.ok(row.visitors>=60&&row.visitors<80,`expected old-size then larger traffic, got ${row.visitors}`);
    snapshots.push([row.visitors,row.sales,row.last_tick_at,row.size]);
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
});

test('prepaid construction counts toward net worth and spending exactly once',async t=>{
  const f=await fixture(t),worth=()=>f.accounts.db(db=>currentNetWorth(db,f.user.id,{now})),before=worth().total;
  const stats=userStatistics(f.dir,f.user,{now}),p=f.payload();f.start(p);f.start(p);
  assert.equal(worth().total,before);assert.equal(worth().businesses,17500);
  const after=userStatistics(f.dir,f.user,{now});assert.equal(after.money.spent,stats.money.spent+13500);assert.equal(after.stores.opened,1);
  f.view(now+8*HOUR);assert.equal(worth().businesses,15000);
});

test('abandoned stores need new stock first and construction protects against takeover while active',async t=>{
  const f=await fixture(t),p=f.payload();
  f.accounts.db(db=>db.prepare('UPDATE businesses SET last_restock_at=? WHERE id=?').run(now-21*86400000,f.shop.id));
  assert.throws(()=>f.start(p),/store_upgrade_abandoned/);
  f.accounts.db(db=>db.prepare('UPDATE businesses SET last_restock_at=? WHERE id=?').run(now-20*86400000+HOUR,f.shop.id));
  f.start(p);assert.equal(f.view(now+2*HOUR).abandoned,false);
  assert.throws(()=>takeOverBusiness(f.dir,{id:'other'},{shopId:f.shop.id,expectedPrice:4000,requestId:randomUUID()},{now:now+2*HOUR}),/store_not_abandoned/);
  assert.equal(f.view(now+8*HOUR).abandoned,true);
  const purchase=takeOverBusiness(f.dir,{id:'other'},{shopId:f.shop.id,expectedPrice:15000,requestId:randomUUID()},{now:now+8*HOUR});
  assert.equal(purchase.shop.size,'medium');assert.equal(purchase.shop.capacity,60);
});

test('Prestige retires pending construction without upgrading a newly freed plot; reset clears receipts',async t=>{
  const f=await fixture(t),plot=f.shop.location.plotId;f.start();
  prestigeAccount(f.dir,f.user,{buffId:'profit',expectedCount:0,requestId:randomUUID(),confirmation:'PRESTIGE'},{now});
  assert.equal(f.raw().upgrade_size,null);assert.equal(f.raw().retired,1);
  tickBusinesses(f.dir,{now:now+8*HOUR});
  assert.equal(f.accounts.db(db=>db.prepare('SELECT size FROM town_plots WHERE id=?').get(plot).size),'tiny');
  f.accounts.resetEconomy(f.user,'RESET ECONOMY');
  assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM business_upgrade_requests').get().n),0);
});

test('independent simultaneous upgrade requests cannot charge twice',async t=>{
  const f=await fixture(t),tokens=f.balance(),p=f.payload(),run=promisify(execFile),url=new URL('../src/businesses.mjs',import.meta.url).href;
  const results=await Promise.all([0,1].map(()=>run(process.execPath,['--input-type=module','-e',
    `import {upgradeBusiness} from ${JSON.stringify(url)};try{upgradeBusiness(${JSON.stringify(f.dir)},{id:'owner'},${JSON.stringify({...p,requestId:randomUUID()})},{now:${now}});console.log('started');}catch(error){console.log(error.message);}`])));
  assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),['started','store_upgrade_pending']);assert.equal(f.balance(),tokens-p.expectedPrice);
});

test('upgrade HTTP route enforces session, CSRF and feature flags and replays the same payment',async t=>{
  const f=await fixture(t),p=f.payload();
  const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  let api=await createAccountApi({dataDir:f.dir,env:{COOKIE_SECURE:'false'},json,dailyPayload:async()=>({auctions:[]})});
  const token=f.accounts.atomic(db=>f.accounts.session(db,f.user.id));
  const server=createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost')))json(res,404,{error:'not_found'});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/account/businesses/upgrade`,headers={cookie:`jg_session=${token}`,'content-type':'application/json','x-requested-with':'JUSTIZGUESSR'},body=JSON.stringify(p);
  assert.equal((await fetch(url,{method:'POST',headers:{'x-requested-with':'JUSTIZGUESSR','content-type':'application/json'},body})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{cookie:headers.cookie},body})).status,403);
  const first=await fetch(url,{method:'POST',headers,body});assert.equal(first.status,200);const result=await first.json();assert.equal(result.receipt.cost,13500);
  const replay=await(await fetch(url,{method:'POST',headers,body})).json();assert.deepEqual(replay.receipt,result.receipt);assert.equal(replay.user.tokens,result.user.tokens);
  assert.equal(replay.shops[0].size,'tiny');assert.equal(replay.shops[0].upgrade.toSize,'medium');
  api=await createAccountApi({dataDir:f.dir,env:{COOKIE_SECURE:'false',FEATURE_BUSINESSES:'false'},json,dailyPayload:async()=>({auctions:[]})});
  assert.equal((await fetch(url,{method:'POST',headers,body})).status,404);
});


test('takeover settles elapsed trading once while validating the current store size',async t=>{
  const counts=[];
  for(const takeover of [false,true]){
    const f=await fixture(t);
    f.accounts.db(db=>db.prepare("UPDATE businesses SET id='takeover-traffic',traffic_popularity=1,last_restock_at=? WHERE id=?").run(now-21*86400000,f.shop.id));
    f.shop.id='takeover-traffic';
    if(takeover)takeOverBusiness(f.dir,{id:'other'},{shopId:f.shop.id,expectedPrice:4000,requestId:randomUUID()},{now:now+2*HOUR});
    else f.accounts.db(db=>advanceShop(db,f.raw(),now+2*HOUR));
    counts.push(f.raw().visitors);
  }
  assert.ok(counts[0]>0);assert.equal(counts[1],counts[0]);
});
