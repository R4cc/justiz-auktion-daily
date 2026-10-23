import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { adminStatistics } from '../src/admin-statistics.mjs';
import { createSiteUsageTracker } from '../src/site-usage.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createGuestGameApi } from '../src/guest-game-api.mjs';
import { buyBusiness } from '../src/businesses.mjs';

const DAY=86400000,now=Date.parse('2026-10-23T12:00:00Z'),password='statistics-test-password';
async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-admin-stats-')),accounts=new Accounts(dir,{now:()=>now});
  await accounts.bootstrap('admin',password);const token=await accounts.login({username:'admin',password}),admin=accounts.user(token);
  const user=(id,{npc=0,banned=0,createdAt=now,tokens=1200,xp=100}={})=>{
    accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,npc,banned,tokens,xp,created_at) VALUES(?,?,'disabled',?,?,?,?,?)").run(id,id,npc,banned,tokens,xp,createdAt));return {id};
  };
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  return {dir,accounts,admin,token,user};
}
function record(tracker,url,statusCode=200,method='GET') {
  const response=new EventEmitter();response.statusCode=statusCode;
  tracker.observe({method,headers:{cookie:'PRIVATE_COOKIE','user-agent':'PRIVATE_AGENT'}},response,new URL(url,'http://localhost'));response.emit('finish');
}

test('admin aggregates human accounts, UTC activity, retained guests and current economy without exposing private payloads or advancing sales',async t=>{
  const f=await fixture(t),alice=f.user('Alice',{createdAt:now-2*DAY}),bob=f.user('Bob',{banned:1,createdAt:now-50*DAY,xp:900}),npc=f.user('Npc',{npc:1});
  const shop=buyBusiness(f.dir,alice,'wine','popup',{now}).shop;
  createGuestGameApi({dataDir:f.dir,json:()=>{},dailyPayload:async()=>({auctions:[]}),now:()=>now});
  f.accounts.db(db=>{
    db.prepare('UPDATE businesses SET cash_balance=420 WHERE id=?').run(shop.id);
    const game=db.prepare('INSERT INTO account_games VALUES(?,?,?,?,?,?)');
    for(const [id,user,date,mode,complete] of [['a',alice.id,'2026-10-23','daily',1],['b',alice.id,'2026-10-22','higher-lower',0],['c',bob.id,'2026-10-20','daily',1],['old',alice.id,'2026-10-01','daily',1],['future',alice.id,'2026-10-24','daily',1],['npc',npc.id,'2026-10-23','daily',1]])game.run(id,user,date,mode,complete,JSON.stringify({secret:'SPOILER_ANSWER'}));
    db.prepare('INSERT INTO daily_rewards VALUES(?,?,?,?,?)').run(alice.id,'2026-10-23','daily','a',500);
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('private-item',alice.id,JSON.stringify({title:'SPOILER_ITEM',price:99999}),now);
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('npc-item',npc.id,JSON.stringify({title:'NPC_ITEM'}),now);
    db.prepare("INSERT INTO resale_auctions(id,seller_id,inventory_id,start_price,status,started_at,ends_at) VALUES('listing',?,'private-item',10,'active',?,?)").run(alice.id,now,now+3600000);
    for(const [id,complete]of [['guest-a',true],['guest-b',false]])db.prepare('INSERT INTO guest_game_runs VALUES(?,?,?,?,?,?)').run(id,'PRIVATE_SESSION_HASH','2026-10-22','random',JSON.stringify({complete,secret:'SPOILER_GUEST'}),now+DAY);
    for(const user of [alice,bob,npc])db.prepare('INSERT INTO account_sessions VALUES(?,?,?)').run(user.id.padEnd(64,'a'),user.id,now+DAY);
  });
  const before=f.accounts.db(db=>db.prepare('SELECT * FROM businesses WHERE id=?').get(shop.id));
  const report=adminStatistics(f.dir,f.admin,{days:7,now});
  assert.equal(report.users.total,3);assert.equal(report.users.registered,2);assert.equal(report.users.admins,1);assert.equal(report.users.banned,1);assert.equal(report.users.playing,2);assert.equal(report.users.signedIn,2);
  assert.equal(report.games.reduce((sum,row)=>sum+row.started,0),3);assert.equal(report.games.reduce((sum,row)=>sum+row.completed,0),2);
  assert.deepEqual(report.guests.map(row=>[row.mode,row.started,row.completed]),[['random',2,1]]);
  assert.equal(report.economy.stores,1);assert.equal(report.economy.storeCash,420);assert.equal(report.economy.items,1);assert.equal(report.economy.activeAuctions,1);assert.equal(report.economy.rewardsPaid,500);
  assert.equal(report.series.length,7);assert.equal(report.series[0].date,'2026-10-17');assert.equal(report.series.at(-1).date,'2026-10-23');assert.equal(report.series.at(-1).games,1);
  assert.deepEqual(report.levels,[{level:1,players:1},{level:2,players:1},{level:4,players:1}]);
  assert.equal(report.traffic.trackingSince,null);
  assert.doesNotMatch(JSON.stringify(report),/SPOILER|NPC_ITEM|PRIVATE_|password|session_hash|payload|Npc/);
  assert.deepEqual(f.accounts.db(db=>db.prepare('SELECT * FROM businesses WHERE id=?').get(shop.id)),before);
});

test('statistics require current admin authority, reject invalid periods and handle an empty activity history',async t=>{
  const f=await fixture(t),player=f.user('Player');
  assert.throws(()=>adminStatistics(f.dir,{...player,admin:true},{now}),/forbidden/);
  assert.throws(()=>adminStatistics(f.dir,null,{now}),/forbidden/);
  for(const days of [0,1,8,365,'invalid'])assert.throws(()=>adminStatistics(f.dir,f.admin,{now,days}),/invalid_period/);
  const empty=adminStatistics(f.dir,f.admin,{now,days:90});assert.equal(empty.series.length,90);assert.ok(empty.series.every(row=>row.games===0&&row.requests===null));assert.deepEqual(empty.games,[]);
  f.accounts.db(db=>db.prepare('UPDATE users SET admin=0 WHERE id=?').run(f.admin.id));
  assert.throws(()=>adminStatistics(f.dir,f.admin,{now}),/forbidden/);
});

test('HTTP counters buffer, persist across restart, distinguish errors and discard identifiers, static assets and admin requests',async t=>{
  const f=await fixture(t);let time=now;
  let tracker=createSiteUsageTracker({dataDir:f.dir,now:()=>time,intervalMs:600000});t.after(()=>tracker.close());
  record(tracker,'/stores?shop=PRIVATE_SHOP');record(tracker,'/api/stores/PRIVATE_ID',404);record(tracker,'/api/account/inventory?token=PRIVATE_QUERY',500);
  for(const route of ['/assets/private.js','/healthz','/api/account/admin/statistics','/api/account/admin/auctions','/styles.css','/stats'])record(tracker,route);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM site_usage_daily').get().n),0);
  let report=adminStatistics(f.dir,f.admin,{now,days:7,siteUsage:tracker});assert.equal(report.traffic.requests,3);assert.equal(report.traffic.apiRequests,2);assert.equal(report.traffic.clientErrors,1);assert.equal(report.traffic.serverErrors,1);assert.ok(report.traffic.averageMs>=0);
  assert.equal(report.series[0].requests,null);assert.equal(report.series.at(-1).requests,3);
  assert.deepEqual(report.traffic.routes.map(row=>row.route).sort(),['/api/account','/api/stores','/stores']);
  assert.doesNotMatch(JSON.stringify(f.accounts.db(db=>db.prepare('SELECT * FROM site_usage_daily').all())),/PRIVATE|cookie|agent/);
  tracker.close();closeDataStore(f.dir);time+=DAY;
  tracker=createSiteUsageTracker({dataDir:f.dir,now:()=>time,intervalMs:600000});record(tracker,'/stores');
  report=adminStatistics(f.dir,f.admin,{now:time,days:7,siteUsage:tracker});assert.equal(report.traffic.requests,4);assert.equal(report.traffic.trackingSince,now);assert.equal(report.series.at(-1).requests,1);assert.equal(report.series.at(-2).requests,3);
  record(tracker,'/stores');const db=f.accounts.db(db=>db);db.exec("CREATE TRIGGER fail_usage BEFORE UPDATE ON site_usage_daily BEGIN SELECT RAISE(ABORT,'retry'); END");
  assert.throws(()=>tracker.flush(),/retry/);db.exec('DROP TRIGGER fail_usage');tracker.flush();assert.equal(adminStatistics(f.dir,f.admin,{now:time}).traffic.requests,5);
  db.prepare("INSERT INTO site_usage_daily VALUES('2020-01-01','/stores',1,0,0,1)").run();record(tracker,'/api/town');tracker.close();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM site_usage_daily WHERE date='2020-01-01'").get().n,0);
  assert.equal(adminStatistics(f.dir,f.admin,{now:time}).traffic.requests,6);
});

test('admin statistics HTTP endpoint rejects anonymous, ordinary and temporary sessions and returns only aggregates',async t=>{
  const f=await fixture(t),json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const api=await createAccountApi({dataDir:f.dir,json,dailyPayload:async()=>({auctions:[]}),env:{COOKIE_SECURE:'false'}});
  const code=f.accounts.codes(f.admin,1)[0],playerToken=await f.accounts.register({username:'ApiPlayer',password,code});
  f.accounts.db(db=>db.prepare('UPDATE account_sessions SET expires=?').run(Date.now()+DAY));
  const server=createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost')))json(res,404,{error:'not_found'});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const call=(token,days=7)=>fetch(`http://127.0.0.1:${server.address().port}/api/account/admin/statistics?days=${days}`,{headers:token?{cookie:'jg_session='+token}:{}});
  assert.equal((await call()).status,401);assert.equal((await call(playerToken)).status,403);
  const allowed=await call(f.token);assert.equal(allowed.status,200);assert.equal((await allowed.json()).days,7);assert.equal((await call(f.token,14)).status,400);
  f.accounts.db(db=>db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(f.admin.id));assert.equal((await call(f.token)).status,403);
});
