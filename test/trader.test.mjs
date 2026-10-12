import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { acquireItems, acquisition, splitCost, ensureTraderSchema } from '../src/trader.mjs';
import { listItem, placeBid, settleAuction, getResale } from '../src/resale.mjs';
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { buyStoreItem, visitStore, customizeStore, startStoreHeist } from '../src/storefronts.mjs';
import { prepareSealedCase, insertSealedCase } from '../src/sealed-cases.mjs';
import { caseCatalog } from '../src/cases.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { createPaletteAuction, bidOnPaletteAuction, settlePaletteAuction, getPaletteAuctionRewards } from '../src/palette-auctions.mjs';

const now = Date.parse('2026-10-09T12:00:00Z'), later = now + 3_600_001;
const themes=[['Elektronik','Laptop Lenovo',40],['Werkzeuge','Bohrhammer Makita',20],['Getränke','Riesling Wein',8],['Fahrzeuge','BMW PKW',500],['Schmuck & Uhren','Gold Armbanduhr',90],['Sammlerstücke','Lego Modell',15]];
const lots=themes.flatMap(([category,title,price],i)=>Array.from({length:12},(_,n)=>({id:i*100+n+1000,title:`${title} ${i*100+n+1000}`,category,image:'/assets/example.jpg',currentBid:price*(n+1),actualBid:price*(n+1)})));
const item = {title:'Wine find',price:100,marketCategory:'wine',rarity:'common'};
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'jg-trader-')); let time=now;
  upsertAuctions(dir,lots);
  const accounts=new Accounts(dir,{now:()=>time,flags:{resales:false}}), seller={id:'seller',admin:true},buyer={id:'buyer'};
  accounts.db(db=>{for(const user of [seller,buyer])db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at,admin) VALUES (?,?,'disabled',100000,?,?)").run(user.id,user.id,now,Number(!!user.admin));ensureTraderSchema(db);});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const add=(id,cost,source='purchase',value=item)=>accounts.atomic(db=>{db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)').run(id,seller.id,JSON.stringify(value),now);if(cost!==undefined)acquireItems(db,seller.id,[id],cost,source,now);});
  const cost=(id,user=buyer)=>accounts.db(db=>acquisition(db,id,user.id));
  const sale=(id,quantity=1,startPrice=101)=>{const lot=listItem(dir,seller,{inventoryId:id,quantity,startPrice,endsAt:new Date(now+3_600_000).toISOString()},{now});placeBid(dir,buyer,lot.id,startPrice+50,{now:now+1});return lot;};
  return {dir,accounts,seller,buyer,add,cost,sale,at:value=>time=value};
}

test('cost splitting preserves integer totals with deterministic rounding',()=>{
  assert.deepEqual(splitCost(101,3),[34,34,33]);assert.deepEqual(splitCost(2,3),[1,1,0]);
  for(const bad of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>splitCost(bad,3));
});

test('mixed-cost resale batches keep immutable seller profit, reward proceeds and unknown costs separate',async t=>{
  const f=await fixture(t);f.add('a',20);f.add('b',0,'reward');f.add('c',undefined);f.add('d',50);
  const lot=f.sale('a',4), held=f.accounts.profile(f.buyer);
  assert.equal(held.heldInBids,151);assert.equal(held.tokens,99849);
  assert.doesNotMatch(JSON.stringify(getResale(f.dir,lot.id,{now:now+2})),/acquisitionCost|acquisitionSource|max_bid|highestBid|151/);
  settleAuction(f.dir,lot.id,{now:later});f.at(later);
  const seller=f.accounts.profile(f.seller),buyer=f.accounts.profile(f.buyer);
  assert.equal(seller.realizedTradingProfit,-19);assert.equal(seller.rewardProceeds,25);assert.equal(seller.unknownCostSales,1);assert.equal(seller.trackedSales,4);
  assert.equal(buyer.heldInBids,0);assert.equal(buyer.tokens,99899);
  assert.deepEqual(['a','b','c','d'].map(id=>f.cost(id).acquisitionCost),[26,25,25,25]);
  assert.equal(f.cost('a',f.seller).acquisitionCost,null);
  settleAuction(f.dir,lot.id,{now:later+1});closeDataStore(f.dir);
  assert.equal(f.accounts.profile(f.seller).realizedTradingProfit,-19);
  f.accounts.requestFriend(f.seller,'buyer');f.accounts.acceptFriend(f.buyer,'seller');
  assert.doesNotMatch(JSON.stringify(f.accounts.friends(f.buyer)),/acquisition|realizedTradingProfit|heldInBids/);
  assert.doesNotMatch(JSON.stringify(f.accounts.leaderboard()),/acquisition|realizedTradingProfit|heldInBids/);
  assert.ok(seller.traderMilestones.some(m=>m.step==='sale'));
  f.accounts.openCase(f.seller,caseCatalog(lots),'fundkiste','reinvest-purchase-0001');
  assert.ok(f.accounts.profile(f.seller).traderMilestones.some(m=>m.step==='reinvest'));
});

test('failed settlement rolls back costs, receipts, balances, escrow, ownership and milestones',async t=>{
  const f=await fixture(t);f.add('a',20);const lot=f.sale('a');
  const before=f.accounts.profile(f.seller).tokens;
  f.accounts.db(db=>db.exec("CREATE TRIGGER reject_cost BEFORE UPDATE ON item_acquisitions BEGIN SELECT RAISE(ABORT,'cost-write-failure'); END"));
  assert.throws(()=>settleAuction(f.dir,lot.id,{now:later}),/cost-write-failure/);
  f.accounts.db(db=>{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trader_sales').get().n,0);assert.equal(db.prepare('SELECT user_id FROM inventory WHERE id=?').get('a').user_id,'seller');assert.equal(db.prepare('SELECT settled_at FROM resale_auctions WHERE id=?').get(lot.id).settled_at,null);db.exec('DROP TRIGGER reject_cost');});
  assert.equal(f.accounts.profile(f.seller).tokens,before);assert.equal(f.cost('a',f.seller).acquisitionCost,20);
  settleAuction(f.dir,lot.id,{now:later});assert.equal(f.cost('a').acquisitionCost,101);
});

test('sealed case transfer resets owner cost; opening inherits the paid case cost once',async t=>{
  const f=await fixture(t),prepared=prepareSealedCase(caseCatalog(lots),'common',{now,random:()=>0});
  f.accounts.atomic(db=>{insertSealedCase(db,f.seller.id,prepared,now);acquireItems(db,f.seller.id,[prepared.item.id],0,'reward',now);});
  const lot=f.sale(prepared.item.id,1,37);settleAuction(f.dir,lot.id,{now:later});f.at(later);
  const reward=f.accounts.openSealedCase(f.buyer,prepared.item.id);
  assert.equal(f.cost(reward.id).acquisitionCost,37);assert.equal(f.cost(reward.id).acquisitionSource,'purchase');
  assert.deepEqual(f.accounts.openSealedCase(f.buyer,prepared.item.id),reward);
  assert.equal(f.accounts.inventory(f.buyer).length,1);assert.equal(f.accounts.profile(f.seller).rewardProceeds,37);
});

test('Daily claims/openings preserve zero reward cost, retries, currency and private provenance',async t=>{
  const f=await fixture(t),catalog=caseCatalog(lots);let run=f.accounts.startGame(f.seller,'daily',()=>lots.slice(0,5),undefined,catalog);
  for(let i=0;i<5;i++)run=f.accounts.answer(f.seller,run.id,i,lots[i].actualBid,catalog);
  const balance=f.accounts.profile(f.seller).tokens,box=f.accounts.claimDailyCase(f.seller,run.id);
  assert.deepEqual(f.accounts.claimDailyCase(f.seller,run.id),box);assert.equal(f.accounts.profile(f.seller).tokens,balance);
  const reward=f.accounts.openSealedCase(f.seller,box.id);assert.equal(f.cost(reward.id,f.seller).acquisitionCost,0);assert.equal(f.cost(reward.id,f.seller).acquisitionSource,'reward');
  f.accounts.sell(f.seller,reward.id);
  assert.equal(f.accounts.profile(f.seller).realizedTradingProfit,0);assert.equal(f.accounts.profile(f.seller).rewardProceeds,reward.sellValue);
  const steps=f.accounts.profile(f.seller).traderMilestones.map(m=>m.step);assert.ok(['daily','find','sale'].every(step=>steps.includes(step)));assert.ok(!steps.includes('reinvest'));
});

test('untracked legacy finds remain unknown across restart and never invent profit',async t=>{
  const f=await fixture(t);f.add('legacy',undefined);closeDataStore(f.dir);
  assert.equal(f.accounts.inventory(f.seller)[0].acquisitionCost,null);
  f.accounts.sell(f.seller,'legacy');const totals=f.accounts.profile(f.seller);
  assert.equal(totals.unknownCostSales,1);assert.equal(totals.realizedTradingProfit,0);assert.equal(totals.rewardProceeds,0);
  f.accounts.resetEconomy(f.seller,'RESET ECONOMY');
  f.accounts.db(db=>{for(const name of ['item_acquisitions','trader_sales','trader_milestones'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0);});
});

test('opening an already owned paid case after a sale is not a new investment',async t=>{
  const f=await fixture(t),prepared=prepareSealedCase(caseCatalog(lots),'common',{now,random:()=>0});
  f.accounts.atomic(db=>{insertSealedCase(db,f.seller.id,prepared,now);acquireItems(db,f.seller.id,[prepared.item.id],12,'purchase',now);});
  f.add('sold',3);f.accounts.sell(f.seller,'sold');f.accounts.openSealedCase(f.seller,prepared.item.id);
  assert.ok(!f.accounts.profile(f.seller).traderMilestones.some(m=>m.step==='reinvest'));
});

test('palette winners receive equally split actual paid cost; public lots never reveal costs or ceiling',async t=>{
  const f=await fixture(t),edition=loadPaletteCatalog(f.dir,{now}).palettes.find(p=>p.id==='fundkiste');
  const lot=createPaletteAuction(f.dir,{editionId:edition.editionId,requestId:'split-palette-test-0001'},{now,random:()=>0});
  bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve+100,{now:now+1});
  assert.equal(f.accounts.profile(f.buyer).heldInBids,lot.reserve+100);
  settlePaletteAuction(f.dir,lot.id,{now:later});f.at(later);
  const reveal=getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:later});
  assert.deepEqual(reveal.rewards.map(r=>f.cost(r.inventoryId).acquisitionCost),splitCost(lot.reserve,3));
  assert.equal(f.accounts.inventory(f.buyer).length,3);
});

test('store transfers preserve seller margin by cost, buyer basis and receipt replay',async t=>{
  const f=await fixture(t);f.add('wine',80);const shop=buyBusiness(f.dir,f.seller,'wine','popup',{now}).shop;
  stockBusiness(f.dir,f.seller,shop.id,['wine'],{now});
  assert.equal(f.accounts.inventory(f.seller).length,0);assert.equal(f.accounts.inventory(f.seller,{includeStores:true})[0].storeId,shop.id);
  const payload={shopId:shop.id,inventoryId:'wine',expectedPrice:120,requestId:'tracked-store-sale-0001'};
  const purchase=buyStoreItem(f.dir,f.buyer,payload,{now});assert.deepEqual(buyStoreItem(f.dir,f.buyer,payload,{now}),purchase);
  assert.equal(f.cost('wine').acquisitionCost,120);assert.equal(f.accounts.profile(f.seller).realizedTradingProfit,40);
  assert.equal(businessDashboard(f.dir,f.seller,{now}).shops[0].realizedTradingProfit,40);
  assert.doesNotMatch(JSON.stringify(visitStore(f.dir,f.buyer,shop.id,{now})),/acquisition|realizedTradingProfit/);
});

test('theft is available in every player store and legacy owner opt-out cannot bypass it',async t=>{
  const f=await fixture(t);f.add('wine',undefined,'unknown',{...item,marketCategory:'wine'});const shop=buyBusiness(f.dir,f.seller,'wine','popup',{now}).shop;stockBusiness(f.dir,f.seller,shop.id,['wine'],{now});
  const view=()=>visitStore(f.dir,f.buyer,shop.id,{now}).store;
  assert.equal(shop.mischiefEnabled,false);assert.ok(view().stock[0].theft);
  const profile={shopId:shop.id,name:'Trader store',motto:'',gooseGuard:false,mischiefEnabled:false,requestId:'legacy-mischief-test-001'};
  assert.throws(()=>customizeStore(f.dir,f.buyer,profile,{now}),/forbidden/);
  customizeStore(f.dir,f.seller,profile,{now});assert.ok(view().stock[0].theft);
  const entry=view().stock[0],payload={shopId:shop.id,inventoryId:'wine',expectedPrice:entry.price,expectedFine:entry.theft.fine,requestId:'all-player-theft-001'};
  const balance=f.accounts.profile(f.buyer).tokens;startStoreHeist(f.dir,f.buyer,payload,{now,draw:max=>max-1});assert.equal(f.accounts.profile(f.buyer).tokens,balance);
});

test('Daily scores rank appraisal skill independently of collection prestige',async t=>{
  const f=await fixture(t);
  f.add('valuable',undefined,'unknown',{...item,price:100000});
  for(const [user,multiplier] of [[f.seller,5],[f.buyer,1]]) {
    const run=f.accounts.startGame(user,'daily',()=>lots.slice(0,5));
    for(let i=0;i<5;i++)f.accounts.answer(user,run.id,i,lots[i].actualBid*multiplier);
  }
  assert.equal(f.accounts.leaderboard().leaders[0].id,f.seller.id);
  assert.equal(f.accounts.leaderboard('daily').leaders[0].id,f.buyer.id);
  assert.equal(f.accounts.leaderboard('daily').leaders[0].score,5000);
});
