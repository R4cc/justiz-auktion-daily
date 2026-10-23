import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Accounts} from '../src/accounts.mjs';
import {closeDataStore} from '../src/database.mjs';
import {checkPoliceRecognition,resolvePoliceEncounter,recognitionSentence,policeActivityKey} from '../src/police-recognition.mjs';
import {playerHeat,heatFineMultiplier,recognitionChance,POLICE_CHECK_INTERVAL,HEAT_DECAY_INTERVAL} from '../src/theft-heat.mjs';
import {justiceStatus,assertPlayerFree} from '../src/justice.mjs';
import {theftQuote,playerCriminalRecord} from '../src/storefronts.mjs';
import {userStatistics} from '../src/user-statistics.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-police-'));let time=now;
  const accounts=new Accounts(dir,{now:()=>time}),user={id:'buyer'},other={id:'other'};
  accounts.db(db=>{for(const id of ['buyer','other'])db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',100000,?)").run(id,id,now);});
  const heat=(value,at=time)=>accounts.db(db=>{playerHeat(db,user.id,at);db.prepare('INSERT INTO player_heat VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(user.id,value,at);});
  const status=(at=time)=>accounts.db(db=>justiceStatus(db,user.id,at));
  const check=(key='activity-1',random=()=>0,at=time)=>checkPoliceRecognition(dir,user,key,{now:at,random});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  return {dir,accounts,user,other,heat,status,check,setNow:value=>{time=value;}};
}

test('recognition curve starts at four stars and Heat fines rise sharply to thirty times at five',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,7,8,9,10].map(recognitionChance),[0,0,0,0,0,0,0,0,2,6,15]);
  assert.deepEqual([8,9,10].map(heatFineMultiplier),[12,18,30]);
  assert.equal(theftQuote(100,false,1,0,0,10).fine,6000);
  assert.equal(theftQuote(100,true,1,0,0,10).fine,6000);
  assert.equal(theftQuote(100,false).fine,200);
  assert.equal(recognitionSentence(8),15*60000);assert.equal(recognitionSentence(9),30*60000);assert.equal(recognitionSentence(10),60*60000);
  assert.equal(recognitionSentence(10,1),120*60000);assert.equal(recognitionSentence(10,100),24*3600000);
});

test('checks use exact probability boundaries at four, four-and-a-half and five stars',async t=>{
  for(const [heat,chance]of [[8,2],[9,6],[10,15]])for(const [offset,caught]of [[-1,true],[0,false]]){
    const f=await fixture(t);f.heat(heat);const result=f.check('boundary',()=>chance*10000+offset);
    assert.equal(Boolean(result),caught);
    if(result){assert.equal(result.chancePercent,chance);assert.equal(result.heatStars,heat/2);}
  }
});

test('cold actions, global check intervals, failed checks and receipt replays cannot reroll recognition',async t=>{
  const f=await fixture(t);f.heat(7);
  assert.equal(f.check('cold',()=>{throw Error('cold RNG');}),null);
  f.heat(10);assert.equal(f.check('cold',()=>{throw Error('replay RNG');}),null);
  assert.equal(f.check('first',()=>999999),null);
  assert.equal(f.check('rate-limited',()=>{throw Error('too soon');},now+POLICE_CHECK_INTERVAL-1),null);
  assert.equal(f.check('first',()=>{throw Error('late replay');},now+POLICE_CHECK_INTERVAL),null);
  assert.equal(f.check('rate-limited',()=>{throw Error('rate-limited receipt replay');},now+POLICE_CHECK_INTERVAL),null);
  assert.ok(f.check('next',()=>0,now+POLICE_CHECK_INTERVAL));
  assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM police_encounters').get().n),1);
});

test('decay is applied before checking recognition and a pending encounter survives cooling and restart',async t=>{
  const f=await fixture(t);f.heat(8);
  assert.equal(f.check('cooled',()=>{throw Error('cooled');},now+HEAT_DECAY_INTERVAL),null);
  f.heat(10);const encounter=f.check();assert.equal(encounter.fine,60000);assert.equal(encounter.fineMultiplier,30);
  closeDataStore(f.dir);f.setNow(now+10*HEAT_DECAY_INTERVAL);
  assert.equal(f.status().policeEncounter.id,encounter.id);
  assert.throws(()=>f.accounts.db(db=>assertPlayerFree(db,f.user.id,now+10*HEAT_DECAY_INTERVAL)),/police_recognized/);
  const result=resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'pay'},{now:now+10*HEAT_DECAY_INTERVAL});
  assert.equal(result.paidCash,60000);assert.equal(f.accounts.profile(f.user).tokens,40000);assert.equal(f.status().policeEncounter,null);
  assert.equal(f.accounts.profile(f.user).heat.stars,0);
  assert.deepEqual(resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'pay'}),result);
  assert.equal(f.accounts.profile(f.user).tokens,40000);
  assert.throws(()=>resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'jail'}),/request_conflict/);
});

test('jail choice keeps cash/assets, creates a persistent timed lock, and clears recognition-level Heat',async t=>{
  const f=await fixture(t);f.heat(10);const encounter=f.check();
  const result=resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'jail'},{now});
  assert.equal(result.jailedUntil,now+3600000);assert.equal(result.convertedToSentence,encounter.fine);
  assert.equal(f.accounts.profile(f.user).tokens,100000);assert.equal(f.status().jailed,true);assert.equal(f.accounts.profile(f.user).heat.stars,3);
  assert.equal(f.status(now+3600000-1).jailed,true);assert.equal(f.status(now+3600000).jailed,false);
  closeDataStore(f.dir);assert.equal(f.status().jailed,true);
  assert.deepEqual(resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'jail'},{now:now+1}),result);
});

test('recognition records and cash fines count once, with actor authority and rollback on failed resolution',async t=>{
  const f=await fixture(t);f.heat(10);const encounter=f.check();
  assert.throws(()=>resolvePoliceEncounter(f.dir,f.other,{id:encounter.id,choice:'pay'}),/police_encounter_not_found/);
  f.accounts.db(db=>db.exec("CREATE TRIGGER fail_police_resolve BEFORE UPDATE OF resolved_at ON police_encounters BEGIN SELECT RAISE(ABORT,'resolution_failed'); END"));
  assert.throws(()=>resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'pay'},{now}),/resolution_failed/);
  assert.equal(f.accounts.profile(f.user).tokens,100000);assert.equal(f.status().policeEncounter.id,encounter.id);
  f.accounts.db(db=>db.exec('DROP TRIGGER fail_police_resolve'));
  resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'pay'},{now});
  const record=playerCriminalRecord(f.dir,f.user,{now});assert.equal(record.total,1);assert.equal(record.records[0].crime,'police_recognition');assert.equal(record.totalPenalties,encounter.fine);
  const stats=userStatistics(f.dir,f.user,{now});assert.equal(stats.money.finesPaid,encounter.fine);assert.equal(stats.theft.caught,1);assert.equal(stats.theft.attempts,0);
});

test('recognition payment cannot overdraw cash and catches cannot be forced by client fields',async t=>{
  const f=await fixture(t);f.heat(10);f.accounts.db(db=>db.prepare("UPDATE users SET tokens=100 WHERE id='buyer'").run());const encounter=f.check();
  assert.equal(encounter.fine,7500);
  assert.throws(()=>resolvePoliceEncounter(f.dir,f.user,{id:encounter.id,choice:'pay',fine:0},{now}),/insufficient_tokens/);
  assert.equal(f.accounts.profile(f.user).tokens,100);assert.ok(f.status().policeEncounter);
  assert.equal(policeActivityKey('me',{},{}),null);
  assert.equal(policeActivityKey('businesses/collect',{}, {collection:{id:'empty',amount:0}}),null);
  assert.equal(policeActivityKey('inventory/case/open',{id:'case',requestId:'new'}, {item:{id:'winner'}}),policeActivityKey('inventory/case/open',{id:'case',requestId:'other'},{item:{id:'winner'}}));
});

test('HTTP recognition follows successful case activity, blocks pending/jail play, and never repeats on a receipt replay',async t=>{
  const {createServer}=await import('node:http');const {createAccountApi}=await import('../src/account-api.mjs');
  const {createEconomyApi}=await import('../src/economy-api.mjs');const {featureFlags}=await import('../src/features.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-police-api-')),password='police-api-test-password';
  const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:password,COOKIE_SECURE:'false'},flags=featureFlags(env);
  let draws=0;const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  const api=await createAccountApi({dataDir:dir,env,flags,json,policeRandom:()=>{draws++;return 0;}}),accounts=new Accounts(dir);
  const token=await accounts.login({username:'admin',password}),user=accounts.user(token),economy=createEconomyApi({dataDir:dir,flags,json,accounts});
  accounts.db(db=>{db.prepare('UPDATE users SET tokens=1000000 WHERE id=?').run(user.id);playerHeat(db,user.id);db.prepare('INSERT INTO player_heat VALUES(?,?,?)').run(user.id,10,Date.now());});
  const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;json(res,404,{error:'not_found'});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const call=async(route,payload)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${route.startsWith('/api/')?route:'/api/account/'+route}`,{
    method:payload?'POST':'GET',headers:{cookie:`jg_session=${token}`,'content-type':'application/json','x-requested-with':'JUSTIZGUESSR'},body:payload?JSON.stringify(payload):undefined});return {status:response.status,body:await response.json()};};
  const store=(await call('case-store')).body,offer=store.cases[0],payload={caseId:offer.id,revision:store.revision,requestId:'police-case-purchase-0001'};
  assert.equal((await call('cases/buy',{...payload,revision:'stale'})).status,409);assert.equal(draws,0);
  const purchase=await call('cases/buy',payload);assert.equal(purchase.status,200);assert.ok(purchase.body.user.justice.policeEncounter);assert.equal(draws,1);
  const encounter=purchase.body.user.justice.policeEncounter,id=purchase.body.item.id;
  assert.equal(accounts.inventory(user).length,1);assert.equal(accounts.profile(user).tokens,1000000-offer.cost);
  for(const route of ['inventory','case-store','/api/town','/api/stores'])assert.equal((await call(route)).status,423);
  assert.equal((await call('me')).status,200);assert.equal(draws,1);
  assert.equal((await call('cases/buy',{...payload,requestId:'blocked-case-purchase-001'})).status,423);
  const paid=await call('police/resolve',{id:encounter.id,choice:'pay',fine:0});assert.equal(paid.status,200);
  assert.equal(paid.body.user.tokens,1000000-offer.cost-encounter.fine);assert.equal(paid.body.user.heat.stars,3);
  const replay=await call('cases/buy',payload);assert.equal(replay.status,200);assert.equal(replay.body.item.id,id);assert.equal(draws,1);
  accounts.db(db=>{db.prepare('UPDATE player_heat SET value=10,updated_at=? WHERE user_id=?').run(Date.now(),user.id);db.prepare('UPDATE police_activity_checks SET checked_at=checked_at-?').run(POLICE_CHECK_INTERVAL+1);});
  const opened=await call('inventory/case/open',{id});assert.equal(opened.status,200);assert.ok(opened.body.user.justice.policeEncounter);assert.equal(draws,2);
  const reward=accounts.inventory(user)[0];assert.equal(reward.id,opened.body.item.id);assert.notEqual(reward.kind,'case');
  const jailed=await call('police/resolve',{id:opened.body.user.justice.policeEncounter.id,choice:'jail'});
  assert.equal(jailed.status,200);assert.equal(jailed.body.user.justice.jailed,true);
  assert.ok(jailed.body.user.justice.jailedUntil>Date.now());assert.equal((await call('/api/town')).status,423);
  assert.equal((await call('inventory')).status,423);assert.equal((await call('me')).status,200);
  assert.equal(accounts.inventory(user)[0].id,reward.id);
});
