import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { createStockPaletteAuction, supplyStockPaletteAuctions } from '../src/stock-palette-auctions.mjs';
import { stockPaletteCatalog, buyStockPalette } from '../src/stock-palettes.mjs';
import { bidOnPaletteAuction, getPaletteAuction, getPaletteAuctionRewards, listPaletteAuctions, paletteAuctionsByUser, settleDuePaletteAuctions, settlePaletteAuction, sealedPaletteInventoryIds } from '../src/palette-auctions.mjs';
import { currentNetWorth } from '../src/net-worth.mjs';
import { upgradeSkill } from '../src/skill-tree.mjs';
import { luckWeights } from '../src/skill-effects.mjs';
import { tickEconomy } from '../src/economy-runtime.mjs';
import { paletteBidCeiling } from '../src/npc-buyers.mjs';
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
 const f=await fixture(t),catalog=stockPaletteCatalog(f.dir,{now});assert.ok(catalog.offers.every(o=>o.purchasable===false&&o.acquisitionMode==='auction'));
 assert.throws(()=>buyStockPalette(f.dir,f.buyer,{offerId:'wine-budget',requestId:'direct-purchase-blocked-001',revision:catalog.revision},{now}),{message:'palette_auction_only',status:410});assert.equal(f.balance('buyer'),1000000);
});
test('the normal board maintains cheap and premium category lots, staggered ends and restart-safe renewal',async t=>{
 const f=await fixture(t),catalog=stockPaletteCatalog(f.dir,{now}),first=supplyStockPaletteAuctions(f.dir,{now});assert.equal(first.auctions.length,catalog.offers.length);
 const board=listPaletteAuctions(f.dir,{now});assert.equal(new Set(board.map(a=>a.endsAt)).size,board.length);assert.ok(board.every(a=>a.stockOffer&&a.quantity===a.stockOffer.quantity));
 assert.deepEqual(new Set(board.map(a=>a.stockOffer.id)),new Set(catalog.offers.map(o=>o.id)));
 assert.ok(board.find(a=>a.stockOffer.id==='wine-budget').reserve<board.find(a=>a.stockOffer.id==='wine-premium').reserve);
 const current=board.find(lot=>lot.stockOffer.id==='wine-budget');
 const staleScheduler=createStockPaletteAuction(f.dir,{offerId:'wine-budget',requestId:'stale-scheduler-request-001'},{now:now+1,automaticSupply:true});assert.equal(staleScheduler.id,current.id);assert.equal(listPaletteAuctions(f.dir,{now}).length,board.length);
 assert.equal(supplyStockPaletteAuctions(f.dir,{now}).auctions.length,0);assert.equal(listPaletteAuctions(f.dir,{now}).length,board.length);
 const ends=board[0].endsAt;supplyStockPaletteAuctions(f.dir,{now:ends});const replaced=listPaletteAuctions(f.dir,{now:ends});assert.equal(replaced.length,board.length);assert.ok(!replaced.some(lot=>lot.id===board[0].id));
 const midnight=Date.parse('2026-10-12T23:55:00Z'),late=createStockPaletteAuction(f.dir,{offerId:'wine-budget',requestId:'midnight-crossing-palette-001'},{now:midnight});assert.equal(late.endsAt,midnight+hour);
 const runtime=tickEconomy(f.dir,{now:now+hour,flags:{palettes:true,paletteAuctions:true}});assert.deepEqual(runtime.failures,[]);assert.equal(listPaletteAuctions(f.dir,{now:now+hour}).length,catalog.offers.length+1);
});
test('escrow, outbid refunds, proxy remainder and sealed inventory transfer are exact and atomic',async t=>{
 const f=await fixture(t),lot=create(f,'wine-premium'),max=lot.reserve+1000;
 const first=bidOnPaletteAuction(f.dir,f.buyer,lot.id,max,{now});assert.equal(first.currentBid,lot.reserve);assert.equal(f.balance('buyer'),1000000-max);
 const next=bidOnPaletteAuction(f.dir,f.other,lot.id,max+500,{now});assert.equal(f.balance('buyer'),1000000);assert.equal(f.balance('other'),1000000-max-500);
 assert.throws(()=>getPaletteAuctionRewards(f.dir,f.other,lot.id,{now}),/rewards_unavailable/);
 const settled=settlePaletteAuction(f.dir,lot.id,{now:now+hour});assert.equal(settled.winnerId,'other');assert.equal(f.balance('other'),1000000-settled.currentBid);
 assert.equal(f.accounts.inventory(f.other).length,0);assert.equal(f.accounts.db(db=>sealedPaletteInventoryIds(db).size),72);
 const wealth=f.accounts.db(db=>currentNetWorth(db,'other',{now:now+hour}));assert.equal(wealth.items,0);assert.equal(wealth.sealedPalettes,settled.currentBid);assert.equal(wealth.total,1000000);
 assert.equal(paletteAuctionsByUser(f.dir,f.other,{now:now+hour})[0].revealAvailable,true);
 assert.throws(()=>getPaletteAuctionRewards(f.dir,{id:'admin'},lot.id,{now:now+hour}),/palette_rewards_not_found/);
 const reveal=getPaletteAuctionRewards(f.dir,f.other,lot.id,{now:now+hour});assert.equal(reveal.rewards.reduce((sum,r)=>sum+r.quantity,0),72);assert.equal(reveal.rewards.length,3);
 assert.ok(reveal.rewards.every(r=>r.item.marketCategory==='wine'));assert.equal(f.accounts.inventory(f.other).length,72);
 assert.equal(f.accounts.db(db=>db.prepare("SELECT sum(cost) value FROM item_acquisitions WHERE user_id='other'").get().value),settled.currentBid);
 assert.deepEqual(getPaletteAuctionRewards(f.dir,f.other,lot.id,{now:now+hour+10000}),reveal);settlePaletteAuction(f.dir,lot.id,{now:now+hour+10000});assert.equal(f.accounts.inventory(f.other).length,72);
});
test('public stock auction reads never expose reserved units or any sealed luck variant',async t=>{
 const f=await fixture(t),lot=create(f),ids=f.accounts.db(db=>db.prepare('SELECT inventory_id FROM primary_palette_stock_units WHERE auction_id=?').all(lot.id).map(row=>row.inventory_id));
 for(const view of [lot,getPaletteAuction(f.dir,lot.id,{now}),listPaletteAuctions(f.dir,{now})]){
  const body=JSON.stringify(view);for(const id of ids)assert.ok(!body.includes(id));assert.doesNotMatch(body,/byLuck|inventoryIds|"draws"|"rewards"/);
 }
 assert.equal(create(f,'wine-standard').id,lot.id);assert.throws(()=>create(f,'wine-budget'),/request_conflict/);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM primary_palette_stock_units').get().n),24);
});
test('stock settlement rolls back all units and refunds on any mint failure, then safely retries',async t=>{
 const f=await fixture(t),lot=create(f);bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve+1000,{now});const held=f.balance('buyer');
 f.accounts.db(db=>db.exec("CREATE TRIGGER fail_stock_mint BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT,'mint_failed'); END"));
 assert.throws(()=>settlePaletteAuction(f.dir,lot.id,{now:now+hour}),/mint_failed/);assert.equal(f.balance('buyer'),held);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM inventory').get().n),0);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT settled_at FROM primary_palette_auctions WHERE id=?').get(lot.id).settled_at),null);
 f.accounts.db(db=>db.exec('DROP TRIGGER fail_stock_mint'));settlePaletteAuction(f.dir,lot.id,{now:now+hour});getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour});assert.equal(f.accounts.inventory(f.buyer).length,24);
});
test('winner luck selects an exact pre-frozen variant once, without increasing quantity or changing prices',async t=>{
 const f=await fixture(t),lot=create(f),stored=f.accounts.db(db=>JSON.parse(db.prepare('SELECT draws FROM primary_palette_stock_draws WHERE auction_id=?').get(lot.id).draws));
 for(let rank=1;rank<=3;rank++)upgradeSkill(f.dir,f.buyer,{skillId:'luck',rank,requestId:`auction-luck-${rank}-request-001`},{now});
 bidOnPaletteAuction(f.dir,f.buyer,lot.id,lot.reserve,{now});settlePaletteAuction(f.dir,lot.id,{now:now+hour});const reveal=getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour});
 assert.equal(reveal.offer.luckPercent,7);assert.deepEqual(reveal.offer.weights,luckWeights(lot.stockOffer.weights,7));assert.equal(reveal.offer.quantity,24);assert.equal(reveal.offer.cost,lot.reserve);
 for(const [index,reward] of reveal.rewards.entries()){assert.equal(reward.item.title,stored[index].byLuck['7'].title);assert.equal(reward.quantity,stored[index].quantity);}
 f.accounts.db(db=>db.prepare("UPDATE user_skills SET rank=1 WHERE user_id='buyer' AND skill_id='luck'").run());assert.deepEqual(getPaletteAuctionRewards(f.dir,f.buyer,lot.id,{now:now+hour+1000}),reveal);
 const npc={id:'npc',categories:['wine'],willingness:1},ceiling=paletteBidCeiling(lot,{wine:100},npc,lot.id,()=>.5),ev=expectedItemValue(lot.stockOffer.items,lot.stockOffer.weights)*24;assert.equal(ceiling.maxBid,Math.floor(ev*.81));
});
test('unbid lots create no inventory and release reserved stock; economy reset clears all stock auction state',async t=>{
 const f=await fixture(t),lot=create(f);assert.equal(settleDuePaletteAuctions(f.dir,{now:now+hour}).settled,1);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM primary_palette_stock_units').get().n),0);assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM primary_palette_stock_draws').get().n),0);assert.equal(f.accounts.inventory(f.buyer).length,0);
 const bought=create(f,'wine-budget','reset-stock-auction-001');bidOnPaletteAuction(f.dir,f.buyer,bought.id,bought.reserve,{now});f.accounts.resetEconomy({id:'admin',admin:true},'RESET ECONOMY');
 for(const table of ['primary_palette_stock_units','primary_palette_stock_draws','primary_palette_auctions'])assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM '+table).get().n),0);
});
