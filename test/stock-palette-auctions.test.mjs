import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { createStockPaletteAuction, supplyStockPaletteAuctions, stockPaletteAuctionCatalog } from '../src/stock-palette-auctions.mjs';
import { stockPaletteCatalog, buyStockPalette } from '../src/stock-palettes.mjs';
import { bidOnPaletteAuction, getPaletteAuction, getPaletteAuctionRewards, listPaletteAuctions, paletteAuctionsByUser, settleDuePaletteAuctions, settlePaletteAuction, sealedPaletteInventoryIds } from '../src/palette-auctions.mjs';
import { currentNetWorth } from '../src/net-worth.mjs';
import { upgradeSkill } from '../src/skill-tree.mjs';
import { luckWeights } from '../src/skill-effects.mjs';
import { tickEconomy } from '../src/economy-runtime.mjs';
import { paletteBidCeiling } from '../src/npc-buyers.mjs';
import { MYSTERY_QUANTITIES, quantityOdds, expectedQuantity, referenceQuantityOdds } from '../src/mystery-stock.mjs';
import { imposeFine } from '../src/justice.mjs';
import { expectedItemValue } from '../src/economy-balance.mjs';
const now=Date.parse('2026-10-12T12:00:00Z'),hour=3600000;
async function fixture(t){
 const dir=await mkdtemp('/tmp/jg-stock-auctions-'),accounts=new Accounts(dir,{now:()=>now});
 accounts.db(db=>{for(const id of ['buyer','other','admin'])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at,admin) VALUES(?,?,'disabled',1000000,36100,?,?)").run(id,id,now,Number(id==='admin'));});
 const wine=['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'].map((name,index)=>({id:84000+index,title:name+' Wine',category:'Getränke',image:'/assets/makita.jpg',finalPrice:10*(index+1)**2}));upsertAuctions(dir,wine);
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 const buyer={id:'buyer'},other={id:'other'},balance=id=>accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(id).tokens);
 return {dir,accounts,buyer,other,balance};
}
const create=(f,offerId='wine-standard',requestId='stock-palette-auction-001',options={})=>createStockPaletteAuction(f.dir,{offerId,requestId},{now,...options});

test('new stock palettes cannot be instantly purchased; catalog explicitly specifies bidding',async t=>{
 const f=await fixture(t),catalog=stockPaletteAuctionCatalog(f.dir,{now});assert.ok(catalog.offers.every(o=>o.purchasable===false&&o.acquisitionMode==='auction'));
 assert.throws(()=>buyStockPalette(f.dir,f.buyer,{offerId:'wine-budget',requestId:'direct-purchase-blocked-001',revision:catalog.revision},{now}),{message:'palette_auction_only',status:410});assert.equal(f.balance('buyer'),1000000);
});
test('the normal board maintains cheap and premium category lots, staggered ends and restart-safe renewal',async t=>{
 const f=await fixture(t),catalog=stockPaletteAuctionCatalog(f.dir,{now}),first=supplyStockPaletteAuctions(f.dir,{now});assert.equal(first.auctions.length,catalog.offers.length);
 const board=listPaletteAuctions(f.dir,{now});assert.equal(new Set(board.map(a=>a.endsAt)).size,board.length);assert.ok(board.every(a=>a.stockOffer&&!('quantity' in a)&&!('quantity' in a.stockOffer)));
 assert.deepEqual(new Set(board.map(a=>a.stockOffer.id)),new Set(catalog.offers.map(o=>o.id)));
 assert.ok(board.find(a=>a.stockOffer.id==='wine-budget').reserve<board.find(a=>a.stockOffer.id==='wine-premium').reserve);
 const current=board.find(lot=>lot.stockOffer.id==='wine-budget');
 const staleScheduler=createStockPaletteAuction(f.dir,{offerId:'wine-budget',requestId:'stale-scheduler-request-001'},{now:now+1,automaticSupply:true});assert.equal(staleScheduler.id,current.id);assert.equal(listPaletteAuctions(f.dir,{now}).length,board.length);
 assert.equal(supplyStockPaletteAuctions(f.dir,{now}).auctions.length,0);assert.equal(listPaletteAuctions(f.dir,{now}).length,board.length);
 const ends=board[0].endsAt;supplyStockPaletteAuctions(f.dir,{now:ends});const replaced=listPaletteAuctions(f.dir,{now:ends});assert.equal(replaced.length,board.length);assert.ok(!replaced.some(lot=>lot.id===board[0].id));
 const midnight=Date.parse('2026-10-12T23:55:00Z'),late=createStockPaletteAuction(f.dir,{offerId:'wine-budget',requestId:'midnight-crossing-palette-001'},{now:midnight});assert.equal(late.endsAt,midnight+hour);
 const runtime=tickEconomy(f.dir,{now:now+hour,flags:{palettes:true,paletteAuctions:true}});assert.deepEqual(runtime.failures,[]);assert.equal(listPaletteAuctions(f.dir,{now:now+hour}).length,catalog.offers.length+1);
});
test('escrow, outbid refunds, proxy remainder and first-opening inventory transfer are exact and atomic',async t=>{
 const f=await fixture(t),lot=create(f,'wine-premium'),max=lot.reserve+1000;
 const first=bidOnPaletteAuction(f.dir,f.buyer,lot.id,max,{now});assert.equal(first.currentBid,lot.reserve);assert.equal(f.balance('buyer'),1000000-max);
 const next=bidOnPaletteAuction(f.dir,f.other,lot.id,max+500,{now});assert.equal(f.balance('buyer'),1000000);assert.equal(f.balance('other'),1000000-max-500);
 assert.throws(()=>getPaletteAuctionRewards(f.dir,f.other,lot.id,{now}),/rewards_unavailable/);
 const settled=settlePaletteAuction(f.dir,lot.id,{now:now+hour});assert.equal(settled.winnerId,'other');assert.equal(f.balance('other'),1000000-settled.currentBid);
 assert.equal(f.accounts.inventory(f.other).length,0);assert.equal(f.accounts.db(db=>sealedPaletteInventoryIds(db).size),0);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM inventory').get().n),0);
 const wealth=f.accounts.db(db=>currentNetWorth(db,'other',{now:now+hour}));assert.equal(wealth.items,0);assert.equal(wealth.sealedPalettes,settled.currentBid);assert.equal(wealth.total,1000000);
 assert.equal(paletteAuctionsByUser(f.dir,f.other,{now:now+hour})[0].revealAvailable,true);
 assert.throws(()=>getPaletteAuctionRewards(f.dir,{id:'admin'},lot.id,{now:now+hour}),/palette_rewards_not_found/);
 const reveal=getPaletteAuctionRewards(f.dir,f.other,lot.id,{now:now+hour,random:max=>max-1});assert.equal(reveal.rewards.reduce((sum,r)=>sum+r.quantity,0),288);assert.equal(reveal.rewards.length,3);
 assert.ok(reveal.rewards.every(r=>r.item.marketCategory==='wine'));assert.equal(f.accounts.inventory(f.other).length,288);
 assert.equal(f.accounts.db(db=>db.prepare("SELECT sum(cost) value FROM item_acquisitions WHERE user_id='other'").get().value),settled.currentBid);
 assert.deepEqual(getPaletteAuctionRewards(f.dir,f.other,lot.id,{now:now+hour+10000}),reveal);settlePaletteAuction(f.dir,lot.id,{now:now+hour+10000});assert.equal(f.accounts.inventory(f.other).length,288);
});
test('public auction/catalog/admin reads contain only odds, with no source items, known total or pre-drawn outcome',async t=>{
 const f=await fixture(t),lot=create(f),saved=f.accounts.db(db=>db.prepare('SELECT * FROM primary_palette_mystery_stock WHERE auction_id=?').get(lot.id));
 assert.equal(saved.rewards,null);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM primary_palette_stock_units').get().n),0);
 for(const view of [lot,getPaletteAuction(f.dir,lot.id,{now}),listPaletteAuctions(f.dir,{now}),stockPaletteAuctionCatalog(f.dir,{now})]){
  const body=JSON.stringify(view);assert.doesNotMatch(body,/Riesling|Merlot|byLuck|inventoryIds|"draws"|"rewards"|expectedQuantity|referenceValue/);
 }
 assert.deepEqual(lot.items,[]);assert.equal('quantity' in lot,false);assert.equal('quantity' in lot.stockOffer,false);
 assert.equal(create(f,'wine-standard').id,lot.id);assert.throws(()=>create(f,'wine-budget'),/request_conflict/);
});
test('first-opening failure rolls back all units, saved result and reveal stamp; retry mints once without another payment',async t=>{
 const f=await fixture(t),lot=create(f);bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve+1000,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});const balance=f.balance('buyer');
 f.accounts.db(db=>db.exec("CREATE TRIGGER fail_stock_mint BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT,'mint_failed'); END"));
 assert.throws(()=>getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour}),/mint_failed/);assert.equal(f.balance('buyer'),balance);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM inventory').get().n),0);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT revealed_at FROM primary_palette_auctions WHERE id=?').get(lot.id).revealed_at),null);assert.equal(f.accounts.db(db=>db.prepare('SELECT rewards FROM primary_palette_mystery_stock WHERE auction_id=?').get(lot.id).rewards),null);
 f.accounts.db(db=>db.exec('DROP TRIGGER fail_stock_mint'));const result=getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour,random:()=>0});assert.equal(f.accounts.inventory(f.buyer).length,3);assert.equal(f.balance('buyer'),balance);
 assert.deepEqual(getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour+1,random:()=>{throw Error('reroll');}}),result);
});
test('opening-time Luck improves rarity and quantity odds, including upgrades after winning, then freezes the result',async t=>{
 const f=await fixture(t),lot=create(f);bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});
 assert.equal(f.accounts.db(db=>db.prepare('SELECT rewards FROM primary_palette_mystery_stock WHERE auction_id=?').get(lot.id).rewards),null);
 for(let rank=1;rank<=3;rank++)upgradeSkill(f.dir,f.buyer,{skillId:'luck',rank,requestId:`auction-luck-${rank}-request-001`},{now:now+hour});
 const maxima=[],reveal=getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour,random:max=>{maxima.push(max);return Math.floor(max*.215);}});
 assert.equal(reveal.offer.luckPercent,7);assert.deepEqual(reveal.offer.weights,luckWeights(lot.stockOffer.weights,7));assert.deepEqual(reveal.offer.quantityOdds,quantityOdds('standard',7));assert.equal(reveal.offer.quantity,9);assert.equal(reveal.offer.cost,lot.reserve);
 assert.ok(maxima.includes(reveal.offer.weights.reduce((a,b)=>a+b,0)));assert.ok(maxima.includes(reveal.offer.quantityOdds.reduce((sum,entry)=>sum+entry.weight,0)));
 f.accounts.db(db=>db.prepare("UPDATE user_skills SET rank=1 WHERE user_id='buyer' AND skill_id='luck'").run());assert.deepEqual(getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour+1000,random:()=>{throw Error('reroll');}}),reveal);
 const offer=f.accounts.db(db=>JSON.parse(db.prepare('SELECT offer FROM primary_palette_mystery_stock WHERE auction_id=?').get(lot.id).offer));
 const npc={id:'npc',categories:['wine'],willingness:1},ceiling=paletteBidCeiling({...lot,items:offer.items,stockOffer:offer},{wine:100},npc,lot.id,()=>.5),ev=expectedItemValue(offer.items,offer.weights)*offer.bidReferenceQuantity;assert.equal(ceiling.maxBid,Math.floor(ev*.81));
});
test('every price tier permits small hauls and jackpots; improved odds and Luck retain their separate balance bounds',async t=>{
 const f=await fixture(t);
 for(const [tier,choices] of Object.entries(MYSTERY_QUANTITIES)){
  const low=create(f,'wine-'+tier,'small-haul-'+tier+'-request'),high=create(f,'wine-'+tier,'jackpot-haul-'+tier+'-request');
  for(const lot of [low,high]){bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});}
  const small=getPaletteAuctionRewards(f.dir,f.buyer,low.id,{now:now+hour,random:()=>0}),jackpot=getPaletteAuctionRewards(f.dir,f.buyer,high.id,{now:now+hour,random:max=>max-1});
  assert.equal(small.offer.quantity,3);assert.equal(jackpot.offer.quantity,3*choices.at(-1)[0]);assert.ok(small.rewards.every(reward=>reward.item.rarity==='common'));assert.ok(jackpot.rewards.every(reward=>reward.item.rarity==='legendary'));
  const offer=f.accounts.db(db=>JSON.parse(db.prepare('SELECT offer FROM primary_palette_mystery_stock WHERE auction_id=?').get(low.id).offer));
  for(const bonus of [0,3,5,7]){
   const lucky=expectedItemValue(offer.items,luckWeights(offer.weights,bonus),item=>item.referenceValue)*expectedQuantity(quantityOdds(tier,bonus));
   assert.ok(lucky<=offer.expectedMarket*(1+bonus/100)**2+1e-8);
   const boostRatio=expectedQuantity(quantityOdds(tier))/expectedQuantity(referenceQuantityOdds(tier));
   assert.ok(lucky/low.reserve<=.82*boostRatio*(1+bonus/100)**2+1e-8);
  }
 }
});
test('unopened won mystery palettes are seized at paid cost without rolling contents or falsely jailing their owner',async t=>{
 const f=await fixture(t),lot=create(f);bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});
 f.accounts.db(db=>db.prepare("UPDATE users SET tokens=0 WHERE id='buyer'").run());const fine=Math.floor(lot.reserve/2),result=f.accounts.atomic(db=>imposeFine(db,'buyer',fine,now+hour));
 assert.equal(result.seized[0].id,lot.id);assert.equal(result.remainingFine,0);assert.equal(result.jailedUntil,0);assert.equal(f.balance('buyer'),lot.reserve-fine);assert.equal(f.accounts.inventory(f.buyer).length,0);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT rewards FROM primary_palette_mystery_stock WHERE auction_id=?').get(lot.id).rewards),null);
 assert.throws(()=>getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour}),/palette_rewards_not_found/);assert.equal(f.accounts.db(db=>currentNetWorth(db,'buyer',{now:now+hour})).sealedPalettes,0);
});
test('unbid lots create no inventory and release reserved stock; economy reset clears all stock auction state',async t=>{
 const f=await fixture(t),lot=create(f);assert.equal(settleDuePaletteAuctions(f.dir,{now:now+hour}).settled,1);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM primary_palette_stock_units').get().n),0);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM primary_palette_stock_draws').get().n),0);assert.equal(f.accounts.inventory(f.buyer).length,0);
 const bought=create(f,'wine-budget','reset-stock-auction-001');bidOnPaletteAuction(f.dir,f.buyer,bought.id,bought.reserve,{now});f.accounts.resetEconomy({id:'admin',admin:true},'RESET ECONOMY');
 for(const table of ['primary_palette_mystery_stock','primary_palette_stock_units','primary_palette_stock_draws','primary_palette_auctions'])assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM '+table).get().n),0);
});


test('legacy fixed-size lots with bids retain frozen rewards while unbid old lots are replaced',async t=>{
 const f=await fixture(t),catalog=stockPaletteCatalog(f.dir,{now});
 const legacy=(offerId,requestId)=>{
  const lot=create(f,offerId,requestId),offer=catalog.offers.find(entry=>entry.id===offerId),item=offer.items[0],amounts=[offer.quantity/3,offer.quantity/3,offer.quantity/3];
  f.accounts.db(db=>{
   const snapshot={...lot,items:offer.items,stockOffer:offer,name:offer.quantity+'× Wine palette',nameDe:offer.quantity+'× Wein-Palette'};
   db.prepare('UPDATE primary_palette_auctions SET public_snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot),lot.id);
   db.prepare('DELETE FROM primary_palette_mystery_stock WHERE auction_id=?').run(lot.id);
   const draws=amounts.map((quantity,position)=>{for(let n=0;n<quantity;n++)db.prepare('INSERT INTO primary_palette_stock_units VALUES (?,?,?)').run(lot.id,position,randomUUID());return {quantity,byLuck:Object.fromEntries([0,3,5,7].map(bonus=>[bonus,item]))};});
   db.prepare('INSERT INTO primary_palette_stock_draws VALUES (?,?,NULL)').run(lot.id,JSON.stringify(draws));
  });return lot;
 };
 const won=legacy('wine-standard','legacy-backed-stock-lot-001'),unbid=legacy('wine-budget','legacy-unbid-stock-lot-001');bidOnPaletteAuction(f.dir,f.buyer,won.id,won.reserve,{now});const balance=f.balance('buyer');
 supplyStockPaletteAuctions(f.dir,{now});assert.equal(f.balance('buyer'),balance);assert.equal(getPaletteAuction(f.dir,unbid.id,{now}).status,'ended');assert.equal(getPaletteAuction(f.dir,won.id,{now}).status,'active');
 settlePaletteAuction(f.dir,won.id,{now:now+hour});assert.equal(f.accounts.db(db=>sealedPaletteInventoryIds(db).size),24);const reveal=getPaletteAuctionRewards(f.dir,f.buyer,won.id,{now:now+hour});assert.equal(reveal.rewards.reduce((sum,reward)=>sum+reward.quantity,0),24);assert.equal(f.accounts.inventory(f.buyer).length,24);
});
test('opening rejects banned, temporary-password and jailed winners without drawing or creating inventory',async t=>{
 const f=await fixture(t),lot=create(f);bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});
 for(const [statement,message] of [["banned=1",'account_banned'],["banned=0,must_change_password=1",'password_change_required']]){
  f.accounts.db(db=>db.prepare("UPDATE users SET "+statement+" WHERE id='buyer'").run());assert.throws(()=>getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour,random:()=>{throw Error('draw_forbidden');}}),{message});
 }
 f.accounts.db(db=>{db.prepare("UPDATE users SET must_change_password=0 WHERE id='buyer'").run();db.prepare("INSERT INTO player_justice(user_id,jailed_until) VALUES('buyer',?)").run(now+hour+10000);});
 assert.throws(()=>getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour,random:()=>{throw Error('draw_forbidden');}}),/player_jailed/);assert.equal(f.accounts.inventory(f.buyer).length,0);assert.equal(f.accounts.db(db=>db.prepare('SELECT revealed_at FROM primary_palette_auctions WHERE id=?').get(lot.id).revealed_at),null);
});


test('opening honors frozen per-lot quantity odds rather than the current global tier table',async t=>{
 const f=await fixture(t),lot=create(f);
 // An older chance structure retained by its price snapshot.
 f.accounts.db(db=>{const row=db.prepare('SELECT offer FROM primary_palette_mystery_stock WHERE auction_id=?').get(lot.id),offer=JSON.parse(row.offer);offer.quantityOdds=[{quantity:2,weight:9500,percent:95},{quantity:7,weight:500,percent:5}];db.prepare('UPDATE primary_palette_mystery_stock SET offer=? WHERE auction_id=?').run(JSON.stringify(offer),lot.id);});
 bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});const reveal=getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour,random:max=>max-1});
 assert.equal(reveal.offer.quantity,21);assert.deepEqual(reveal.offer.quantityOdds.map(choice=>choice.quantity),[2,7]);
});

test('pre-buff auctions keep their quoted odds, NPC budget and opening while new auctions use improved quantities',async t=>{
 const f=await fixture(t),old=create(f,'wine-budget','pre-buff-stock-auction-001');
 const saved=f.accounts.db(db=>JSON.parse(db.prepare('SELECT offer FROM primary_palette_mystery_stock WHERE auction_id=?').get(old.id).offer));
 saved.quantityOdds=referenceQuantityOdds('budget');saved.expectedQuantity=expectedQuantity(saved.quantityOdds);delete saved.bidReferenceQuantity;
 saved.expectedMarket=expectedItemValue(saved.items,saved.weights,item=>item.referenceValue)*saved.expectedQuantity;
 f.accounts.db(db=>{
  db.prepare('UPDATE primary_palette_mystery_stock SET offer=? WHERE auction_id=?').run(JSON.stringify(saved),old.id);
  const snapshot=JSON.parse(db.prepare('SELECT public_snapshot_json FROM primary_palette_auctions WHERE id=?').get(old.id).public_snapshot_json);
  snapshot.stockOffer={...snapshot.stockOffer,quantityOdds:saved.quantityOdds};
  db.prepare('UPDATE primary_palette_auctions SET public_snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot),old.id);
 });
 const before=getPaletteAuction(f.dir,old.id,{now}),fresh=create(f,'wine-budget','post-buff-stock-auction-001');
 assert.equal(fresh.reserve,old.reserve);
 const retried=create(f,'wine-budget','pre-buff-stock-auction-001');
 assert.equal(retried.id,before.id);assert.equal(retried.reserve,before.reserve);assert.deepEqual(retried.stockOffer,before.stockOffer);
 assert.deepEqual(getPaletteAuction(f.dir,old.id,{now}),before);
 assert.notDeepEqual(fresh.stockOffer.quantityOdds,before.stockOffer.quantityOdds);
 for(const lot of [old,fresh]){
  bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});
 }
 const draw=max=>Math.floor(max*.53);
 const oldOpen=getPaletteAuctionRewards(f.dir,f.buyer,old.id,{now:now+hour,random:draw});
 const newOpen=getPaletteAuctionRewards(f.dir,f.buyer,fresh.id,{now:now+hour,random:draw});
 assert.equal(oldOpen.offer.quantity,3);assert.equal(newOpen.offer.quantity,6);
 assert.deepEqual(getPaletteAuctionRewards(f.dir,f.buyer,old.id,{now:now+hour,random:()=>{throw Error('rerolled');}}),oldOpen);
});
