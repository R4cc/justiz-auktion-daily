import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { stockPaletteCatalog, buyStockPalette, revealStockPalette, stockPalettesByUser, quantitySplits } from '../src/stock-palettes.mjs';
import { expectedItemValue, ECONOMY_BALANCE } from '../src/economy-balance.mjs';
import { estimatedValueTokens, marketIndexes, setMarketIndex } from '../src/market.mjs';
import { currentNetWorth } from '../src/net-worth.mjs';
import { buyBusiness, stockBusiness, businessDashboard, supplyStockAuctions } from '../src/businesses.mjs';
import { listResales, placeBid, settleDueListings } from '../src/resale.mjs';
import { imposeFine } from '../src/justice.mjs';
import { businessTypeForItem } from '../src/stock-compatibility.mjs';
const now=Date.parse('2026-10-12T12:00:00Z');
const wine=['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'];
export const paletteArchive=wine.map((name,i)=>({id:81000+i,title:name+' Wine',category:'Getränke',finalPrice:10*(i+1)**2,image:'/assets/makita.jpg'}));
async function fixture(t,archive=paletteArchive){
  const dir=await mkdtemp('/tmp/jg-stock-palettes-');upsertAuctions(dir,archive);const accounts=new Accounts(dir,{now:()=>now});
  accounts.db(db=>{for(const id of ['buyer','other'])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',100000000,400,?)").run(id,id,now);});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  return {dir,accounts,user:{id:'buyer'},balance:()=>accounts.db(db=>db.prepare("SELECT tokens FROM users WHERE id='buyer'").get().tokens),count:()=>accounts.db(db=>db.prepare("SELECT count(*) n FROM inventory WHERE user_id='buyer'").get().n)};
}
function buy(f,id='wine-standard',requestId='palette-purchase-request-001',options={}){const catalog=stockPaletteCatalog(f.dir,{now});return buyStockPalette(f.dir,f.user,{offerId:id,revision:catalog.revision,requestId},{now,allowLegacyPurchase:true,...options});}

test('permanent budget and premium stock survive empty archives without fictional products',async t=>{
 const f=await fixture(t,[]);const catalog=stockPaletteCatalog(f.dir,{now});assert.ok(catalog.offers.length>=3);
 for(const category of catalog.categories.filter(entry=>entry.available)){
  const offers=catalog.offers.filter(offer=>offer.category===category.id);assert.deepEqual(offers.map(o=>o.quantity),[6,24,72]);
  assert.ok(offers[0].cost<offers[1].cost&&offers[1].cost<offers[2].cost);
  assert.ok(offers.every(o=>o.items.every(item=>Number.isInteger(item.auctionId)&&item.image)));
 }
 assert.equal(catalog.categories.find(c=>c.id==='wine').available,false);
});
test('starter supply stays available even if collected ids overlap the packaged archive in unsupported categories',async t=>{
 const f=await fixture(t,[1,2,3,4,5].map(id=>({id,title:'Reference Book '+id,category:'Bücher',finalPrice:100,image:'/archive/book.jpg'})));
 const catalog=stockPaletteCatalog(f.dir,{now});assert.ok(catalog.offers.some(offer=>offer.id==='electronics-budget'));assert.ok(catalog.offers.some(offer=>offer.id==='tools-premium'));
});
test('price equals item and quantity expectation and every draw stays in its stock category',async t=>{
 const f=await fixture(t);const catalog=stockPaletteCatalog(f.dir,{now}),indexes=f.accounts.db(db=>marketIndexes(db,now));
 for(const offer of catalog.offers){
  const total=offer.weights.reduce((sum,w)=>sum+w,0);assert.ok(total>0);
  assert.ok(Math.abs(offer.dropChances.reduce((s,c)=>s+c.percent,0)-100)<1e-8);
  const meanQuantity=offer.multiplierChances.reduce((s,c)=>s+c.quantity*c.percent/100,0);assert.ok(Math.abs(meanQuantity-offer.quantity/3)<1e-8);
  const ev=expectedItemValue(offer.items,offer.weights,item=>estimatedValueTokens(item,indexes))*3*meanQuantity;
  assert.ok(Math.abs(ev-offer.expectedMarket)<1e-8);
  assert.equal(offer.cost,Math.ceil(Math.max(ev,expectedItemValue(offer.items,offer.weights)*offer.quantity)/ECONOMY_BALANCE.paidCaseReturn));
  assert.ok(offer.items.every(item=>offer.category!=='wine'||businessTypeForItem(item)==='wine'));
  for(const split of quantitySplits(offer.quantity))assert.equal(split.quantities.reduce((a,b)=>a+b),offer.quantity);
 }
});
test('daily pool is frozen while quote and revision follow the live market',async t=>{
 const f=await fixture(t),first=stockPaletteCatalog(f.dir,{now});
 upsertAuctions(f.dir,[{...paletteArchive[0],finalPrice:90000,title:'Updated archive Wine'}]);
 assert.deepEqual(stockPaletteCatalog(f.dir,{now}).offers,first.offers);
 setMarketIndex(f.dir,'wine',150,{now});const next=stockPaletteCatalog(f.dir,{now});
 assert.deepEqual(next.offers[0].items,first.offers[0].items);assert.notEqual(next.revision,first.revision);assert.ok(next.offers[0].cost>first.offers[0].cost);
 assert.throws(()=>buyStockPalette(f.dir,f.user,{offerId:'wine-standard',revision:first.revision,requestId:'palette-stale-quote-0001'},{now,allowLegacyPurchase:true}),/catalog_changed/);
 assert.equal(f.balance(),100000000);assert.equal(f.count(),0);
});
test('purchase retries do not charge or reroll; only the owner can reveal exactly 72 physical units',async t=>{
 const f=await fixture(t),before=f.balance();let calls=0;
 const purchase=buy(f,'wine-premium','palette-idempotent-00001',{random:max=>{calls++;return max-1;}});
 const storedCalls=calls;assert.equal(f.count(),0);assert.equal(f.balance(),before-purchase.cost);
 assert.equal('rewards' in purchase,false);assert.equal('items' in purchase.offer,false);
 const retried=buy(f,'wine-premium','palette-idempotent-00001',{random:()=>{throw new Error('rerolled');}});
 assert.deepEqual(retried,purchase);assert.equal(calls,storedCalls);assert.equal(f.balance(),before-purchase.cost);
 assert.throws(()=>buy(f,'wine-budget','palette-idempotent-00001'),/request_conflict/);
 assert.deepEqual(stockPalettesByUser(f.dir,f.user,{now}),[purchase]);
 assert.throws(()=>revealStockPalette(f.dir,{id:'other'},purchase.id,{now}),/palette_rewards_not_found/);
 const sealedWorth=f.accounts.db(db=>currentNetWorth(db,f.user.id,{now}));assert.equal(sealedWorth.total,before);assert.equal(sealedWorth.sealedPalettes,purchase.cost);
 const reveal=revealStockPalette(f.dir,f.user,purchase.id,{now});assert.equal(reveal.rewards.length,3);
 assert.equal(reveal.rewards.reduce((sum,r)=>sum+r.quantity,0),72);assert.ok(reveal.rewards.every(r=>r.item.marketCategory==='wine'&&businessTypeForItem(r.item)==='wine'));
 assert.equal(new Set(reveal.rewards.flatMap(r=>r.inventoryIds)).size,72);assert.equal(f.count(),72);
 assert.deepEqual(revealStockPalette(f.dir,f.user,purchase.id,{now}),reveal);assert.equal(f.count(),72);
 const sum=f.accounts.db(db=>db.prepare("SELECT sum(cost) value FROM item_acquisitions WHERE user_id='buyer'").get().value);assert.equal(sum,purchase.cost);
 const worth=f.accounts.db(db=>currentNetWorth(db,'buyer',{now}));assert.equal(worth.sealedPalettes,0);assert.equal(worth.total,worth.cash+worth.items);
 assert.deepEqual(stockPalettesByUser(f.dir,f.user,{now}),[]);
});
test('every multiplier split and rarity tail can actually be drawn with unmodified advertised weights',async t=>{
 const f=await fixture(t);
 for(const [index,roll] of [0,40,85].entries()){
  let draw=0;const purchase=buy(f,'wine-standard',`palette-splits-request-00${index}`,{random:max=>draw++===0?roll:max-1});
  const reveal=revealStockPalette(f.dir,f.user,purchase.id,{now});assert.deepEqual(reveal.rewards.map(r=>r.quantity).sort((a,b)=>a-b),quantitySplits(24)[index].quantities);
  assert.ok(reveal.rewards.every(r=>r.item.rarity==='legendary'));
 }
});
test('unpacked palette units use existing store capacity and inventory locks',async t=>{
 const f=await fixture(t);const purchase=buy(f),reveal=revealStockPalette(f.dir,f.user,purchase.id,{now});
 const shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop,ids=reveal.rewards.flatMap(r=>r.inventoryIds);
 stockBusiness(f.dir,f.user,shop.id,ids.slice(0,shop.capacity),{now});
 assert.equal(businessDashboard(f.dir,f.user,{now}).shops[0].stock.length,shop.capacity);
 assert.throws(()=>stockBusiness(f.dir,f.user,shop.id,[ids[shop.capacity]],{now}),/business_full/);
 assert.equal(f.count(),24);
});
test('new flow retires unbid supplier lots but preserves existing escrow and normal settlement',async t=>{
 const f=await fixture(t);supplyStockAuctions(f.dir,{now,retire:false});const lots=listResales(f.dir,{now});assert.ok(lots.length);
 const lot=lots[0];placeBid(f.dir,f.user,lot.id,lot.startPrice,{now});const balance=f.balance();
 assert.deepEqual(supplyStockAuctions(f.dir,{now}),{supplied:0});const remaining=listResales(f.dir,{now});assert.equal(remaining.length,1);assert.equal(remaining[0].id,lot.id);assert.equal(f.balance(),balance);
 settleDueListings(f.dir,{now:now+2*3600000});assert.equal(f.count(),lot.quantity);assert.equal(f.balance(),balance);
});
test('fines seize sealed palettes at disclosed cost, prevent reveal and pay excess back',async t=>{
 const f=await fixture(t),purchase=buy(f);f.accounts.db(db=>db.prepare("UPDATE users SET tokens=0 WHERE id='buyer'").run());
 const fine=Math.floor(purchase.cost/2),result=f.accounts.atomic(db=>imposeFine(db,'buyer',fine,now));
 assert.equal(result.seized[0].id,purchase.id);assert.equal(result.remainingFine,0);assert.equal(result.jailedUntil,0);assert.equal(f.balance(),purchase.cost-fine);assert.equal(f.count(),0);
 assert.deepEqual(stockPalettesByUser(f.dir,f.user,{now}),[]);assert.throws(()=>revealStockPalette(f.dir,f.user,purchase.id,{now}),/palette_rewards_not_found/);
 assert.equal(f.accounts.db(db=>currentNetWorth(db,'buyer',{now})).sealedPalettes,0);
});
test('purchase and reveal reject banned, temporary-password and jailed players, and reset clears receipts',async t=>{
 const f=await fixture(t),purchase=buy(f);
 for(const [statement,error] of [["banned=1",/login_required/],["banned=0,must_change_password=1",/password_change_required/]]){
  f.accounts.db(db=>db.prepare("UPDATE users SET "+statement+" WHERE id='buyer'").run());
  assert.throws(()=>buy(f,'wine-standard','palette-idempotent-guard'),error);assert.throws(()=>revealStockPalette(f.dir,f.user,purchase.id,{now}),error);
 }
 f.accounts.db(db=>{db.prepare("UPDATE users SET must_change_password=0 WHERE id='buyer'").run();db.prepare("INSERT INTO player_justice(user_id,jailed_until) VALUES('buyer',?)").run(now+10000);});
 assert.throws(()=>buy(f),/player_jailed/);assert.throws(()=>revealStockPalette(f.dir,f.user,purchase.id,{now}),/player_jailed/);
 f.accounts.resetEconomy({id:'other',admin:true},'RESET ECONOMY');
 assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM stock_palette_purchases').get().n),0);
});

test('instant purchase HTTP route is removed; legacy purchases remain owner-only and reveal idempotently',async t=>{
 const {createServer}=await import('node:http');const {createAccountApi}=await import('../src/account-api.mjs');const {createEconomyApi}=await import('../src/economy-api.mjs');
 const f=await fixture(t),flags={palettes:true,market:true,resales:true,businesses:true,paletteAuctions:true};
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const api=await createAccountApi({dataDir:f.dir,json,env:{COOKIE_SECURE:'false'},flags,dailyPayload:async()=>({auctions:[]})});
 const economy=createEconomyApi({dataDir:f.dir,json,flags,accounts:f.accounts});
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;json(res,404,{error:'not_found'});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,tokens=f.accounts.atomic(db=>['buyer','other'].map(id=>f.accounts.session(db,id)));
 const post=(route,payload,token=tokens[0],csrf=true)=>fetch(base+'/api/account/'+route,{method:'POST',headers:{'content-type':'application/json',cookie:token?'jg_session='+token:'',...(csrf?{'x-requested-with':'JUSTIZGUESSR'}:{})},body:JSON.stringify(payload)});
 const catalogue=await(await fetch(base+'/api/stock-palettes')).json(),offer=catalogue.offers.find(entry=>entry.id==='wine-budget');
 const payload={offerId:offer.id,revision:catalogue.revision,requestId:'palette-http-request-001'};
 assert.equal((await post('stock-palettes/buy',payload,'')).status,401);assert.equal((await post('stock-palettes/buy',payload,tokens[0],false)).status,403);
 const response=await post('stock-palettes/buy',payload);assert.equal(response.status,404);const purchase=buyStockPalette(f.dir,f.user,{...payload,revision:stockPaletteCatalog(f.dir).revision},{allowLegacyPurchase:true});
 assert.equal('rewards' in purchase,false);assert.equal((await post('stock-palettes/buy',payload)).status,404);
 assert.equal((await post('stock-palettes/reveal',{id:purchase.id},tokens[1])).status,404);
 assert.equal((await fetch(base+'/api/account/stock-palettes')).status,401);
 assert.equal((await post('stock-palettes/reveal',{id:purchase.id},tokens[0],false)).status,403);
 const revealed=await post('stock-palettes/reveal',{id:purchase.id});assert.equal(revealed.status,200);assert.equal((await revealed.json()).palette.rewards.reduce((sum,r)=>sum+r.quantity,0),6);
 await post('stock-palettes/reveal',{id:purchase.id});assert.equal(f.count(),6);
 flags.palettes=false;assert.equal((await fetch(base+'/api/stock-palettes')).status,404);assert.equal((await post('stock-palettes/buy',payload)).status,404);
 assert.equal((await fetch(base+'/api/account/stock-palettes',{headers:{cookie:'jg_session='+tokens[0]}})).status,404);
});
