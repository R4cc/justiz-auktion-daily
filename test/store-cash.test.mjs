import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness,stockBusiness,businessDashboard,ensureBusinessSchema,tickBusinesses } from '../src/businesses.mjs';
import { buyStoreItem,tipStore,collectStoreCash,visitStore,listStores } from '../src/storefronts.mjs';
import { currentNetWorth,recordNetWorth,ensureNetWorthSchema } from '../src/net-worth.mjs';
import { imposeFine } from '../src/justice.mjs';
const now=Date.parse('2026-10-13T12:30:00Z');
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'jg-store-cash-')),accounts=new Accounts(dir,{now:()=>now}),owner={id:'owner'},buyer={id:'buyer'};
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  accounts.db(db=>{for(const user of [owner,buyer])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',100000,36100,?)").run(user.id,user.id,now);});
  const shops=['wine','toys'].map(type=>{
    const shop=buyBusiness(dir,owner,type,'popup',{now}).shop;
    const id='cash-'+type;accounts.db(db=>db.prepare('UPDATE businesses SET id=? WHERE id=?').run(id,shop.id));shop.id=id;
    accounts.db(db=>{for(let n=0;n<3;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
      .run(type+'-'+n,owner.id,JSON.stringify({title:type+' '+n,price:100,businessCategory:type,marketCategory:type==='toys'?'collectibles':'wine'}),now);});
    stockBusiness(dir,owner,shop.id,[type+'-0',type+'-1',type+'-2'],{now});return shop;
  });
  accounts.db(db=>db.prepare('UPDATE businesses SET traffic_popularity=0').run());
  const balance=id=>accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(id||owner.id).tokens);
  const till=id=>accounts.db(db=>db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(id).cash_balance);
  const purchase=(shop=shops[0],item='wine-0',id='cash-purchase-0001')=>buyStoreItem(dir,buyer,{shopId:shop.id,inventoryId:item,expectedPrice:120,requestId:id},{now});
  const collect=(shop=shops[0],id='cash-collection-0001')=>collectStoreCash(dir,owner,{shopId:shop.id,requestId:id,amount:999999999},{now});
  return {dir,accounts,owner,buyer,shops,balance,till,purchase,collect};
}

test('each till holds purchases and tips until collection, with stable net worth and no public cash disclosure',async t=>{
  const f=await fixture(t),balance=f.balance();f.purchase();
  tipStore(f.dir,f.buyer,{shopId:f.shops[0].id,amount:25,requestId:'cash-tip-00000001'},{now});
  f.purchase(f.shops[1],'toys-0','cash-purchase-toys-1');
  assert.equal(f.balance(),balance);assert.equal(f.till(f.shops[0].id),145);assert.equal(f.till(f.shops[1].id),120);
  const ready=businessDashboard(f.dir,f.owner,{now}).shops;assert.equal(ready.find(s=>s.id===f.shops[0].id).cashReady,145);
  const wealth=()=>f.accounts.db(db=>currentNetWorth(db,f.owner.id,{now}));
  const before=wealth();assert.equal(before.storeCash,265);
  const receipt=f.collect();assert.equal(receipt.amount,145);assert.equal(f.balance(),balance+145);
  assert.equal(f.till(f.shops[0].id),0);assert.equal(f.till(f.shops[1].id),120);
  assert.equal(wealth().total,before.total);assert.equal(wealth().storeCash,120);
  assert.equal(f.collect(f.shops[0],'cash-empty-collection-1').amount,0);
  assert.doesNotMatch(JSON.stringify(visitStore(f.dir,f.buyer,f.shops[0].id,{now})),/cashReady|cash_balance/);
  assert.doesNotMatch(JSON.stringify(listStores(f.dir,null,{now})),/cashReady|cash_balance/);
  assert.equal(f.collect(f.shops[1],'cash-toys-collection-1').amount,120);
  assert.equal(wealth().storeCash,0);assert.equal(wealth().total,before.total);
});

test('collection retries cannot pay twice or take later earnings; ownership, actor and request checks apply',async t=>{
  const f=await fixture(t);f.purchase();const before=f.balance(),receipt=f.collect();
  f.purchase(f.shops[0],'wine-1','cash-second-purchase-1');
  closeDataStore(f.dir);assert.deepEqual(f.collect(),receipt);
  assert.equal(f.balance(),before+120);assert.equal(f.till(f.shops[0].id),120);
  assert.throws(()=>f.collect(f.shops[1]),/request_conflict/);
  assert.throws(()=>collectStoreCash(f.dir,f.buyer,{shopId:f.shops[0].id,requestId:'cash-foreign-collection'},{now}),/business_not_found/);
  assert.throws(()=>collectStoreCash(f.dir,{id:'missing'},{shopId:f.shops[0].id,requestId:'cash-absent-collection'},{now}),/login_required/);
  assert.throws(()=>collectStoreCash(f.dir,f.owner,{shopId:f.shops[0].id,requestId:'bad'},{now}),/invalid_request/);
  f.accounts.db(db=>db.prepare("UPDATE users SET banned=1 WHERE id='owner'").run());assert.throws(()=>f.collect(f.shops[0],'cash-banned-collection'),/login_required/);
  f.accounts.db(db=>{db.prepare("UPDATE users SET banned=0 WHERE id='owner'").run();db.prepare("INSERT INTO player_justice(user_id,jailed_until) VALUES('owner',?)").run(now+60000);});
  assert.throws(()=>f.collect(f.shops[0],'cash-jailed-collection'),/player_jailed/);
});

test('wallet overflow and failed credits roll back the till and receipt; till overflow rolls back buyer payment and stock',async t=>{
  const f=await fixture(t);f.purchase();
  f.accounts.db(db=>db.prepare("UPDATE users SET tokens=? WHERE id='owner'").run(Number.MAX_SAFE_INTEGER));
  assert.throws(()=>f.collect(),/token_balance_limit/);assert.equal(f.till(f.shops[0].id),120);
  f.accounts.db(db=>{db.prepare("UPDATE users SET tokens=0 WHERE id='owner'").run();db.exec("CREATE TRIGGER fail_cash_collection BEFORE UPDATE OF tokens ON users WHEN NEW.id='owner' AND NEW.tokens>OLD.tokens BEGIN SELECT RAISE(ABORT,'cash credit failed'); END");});
  assert.throws(()=>f.collect(),/cash credit failed/);assert.equal(f.till(f.shops[0].id),120);assert.equal(f.balance(),0);
  assert.equal(f.accounts.db(db=>db.prepare("SELECT COUNT(*) n FROM store_receipts WHERE action='collect-cash'").get().n),0);
  f.accounts.db(db=>db.exec('DROP TRIGGER fail_cash_collection'));assert.equal(f.collect().amount,120);
  f.accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,f.shops[0].id));
  const buyer=f.balance('buyer');assert.throws(()=>f.purchase(f.shops[0],'wine-1','cash-overflow-purchase'),/token_balance_limit/);
  assert.equal(f.balance('buyer'),buyer);assert.equal(f.till(f.shops[0].id),Number.MAX_SAFE_INTEGER);
  assert.equal(f.accounts.db(db=>db.prepare("SELECT user_id FROM inventory WHERE id='wine-1'").get().user_id),'owner');
});

test('offline NPC sales accrue once in their till and collection settles new elapsed sales before paying',async t=>{
  const f=await fixture(t),later=now+24*3600_000,before=f.balance();
  f.accounts.db(db=>db.prepare("UPDATE businesses SET size='large',traffic_popularity=1.5 WHERE id=?").run(f.shops[0].id));
  tickBusinesses(f.dir,{now:later});assert.equal(f.balance(),before);
  const pending=f.till(f.shops[0].id);assert.ok(pending>0);
  closeDataStore(f.dir);tickBusinesses(f.dir,{now:later});assert.equal(f.till(f.shops[0].id),pending);
  const receipt=collectStoreCash(f.dir,f.owner,{shopId:f.shops[0].id,requestId:'cash-offline-collection'},{now:later});
  assert.equal(receipt.amount,pending);assert.equal(f.balance(),before+pending);assert.equal(f.till(f.shops[0].id),0);
  const g=await fixture(t);g.accounts.db(db=>db.prepare("UPDATE businesses SET size='large',traffic_popularity=1.5 WHERE id=?").run(g.shops[0].id));
  const fresh=collectStoreCash(g.dir,g.owner,{shopId:g.shops[0].id,requestId:'cash-lazy-collection-1'},{now:later});assert.ok(fresh.amount>0);assert.equal(g.till(g.shops[0].id),0);
});

test('legacy revenue stays paid, new cash survives restart, and historical wealth snapshots migrate without re-crediting',async t=>{
  const f=await fixture(t),before=f.balance();
  f.accounts.db(db=>{db.exec('ALTER TABLE businesses DROP COLUMN cash_balance');db.prepare('UPDATE businesses SET revenue=450').run();ensureBusinessSchema(db,{now});ensureBusinessSchema(db,{now});});
  assert.equal(f.till(f.shops[0].id),0);assert.equal(f.balance(),before);
  f.accounts.db(db=>{recordNetWorth(db,f.owner.id,{now});db.exec('ALTER TABLE net_worth_snapshots DROP COLUMN store_cash');ensureNetWorthSchema(db);});
  assert.equal(f.accounts.db(db=>db.prepare('SELECT store_cash FROM net_worth_snapshots WHERE user_id=?').get(f.owner.id).store_cash),0);
  f.purchase();closeDataStore(f.dir);assert.equal(f.till(f.shops[0].id),120);
  f.accounts.db(db=>recordNetWorth(db,f.owner.id,{now:now+60000}));
  assert.equal(f.accounts.db(db=>db.prepare('SELECT store_cash FROM net_worth_snapshots WHERE user_id=? ORDER BY captured_at DESC LIMIT 1').get(f.owner.id).store_cash),120);
  f.accounts.resetEconomy({...f.owner,admin:true},'RESET ECONOMY');assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM businesses').get().n),0);
});

test('bailiff applies unpaid store cash as an asset without crediting a wallet or seizing unnecessary stock',async t=>{
  const f=await fixture(t);f.purchase();f.accounts.db(db=>db.prepare("UPDATE users SET tokens=0 WHERE id='owner'").run());
  const result=f.accounts.atomic(db=>imposeFine(db,f.owner.id,100,now));
  assert.equal(result.paidCash,0);assert.equal(result.paidStoreCash,100);assert.equal(result.seized.length,0);
  assert.equal(result.remainingFine,0);assert.equal(result.jailedUntil,0);assert.equal(f.balance(),0);assert.equal(f.till(f.shops[0].id),20);
  assert.equal(f.collect().amount,20);assert.equal(f.balance(),20);
});
