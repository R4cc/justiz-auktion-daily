import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openingProfitChance, paletteProfitReport } from '../scripts/palette-profit-report.mjs';
import { STOCK_PALETTE_TIERS } from '../src/stock-palettes.mjs';
import { mysteryStockOffer, publicMysteryOffer, referenceQuantityOdds, quantityOdds, expectedQuantity, protectMysteryDraws } from '../src/mystery-stock.mjs';
import { estimatedValueTokens } from '../src/market.mjs';
import { expectedItemValue } from '../src/economy-balance.mjs';
import { paletteBidCeiling } from '../src/npc-buyers.mjs';
import { luckWeights } from '../src/skill-effects.mjs';

const items = ['common','uncommon','rare','epic','legendary'].map((rarity, n) => ({
  title: `Archive find ${n}`, rarity, price: [10,25,60,140,750][n], marketCategory: 'electronics'
}));
const quote = tier => ({ ...tier, tier: tier.id, items, rolls: 3 });

test('exact profit calculation counts only strictly profitable three-draw outcomes', () => {
  const pool = [{rarity:'common',referenceValue:1},{rarity:'uncommon',referenceValue:3}], weights = [1,1,0,0,0], odds = [{quantity:1,weight:1}];
  assert.equal(openingProfitChance(pool, weights, odds, 5), .5);
  assert.equal(openingProfitChance(pool, weights, odds, 9), 0);
  assert.equal(openingProfitChance(pool, weights, odds, 2), 1);
});

test('new quantity odds improve returns without raising starting prices or NPC budgets', () => {
  const npc = {id:'audit-npc',categories:['electronics'],willingness:1};
  for (const tier of STOCK_PALETTE_TIERS) for (const index of [50,100,150]) {
    const offer = mysteryStockOffer(quote(tier), {electronics:index});
    const oldQuantity = expectedQuantity(referenceQuantityOdds(tier.id));
    const base = expectedItemValue(offer.items, offer.weights), market = expectedItemValue(offer.items, offer.weights, item => item.referenceValue);
    assert.equal(offer.cost, Math.ceil(Math.max(base,market)*oldQuantity/.82));
    assert.equal(offer.bidReferenceQuantity, oldQuantity);
    assert.ok(offer.expectedQuantity > oldQuantity);
    assert.equal(offer.expectedMarket, market*offer.expectedQuantity);
    assert.ok(offer.expectedMarket/offer.cost <= .91);
    const oldOffer = {...offer,expectedQuantity:oldQuantity}; delete oldOffer.bidReferenceQuantity;
    const snapshot = stockOffer => ({items:offer.items,stockOffer,allowedMarketCategories:['electronics']});
    const oldCeiling = paletteBidCeiling(snapshot(oldOffer), {electronics:index}, npc, 'audit-lot', ()=>.5);
    assert.deepEqual(paletteBidCeiling(snapshot(offer), {electronics:index}, npc, 'audit-lot', ()=>.5), oldCeiling);
  }
});

test('public quantity percentages include the improvement and Luck exactly once', () => {
  for (const tier of STOCK_PALETTE_TIERS) {
    const offer = mysteryStockOffer(quote(tier), {electronics:100});
    for (const bonus of [0,3,5,7,25,28,30,32]) {
      const view = publicMysteryOffer(offer, bonus);
      assert.deepEqual(view.quantityOdds, quantityOdds(tier.id, bonus));
      assert.deepEqual(view.weights, luckWeights(offer.weights, bonus));
      assert.ok(Math.abs(view.quantityOdds.reduce((sum, entry) => sum+entry.percent, 0)-100)<1e-9);
      for (const entry of view.quantityOdds) assert.ok(Number.isSafeInteger(entry.weight)&&entry.weight>0);
      assert.ok(view.quantityOdds.reduce((sum,entry)=>sum+entry.weight,0)<2**48);
      assert.equal('bidReferenceQuantity' in view, false);
      assert.equal('expectedQuantity' in view, false);
      assert.equal('items' in view, false);
    }
  }
});

test('archived and stress catalogs exceed 80 percent profitable openings at every price tier and market index', async () => {
  for (const input of [fileURLToPath(new URL('../seed/auctions.json',import.meta.url)), '--stress']) {
    const rows = await paletteProfitReport(input);
    for (const tier of ['budget','standard','premium']) {
      const group = rows.filter(row=>row.tier===tier&&row.index===100);
      assert.ok(group.length>0);
      const average = key => group.reduce((sum,row)=>sum+row[key],0)/group.length;
      assert.ok(average('after')>=.8, `${input} ${tier}: ${average('after')}`);
    }
    assert.ok(rows.every(row=>row.after>row.before&&row.after>=.8&&row.minimumReturn>=1.06-1e-9));
  }
});


test('return protection caps losses at ten percent, wins at least eighty percent and preserves item values and jackpots',()=>{
 const draws=[{position:0,item:items[0],quantity:1},{position:1,item:items[1],quantity:1},{position:2,item:items[2],quantity:1}];
 const original=JSON.stringify(draws);
 for(const index of [1,50,100,150,500])for(const cost of [1,9,101,1000,100001]){
  const indexes={electronics:index};let wins=0;
  for(let roll=0;roll<100;roll++){
   const result=protectMysteryDraws(draws,cost,indexes,()=>roll);
   const value=result.reduce((sum,draw)=>sum+draw.quantity*estimatedValueTokens(draw.item,indexes),0);
   assert.ok(value>=Math.ceil(cost*.9),`loss floor: ${index}/${cost}/${roll}`);
   if(roll<80)assert.ok(value>=Math.ceil(cost*1.1),`profit floor: ${index}/${cost}/${roll}`);
   if(value>cost)wins++;
   result.forEach((draw,n)=>{assert.strictEqual(draw.item,draws[n].item);assert.ok(draw.quantity>=draws[n].quantity);});
  }
  assert.ok(wins>=80);
 }
 assert.equal(JSON.stringify(draws),original);
 const jackpot=draws.map(draw=>({...draw,quantity:96}));
 assert.deepEqual(protectMysteryDraws(jackpot,10,{electronics:100},()=>99),jackpot);
});
