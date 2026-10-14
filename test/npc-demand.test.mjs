import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { withDatabase, closeDataStore } from '../src/database.mjs';
import { npcItemKey, npcAudienceKey, npcDemand, NPC_DEMAND_WINDOW_MS } from '../src/npc-demand.mjs';
import { npcCohort, npcValuation, npcResaleBidDelay, seedNpcBuyers, tickNpcBuyers, NPC_BUYERS, PALETTE_SHOWUP_MS } from '../src/npc-buyers.mjs';
import { listItem, placeBid, settleAuction, cancelListing } from '../src/resale.mjs';
import { setMarketIndex } from '../src/market.mjs';

const now=Date.parse('2026-10-11T12:00:00Z'), unit=key=>key.endsWith(':interest')?0:.5;
async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-npc-demand-'));
  new Accounts(dir,{now:()=>now});
  const read=(sql,...args)=>withDatabase(dir,db=>db.prepare(sql).all(...args));
  const write=(sql,...args)=>withDatabase(dir,db=>db.prepare(sql).run(...args));
  write("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES ('seller','seller','disabled',100000,?)",now);
  seedNpcBuyers(dir,{now});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const add=(id,item,time=now,price=851)=>{
    write('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?, ?, ?, ?)',id,'seller',JSON.stringify(item),time);
    return listItem(dir,{id:'seller'},{inventoryId:id,startPrice:price,endsAt:new Date(time+900000).toISOString()},{now:time});
  };
  return {dir,read,write,add,demand:(item,time=now,exclude='')=>withDatabase(dir,db=>npcDemand(db,item,time,exclude))};
}

test('normal-item buyers consider bids 20% more often on new and existing interest', async t => {
  const f = await fixture(t), lot = f.add('activity-item', { price: 1000, marketCategory: 'electronics' }, now, 1);
  tickNpcBuyers(f.dir, { now, unit });
  let interests = f.read('SELECT * FROM resale_npc_interest WHERE auction_id=?', lot.id);
  assert.ok(interests.length > 0);
  for (const row of interests) {
    const npc = NPC_BUYERS.find(entry => entry.id === row.npc_id);
    assert.equal(row.next_bid_at - now, Math.round(npc.delaySeconds * 1000 / 1.2));
  }
  // Existing buyers whose old timer is due adopt the new repeat cadence.
  f.write('UPDATE resale_npc_interest SET next_bid_at=? WHERE auction_id=?', now, lot.id);
  tickNpcBuyers(f.dir, { now, unit });
  interests = f.read('SELECT * FROM resale_npc_interest WHERE auction_id=?', lot.id);
  assert.ok(interests.some(row => row.last_bid_at === now));
  for (const row of interests.filter(entry => entry.next_bid_at > now)) {
    const npc = NPC_BUYERS.find(entry => entry.id === row.npc_id);
    assert.equal(row.next_bid_at - now, Math.round(npc.delaySeconds * 1000 / 1.2));
  }
  for (const npc of NPC_BUYERS) {
    const before = Math.round(10000 + npc.patience * 20000 + (1 - npc.aggressiveness) * 10000);
    assert.equal(npcResaleBidDelay(npc), Math.round(npc.delaySeconds * 1000 / 1.2));
    assert.equal(npcResaleBidDelay(npc, now + 120000, now), Math.round(before / 1.2));
  }
  assert.equal(PALETTE_SHOWUP_MS, 300000);
});

test('audience identity ignores owners, price of acquisition, batch size and listing UUID; refreshes every six hours',()=>{
  const item={auctionId:12,title:'Laptop',price:1000,marketCategory:'electronics'};
  assert.equal(npcItemKey(item),npcItemKey({...item,ownerId:'other',cost:1,wholesaleUnit:5}));
  assert.equal(npcAudienceKey(item,now),npcAudienceKey(item,now+3600000));
  assert.notEqual(npcAudienceKey(item,now),npcAudienceKey(item,now+NPC_DEMAND_WINDOW_MS));
  assert.notEqual(npcItemKey(item),npcItemKey({...item,auctionId:13}));
});

test('cancel and relist preserves the same interested buyers and private ceilings in one demand window',async t=>{
  const f=await fixture(t),item={auctionId:42,title:'Laptop',price:1000,marketCategory:'electronics',rarity:'common'};
  const first=f.add('first',item);tickNpcBuyers(f.dir,{now,unit});
  const interest=id=>f.read('SELECT npc_id,max_bid,active FROM resale_npc_interest WHERE auction_id=? ORDER BY npc_id',id);
  const before=interest(first.id);cancelListing(f.dir,{id:'seller'},first.id,{now});
  const second=f.add('second',item);tickNpcBuyers(f.dir,{now,unit});
  assert.deepEqual(interest(second.id),before);
});

test('NPC commitments and purchases consume shared demand across sellers and bundles; human bids do not and demand recovers',async t=>{
  const f=await fixture(t),item={auctionId:43,title:'Laptop',price:1000,marketCategory:'electronics',rarity:'common'};
  for(let i=0;i<8;i++) f.write('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?, ?, ?, ?)',`bundle-${i}`,'seller',JSON.stringify(item),now);
  const lot=listItem(f.dir,{id:'seller'},{inventoryId:'bundle-0',quantity:8,startPrice:1,endsAt:new Date(now+900000).toISOString()},{now});
  const other=f.add('human-lot',item,now,1);
  f.write("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES ('buyer','buyer','disabled',100000,?)",now);
  assert.equal(f.demand(item).multiplier,1);
  placeBid(f.dir,{id:'buyer'},other.id,1,{now});
  assert.equal(f.demand(item).multiplier,1);
  placeBid(f.dir,NPC_BUYERS[0],lot.id,1,{now});
  assert.equal(f.demand(item).multiplier,.5);
  assert.equal(f.demand(item,now,lot.id).multiplier,1,'A lot must not count its own commitment twice');
  settleAuction(f.dir,lot.id,{now:now+900000});
  closeDataStore(f.dir);
  assert.equal(f.demand(item,now+900000).multiplier,.5);
  assert.equal(f.demand(item,now+900000+NPC_DEMAND_WINDOW_MS).multiplier,1);
});

test('repeated cost-plus listings cannot reroll enough NPC buyers to profitably clear an identical stock batch',async t=>{
  const f=await fixture(t);
  let item={auctionId:500,title:'Laptop',price:1000,marketCategory:'electronics',rarity:'common'};
  while(!npcCohort(npcAudienceKey(item,now)).some(npc=>npcValuation(item,{electronics:100},npc,npcAudienceKey(item,now),unit).maxBid>930)) item.auctionId++;
  const copies=Array.from({length:12},(_,i)=>({id:'copy-'+i,lot:f.add('copy-'+i,item),sold:false}));
  for(let attempt=0;attempt<6;attempt++) {
    const start=now+attempt*1200000;
    if(attempt) for(const row of copies.filter(row=>!row.sold)) row.lot=listItem(f.dir,{id:'seller'},
      {inventoryId:row.id,startPrice:851,endsAt:new Date(start+900000).toISOString()},{now:start});
    for(let tick=0;tick<34;tick++) tickNpcBuyers(f.dir,{now:start+tick*30000,unit});
    for(const row of copies.filter(row=>!row.sold)) row.sold=Boolean(settleAuction(f.dir,row.lot.id,{now:start+1200000}).winnerId);
    closeDataStore(f.dir);
  }
  const sold=copies.filter(row=>row.sold).length;
  assert.ok(sold>0,'Good prices still attract NPC purchases');
  assert.ok(sold<6,`Shared demand must leave stock unsold; sold ${sold}/12`);
});

test('falling market prices stop future NPC bids without rewriting existing escrow or frozen private interest',async t=>{
  const f=await fixture(t),item={auctionId:44,title:'Laptop',price:1000,marketCategory:'electronics',rarity:'common'};
  const lot=f.add('cooling',item,now,750);
  tickNpcBuyers(f.dir,{now,unit});
  const before=f.read('SELECT npc_id,max_bid FROM resale_npc_interest WHERE auction_id=? ORDER BY npc_id',lot.id);
  setMarketIndex(f.dir,'electronics',50,{now});
  assert.equal(tickNpcBuyers(f.dir,{now:now+90000,unit}).bids,0);
  assert.deepEqual(f.read('SELECT npc_id,max_bid FROM resale_npc_interest WHERE auction_id=? ORDER BY npc_id',lot.id),before);
  assert.equal(f.read('SELECT current_bid,max_bid FROM resale_auctions WHERE id=?',lot.id)[0].current_bid,null);
});
