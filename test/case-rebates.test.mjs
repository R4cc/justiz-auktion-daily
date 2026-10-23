import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { loadCaseStoreCatalog,quoteCaseStore } from '../src/case-store.mjs';
import { marketIndexes } from '../src/market.mjs';
import { activeCaseRebates,caseRebateDashboard,createCaseRebate,cancelCaseRebate } from '../src/case-rebates.mjs';

const start=Date.parse('2026-10-23T12:00:00Z');
async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-rebates-'));
  let now=start,seq=0;
  const accounts=new Accounts(dir,{now:()=>now}),admin={id:'admin'},buyer={id:'buyer'};
  accounts.db(db=>{
    for(const user of [admin,buyer])db.prepare("INSERT INTO users(id,username,password_hash,tokens,admin,created_at) VALUES(?,?,'disabled',1000000,?,?)").run(user.id,user.id,Number(user===admin),now);
  });
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const catalog=()=>loadCaseStoreCatalog(dir,now);
  const quote=(options={})=>accounts.db(db=>quoteCaseStore(catalog(),marketIndexes(db,now),{...options,rebates:activeCaseRebates(db,now)}));
  const rebate=(values={})=>createCaseRebate(dir,admin,{caseId:'all',percent:20,startsAt:start,endsAt:start+3600000,requestId:`rebate-request-${++seq}-0001`,...values},{now});
  return {dir,accounts,admin,buyer,catalog,quote,rebate,setNow:value=>{now=value;},balance:()=>accounts.profile(buyer).tokens};
}

test('rebates target one or all cases, keep contents/odds, and use only the largest active percentage',async t=>{
  const f=await fixture(t),base=f.quote();
  const global=f.rebate(),single=f.rebate({caseId:'vault',percent:40});
  const sale=f.quote();
  for(const box of sale.cases){
    const normal=base.cases.find(entry=>entry.id===box.id),percent=box.id==='vault'?40:20;
    assert.equal(box.cost,Math.ceil(normal.cost*(100-percent)/100));
    assert.equal(box.regularCost,normal.cost);assert.equal(box.rebate.percent,percent);
    assert.deepEqual(box.items,normal.items);assert.deepEqual(box.dropChances,normal.dropChances);
  }
  assert.notEqual(base.revision,sale.revision);
  cancelCaseRebate(f.dir,f.admin,global.id,{now:start});
  const targeted=f.quote();
  assert.equal(targeted.cases[0].cost,base.cases[0].cost);
  assert.equal(targeted.cases.find(box=>box.id==='vault').rebate.id,single.id);
  cancelCaseRebate(f.dir,f.admin,single.id,{now:start});
  assert.equal(f.quote().revision,base.revision);
});

test('scheduled rebates start inclusively and expire exclusively, persist across restart, and cancel idempotently',async t=>{
  const f=await fixture(t),base=f.quote(),sale=f.rebate({startsAt:start+1000,endsAt:start+2000});
  assert.equal(f.quote().revision,base.revision);
  assert.equal(caseRebateDashboard(f.dir,f.admin,{now:start}).rebates[0].id,sale.id);
  f.setNow(start+1000);assert.equal(f.quote().cases[0].rebate.id,sale.id);
  closeDataStore(f.dir);assert.equal(f.quote().cases[0].rebate.id,sale.id);
  f.setNow(start+1999);assert.equal(f.quote().cases[0].rebate.id,sale.id);
  f.setNow(start+2000);assert.equal(f.quote().revision,base.revision);
  const scheduled=f.rebate({startsAt:start+5000,endsAt:start+10000});
  const stopped=cancelCaseRebate(f.dir,f.admin,scheduled.id,{now:start+2000});
  assert.deepEqual(cancelCaseRebate(f.dir,f.admin,scheduled.id,{now:start+3000}),stopped);
  f.setNow(start+6000);assert.equal(f.quote().cases[0].rebate,null);
});

test('purchases charge the rebate price, record it for opening, reject stale prices, and replay after expiry without charging twice',async t=>{
  const f=await fixture(t),base=f.quote(),balance=f.balance();
  f.rebate();const sale=f.quote(),offer=sale.cases[0];
  assert.throws(()=>f.accounts.buyCase(f.buyer,f.catalog(),offer.id,'stale-price-purchase-0001',base.revision),/catalog_changed/);
  assert.equal(f.balance(),balance);
  const item=f.accounts.buyCase(f.buyer,f.catalog(),offer.id,'discount-purchase-0001',sale.revision);
  assert.equal(f.balance(),balance-offer.cost);assert.equal(item.caseCost,offer.cost);
  f.setNow(start+3600000);closeDataStore(f.dir);
  assert.deepEqual(f.accounts.buyCase(f.buyer,f.catalog(),offer.id,'discount-purchase-0001',sale.revision),item);
  assert.throws(()=>f.accounts.buyCase(f.buyer,f.catalog(),offer.id,'expired-price-purchase-0001',sale.revision),/catalog_changed/);
  assert.equal(f.balance(),balance-offer.cost);
  assert.equal(f.accounts.openSealedCase(f.buyer,item.id).caseCost,offer.cost);
});

test('rebates combine with Prestige prices and support a stock-limited 100% rebate without reducing contents',async t=>{
  const f=await fixture(t),base=f.quote({caseDiscountPercent:50});
  f.rebate({percent:25});const combined=f.quote({caseDiscountPercent:50});
  assert.equal(combined.cases[0].cost,Math.ceil(base.cases[0].cost*.75));
  f.rebate({percent:100});const free=f.quote(),balance=f.balance(),offer=free.cases[0];
  assert.equal(offer.cost,0);
  const item=f.accounts.buyCase(f.buyer,f.catalog(),offer.id,'free-rebate-purchase-0001',free.revision);
  assert.equal(item.caseCost,0);assert.equal(f.balance(),balance);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT sold FROM case_stock WHERE case_id=?').get(offer.id).sold),1);
  assert.ok(f.accounts.openSealedCase(f.buyer,item.id).title);
});

test('rebate creation validates authority, inputs and request replays, including retries after expiry',async t=>{
  const f=await fixture(t),payload={caseId:'all',percent:25,startsAt:start,endsAt:start+1000,requestId:'create-rebate-retry-0001'};
  assert.throws(()=>caseRebateDashboard(f.dir,null),/login_required/);
  assert.throws(()=>createCaseRebate(f.dir,{...f.buyer,admin:true},payload,{now:start}),/forbidden/);
  for(const values of [{percent:0},{percent:101},{percent:1.5},{percent:'20'},{startsAt:NaN},{endsAt:start},{endsAt:start-1},{caseId:'missing'},{requestId:'short'}]) {
    assert.throws(()=>createCaseRebate(f.dir,f.admin,{...payload,...values},{now:start}));
  }
  const saved=createCaseRebate(f.dir,f.admin,payload,{now:start});
  assert.deepEqual(createCaseRebate(f.dir,f.admin,payload,{now:start+2000}),saved);
  assert.throws(()=>createCaseRebate(f.dir,f.admin,{...payload,percent:30},{now:start}),/request_conflict/);
  assert.throws(()=>cancelCaseRebate(f.dir,f.buyer,saved.id),/forbidden/);
  f.accounts.db(db=>db.prepare('UPDATE users SET admin=0 WHERE id=?').run(f.admin.id));
  assert.throws(()=>createCaseRebate(f.dir,{...f.admin,admin:true},payload,{now:start}),/forbidden/);
});

test('HTTP rebate tools require an administrator and public shop quotes match the price charged',async t=>{
  const {createServer}=await import('node:http');
  const {createAccountApi}=await import('../src/account-api.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-rebate-api-'));
  const password='rebate-api-test-password';
  const api=await createAccountApi({dataDir:dir,env:{ADMIN_USERNAME:'admin',ADMIN_PASSWORD:password,COOKIE_SECURE:'false'},
    json:(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}});
  const accounts=new Accounts(dir),adminToken=await accounts.login({username:'admin',password}),admin=accounts.user(adminToken);
  const buyerToken=await accounts.register({username:'buyer',password,code:accounts.codes(admin,1)[0]}),buyer=accounts.user(buyerToken);
  accounts.db(db=>db.prepare('UPDATE users SET tokens=1000000 WHERE id=?').run(buyer.id));
  const server=createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const call=async(route,token,payload)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/account/${route}`,{method:payload?'POST':'GET',
      headers:{cookie:`jg_session=${token||''}`,'x-requested-with':'JUSTIZGUESSR','content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});
    return {status:response.status,body:await response.json()};
  };
  const now=Date.now(),payload={caseId:'all',percent:30,startsAt:now-1000,endsAt:now+3600000,requestId:'http-rebate-request-0001'};
  for(const [token,status] of [[null,401],[buyerToken,403]]){
    assert.equal((await call('admin/case-rebates',token)).status,status);
    assert.equal((await call('admin/case-rebates',token,payload)).status,status);
  }
  const base=(await call('case-store')).body;
  const saved=await call('admin/case-rebates',adminToken,payload);assert.equal(saved.status,200);
  const guest=(await call('case-store')).body,quote=(await call('case-store',buyerToken)).body;
  assert.equal(quote.cases[0].cost,Math.ceil(base.cases[0].cost*.7));
  assert.equal(guest.cases[0].cost,quote.cases[0].cost);
  const balance=accounts.profile(buyer).tokens;
  const purchase=await call('cases/buy',buyerToken,{caseId:quote.cases[0].id,revision:quote.revision,requestId:'http-rebate-purchase-0001'});
  assert.equal(purchase.status,200);assert.equal(purchase.body.user.tokens,balance-quote.cases[0].cost);
  assert.equal((await call('admin/case-rebates/cancel',buyerToken,{id:saved.body.rebate.id})).status,403);
  assert.equal((await call('admin/case-rebates/cancel',adminToken,{id:saved.body.rebate.id})).status,200);
  assert.equal((await call('case-store')).body.cases[0].cost,base.cases[0].cost);
});
