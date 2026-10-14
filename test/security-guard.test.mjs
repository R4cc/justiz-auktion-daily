import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { acquireItems } from '../src/trader.mjs';
import { buyBusiness, stockBusiness, businessDashboard, ensureBusinessSchema, setBusinessMargin } from '../src/businesses.mjs';
import { customizeStore, buyStoreItem, visitStore, startStoreHeist, actStoreHeist, spinStoreHeist } from '../src/storefronts.mjs';
import { checkStoreEvents, STORE_EVENTS, STORE_EVENT_INTERVAL } from '../src/store-events.mjs';

const now = Date.parse('2026-10-14T12:30:00Z'), hour = 3600000;
async function fixture(t) {
  const dir = await mkdtemp('/tmp/jg-security-guard-'), accounts = new Accounts(dir, { now: () => now });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  const owner = { id:'owner' }, thief = { id:'thief' };
  accounts.db(db => { for (const user of [owner,thief]) db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',100000,36100,?)").run(user.id,user.id,now); });
  const shop = buyBusiness(dir,owner,'wine','popup',{now}).shop;
  accounts.db(db => db.prepare('UPDATE businesses SET traffic_popularity=0 WHERE id=?').run(shop.id));
  let request = 0;
  const guard = (active, at=now) => customizeStore(dir,owner,{shopId:shop.id,name:'Guarded store',motto:'',securityGuard:active,requestId:`security-toggle-${++request}-00001`},{now:at});
  const add = (id, cost=100, source='purchase') => {
    accounts.db(db => {
      db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,owner.id,JSON.stringify({title:'Wine '+id,price:100,marketCategory:'wine',rarity:'common'}),now);
      if (cost !== null) acquireItems(db,owner.id,[id],cost,source,now);
    });
    stockBusiness(dir,owner,shop.id,[id],{now});
  };
  const buy = (id, price=120) => buyStoreItem(dir,thief,{shopId:shop.id,inventoryId:id,expectedPrice:price,requestId:`security-sale-${++request}-00001`},{now});
  const balance = user => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(user.id).tokens);
  const dashboard = at => businessDashboard(dir,owner,{now:at??now}).shops[0];
  return {dir,accounts,owner,thief,shop,guard,add,buy,balance,dashboard};
}

test('guard costs follow active profits across small sales, toggles, restart and receipt retries', async t => {
  const f = await fixture(t); setBusinessMargin(f.dir,f.owner,f.shop.id,1,{now}); f.guard(true);
  let first;
  for (let n=0;n<50;n++) {
    if(n===20)f.guard(false);
    if(n===30){closeDataStore(f.dir);f.guard(true);}
    f.add('small-'+n); const receipt=f.buy('small-'+n,101); if(!n)first=receipt;
  }
  const shop=f.dashboard();
  assert.equal(shop.securityGuardFees,2); // 40 active-profit J€ × 5%.
  assert.equal(shop.cashReady,5050-2); assert.equal(shop.revenue,5050);
  assert.equal(shop.realizedTradingProfit,48);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT security_guard_profit AS profit FROM businesses WHERE id=?').get(f.shop.id).profit),40);
  // A receipt retry cannot charge the buyer or the guard fee twice.
  const before=f.balance(f.thief);
  const old=f.accounts.db(db=>db.prepare("SELECT result,payload FROM store_receipts WHERE action='buy' ORDER BY rowid LIMIT 1").get());
  assert.deepEqual(buyStoreItem(f.dir,f.thief,JSON.parse(old.payload).payload,{now}),first);
  assert.equal(f.balance(f.thief),before);assert.equal(f.dashboard().securityGuardFees,2);
});

test('losses offset later guard profit; rewards count and unknown acquisition costs stay excluded', async t => {
  const f=await fixture(t);f.guard(true);
  f.add('loss',150);f.buy('loss');
  assert.equal(f.dashboard().securityGuardFees,0);
  f.add('reward',0,'reward');f.buy('reward');
  assert.equal(f.dashboard().securityGuardFees,4); // (−30 + 120) × 5%, whole J€.
  f.add('unknown',null);f.buy('unknown');
  const shop=f.dashboard();assert.equal(shop.securityGuardFees,4);
  assert.equal(shop.cashReady,356);assert.equal(shop.realizedTradingProfit,-30);
  assert.equal(shop.rewardProceeds,116);assert.equal(shop.unknownCostSales,1);
});

test('NPC store sales and special sale events pay the same guard profit fee', async t => {
  for(const event of [false,true]) {
    const f=await fixture(t);f.guard(true);for(let n=0;n<3;n++)f.add('stock-'+n);
    if(event) {
      f.accounts.db(db=>db.prepare('UPDATE businesses SET traffic_popularity=0 WHERE id=?').run(f.shop.id));
      const roll=STORE_EVENTS.slice(0,STORE_EVENTS.findIndex(entry=>entry.id==='collector')).reduce((sum,entry)=>sum+entry.weight,0);
      let calls=0;checkStoreEvents(f.dir,f.owner,{now:now+STORE_EVENT_INTERVAL,random:()=>calls++%2?roll:0});
    } else f.dashboard(now+7*24*hour);
    const rows=f.accounts.db(db=>db.prepare('SELECT proceeds,cost,guard_fee FROM trader_sales WHERE business_id=?').all(f.shop.id));
    assert.ok(rows.length>0);
    const gross=rows.reduce((sum,row)=>sum+row.proceeds,0),profit=rows.reduce((sum,row)=>sum+row.proceeds-row.cost,0);
    const fees=rows.reduce((sum,row)=>sum+row.guard_fee,0);
    assert.equal(fees,Math.floor(profit*.05));assert.ok(fees>0);
    const shop=f.dashboard(event?now+STORE_EVENT_INTERVAL:now+7*24*hour);
    assert.equal(shop.cashReady,gross-fees);assert.equal(shop.securityGuardFees,fees);
  }
});

test('old goose-guard ownership migrates to a toggleable security guard without charging history', async t => {
  const f=await fixture(t);f.guard(true);
  f.accounts.db(db=>{db.exec('ALTER TABLE businesses RENAME COLUMN security_guard TO goose_guard');ensureBusinessSchema(db,{now});});
  closeDataStore(f.dir);const shop=f.dashboard();assert.equal(shop.securityGuard,true);assert.equal(shop.securityGuardFees,0);
  f.guard(false);assert.equal(f.dashboard().securityGuard,false);
});

test('30% and 50% catch boundaries are frozen at entry and caught fines pay the owner exactly once', async t => {
  for(const guarded of [false,true])for(const roll of [0,299999,300000,499999,500000,999999]) {
    const f=await fixture(t);f.add('target');f.guard(guarded);
    const quote=visitStore(f.dir,f.thief,f.shop.id,{now}).store.stock[0].theft;
    const {id}=startStoreHeist(f.dir,f.thief,{shopId:f.shop.id,inventoryId:'target',expectedPrice:120,expectedFine:quote.fine,expectedPoliceCatchPercent:quote.policeCatchPercent,requestId:'security-heist-start-001'},{now,draw:max=>max-1});
    f.guard(!guarded); // Toggling after entry cannot alter this attempt.
    f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[1,4,5],turn:0,outcome:'active'}),id));
    const ownerBefore=f.balance(f.owner),thiefBefore=f.balance(f.thief);
    const lost=actStoreHeist(f.dir,f.thief,{heistId:id,action:'stand',turn:0,requestId:'security-heist-stand-001'},{now,policeDraw:()=>roll});
    assert.equal(lost.policeWheel.catchPercent,guarded?50:30);assert.equal(lost.fine,200);
    const result=spinStoreHeist(f.dir,f.thief,{heistId:id,requestId:'security-heist-spin-001'},{now});
    const caught=roll<(guarded?500000:300000);
    assert.equal(result.outcome,caught?'caught':'escaped');
    assert.equal(f.balance(f.owner),ownerBefore+(caught?200:0));assert.equal(f.balance(f.thief),thiefBefore-(caught?200:0));
    closeDataStore(f.dir);spinStoreHeist(f.dir,f.thief,{heistId:id,requestId:'security-heist-retry-001'},{now});
    assert.equal(f.balance(f.owner),ownerBefore+(caught?200:0));
  }
});

test('guard toggles settle elapsed NPC hours under the old setting', async t => {
  const f=await fixture(t);for(let n=0;n<3;n++)f.add('past-'+n);
  f.guard(true,now+24*hour);
  const shop=f.dashboard(now+24*hour);assert.ok(shop.sales>0);assert.equal(shop.securityGuardFees,0);
});

test('fine payout and enforcement roll back together, then retry once', async t => {
  const f=await fixture(t);f.add('target');const ownerBefore=f.balance(f.owner),thiefBefore=f.balance(f.thief);
  const {id}=startStoreHeist(f.dir,f.thief,{shopId:f.shop.id,inventoryId:'target',expectedPrice:120,expectedFine:200,requestId:'security-rollback-start-1'},{now,draw:max=>max-1});
  f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[1,4,5],turn:0,outcome:'active'}),id));
  actStoreHeist(f.dir,f.thief,{heistId:id,action:'stand',turn:0,requestId:'security-rollback-stand-1'},{now,policeDraw:()=>0});
  f.accounts.db(db=>db.exec("CREATE TRIGGER reject_guard_payout BEFORE UPDATE OF tokens ON users WHEN NEW.id='owner' BEGIN SELECT RAISE(ABORT,'payout_failed'); END"));
  assert.throws(()=>spinStoreHeist(f.dir,f.thief,{heistId:id,requestId:'security-rollback-spin-1'},{now}),/payout_failed/);
  assert.equal(f.balance(f.owner),ownerBefore);assert.equal(f.balance(f.thief),thiefBefore);
  f.accounts.db(db=>db.exec('DROP TRIGGER reject_guard_payout'));
  spinStoreHeist(f.dir,f.thief,{heistId:id,requestId:'security-rollback-spin-1'},{now});
  assert.equal(f.balance(f.owner),ownerBefore+200);assert.equal(f.balance(f.thief),thiefBefore-200);
});

test('an insolvent caught thief still pays the quoted fine value to the owner when debt becomes jail', async t => {
  const f=await fixture(t);f.add('target');f.accounts.db(db=>db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(f.thief.id));
  const before=f.balance(f.owner);
  const {id}=startStoreHeist(f.dir,f.thief,{shopId:f.shop.id,inventoryId:'target',expectedPrice:120,expectedFine:200,requestId:'security-jail-start-001'},{now,draw:max=>max-1});
  f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[1,4,5],turn:0,outcome:'active'}),id));
  actStoreHeist(f.dir,f.thief,{heistId:id,action:'stand',turn:0,requestId:'security-jail-stand-001'},{now,policeDraw:()=>0});
  const result=spinStoreHeist(f.dir,f.thief,{heistId:id,requestId:'security-jail-spin-0001'},{now});
  assert.equal(result.consequence.convertedToSentence,200);assert.ok(result.consequence.jailedUntil>now);
  assert.equal(f.balance(f.owner),before+200);assert.equal(f.balance(f.thief),0);
});

test('pre-patch active hands and pending wheels preserve their original 20% risk', async t => {
  const f=await fixture(t);f.add('target');
  const {id}=startStoreHeist(f.dir,f.thief,{shopId:f.shop.id,inventoryId:'target',expectedPrice:120,expectedFine:200,requestId:'security-legacy-start-01'},{now,draw:max=>max-1});
  f.accounts.db(db=>db.prepare('UPDATE store_heists SET chance=0,blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[1,4,5],turn:0,outcome:'active'}),id));
  const lost=actStoreHeist(f.dir,f.thief,{heistId:id,action:'stand',turn:0,requestId:'security-legacy-stand-01'},{now,policeDraw:()=>250000});
  assert.equal(lost.policeWheel.catchPercent,20);closeDataStore(f.dir);
  const result=spinStoreHeist(f.dir,f.thief,{heistId:id,requestId:'security-legacy-spin-001'},{now});
  assert.equal(result.outcome,'escaped');assert.equal(result.policeWheel.catchPercent,20);
});
