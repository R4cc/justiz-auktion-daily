import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {Accounts} from '../src/accounts.mjs';
import {closeDataStore} from '../src/database.mjs';
import {buyBusiness,businessDashboard,stockBusiness,unstockBusiness,ensureBusinessSchema} from '../src/businesses.mjs';
import {buyStoreItem} from '../src/storefronts.mjs';
import {storePopularityBreakdown,shelfFillFactor} from '../src/store-reputation.mjs';
import {setMarketIndex} from '../src/market.mjs';
const now=Date.parse('2026-10-14T12:00:00Z');
async function fixture(t){const dir=await mkdtemp('/tmp/popularity-'),accounts=new Accounts(dir,{now:()=>now}),owner={id:'owner',admin:true},buyer={id:'buyer'};accounts.db(db=>{for(const id of ['owner','buyer'])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,admin,created_at) VALUES(?,?,'disabled',1000000,36100,1,?)").run(id,id,now);for(let n=0;n<10;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('wine-'+n,owner.id,JSON.stringify({title:'Wine '+n%4,price:35,marketCategory:'wine'}),now);});const shop=buyBusiness(dir,owner,'wine',null,{plotId:'hietzing-1',now}).shop;t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});return {dir,accounts,owner,buyer,shop,view:()=>businessDashboard(dir,owner,{now}).shops[0]};}
const reconcile=shop=>assert.equal(shop.popularityBreakdown.basePercent+shop.popularityBreakdown.factors.reduce((sum,f)=>sum+f.points,0),shop.popularityPercent);
test('popularity contributions reconcile for partial/full/empty shelves, good/bad reviews, and caps',async t=>{const f=await fixture(t);stockBusiness(f.dir,f.owner,f.shop.id,['wine-0'],{now});let shop=f.view();reconcile(shop);assert.ok(shop.popularityBreakdown.factors.find(f=>f.id==='shelf_fill').points<0);assert.equal(shop.popularityBreakdown.visitorEffectPercent,0);assert.equal(f.accounts.db(db=>storePopularityBreakdown(db,db.prepare('SELECT * FROM businesses WHERE id=?').get(f.shop.id),{trafficMultiplier:.65},now)).visitorEffectPercent,-35);const original=shop.popularityPercent;for(let n=0;n<30;n++)f.accounts.db(db=>{const id='reviewer-'+n;db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',1000,?)").run(id,id,now);db.prepare('INSERT INTO store_reviews(business_id,user_id,stars,comment,updated_at) VALUES(?,?,1,\'\',?)').run(f.shop.id,id,now);});shop=f.view();reconcile(shop);assert.ok(shop.popularityPercent<original);assert.ok(shop.popularityBreakdown.factors.find(f=>f.id==='reviews').points<0);f.accounts.db(db=>db.prepare('UPDATE store_reviews SET stars=5').run());shop=f.view();reconcile(shop);assert.ok(shop.popularityBreakdown.factors.find(f=>f.id==='reviews').points>0);stockBusiness(f.dir,f.owner,f.shop.id,Array.from({length:9},(_,i)=>'wine-'+(i+1)),{now});shop=f.view();reconcile(shop);assert.equal(shop.popularityBreakdown.factors.find(f=>f.id==='shelf_fill').points,0);for(let i=0;i<10;i++)unstockBusiness(f.dir,f.owner,f.shop.id,'wine-'+i,{now});shop=f.view();reconcile(shop);assert.equal(shop.popularityPercent,0);assert.equal(shop.popularityBreakdown.factors.find(f=>f.id==='empty_shelves').points,-shop.popularityBreakdown.basePercent);});
test('sales and market movement retain the factors that produced stored popularity',async t=>{const f=await fixture(t);stockBusiness(f.dir,f.owner,f.shop.id,['wine-0','wine-1'],{now});const before=f.view(),stockFactors=before.popularityBreakdown.factors.filter(f=>f.id!=='reviews');buyStoreItem(f.dir,f.buyer,{shopId:f.shop.id,inventoryId:'wine-0',expectedPrice:before.stock[0].askingPrice,requestId:'popularity-purchase-001'},{now});setMarketIndex(f.dir,'wine',170,{now});const after=f.view();assert.equal(after.stock.length,1);assert.deepEqual(after.popularityBreakdown.factors.filter(f=>f.id!=='reviews'),stockFactors);assert.equal(after.popularityBreakdown.recordedAt,now);reconcile(after);});
test('legacy stores preserve their score without fabricating unknown stock factors',async t=>{const f=await fixture(t);stockBusiness(f.dir,f.owner,f.shop.id,['wine-0'],{now});const before=f.view();f.accounts.db(db=>{db.exec('ALTER TABLE businesses DROP COLUMN popularity_factors');ensureBusinessSchema(db,{now});});const after=f.view();assert.equal(after.popularityPercent,before.popularityPercent);assert.equal(after.popularityBreakdown.baseLabel,'recorded_stock');assert.equal(after.popularityBreakdown.recordedAt,null);assert.deepEqual(after.popularityBreakdown.factors.map(f=>f.id),['reviews']);reconcile(after);stockBusiness(f.dir,f.owner,f.shop.id,['wine-1'],{now});assert.equal(f.view().popularityBreakdown.baseLabel,'base');});


test('shelf fullness is neutral at 30% and above for every shop capacity', () => {
  for (const capacity of [1,3,8,10,20,25,60,150]) {
    const minimum = Math.ceil(capacity * .3);
    assert.equal(shelfFillFactor(minimum,capacity),1,`${minimum}/${capacity}`);
    assert.equal(shelfFillFactor(capacity,capacity),1);
    assert.ok(shelfFillFactor(minimum-1,capacity)<1,`${minimum-1}/${capacity}`);
  }
  assert.equal(shelfFillFactor(50,60),1);
  assert.equal(shelfFillFactor(18,60),1);
  assert.ok(shelfFillFactor(17,60)<1);
});

test('50/60 and exactly 30% stocked have no shelf or low-value penalty; sparse stock still does', async t => {
  const f=await fixture(t), medium=buyBusiness(f.dir,f.owner,'wine','medium',{now}).shop;
  f.accounts.db(db=>{
    const insert=db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)');
    for(let n=0;n<50;n++)insert.run('cheap-'+n,f.owner.id,JSON.stringify({title:'Riesling '+n%4,price:1,marketCategory:'wine'}),now);
  });
  const view=()=>businessDashboard(f.dir,f.owner,{now}).shops.find(shop=>shop.id===medium.id);
  const factor=(shop,id)=>shop.popularityBreakdown.factors.find(factor=>factor.id===id).points;
  stockBusiness(f.dir,f.owner,medium.id,Array.from({length:50},(_,i)=>'cheap-'+i),{now});
  let shop=view();reconcile(shop);
  assert.equal(shop.stock.length,50);assert.equal(shop.capacity,60);
  assert.equal(factor(shop,'shelf_fill'),0);assert.equal(factor(shop,'stock_value'),0);
  const originalPopularity=shop.popularityPercent;
  for(let i=49;i>=18;i--)unstockBusiness(f.dir,f.owner,medium.id,'cheap-'+i,{now});
  shop=view();reconcile(shop);
  assert.equal(factor(shop,'shelf_fill'),0);assert.equal(factor(shop,'stock_value'),0);
  assert.equal(shop.popularityPercent,originalPopularity,'same variety and value at 30% retains popularity');
  unstockBusiness(f.dir,f.owner,medium.id,'cheap-17',{now});
  shop=view();reconcile(shop);
  assert.ok(factor(shop,'shelf_fill')<0);assert.equal(factor(shop,'stock_value'),0);
  assert.ok(shop.popularityPercent<originalPopularity);
  // Expensive stock still earns the existing positive stock-value bonus.
  f.accounts.db(db=>db.prepare('UPDATE inventory SET item=? WHERE id=?').run(JSON.stringify({title:'Premium Riesling',price:3500,marketCategory:'wine'}),'cheap-18'));
  stockBusiness(f.dir,f.owner,medium.id,['cheap-18'],{now});
  assert.ok(factor(view(),'stock_value')>0);
});

test('existing recorded stock gets the new rules once without recalculating sold stock or market values', async t => {
  const f=await fixture(t);stockBusiness(f.dir,f.owner,f.shop.id,['wine-0'],{now});
  const old={version:1,count:50,capacity:60,variety:4,varietyFactor:1.25,valueFactor:.81,fillFactor:.65+.35*50/60,updatedAt:now-1000};
  old.basePopularity=Math.round(old.varietyFactor*old.valueFactor*old.fillFactor*100)/100;
  f.accounts.db(db=>{
    db.prepare('UPDATE businesses SET traffic_popularity=?,popularity_factors=? WHERE id=?').run(old.basePopularity,JSON.stringify(old),f.shop.id);
    db.prepare("DELETE FROM app_state WHERE key='store_popularity_factors_v2'").run();
    ensureBusinessSchema(db,{now});
    const row=db.prepare('SELECT * FROM businesses WHERE id=?').get(f.shop.id),saved=JSON.parse(row.popularity_factors);
    assert.equal(row.traffic_popularity,1.25);assert.equal(saved.version,2);
    assert.equal(saved.valueFactor,1);assert.equal(saved.fillFactor,1);
    assert.equal(saved.count,50);assert.equal(saved.capacity,60);assert.equal(saved.updatedAt,old.updatedAt);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM business_stock WHERE business_id=?').get(f.shop.id).n,1);
    const breakdown=storePopularityBreakdown(db,row,null,now);
    assert.equal(breakdown.factors.find(f=>f.id==='stock_value').points,0);
    assert.equal(breakdown.factors.find(f=>f.id==='shelf_fill').points,0);
    ensureBusinessSchema(db,{now:now+1000});
    assert.equal(db.prepare('SELECT popularity_factors FROM businesses WHERE id=?').get(f.shop.id).popularity_factors,row.popularity_factors);
  });
});
