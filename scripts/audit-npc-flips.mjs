// Disposable economy audit: buy real supplier lots, split them and auction the finds to NPCs.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { supplyStockAuctions } from '../src/businesses.mjs';
import { listResales, listItem, placeBid, settleAuction, settleDueListings } from '../src/resale.mjs';
import { tickNpcBuyers } from '../src/npc-buyers.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-npc-flip-audit-'));
let now = Date.parse('2026-10-11T12:00:00Z');
const user = { id: 'audit-trader' }, accounts = new Accounts(dir, { now: () => now, flags: { resales: true } });
const sql = (query, ...args) => withDatabase(dir, db => db.prepare(query).all(...args));
try {
  accounts.db(db => db.prepare("INSERT INTO users(id, username, password_hash, tokens, created_at) VALUES (?, ?, 'disabled', 1000000, ?)").run(user.id, user.id, now));
  upsertAuctions(dir, [['Getränke', 'Riesling Wein', 100], ['Sammlerstücke', 'Lego Spielzeug', 100],
    ['Elektronik', 'Laptop computer', 100], ['Fahrzeuge', 'BMW PKW', 1000]].map(([category,title,price], i) =>
    ({ id: 9100+i, category, title, currentBid: price, finalPrice: price })));
  supplyStockAuctions(dir, { now, retire: false });
  const supply = listResales(dir, { now });
  for (const lot of supply) placeBid(dir, user, lot.id, lot.startPrice, { now });
  now = Math.max(...supply.map(lot => lot.endsAt)) + 1;
  settleDueListings(dir, { now });
  const items = sql('SELECT i.id, i.item, a.cost FROM inventory i JOIN item_acquisitions a ON a.inventory_id=i.id WHERE i.user_id=? ORDER BY i.id', user.id);
  const atCost=process.argv.includes('--at-cost'), attempts=atCost?6:1;
  const outcomes=items.map(item=>({ inventoryId:item.id, cost:item.cost, item:JSON.parse(item.item), proceeds:null }));
  for(let attempt=0;attempt<attempts;attempt++) {
    const rows=[];
    for (const item of outcomes.filter(row=>row.proceeds===null)) {
      const price=atCost?item.cost+1:Math.max(1,Math.round(item.item.price*.7));
      const lot = listItem(dir, user, { inventoryId:item.inventoryId, startPrice:price, endsAt:new Date(now+900000).toISOString() }, { now });
      item.category=lot.item.marketCategory;rows.push({item,id:lot.id});
    }
    for (let tick=0;tick<34;tick++) tickNpcBuyers(dir,{now:now+tick*30000});
    now+=1200000;
    for(const row of rows) {const lot=settleAuction(dir,row.id,{now});row.item.proceeds=lot.winnerId?lot.currentBid:null;}
  }
  const sold=outcomes.filter(row=>row.proceeds!==null), profitable=sold.filter(row=>row.proceeds>row.cost);
  console.log(JSON.stringify({ mode:atCost?'cost plus J€1, six attempts':'default 70% estimate, one attempt', listed:outcomes.length, sold:sold.length, unsold:outcomes.length-sold.length,
    profitable:profitable.length, lossMaking:sold.filter(row=>row.proceeds<row.cost).length,
    realizedProfit:sold.reduce((sum,row)=>sum+row.proceeds-row.cost,0),
    byCategory:Object.fromEntries([...new Set(outcomes.map(row=>row.category))].map(category=>{
      const group=outcomes.filter(row=>row.category===category), sales=group.filter(row=>row.proceeds!==null);
      return [category,{listed:group.length,sold:sales.length,profitable:sales.filter(row=>row.proceeds>row.cost).length,
        profit:sales.reduce((sum,row)=>sum+row.proceeds-row.cost,0)}];
    })) },null,2));
} finally { closeDataStore(dir); await rm(dir,{recursive:true,force:true}); }
