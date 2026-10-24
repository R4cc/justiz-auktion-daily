import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { SHOP_TYPES, businessSaleChance, businessItemSaleChance, buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { setMarketIndex } from '../src/market.mjs';

const now = Date.parse('2026-10-24T12:00:00Z'), hour = 3600000;
const wine = SHOP_TYPES.find(type => type.id === 'wine');
const electronics = SHOP_TYPES.find(type => type.id === 'electronics');

test('cheaper goods receive a real demand boost and typical store turnover is more balanced', () => {
  const wineChance = businessItemSaleChance(wine,20,35), electronicsChance = businessItemSaleChance(electronics,20,120);
  assert.ok(wineChance > .47 && wineChance < .48);
  assert.ok(electronicsChance > .20 && electronicsChance < .21);
  assert.ok(wineChance > electronicsChance * 2);
  const proceeds = SHOP_TYPES.map(type => type.typicalValue * businessItemSaleChance(type,20,type.typicalValue));
  assert.ok(Math.max(...proceeds) / Math.min(...proceeds) < 2);
});

test('every category uses continuous item-value demand, keeps markup penalties and caps cheap-stock odds', () => {
  for(const type of SHOP_TYPES) {
    let last = Infinity;
    for(const value of [1,10,25,35,50,100,120,350,1000,2500,10000,1000000]) {
      const chance = businessItemSaleChance(type,20,value);
      assert.ok(chance > 0 && chance <= .85);
      assert.ok(chance <= last);last = chance;
      assert.ok(businessItemSaleChance(type,100,value) < businessItemSaleChance(type,20,value));
    }
    assert.equal(businessItemSaleChance(type,20,100), businessSaleChance(type.conversion,20));
    assert.ok(businessItemSaleChance(type,20,25) > businessItemSaleChance(type,20,400) * 3.9);
  }
  assert.equal(businessItemSaleChance(wine,0,1), .85);
  assert.equal(businessItemSaleChance(wine,20,1), .85);
});

async function fixture(t, value, count=10, size='popup') {
  const dir=await mkdtemp(path.join(tmpdir(),'jg-store-demand-'));
  const accounts=new Accounts(dir,{now:()=>now}),user={id:'owner'};
  accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('owner','Owner','disabled',1000000,36100,?)").run(now));
  const shop=buyBusiness(dir,user,'wine',size,{now}).shop;
  // Same deterministic customer rolls isolate the price change from UUID luck.
  accounts.db(db=>db.prepare('UPDATE businesses SET id=? WHERE id=?').run('demand-store',shop.id));shop.id='demand-store';
  accounts.db(db=>{
    const insert=db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)');
    for(let n=0;n<count;n++)insert.run(`stock-${n}`,user.id,JSON.stringify({title:'Wine',price:typeof value==='function'?value(n):value,marketCategory:'wine',businessCategory:'wine'}),now);
  });
  stockBusiness(dir,user,shop.id,Array.from({length:count},(_,n)=>`stock-${n}`),{now});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  return {dir,accounts,user,shop};
}

test('the displayed rate averages individual live values and responds to market changes',async t=>{
  const f=await fixture(t,n=>n<5?25:400);
  const read=()=>businessDashboard(f.dir,f.user,{now}).shops[0];
  let shop=read();
  const expected=(businessItemSaleChance(wine,20,25)+businessItemSaleChance(wine,20,400))/2;
  assert.equal(shop.buyChancePercent,Math.round(expected*1000)/10);
  const popularity=shop.popularity,visitors=shop.visitors;
  setMarketIndex(f.dir,'wine',150,{now});shop=read();
  assert.ok(shop.buyChancePercent < Math.round(expected*1000)/10);
  assert.equal(shop.popularity,popularity);assert.equal(shop.visitors,visitors);
});

test('real NPC sales move cheaper stock faster and preserve cash/stock receipts through replay and restart',async t=>{
  const results=[];
  for(const value of [25,400]) {
    const f=await fixture(t,value,150,'large');
    f.accounts.db(db=>{
      db.prepare('UPDATE businesses SET traffic_popularity=1').run();
      // Keep feedback from changing traffic during this controlled comparison.
      db.exec('CREATE TRIGGER stable_reviews AFTER INSERT ON store_reviews BEGIN DELETE FROM store_reviews WHERE business_id=NEW.business_id AND user_id=NEW.user_id; END');
    });
    const balance=f.accounts.profile(f.user).tokens;
    const first=businessDashboard(f.dir,f.user,{now:now+6*hour}).shops[0];
    assert.ok(first.sales>0&&first.stock.length>0);
    assert.equal(first.stock.length+first.sales,150);
    const receipts=f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS count,SUM(price) AS total FROM business_sales WHERE business_id=?').get(f.shop.id));
    assert.equal(receipts.count,first.sales);assert.equal(receipts.total,first.cashReady);
    assert.equal(f.accounts.profile(f.user).tokens,balance,'Uncollected revenue stays in the store');
    closeDataStore(f.dir);
    const replay=businessDashboard(f.dir,f.user,{now:now+6*hour}).shops[0];
    assert.equal(replay.sales,first.sales);assert.equal(replay.cashReady,first.cashReady);
    results.push(first);
  }
  assert.equal(results[0].visitors,results[1].visitors);
  assert.ok(results[0].sales > results[1].sales*2);
});
