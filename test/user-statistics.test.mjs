import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore,upsertAuctions } from '../src/database.mjs';
import { userStatistics } from '../src/user-statistics.mjs';
import { buyBusiness,stockBusiness } from '../src/businesses.mjs';
import { buyStoreItem,collectStoreCash,tipStore,recordStoreVisit,startStoreHeist,actStoreHeist,spinStoreHeist,HEIST_COOLDOWN,visitStore } from '../src/storefronts.mjs';
import { listItem,placeBid,settleAuction } from '../src/resale.mjs';
import { loadCaseStoreCatalog,quoteCaseStore } from '../src/case-store.mjs';
import { marketIndexes } from '../src/market.mjs';
import { prestigeAccount } from '../src/prestige.mjs';
import { createStockPaletteAuction,stockPaletteAuctionCatalog } from '../src/stock-palette-auctions.mjs';
import { bidOnPaletteAuction,settlePaletteAuction,getPaletteAuctionRewards } from '../src/palette-auctions.mjs';
import { playAnswer } from './helpers/play-answer.mjs';

const now=Date.parse('2026-10-14T12:30:00Z');
async function fixture(t){
 const dir=await mkdtemp('/tmp/jg-user-statistics-'),accounts=new Accounts(dir,{now:()=>now,flags:{resales:true}}),user={id:'player',admin:true},other={id:'other'};
 accounts.db(db=>{for(const id of [user.id,other.id])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,admin,created_at) VALUES(?,?,'disabled',100000,8100,?,?)").run(id,id,Number(id===user.id),now);});
 upsertAuctions(dir,['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'].map((title,index)=>({id:94000+index,title:title+' Wine',category:'Getränke',image:'/favicon.png',finalPrice:10*(index+1)**2})));
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 const stats=()=>userStatistics(dir,user,{now});
 const item=(id,owner=other)=>accounts.db(db=>db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,owner.id,JSON.stringify({title:'Wine '+id,price:100,marketCategory:'wine',rarity:'rare'}),now));
 const buyItem=(id,price=100)=>{item(id);const lot=listItem(dir,other,{inventoryId:id,startPrice:price,endsAt:new Date(now+60000).toISOString()},{now});placeBid(dir,user,lot.id,price+100,{now});settleAuction(dir,lot.id,{now:now+60001});return lot;};
 const catalog=loadCaseStoreCatalog(dir,now),quote=()=>quoteCaseStore(catalog,accounts.db(db=>marketIndexes(db,now)));
 return {dir,accounts,user,other,stats,item,buyItem,catalog,quote};
}

test('new accounts have zero activity totals; starting cash, escrow and returned bid deposits are not income or spending',async t=>{
 const f=await fixture(t),empty=f.stats();assert.equal(empty.money.earned,0);assert.equal(empty.money.spent,0);assert.equal(empty.cases.opened,0);assert.equal(empty.trading.itemsSold,0);
 f.item('bidding');const lot=listItem(f.dir,f.other,{inventoryId:'bidding',startPrice:100,endsAt:new Date(now+60000).toISOString()},{now});placeBid(f.dir,f.user,lot.id,500,{now});
 assert.equal(f.stats().money.spent,0);assert.equal(f.stats().money.earned,0);assert.equal(f.stats().trading.bids,1);
 settleAuction(f.dir,lot.id,{now:now+60001});assert.equal(f.stats().money.spent,100);assert.equal(f.stats().trading.auctionWins,1);
 for(let retry=0;retry<3;retry++){settleAuction(f.dir,lot.id,{now:now+60002});assert.equal(f.stats().money.spent,100);assert.equal(f.stats().money.earned,0);}
 assert.equal(userStatistics(f.dir,f.other,{now}).money.earned,100);
});

test('case statistics count each reveal once, exclude hidden contents, and distinguish total purchases from opened costs',async t=>{
 const f=await fixture(t),offer=f.quote().cases[0],buy=id=>f.accounts.buyCase(f.user,f.catalog,offer.id,id,f.quote().revision);
 const first=buy('stats-first-case-request-001');buy('stats-second-case-request-001');assert.equal(f.stats().cases.bought,2);assert.equal(f.stats().cases.cost,2*offer.cost);
 assert.equal(f.stats().cases.opened,0);assert.equal(f.stats().cases.value,0);assert.equal(f.stats().cases.bestValue,0);assert.ok(f.stats().cases.rarities.every(row=>row.count===0));
 const find=f.accounts.openSealedCase(f.user,first.id);f.accounts.openSealedCase(f.user,first.id);buy('stats-first-case-request-001');
 const s=f.stats();assert.equal(s.cases.opened,1);assert.equal(s.cases.value,Math.round(find.price));assert.equal(s.cases.openedCost,offer.cost);assert.equal(s.money.spent,2*offer.cost);
 assert.equal(s.cases.rarities.find(row=>row.id===find.rarity).count,1);assert.equal(s.money.earned,0);assert.equal(s.cases.bought,2);
 assert.doesNotMatch(JSON.stringify(s),/inventoryId|rewardPosition|pool|password|caseTier/);
});

test('business sales, costs, tips, visits and register collection reconcile without duplicated earnings or item spending',async t=>{
 const f=await fixture(t),lot=f.buyItem('shop-stock'),opened=buyBusiness(f.dir,f.user,'wine','popup',{now});stockBusiness(f.dir,f.user,opened.shop.id,['shop-stock'],{now});
 const buy={shopId:opened.shop.id,inventoryId:'shop-stock',expectedPrice:120,requestId:'stats-store-purchase-001'};buyStoreItem(f.dir,f.other,buy,{now});buyStoreItem(f.dir,f.other,buy,{now});
 recordStoreVisit(f.dir,f.other,opened.shop.id,{now});recordStoreVisit(f.dir,f.other,opened.shop.id,{now});
 const collect={shopId:opened.shop.id,requestId:'stats-cash-collection-001'};collectStoreCash(f.dir,f.user,collect,{now});collectStoreCash(f.dir,f.user,collect,{now});collectStoreCash(f.dir,f.user,{...collect,requestId:'stats-empty-register-001'},{now});
 const tip={shopId:opened.shop.id,amount:10,requestId:'stats-store-tip-request-001'};tipStore(f.dir,f.other,tip,{now});tipStore(f.dir,f.other,tip,{now});
 const s=f.stats();assert.equal(s.money.earned,130);assert.equal(s.money.spent,100+opened.cost);assert.equal(s.trading.itemsSold,1);assert.equal(s.trading.profit,20);
 assert.equal(s.stores.opened,1);assert.equal(s.stores.revenue,120);assert.equal(s.stores.collected,120);assert.equal(s.stores.collections,1);assert.equal(s.stores.playerVisits,1);assert.equal(s.stores.visitors,1);
 assert.equal(s.money.tipsReceived,10);assert.equal(s.stores.unknownCosts,0);assert.equal(s.trading.auctionWins,1);assert.equal(lot.startPrice,100);
 const other=userStatistics(f.dir,f.other,{now});assert.equal(other.money.spent,130);assert.equal(other.money.earned,100);
});

test('completed games, free cases and grants are receipt-backed; free asset value never counts as cash earned',async t=>{
 const f=await fixture(t),auctions=Array.from({length:5},(_,index)=>({id:100+index,title:'Daily wine '+index,actualBid:100,image:'/favicon.png',category:'Getränke'}));
 let run=f.accounts.startGame(f.user,'daily',()=>auctions);
 for(let index=0;index<5;index++)run=playAnswer(f.accounts,f.user,run.id,index,100);
 const box=f.accounts.claimDailyCase(f.user,run.id);f.accounts.openSealedCase(f.user,box.id);
 f.accounts.grantUserTokens(f.user,f.user.id,500,'stats-personal-grant-001');f.accounts.grantTokens(f.user,250,'stats-global-grant-001');
 const s=f.stats();assert.equal(s.games.dailyCompleted,1);assert.equal(s.games.xpEarned,150);assert.equal(s.games.bestDailyScore,5000);assert.equal(s.money.dailyRewards,1000);assert.equal(s.money.gifts,750);assert.equal(s.money.earned,1750);assert.equal(s.money.spent,0);assert.equal(s.cases.opened,1);assert.equal(s.cases.cost,0);assert.ok(s.cases.value>0);
 assert.deepEqual(f.stats(),s);
});

test('theft outcomes and cash fines are counted once and kept separate from the value of stolen goods',async t=>{
 const f=await fixture(t),shop=buyBusiness(f.dir,f.other,'wine','popup',{now}).shop;
 for(const id of ['stolen','caught']){f.item(id);stockBusiness(f.dir,f.other,shop.id,[id],{now});}
 f.accounts.db(db=>db.prepare('UPDATE businesses SET traffic_popularity=0 WHERE id=?').run(shop.id));
 const start=(id,at)=>startStoreHeist(f.dir,f.user,{shopId:shop.id,inventoryId:id,expectedPrice:120,expectedFine:visitStore(f.dir,f.user,shop.id,{now:at}).store.stock.find(item=>item.id===id).theft.fine,requestId:'stats-theft-start-'+id},{now:at,draw:max=>max-1}).id;
 const win=start('stolen',now);assert.equal(f.stats().theft.attempts,1);assert.equal(f.stats().theft.stolen,0);
 f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[9,8],dealer:[6,10],deck:[],turn:0,outcome:'active'}),win));
 const action={heistId:win,action:'stand',turn:0,requestId:'stats-winning-theft-001'};assert.equal(actStoreHeist(f.dir,f.user,action,{now}).outcome,'stolen');actStoreHeist(f.dir,f.user,action,{now});
 assert.equal(f.stats().theft.stolen,1);assert.equal(f.stats().money.earned,0);
 const at=now+HEIST_COOLDOWN+1,loss=start('caught',at);f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[],turn:0,outcome:'active'}),loss));
 actStoreHeist(f.dir,f.user,{heistId:loss,action:'stand',turn:0,requestId:'stats-losing-theft-001'},{now:at,policeDraw:()=>0});spinStoreHeist(f.dir,f.user,{heistId:loss,requestId:'stats-caught-wheel-001'},{now:at});
 const s=f.stats();assert.equal(s.theft.attempts,2);assert.equal(s.theft.caught,1);assert.equal(s.theft.stolen,1);assert.equal(s.money.finesPaid,300);assert.equal(s.money.spent,300);
 assert.equal(userStatistics(f.dir,f.other,{now:at}).money.finesReceived,300);assert.equal(f.stats().money.finesPaid,300);
});

test('lifetime statistics survive Prestige, include discounted case payments, and reset with an administrative economy reset',async t=>{
 const f=await fixture(t),offer=f.quote().cases[0],box=f.accounts.buyCase(f.user,f.catalog,offer.id,'stats-before-prestige-case-001',f.quote().revision);f.accounts.openSealedCase(f.user,box.id);
 // Snapshot must happen in Prestige even if this player never opened Statistics.
 prestigeAccount(f.dir,f.user,{buffId:'cases',expectedCount:0,confirmation:'PRESTIGE',requestId:'stats-prestige-reset-001'},{now});
 let s=f.stats();assert.equal(s.cases.opened,1);assert.equal(s.community.prestiges,1);assert.equal(s.cases.cost,offer.cost);assert.equal(s.money.spent,offer.cost);assert.equal(f.accounts.profile(f.user).itemCount,0);
 const cheap=quoteCaseStore(f.catalog,f.accounts.db(db=>marketIndexes(db,now)),{caseDiscountPercent:50});f.accounts.buyCase(f.user,f.catalog,offer.id,'stats-after-prestige-case-001',cheap.revision);
 s=f.stats();assert.equal(s.cases.cost,offer.cost+cheap.cases[0].cost);assert.equal(s.cases.opened,1);assert.equal(s.cases.bought,2);
 closeDataStore(f.dir);assert.equal(f.stats().money.spent,s.money.spent);
 f.accounts.resetEconomy(f.user,'RESET ECONOMY');assert.equal(f.stats().cases.opened,0);assert.equal(f.stats().money.spent,0);
});

test('palette payment and reveal totals are distinct; unopened private outcomes never enter statistics',async t=>{
 const f=await fixture(t),offer=stockPaletteAuctionCatalog(f.dir,{now}).offers.find(offer=>offer.category==='wine'),lot=createStockPaletteAuction(f.dir,{offerId:offer.id,requestId:'stats-primary-palette-001'},{now});
 bidOnPaletteAuction(f.dir,f.user,lot.id,lot.reserve,{now});assert.equal(f.stats().money.spent,0);assert.equal(f.stats().trading.palettesOpened,0);
 settlePaletteAuction(f.dir,lot.id,{now:lot.endsAt+1});assert.equal(f.stats().money.spent,lot.reserve);assert.equal(f.stats().trading.auctionWins,1);assert.equal(f.stats().trading.paletteItems,0);
 const opened=getPaletteAuctionRewards(f.dir,f.user,lot.id,{now:lot.endsAt+1});getPaletteAuctionRewards(f.dir,f.user,lot.id,{now:lot.endsAt+1});
 assert.equal(f.stats().trading.palettesOpened,1);assert.equal(f.stats().trading.paletteItems,opened.rewards.reduce((sum,row)=>sum+row.quantity,0));
 assert.equal(f.stats().money.spent,lot.reserve);assert.equal(f.stats().money.earned,0);
});

test('Statistics HTTP is private to the session actor and fresh bans or temporary passwords block access',async t=>{
 const f=await fixture(t),{createServer}=await import('node:http'),{createAccountApi}=await import('../src/account-api.mjs');
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};const api=await createAccountApi({dataDir:f.dir,json,env:{COOKIE_SECURE:'false'},dailyPayload:async()=>({auctions:[]})});
 const server=createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost')))json(res,404,{error:'not_found'});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,token=f.accounts.atomic(db=>f.accounts.session(db,f.user.id)),headers={cookie:'jg_session='+token};
 assert.equal((await fetch(base+'/api/account/statistics')).status,401);let response=await fetch(base+'/api/account/statistics?userId=other',{headers});assert.equal(response.status,200);assert.equal((await response.json()).userId,f.user.id);
 f.accounts.db(db=>db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(f.user.id));assert.equal((await fetch(base+'/api/account/statistics',{headers})).status,403);
 f.accounts.db(db=>db.prepare('UPDATE users SET must_change_password=0,banned=1 WHERE id=?').run(f.user.id));assert.equal((await fetch(base+'/api/account/statistics',{headers})).status,401);
 assert.throws(()=>f.stats(),/login_required/);
});

test('older stored revenue is backfilled without inventing missing costs, and later reads do not duplicate sales',async t=>{
 const f=await fixture(t),shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop;
 f.accounts.db(db=>db.prepare('UPDATE businesses SET revenue=450,sales=3,visitors=18,opening_cost=NULL WHERE id=?').run(shop.id));
 const s=f.stats();assert.equal(s.money.earned,450);assert.equal(s.trading.itemsSold,3);assert.equal(s.stores.visitors,18);assert.equal(s.money.spent,0);assert.equal(s.stores.unknownCosts,1);assert.equal(s.trading.unknownCosts,3);assert.equal(s.trading.profit,0);
 assert.equal(f.stats().money.earned,450);
});

test('retired case history is attributed to its opener, never to the creator who sold an unopened case',async t=>{
 const f=await fixture(t),offer=f.quote().cases[0],box=f.accounts.buyCase(f.user,f.catalog,offer.id,'stats-old-case-origin-001',f.quote().revision);
 const sale=listItem(f.dir,f.user,{inventoryId:box.id,startPrice:100,endsAt:new Date(now+60000).toISOString()},{now});placeBid(f.dir,f.other,sale.id,100,{now});settleAuction(f.dir,sale.id,{now:now+60001});
 const find=f.accounts.openSealedCase(f.other,box.id);
 // Simulate a reset predating lifetime tracking: receipts survive, owner rows retire.
 f.accounts.db(db=>{db.prepare("INSERT INTO users(id,username,password_hash,npc,tokens,created_at) VALUES('npc-prestige-retired','Retired Assets','disabled',1,0,?)").run(now);db.prepare("UPDATE inventory SET user_id='npc-prestige-retired' WHERE user_id=?").run(f.other.id);db.prepare('DELETE FROM item_acquisitions WHERE user_id=?').run(f.other.id);});
 assert.equal(f.stats().cases.opened,0);const opened=userStatistics(f.dir,f.other,{now});assert.equal(opened.cases.opened,1);assert.equal(opened.cases.value,Math.round(find.price));assert.equal(opened.cases.openedCost,100);
 assert.equal(f.stats().cases.value,0);assert.equal(userStatistics(f.dir,f.other,{now}).cases.opened,1);
});
