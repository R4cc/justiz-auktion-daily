import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { advanceShop, buyBusiness, ensureBusinessSchema, restockPrestigeStores, stockBusiness, unstockBusiness, takeOverBusiness } from '../src/businesses.mjs';
import { BUSINESS_ABANDONMENT_MS, businessAbandonment } from '../src/business-abandonment.mjs';
import { ensureStoreSchema } from '../src/storefronts.mjs';
import { ensurePrestigeSchema } from '../src/prestige-effects.mjs';
import { ensureResaleSchema } from '../src/resale.mjs';
import { marketIndexes } from '../src/market.mjs';
import { acquireItems, acquisition } from '../src/trader.mjs';

const start=Date.parse('2026-10-01T12:00:00Z'), day=86_400_000, hour=3_600_000, abandonedAt=start+BUSINESS_ABANDONMENT_MS;
async function fixture(t,{size='popup',plotId='leopoldstadt-1'}={}) {
  const dir=await mkdtemp(join(tmpdir(),'jg-abandonment-'));let time=start;
  const accounts=new Accounts(dir,{now:()=>time}), owner={id:'owner',admin:true},buyer={id:'buyer'},rival={id:'rival'};
  accounts.db(db=>{
    for(const user of [owner,buyer,rival]) db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at,admin) VALUES(?,?,'disabled',1000000,8100,?,?)").run(user.id,user.id,start,Number(!!user.admin));
  });
  const purchase=buyBusiness(dir,owner,'wine',size,{now:start,plotId}),shop=purchase.shop;
  accounts.db(db=>marketIndexes(db,start));
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const query=(sql,...args)=>accounts.db(db=>db.prepare(sql).all(...args));
  const balance=user=>query('SELECT tokens FROM users WHERE id=?',user.id)[0].tokens;
  const row=()=>query('SELECT * FROM businesses WHERE id=?',shop.id)[0];
  const add=(id,at=time)=>accounts.db(db=>db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,owner.id,JSON.stringify({title:'Wachau Riesling '+id,price:100,marketCategory:'wine'}),at));
  // Isolate abandonment/accounting from elapsed customer sales and random events.
  const at=value=>{time=value;accounts.db(db=>{
    db.prepare('UPDATE businesses SET last_tick_at=?,traffic_popularity=0').run(Math.floor(value/hour)*hour);
    db.exec('CREATE TABLE IF NOT EXISTS store_event_checks(business_id TEXT PRIMARY KEY REFERENCES businesses(id),checked_at INTEGER NOT NULL) STRICT');
    for(const b of db.prepare('SELECT id FROM businesses').all())db.prepare('INSERT INTO store_event_checks VALUES(?,?) ON CONFLICT(business_id) DO UPDATE SET checked_at=excluded.checked_at').run(b.id,value);
  });};
  const payload=(requestId='takeover-request-0001',expectedPrice=purchase.cost)=>({shopId:shop.id,requestId,expectedPrice});
  const takeover=(user=buyer,request=payload(),when=time)=>takeOverBusiness(dir,user,request,{now:when});
  return {dir,accounts,owner,buyer,rival,shop,purchase,query,balance,row,add,at,payload,takeover};
}

test('abandonment starts exactly twenty days after the last genuine restock; shelf shuffling cannot renew it',async t=>{
  const f=await fixture(t);f.add('original');stockBusiness(f.dir,f.owner,f.shop.id,['original'],{now:start});
  f.at(start+19*day);unstockBusiness(f.dir,f.owner,f.shop.id,'original',{now:start+19*day});stockBusiness(f.dir,f.owner,f.shop.id,['original'],{now:start+19*day});
  assert.equal(f.row().last_restock_at,start);
  assert.equal(businessAbandonment(f.row(),abandonedAt-1).abandoned,false);
  assert.equal(businessAbandonment(f.row(),abandonedAt).abandoned,true);
  f.at(abandonedAt);f.add('fresh');stockBusiness(f.dir,f.owner,f.shop.id,['fresh'],{now:abandonedAt});
  assert.equal(f.row().last_restock_at,abandonedAt);
  assert.equal(businessAbandonment(f.row(),abandonedAt).abandoned,false);
  assert.equal(businessAbandonment(f.row(),abandonedAt+BUSINESS_ABANDONMENT_MS).abandoned,true);
  assert.equal(f.query('SELECT * FROM business_stock_history WHERE business_id=?',f.shop.id).length,2);
});

test('Prestige auto-restocking renews genuine additions but never repeated placements of the same item',async t=>{
  const f=await fixture(t);
  f.accounts.db(db=>{ensurePrestigeSchema(db);db.prepare('INSERT INTO user_prestige VALUES(?,?,?,?)').run(f.owner.id,JSON.stringify(['restocker']),1,start);});
  f.at(start+2*day);f.add('auto-original');
  assert.equal(f.accounts.atomic(db=>restockPrestigeStores(db,start+2*day,f.owner.id)),1);
  assert.equal(f.row().last_restock_at,start+2*day);
  f.at(start+3*day);unstockBusiness(f.dir,f.owner,f.shop.id,'auto-original',{now:start+3*day});
  assert.equal(f.accounts.atomic(db=>restockPrestigeStores(db,start+3*day,f.owner.id)),1);
  assert.equal(f.row().last_restock_at,start+2*day);
  f.at(start+4*day);f.add('auto-fresh');
  assert.equal(f.accounts.atomic(db=>restockPrestigeStores(db,start+4*day,f.owner.id)),1);
  assert.equal(f.row().last_restock_at,start+4*day);
});

test('legacy migration grants a full twenty-day grace period once and remembers existing stock',async t=>{
  const f=await fixture(t);f.add('legacy');stockBusiness(f.dir,f.owner,f.shop.id,['legacy'],{now:start});
  f.accounts.db(db=>{db.prepare('UPDATE businesses SET bought_at=? WHERE id=?').run(start-100*day,f.shop.id);db.exec('DROP TABLE business_stock_history; DROP TABLE business_takeovers; ALTER TABLE businesses DROP COLUMN last_restock_at');});
  const deployed=start+50*day;f.accounts.atomic(db=>ensureBusinessSchema(db,{now:deployed}));
  assert.equal(f.row().last_restock_at,deployed);assert.equal(businessAbandonment(f.row(),deployed+BUSINESS_ABANDONMENT_MS-1).abandoned,false);
  assert.equal(businessAbandonment(f.row(),deployed+BUSINESS_ABANDONMENT_MS).abandoned,true);
  closeDataStore(f.dir);f.accounts.atomic(db=>ensureBusinessSchema(db,{now:deployed+day}));
  assert.equal(f.row().last_restock_at,deployed);assert.equal(f.query('SELECT * FROM business_stock_history WHERE inventory_id=?','legacy').length,1);
});

test('takeover charges the normal plot opening price, returns stock and till, and preserves the retired shop history',async t=>{
  const f=await fixture(t,{plotId:'hietzing-1'});f.add('remaining');stockBusiness(f.dir,f.owner,f.shop.id,['remaining'],{now:start});
  f.accounts.db(db=>{
    ensureStoreSchema(db);acquireItems(db,f.owner.id,['remaining'],85,'purchase',start);db.prepare('UPDATE businesses SET cash_balance=321,revenue=450,sales=2,store_name=?,security_guard=1,profit_margin=100 WHERE id=?').run('Old cellar',f.shop.id);
    db.prepare('INSERT INTO business_sales VALUES(?,?,?,?,?)').run('historic-sale',f.shop.id,'historic-item',450,start);
    db.prepare('INSERT INTO store_reviews(business_id,user_id,stars,comment,updated_at) VALUES(?,?,?,?,?)').run(f.shop.id,f.rival.id,5,'Old review',start);
    db.prepare('INSERT INTO store_receipts(id,user_id,request_id,business_id,action,payload,result,created_at) VALUES(?,?,?,?,?,?,?,?)').run('old-receipt',f.rival.id,'historical-request-001',f.shop.id,'buy','{}','{}',start);
  });
  f.at(abandonedAt);const ownerBefore=f.balance(f.owner),buyerBefore=f.balance(f.buyer),result=f.takeover();
  assert.equal(result.cost,1700);assert.equal(f.balance(f.buyer),buyerBefore-1700);assert.equal(f.balance(f.owner),ownerBefore+321);
  const old=f.row();assert.equal(old.retired,1);assert.equal(old.plot_id,null);assert.equal(old.cash_balance,0);assert.equal(old.store_name,'Old cellar');assert.equal(old.revenue,450);assert.equal(old.sales,2);
  assert.notEqual(old.user_id,f.owner.id);assert.equal(f.query('SELECT * FROM business_sales WHERE business_id=?',f.shop.id).length,1);
  assert.equal(f.query('SELECT * FROM store_reviews WHERE business_id=?',f.shop.id).length,1);assert.equal(f.query('SELECT * FROM store_receipts WHERE business_id=?',f.shop.id).length,1);
  assert.equal(f.query('SELECT * FROM business_stock WHERE business_id=?',f.shop.id).length,0);
  assert.deepEqual(f.query('SELECT user_id,sold_at FROM inventory WHERE id=?','remaining').map(row=>({...row})),[{user_id:f.owner.id,sold_at:null}]);
  assert.equal(f.accounts.db(db=>acquisition(db,'remaining',f.owner.id)).acquisitionCost,85);
  assert.notEqual(result.shop.id,f.shop.id);assert.equal(result.shop.location.plotId,'hietzing-1');assert.equal(result.shop.name,'');assert.equal(result.shop.securityGuard,false);
  assert.equal(result.shop.profitMargin,20);assert.equal(result.shop.cashReady,0);assert.equal(result.shop.revenue,0);assert.equal(result.shop.sales,0);assert.equal(result.shop.stock.length,0);assert.equal(result.shop.abandoned,false);assert.equal(result.shop.lastRestockedAt,abandonedAt);
  assert.equal(f.query('SELECT * FROM account_notifications WHERE user_id=? AND source_key=?',f.owner.id,`store-takeover:${f.shop.id}`).length,1);
});

test('takeover replay survives restart, conflicts on request reuse and prevents a second buyer from taking the replaced shop',async t=>{
  const f=await fixture(t);f.at(abandonedAt);const request=f.payload(),before=f.balance(f.buyer),result=f.takeover(f.buyer,request);
  closeDataStore(f.dir);assert.deepEqual(f.takeover(f.buyer,request),result);assert.equal(f.balance(f.buyer),before-result.cost);
  assert.throws(()=>f.takeover(f.buyer,{...request,expectedPrice:request.expectedPrice+1}),/request_conflict/);
  const rivalBefore=f.balance(f.rival);assert.throws(()=>f.takeover(f.rival,f.payload('competing-buyer-0001')),/store_not_abandoned/);
  assert.equal(f.balance(f.rival),rivalBefore);assert.equal(f.query('SELECT * FROM business_takeovers').length,1);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM businesses WHERE plot_id=?',f.shop.location.plotId)[0].n,1);
});

test('a genuine restock invalidates a previously viewed abandoned-store takeover',async t=>{
  const f=await fixture(t);f.at(abandonedAt);const viewed=f.payload(),before=f.balance(f.buyer);
  assert.equal(businessAbandonment(f.row(),abandonedAt).abandoned,true);
  f.add('recovered');stockBusiness(f.dir,f.owner,f.shop.id,['recovered'],{now:abandonedAt});
  assert.throws(()=>f.takeover(f.buyer,viewed),/store_not_abandoned/);assert.equal(f.balance(f.buyer),before);assert.equal(f.row().retired,0);
});

test('takeover rejects own, active and stale-price offers atomically',async t=>{
  const f=await fixture(t),before=f.balance(f.buyer);
  assert.throws(()=>f.takeover(f.buyer,f.payload(),abandonedAt-1),/store_not_abandoned/);
  f.at(abandonedAt);assert.throws(()=>f.takeover(f.owner),/store_not_abandoned/);
  assert.throws(()=>f.takeover(f.buyer,f.payload('stale-price-request-001',999)),/store_price_changed/);
  assert.equal(f.balance(f.buyer),before);assert.equal(f.row().retired,0);assert.equal(f.query('SELECT * FROM business_takeovers').length,0);
});

test('takeover enforces persisted level, ownership cap and available funds without charging or retiring the store',async t=>{
  for(const condition of ['level','limit','funds']) {
    const f=await fixture(t,{size:'tiny',plotId:'leopoldstadt-2'});
    if(condition==='level')f.accounts.db(db=>db.prepare('UPDATE users SET xp=399 WHERE id=?').run(f.buyer.id));
    if(condition==='funds')f.accounts.db(db=>db.prepare('UPDATE users SET tokens=3999 WHERE id=?').run(f.buyer.id));
    if(condition==='limit')for(const plotId of ['favoriten-1','favoriten-5','hietzing-1'])buyBusiness(f.dir,f.buyer,'wine','popup',{now:start,plotId});
    f.at(abandonedAt);const before=f.balance(f.buyer),spoofed={...f.buyer,xp:1000000,progression:{level:20}};
    assert.throws(()=>f.takeover(spoofed),new RegExp({level:'store_level_required',limit:'store_limit_reached',funds:'insufficient_tokens'}[condition]));
    assert.equal(f.balance(f.buyer),before);assert.equal(f.row().retired,0);assert.equal(f.query('SELECT * FROM business_takeovers').length,0);
    if(condition==='level') {
      f.accounts.db(db=>db.prepare('UPDATE users SET xp=400 WHERE id=?').run(f.buyer.id));
      assert.equal(f.takeover().cost,4000);
    }
  }
});

test('expired legacy memory heists do not reserve abandoned stores forever',async t=>{
  const f=await fixture(t);f.add('legacy-target');stockBusiness(f.dir,f.owner,f.shop.id,['legacy-target'],{now:start});f.at(abandonedAt);
  f.accounts.db(db=>{
    ensureStoreSchema(db);
    db.prepare("INSERT INTO store_heists(id,user_id,business_id,owner_id,inventory_id,sequence,roll,chance,fee,created_at,ready_at,expires_at,status) VALUES('legacy-expired',?,?,?,?, '[]',0,30,200,?,?,?,'active')").run(f.rival.id,f.shop.id,f.owner.id,'legacy-target',start,start,start+65_000);
  });
  const result=f.takeover();assert.equal(result.cost,1000);
  assert.equal(f.query("SELECT status FROM store_heists WHERE id='legacy-expired'")[0].status,'expired');
  assert.equal(f.query("SELECT user_id,sold_at FROM inventory WHERE id='legacy-target'")[0].user_id,f.owner.id);
});

test('takeover refuses live theft and resale-locked inventory until competing activity is settled',async t=>{
  for(const condition of ['active','police','inventory']) {
    const f=await fixture(t);f.add('contested');stockBusiness(f.dir,f.owner,f.shop.id,['contested'],{now:start});f.at(abandonedAt);
    f.accounts.db(db=>{
      ensureStoreSchema(db);
      if(condition==='inventory') {
        ensureResaleSchema(db,abandonedAt);
        db.prepare("INSERT INTO resale_auctions(id,seller_id,inventory_id,start_price,status,started_at,ends_at) VALUES('pending-listing',?,?,100,'active',?,?)").run(f.owner.id,'contested',abandonedAt,abandonedAt+hour);
        db.prepare("INSERT INTO resale_auction_items VALUES('pending-listing','contested',0)").run();
      } else db.prepare('INSERT INTO store_heists(id,user_id,business_id,owner_id,inventory_id,sequence,roll,chance,fee,created_at,ready_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('pending-heist',f.rival.id,f.shop.id,f.owner.id,'contested','[]',0,30,200,abandonedAt,abandonedAt,abandonedAt+hour,condition);
    });
    const before=f.balance(f.buyer);assert.throws(()=>f.takeover(),/store_takeover_pending/);assert.equal(f.balance(f.buyer),before);assert.equal(f.row().retired,0);
    assert.equal(f.query('SELECT * FROM business_stock WHERE business_id=?',f.shop.id).length,1);
  }
});

test('business traffic increase produces approximately twenty-five percent more actual hourly visitors',async t=>{
  const f=await fixture(t);
  f.accounts.atomic(db=>{
    db.prepare('UPDATE businesses SET traffic_popularity=1,last_tick_at=? WHERE id=?').run(start,f.shop.id);
    advanceShop(db,db.prepare('SELECT * FROM businesses WHERE id=?').get(f.shop.id),start+400*hour);
  });
  // With neutral side-street traffic and reputation, the old rate was exactly 400.
  assert.ok(f.row().visitors>450&&f.row().visitors<550,`expected about 500 visitors, got ${f.row().visitors}`);
});
