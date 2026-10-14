import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { prestigeAccount } from '../src/prestige.mjs';
import { prestigeEffects } from '../src/prestige-effects.mjs';
import { upgradeSkill } from '../src/skill-tree.mjs';
import { acquireItems, salePayout } from '../src/trader.mjs';
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { visitStore, customizeStore, buyStoreItem, startStoreHeist, actStoreHeist, spinStoreHeist, playerCriminalRecord } from '../src/storefronts.mjs';
import { listItem, placeBid, settleAuction, getResale } from '../src/resale.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { marketIndexes } from '../src/market.mjs';
import { skillEffects, luckWeights } from '../src/skill-effects.mjs';
import { stockPaletteAuctionCatalog } from '../src/stock-palette-auctions.mjs';
import { createStockPaletteAuction } from '../src/stock-palette-auctions.mjs';
import { bidOnPaletteAuction, settlePaletteAuction, getPaletteAuctionRewards } from '../src/palette-auctions.mjs';

const now=Date.parse('2026-10-14T12:00:00Z');
async function fixture(t) {
 const dir=await mkdtemp('/tmp/jg-prestige-'),accounts=new Accounts(dir,{now:()=>now,flags:{resales:true}}),user={id:'player'},other={id:'other'};
 accounts.db(db=>{for(const id of [user.id,other.id])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',100000,8100,?)").run(id,id,now);});
 upsertAuctions(dir,['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'].map((title,index)=>({id:93000+index,title:title+' Wine',category:'Getränke',image:'/favicon.png',finalPrice:10*(index+1)**2})));
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 const prestige=(buffId='profit',count=accounts.profile(user).prestige.count,requestId=`prestige-${buffId}-${count}-request-001`)=>prestigeAccount(dir,user,{buffId,expectedCount:count,requestId,confirmation:'PRESTIGE'},{now});
 const item=(id,owner=user,cost=100,kind=null)=>accounts.db(db=>{db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,owner.id,JSON.stringify({title:kind?'Case':'Wine '+id,kind,price:100,marketCategory:'wine',rarity:'common'}),now);acquireItems(db,owner.id,[id],cost,'purchase',now);});
 const level=()=>accounts.db(db=>db.prepare('UPDATE users SET xp=8100 WHERE id=?').run(user.id));
 return {dir,accounts,user,other,prestige,item,level};
}

test('level-ten Prestige resets only the actor, retires assets and plots, preserves friends/session and permanently unlocks one buff',async t=>{
 const f=await fixture(t),shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop;f.item('stock');stockBusiness(f.dir,f.user,shop.id,['stock'],{now});f.item('listed');
 const listing=listItem(f.dir,f.user,{inventoryId:'listed',startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});
 upgradeSkill(f.dir,f.user,{skillId:'luck',rank:1,requestId:'prestige-before-skill-001'},{now});
 const token=f.accounts.atomic(db=>f.accounts.session(db,f.user.id));f.accounts.db(db=>db.prepare("INSERT INTO friendships VALUES('other','player','player',?,1)").run(now));
 f.accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=500 WHERE id=?').run(shop.id));
 const before=f.accounts.profile(f.other),result=f.prestige();
 assert.deepEqual(result.buffs,['profit']);const profile=f.accounts.profile(f.user);
 assert.equal(profile.progression.level,1);assert.equal(profile.tokens,1000);assert.equal(profile.itemCount,0);assert.deepEqual(profile.skills.ranks,{});assert.equal(profile.prestige.profitPercent,25);
 assert.equal(profile.traderMilestones.length,0);assert.equal(businessDashboard(f.dir,f.user,{now}).shops.length,0);
 assert.equal(getResale(f.dir,listing.id,{now}).status,'cancelled');assert.equal(f.accounts.user(token).id,f.user.id);
 assert.equal(f.accounts.profile(f.other).tokens,before.tokens);assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM friendships').get().n),1);
 const newShop=buyBusiness(f.dir,f.other,'wine','popup',{plotId:shop.plotId??shop.location.plotId,now}).shop;assert.equal(newShop.location.plotId,shop.location.plotId);
 closeDataStore(f.dir);assert.equal(f.accounts.profile(f.user).prestige.count,1);assert.equal(f.accounts.profile(f.user).prestige.eligible,false);
});

test('fresh level, once-per-buff guards, expected-cycle and receipt checks prevent forged, repeated or double resets',async t=>{
 const f=await fixture(t);f.accounts.db(db=>db.prepare('UPDATE users SET xp=8099 WHERE id=?').run(f.user.id));assert.throws(()=>f.prestige(),/prestige_level_required/);
 f.level();f.prestige();f.accounts.db(db=>db.prepare('UPDATE users SET tokens=1777 WHERE id=?').run(f.user.id));
 assert.equal(f.prestige('profit',0).count,1);assert.equal(f.accounts.profile(f.user).tokens,1777);
 assert.throws(()=>f.prestige('stealth',0,'prestige-stale-request-001'),/prestige_changed/);
 assert.throws(()=>f.prestige('profit',1),/prestige_buff_owned/);
 assert.throws(()=>f.prestige('stealth',1),/prestige_level_required/);
 for(const [index,buff] of ['stealth','cases','luck'].entries()){f.level();f.prestige(buff,index+1);}
 assert.equal(f.accounts.profile(f.user).prestige.count,4);assert.deepEqual(f.accounts.profile(f.user).prestige.choices,[]);
 assert.equal(f.accounts.profile(f.other).prestige.count,0);
 f.accounts.resetEconomy({id:f.other.id,admin:true},'RESET ECONOMY');assert.equal(f.accounts.profile(f.user).prestige.count,4);assert.equal(f.accounts.profile(f.user).prestige.luckPercent,25);
 assert.throws(()=>prestigeAccount(f.dir,f.user,{buffId:'profit',expectedCount:4,requestId:'invalid-confirmation-001'},{now}),/invalid_prestige_confirmation/);
});

test('active escrow, auctions, theft, jail and debt block resetting and transaction failure restores all progress',async t=>{
 const f=await fixture(t);f.item('sell',f.other);const lot=listItem(f.dir,f.other,{inventoryId:'sell',startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});placeBid(f.dir,f.user,lot.id,200,{now});
 assert.throws(()=>f.prestige(),/prestige_auction_pending/);assert.equal(f.accounts.profile(f.user).heldInBids,200);
 settleAuction(f.dir,lot.id,{now:now+3600001});
 f.accounts.db(db=>db.prepare('INSERT INTO player_justice(user_id,fine_due,jailed_until) VALUES(?,100,?)').run(f.user.id,now+60000));
 assert.throws(()=>f.prestige(),/prestige_justice_pending/);f.accounts.db(db=>db.prepare('DELETE FROM player_justice WHERE user_id=?').run(f.user.id));
 f.accounts.db(db=>db.exec("CREATE TRIGGER reject_prestige BEFORE INSERT ON prestige_receipts BEGIN SELECT RAISE(ABORT,'blocked prestige'); END"));
 const before=f.accounts.profile(f.user);assert.throws(()=>f.prestige(),/blocked prestige/);
 assert.equal(f.accounts.profile(f.user).tokens,before.tokens);assert.equal(f.accounts.profile(f.user).progression.level,before.progression.level);assert.equal(f.accounts.inventory(f.user).length,1);assert.equal(f.accounts.profile(f.user).prestige.count,0);
});

test('profit buff adds 25% of positive tracked profit to player store sales and auctions, with exact-once settlement',async t=>{
 const f=await fixture(t);f.prestige();f.accounts.db(db=>db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(f.user.id));
 const shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop;f.item('store',f.user,100);stockBusiness(f.dir,f.user,shop.id,['store'],{now});
 const payload={shopId:shop.id,inventoryId:'store',expectedPrice:120,requestId:'prestige-store-purchase-001'};
 buyStoreItem(f.dir,f.other,payload,{now});buyStoreItem(f.dir,f.other,payload,{now});
 assert.equal(f.accounts.db(db=>db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(shop.id).cash_balance),125);
 assert.equal(f.accounts.profile(f.other).tokens,99880);
 f.item('auction',f.user,100);const lot=listItem(f.dir,f.user,{inventoryId:'auction',startPrice:200,endsAt:new Date(now+60000).toISOString()},{now});placeBid(f.dir,f.other,lot.id,200,{now});
 const before=f.accounts.profile(f.user).tokens;settleAuction(f.dir,lot.id,{now:now+60001});settleAuction(f.dir,lot.id,{now:now+60001});
 assert.equal(f.accounts.profile(f.user).tokens,before+225);assert.equal(f.accounts.profile(f.user).realizedTradingProfit,150);
 f.item('loss',f.user,100);assert.equal(f.accounts.db(db=>salePayout(db,f.user.id,['loss'],80)),80);
 f.item('batch-up',f.user,100);f.item('batch-down',f.user,300);
 assert.equal(f.accounts.db(db=>salePayout(db,f.user.id,['batch-up','batch-down'],400)),400); // The batch breaks even overall.
});

test('case perk halves all store prices and actual charges, including case-auction settlement; luck stays separate',async t=>{
 const f=await fixture(t);f.prestige('cases');f.accounts.db(db=>db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(f.user.id));
 const catalog=loadCaseStoreCatalog(f.dir,now),indexes=f.accounts.db(db=>marketIndexes(db,now)),normal=quoteCaseStore(catalog,indexes),cheap=quoteCaseStore(catalog,indexes,{caseDiscountPercent:50});
 for(let index=0;index<normal.cases.length;index++)assert.equal(cheap.cases[index].cost,Math.ceil(normal.cases[index].cost/2));
 const before=f.accounts.profile(f.user).tokens,item=f.accounts.buyCase(f.user,catalog,cheap.cases[0].id,'prestige-discount-case-001',cheap.revision);
 assert.equal(before-f.accounts.profile(f.user).tokens,cheap.cases[0].cost);assert.equal(item.caseCost,cheap.cases[0].cost);assert.equal(f.accounts.buyCase(f.user,catalog,cheap.cases[0].id,'prestige-discount-case-001',cheap.revision).id,item.id);
 f.item('case-auction',f.other,40,'case');const lot=listItem(f.dir,f.other,{inventoryId:'case-auction',startPrice:100,endsAt:new Date(now+60000).toISOString()},{now});
 const wallet=f.accounts.profile(f.user).tokens;placeBid(f.dir,f.user,lot.id,100,{now});settleAuction(f.dir,lot.id,{now:now+60001});settleAuction(f.dir,lot.id,{now:now+60001});assert.equal(f.accounts.profile(f.user).tokens,wallet-50);
});

test('luck perk stacks with skills on new case and mystery palette draws without changing existing contents',async t=>{
 const f=await fixture(t);f.prestige('luck');f.level();upgradeSkill(f.dir,f.user,{skillId:'luck',rank:1,requestId:'prestige-luck-skill-001'},{now});
 assert.equal(f.accounts.db(db=>skillEffects(db,f.user.id).luckPercent),28);assert.equal(f.accounts.profile(f.user).skills.luckPercent,28);
 assert.deepEqual(luckWeights([7500,2000,450,49,1],25),[750000,250000,56250,6125,125]);
 assert.throws(()=>luckWeights([1,2],50),/invalid_luck_bonus/);
 f.accounts.db(db=>db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(f.user.id));
 const quote=stockPaletteAuctionCatalog(f.dir,{now,userId:f.user.id}),offer=quote.offers.find(offer=>offer.category==='wine');assert.equal(offer.luckPercent,28);
 const lot=createStockPaletteAuction(f.dir,{offerId:offer.id,requestId:'prestige-lucky-palette-001'},{now});bidOnPaletteAuction(f.dir,f.user,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:lot.endsAt+1});
 const opened=getPaletteAuctionRewards(f.dir,f.user,lot.id,{now:lot.endsAt+1});assert.equal(opened.offer.luckPercent,28);
 assert.deepEqual(getPaletteAuctionRewards(f.dir,f.user,lot.id,{now:lot.endsAt+2}).rewards,opened.rewards);
});

test('stealth reduces caught odds to 22.5%/37.5%, freezes precision through restart and does not change blackjack',async t=>{
 const f=await fixture(t);f.prestige('stealth');const shop=buyBusiness(f.dir,f.other,'wine','popup',{now}).shop;f.item('target',f.other);stockBusiness(f.dir,f.other,shop.id,['target'],{now});
 let entry=visitStore(f.dir,f.user,shop.id,{now}).store.stock[0];assert.equal(entry.theft.policeCatchPercent,22.5);
 customizeStore(f.dir,f.other,{shopId:shop.id,name:'Guarded',motto:'',securityGuard:true,requestId:'prestige-guard-toggle-001'},{now});
 entry=visitStore(f.dir,f.user,shop.id,{now}).store.stock[0];assert.equal(entry.theft.policeCatchPercent,37.5);assert.equal(visitStore(f.dir,null,shop.id,{now}).store.stock[0].theft.policeCatchPercent,50);
 const started=startStoreHeist(f.dir,f.user,{shopId:shop.id,inventoryId:entry.id,expectedPrice:entry.price,expectedFine:entry.theft.fine,expectedPoliceCatchPercent:37.5,requestId:'prestige-stealth-start-001'},{now,draw:max=>max-1});assert.equal(started.heist.policeCatchPercent,37.5);
 f.accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[1,4,5],turn:0,outcome:'active'}),started.id));
 const pending=actStoreHeist(f.dir,f.user,{heistId:started.id,action:'stand',turn:0,requestId:'prestige-stealth-stand-001'},{now,policeDraw:()=>374999});assert.equal(pending.policeWheel.catchPercent,37.5);
 closeDataStore(f.dir);const result=spinStoreHeist(f.dir,f.user,{heistId:started.id,requestId:'prestige-stealth-spin-001'},{now});assert.equal(result.outcome,'caught');assert.equal(result.policeWheel.catchPercent,37.5);
 assert.equal(playerCriminalRecord(f.dir,f.user,{now:now+1}).total,1); // New-cycle crimes remain visible even in the same clock tick.
 f.level();f.prestige('cases');assert.equal(playerCriminalRecord(f.dir,f.user,{now:now+1}).total,0);
});

test('Prestige HTTP requires a human session, CSRF and explicit confirmation; retries do not reset later earnings',async t=>{
 const f=await fixture(t),{createServer}=await import('node:http'),{createAccountApi}=await import('../src/account-api.mjs');
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const api=await createAccountApi({dataDir:f.dir,json,env:{COOKIE_SECURE:'false'},dailyPayload:async()=>({auctions:[]})});
 const server=createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost')))json(res,404,{error:'not_found'});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,token=f.accounts.atomic(db=>f.accounts.session(db,f.user.id)),cookie='jg_session='+token;
 const payload={buffId:'luck',expectedCount:0,requestId:'prestige-http-request-001',confirmation:'PRESTIGE',userId:'other',xp:100000};
 const post=(value=payload,csrf=true,session=cookie)=>fetch(base+'/api/account/prestige',{method:'POST',headers:{'content-type':'application/json',cookie:session,...(csrf?{'x-requested-with':'JUSTIZGUESSR'}:{})},body:JSON.stringify(value)});
 assert.equal((await post(payload,true,'')).status,401);assert.equal((await post(payload,false)).status,403);assert.equal((await post({...payload,confirmation:''})).status,400);
 const result=await(await post()).json();assert.equal(result.user.prestige.count,1);assert.equal(result.user.skills.luckPercent,25);assert.equal(result.user.progression.level,1);assert.equal(result.user.tokens,1000);assert.equal(f.accounts.profile(f.other).prestige.count,0);
 f.accounts.db(db=>db.prepare('UPDATE users SET tokens=1777 WHERE id=?').run(f.user.id));
 const repeated=await(await post()).json();assert.equal(repeated.user.tokens,1777);assert.equal(repeated.user.prestige.count,1);
 assert.equal((await post({...payload,buffId:'cases'})).status,409);
 f.accounts.db(db=>db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(f.user.id));assert.equal((await post()).status,403);
});

test('reset preserves other players purchases and crime history, while clearing the actor record and refusing live theft',async t=>{
 const f=await fixture(t),shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop;f.item('foreign-sale');stockBusiness(f.dir,f.user,shop.id,['foreign-sale'],{now});
 buyStoreItem(f.dir,f.other,{shopId:shop.id,inventoryId:'foreign-sale',expectedPrice:120,requestId:'prestige-foreign-sale-001'},{now});
 f.item('target');stockBusiness(f.dir,f.user,shop.id,['target'],{now});
 const attempt=startStoreHeist(f.dir,f.other,{shopId:shop.id,inventoryId:'target',expectedPrice:120,expectedFine:200,requestId:'prestige-foreign-theft-001'},{now,draw:max=>max-1});
 assert.throws(()=>f.prestige(),/prestige_heist_pending/);
 f.accounts.db(db=>db.prepare("UPDATE store_heists SET status='caught',settled_at=? WHERE id=?").run(now,attempt.id));
 assert.equal(playerCriminalRecord(f.dir,f.other,{now}).total,1);
 f.prestige();assert.equal(playerCriminalRecord(f.dir,f.other,{now}).total,1);
 assert.ok(f.accounts.inventory(f.other).some(item=>item.id==='foreign-sale'));
 assert.equal(f.accounts.db(db=>db.prepare('SELECT cost FROM item_acquisitions WHERE inventory_id=?').get('foreign-sale').cost),120);
 assert.equal(f.accounts.profile(f.user).itemCount,0);assert.throws(()=>visitStore(f.dir,f.other,shop.id,{now}),/business_not_found/);
});

test('profit applies to simulated NPC business sales and sale events without increasing customer prices',async t=>{
 const f=await fixture(t);f.prestige();f.accounts.db(db=>db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(f.user.id));
 const shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop;
 for(let n=0;n<8;n++){f.item('npc-sale-'+n);stockBusiness(f.dir,f.user,shop.id,['npc-sale-'+n],{now});}
 const dashboard=businessDashboard(f.dir,f.user,{now:now+24*3600000});assert.ok(dashboard.shops[0].sales>0);
 const sales=f.accounts.db(db=>db.prepare('SELECT price FROM business_sales WHERE business_id=?').all(shop.id));
 const expected=sales.reduce((sum,sale)=>sum+sale.price+Math.floor(Math.max(0,sale.price-100)*.25),0);
 assert.equal(dashboard.shops[0].cashReady,expected);assert.equal(dashboard.shops[0].revenue,expected);
 const {checkStoreEvents,STORE_EVENTS,STORE_EVENT_INTERVAL}=await import('../src/store-events.mjs');
 const extra=buyBusiness(f.dir,f.user,'wine','popup',{now:now+24*3600000}).shop;f.item('event-sale');stockBusiness(f.dir,f.user,extra.id,['event-sale'],{now:now+24*3600000});
 f.accounts.db(db=>db.prepare('UPDATE businesses SET traffic_popularity=0 WHERE id=?').run(extra.id));
 const saleIndex=STORE_EVENTS.findIndex(event=>event.effect==='sale'),roll=STORE_EVENTS.slice(0,saleIndex).reduce((sum,event)=>sum+event.weight,0);let reads=0;
 checkStoreEvents(f.dir,f.user,{now:now+24*3600000+STORE_EVENT_INTERVAL,random:()=>++reads%2===1?0:roll});
 const rows=f.accounts.db(db=>db.prepare('SELECT proceeds,cost FROM trader_sales WHERE business_id=?').all(extra.id));
 assert.ok(rows.length);assert.ok(rows.every(row=>row.proceeds>=row.cost));
});

test('Daily reward guards survive Prestige; unclaimed old cases and unfinished games cannot restore discarded assets or pay twice',async t=>{
 const f=await fixture(t),{playAnswer}=await import('./helpers/play-answer.mjs');
 const auctions=Array.from({length:5},(_,index)=>({id:index+1,title:'Wine '+index,actualBid:100,image:'/favicon.png',category:'Getränke'}));
 let run=f.accounts.startGame(f.user,'daily',()=>auctions);
 for(let index=0;index<5;index++)run=playAnswer(f.accounts,f.user,run.id,index,100);
 assert.equal(run.dailyCase.status,'ready');f.prestige('luck');
 assert.throws(()=>f.accounts.claimDailyCase(f.user,run.id),/daily_case_already_opened/);
 assert.equal(f.accounts.startGame(f.user,'daily',()=>auctions).id,run.id);
 const before=f.accounts.profile(f.user);playAnswer(f.accounts,f.user,run.id,0,100);
 assert.equal(f.accounts.profile(f.user).tokens,before.tokens);assert.equal(f.accounts.profile(f.user).progression.xp,0);
 assert.equal(f.accounts.profile(f.user).itemCount,0);
 const active=f.accounts.startGame(f.user,'higher-lower',()=>auctions);f.level();f.prestige('cases');
 assert.throws(()=>f.accounts.answer(f.user,active.id,0,true),/game_not_found/);
});

test('unopened mystery palette winnings are discarded by Prestige and cannot mint items afterward',async t=>{
 const f=await fixture(t),offer=stockPaletteAuctionCatalog(f.dir,{now}).offers.find(offer=>offer.category==='wine');
 const lot=createStockPaletteAuction(f.dir,{offerId:offer.id,requestId:'prestige-old-sealed-palette-001'},{now});bidOnPaletteAuction(f.dir,f.user,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:lot.endsAt+1});
 prestigeAccount(f.dir,f.user,{buffId:'luck',expectedCount:0,requestId:'prestige-after-palette-001',confirmation:'PRESTIGE'},{now:lot.endsAt+2});
 assert.throws(()=>getPaletteAuctionRewards(f.dir,f.user,lot.id,{now:lot.endsAt+3}),/palette_rewards_not_found/);
 assert.equal(f.accounts.profile(f.user).itemCount,0);assert.equal(f.accounts.profile(f.user).tokens,1000);
});
