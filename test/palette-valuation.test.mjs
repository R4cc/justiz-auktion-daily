import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { closeDataStore, withDatabase } from '../src/database.mjs';
import { estimatedValueTokens, marketIndexes, setMarketIndex } from '../src/market.mjs';
import { paletteMarketValue } from '../src/palette-valuation.mjs';

const now=Date.parse('2026-10-14T12:00:00Z');
async function fixture(t) {
  const dir=await mkdtemp('/tmp/jg-palette-valuation-');
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  return {dir,quote:palette=>withDatabase(dir,db=>paletteMarketValue(db,palette,{now}))};
}

test('pallet value rounds each unit like inventory, counts every multiplier and uses the actual winning bid',async t=>{
  const f=await fixture(t);setMarketIndex(f.dir,'wine',133,{now});
  const item={price:10.4,marketCategory:'wine'},palette={bundleCostTokens:125,cost:5,reserve:3,
    rewards:[{item,quantity:7},{item,quantity:2},{item:{price:20,category:'Werkzeuge'},quantity:3}]};
  const before=JSON.stringify(palette),quote=f.quote(palette);
  assert.deepEqual(quote.rewards,[{unitValueTokens:13,totalValueTokens:91},{unitValueTokens:13,totalValueTokens:26},{unitValueTokens:20,totalValueTokens:60}]);
  assert.equal(quote.totalValueTokens,177);assert.equal(quote.costTokens,125);assert.equal(quote.profitLossTokens,52);
  assert.equal(JSON.stringify(palette),before,'live quotes cannot rewrite the saved outcome');
  const inventoryValues=withDatabase(f.dir,db=>palette.rewards.map(reward=>estimatedValueTokens(reward.item,marketIndexes(db,now))));
  assert.deepEqual(quote.rewards.map(reward=>reward.unitValueTokens),inventoryValues);
});

test('legacy single items and paid pallets revalue with the market without changing draws or costs',async t=>{
  const f=await fixture(t),palette={cost:100,rewards:[{item:{price:100,marketCategory:'wine'}}]};
  assert.equal(f.quote(palette).profitLossTokens,0);
  setMarketIndex(f.dir,'wine',150,{now});const profit=f.quote(palette);
  assert.equal(profit.totalValueTokens,150);assert.equal(profit.profitLossTokens,50);
  setMarketIndex(f.dir,'wine',50,{now});const loss=f.quote(palette);
  assert.equal(loss.totalValueTokens,50);assert.equal(loss.profitLossTokens,-50);
  assert.equal(loss.costTokens,100);assert.equal(palette.rewards[0].item.price,100);
});
