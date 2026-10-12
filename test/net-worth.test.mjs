import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { currentNetWorth, recordNetWorth, netWorthHistory, captureNetWorth } from '../src/net-worth.mjs';
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { listItem, placeBid } from '../src/resale.mjs';
import { setMarketIndex } from '../src/market.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { createPaletteAuction, bidOnPaletteAuction, settleDuePaletteAuctions, getPaletteAuctionRewards } from '../src/palette-auctions.mjs';
const now = Date.parse('2026-10-12T10:00:00Z'), minute = 60000;
async function fixture(t) {
  const dir = await mkdtemp('/tmp/jg-net-worth-'), accounts = new Accounts(dir, { now: () => now });
  upsertAuctions(dir, Array.from({length:72}, (_,n)=>({id:9000+n,title:`Archived find ${n}`,category:['Getränke','Elektronik','Werkzeuge','Sammlerstücke'][n%4],currentBid:10+n,image:'/favicon.png'})));
  const user = { id: 'buyer', admin: true }, seller = { id: 'seller' };
  accounts.db(db => { for (const person of [user,seller]) db.prepare("INSERT INTO users (id,username,password_hash,tokens,xp,created_at) VALUES (?,?,'disabled',100000,36100,?)").run(person.id,person.id,now); });
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const add = (id,price,owner=user,extra={}) => accounts.db(db=>db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id,owner.id,JSON.stringify({title:id,price,marketCategory:'wine',rarity:'common',...extra}),now));
  const worth = () => accounts.db(db=>currentNetWorth(db,user.id,{now}));
  return {dir,accounts,user,seller,add,worth};
}
test('cash, proxy escrow, available/listed/shelved items, cases and property count exactly once',async t=>{
  const f=await fixture(t);f.add('free',100);f.add('listed',200);f.add('stock',300);f.add('case',80,f.user,{kind:'case',marketCategory:null});f.add('sold',90000);
  f.accounts.db(db=>db.prepare("UPDATE inventory SET sold_at=? WHERE id='sold'").run(now));
  const before=f.worth();assert.equal(before.items,680);assert.equal(before.total,100680);
  const shop=buyBusiness(f.dir,f.user,'wine','popup',{now}).shop;stockBusiness(f.dir,f.user,shop.id,['stock'],{now});
  listItem(f.dir,f.user,{inventoryId:'listed',startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});
  assert.equal(f.worth().total,before.total);assert.equal(f.worth().businesses,1000);
  f.add('other-item',100,f.seller);const lot=listItem(f.dir,f.seller,{inventoryId:'other-item',startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});
  placeBid(f.dir,f.user,lot.id,400,{now});const held=f.worth();assert.equal(held.heldBids,400);assert.equal(held.total,before.total);
  setMarketIndex(f.dir,'wine',120,{now});assert.equal(f.worth().items,800);assert.equal(f.worth().total,before.total+120);
});
test('unrevealed palettes use the winning price without leaking secret reward values',async t=>{
  const f=await fixture(t), edition=loadPaletteCatalog(f.dir,{now}).palettes.find(p=>p.id==='fundkiste');
  const auction=createPaletteAuction(f.dir,{editionId:edition.editionId,requestId:'wealth-palette-001'},{now,random:()=>0});
  bidOnPaletteAuction(f.dir,f.user,auction.id,auction.reserve,{now});settleDuePaletteAuctions(f.dir,{now:auction.endsAt+1});
  const before=f.accounts.db(db=>currentNetWorth(db,f.user.id,{now:auction.endsAt+1}));assert.equal(before.items,0);assert.equal(before.sealedPalettes,auction.reserve);
  f.accounts.db(db=>db.prepare("UPDATE inventory SET item=json_set(item,'$.price',1000000) WHERE user_id=?").run(f.user.id));
  const hidden=f.accounts.db(db=>currentNetWorth(db,f.user.id,{now:auction.endsAt+1}));assert.deepEqual(hidden,before);
  getPaletteAuctionRewards(f.dir,f.user,auction.id,{now:auction.endsAt+1});const revealed=f.accounts.db(db=>currentNetWorth(db,f.user.id,{now:auction.endsAt+1}));assert.equal(revealed.sealedPalettes,0);assert.equal(revealed.items,3000000);
});
test('snapshots persist, minute polling is bounded, ranges are correct and all time is downsampled',async t=>{
  const f=await fixture(t);
  f.accounts.db(db=>{recordNetWorth(db,f.user.id,{now});recordNetWorth(db,f.user.id,{now:now+1000});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM net_worth_snapshots').get().n,1);
    for(let n=1;n<=45;n++){db.prepare('UPDATE users SET tokens=? WHERE id=?').run(100000+n,f.user.id);recordNetWorth(db,f.user.id,{now:now+n*86400000});}});
  closeDataStore(f.dir);
  for(const [range,days] of [['1d',1],['1w',7],['1m',30],['all',45]]){
    const data=netWorthHistory(f.dir,f.user,{range,now:now+45*86400000});assert.ok(data.points.length);assert.ok(data.points.every(p=>p.capturedAt>=now+(45-days)*86400000));assert.equal(data.points.at(-1).total,100045);assert.ok(data.points.length<=403);
  }
  f.accounts.db(db=>{for(let n=1;n<=1600;n++)recordNetWorth(db,f.user.id,{now:now+n*minute});});
  const all=netWorthHistory(f.dir,f.user,{range:'all',now:now+46*86400000});assert.ok(all.observationCount>1600);assert.ok(all.points.length<=403);assert.equal(all.points.at(-1).capturedAt,now+46*86400000);
  const other=netWorthHistory(f.dir,f.seller,{range:'all',now:now+46*86400000});assert.equal(other.points.length,1);assert.equal(other.current.total,100000);assert.equal(other.trackedSince,now+46*86400000);
  assert.throws(()=>netWorthHistory(f.dir,f.user,{range:'__proto__',now}),/invalid_net_worth_range/);
});
test('background capture includes offline humans, excludes NPCs and respects cadence; reset clears history',async t=>{
  const f=await fixture(t);f.accounts.db(db=>db.prepare("INSERT INTO users (id,username,password_hash,tokens,npc,created_at) VALUES ('npc','npc','disabled',1000,1,?)").run(now));
  assert.equal(captureNetWorth(f.dir,{now}).recorded,2);assert.equal(captureNetWorth(f.dir,{now:now+minute}).recorded,0);assert.equal(captureNetWorth(f.dir,{now:now+5*minute}).recorded,2);
  assert.throws(()=>netWorthHistory(f.dir,{id:'npc'},{now}),/login_required/);
  f.accounts.resetEconomy(f.user,'RESET ECONOMY');assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM net_worth_snapshots').get().n),0);
  const data=netWorthHistory(f.dir,f.user,{now:now+6*minute});assert.equal(data.points.length,1);assert.equal(data.current.total,1000);assert.equal(data.trackedSince,now+6*minute);
});
