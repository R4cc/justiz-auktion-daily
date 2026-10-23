import { caseOutcomeDistribution } from './case-outcomes.mjs';
import { discountedCaseCost } from './prestige-effects.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { caseCatalog, loadCaseCatalog, RARITIES, matchesTheme, buildEditionItems } from './cases.mjs';
import { ECONOMY_BALANCE, expectedItemValue } from './economy-balance.mjs';
import { estimatedValueTokens } from './market.mjs';
import { ensureCaseStockSchema } from './case-stock.mjs';

export { STORE_CASES, STORE_CATEGORIES, STORE_TIERS, LEGACY_STORE_CASES } from './store-case-definitions.mjs';
import { STORE_CASES, STORE_CATEGORIES, STORE_TIERS } from './store-case-definitions.mjs';
const starterArchive = JSON.parse(readFileSync(new URL('../seed/category-case-auctions.json', import.meta.url), 'utf8')).auctions;
const starterCatalogs=new Map();
function starterCatalog(date='2026-10-23') {
  if(!starterCatalogs.has(date)){
    if(starterCatalogs.size>=2)starterCatalogs.delete(starterCatalogs.keys().next().value);
    starterCatalogs.set(date,caseCatalog(starterArchive,Date.parse(date)));
  }
  return starterCatalogs.get(date);
}
const complete=items=>items?.length>=5&&new Set(items.map(item=>item.price)).size>=5&&RARITIES.every(rarity=>items.some(item=>item.rarity===rarity.id));

// A sparse category falls back only to real archived items from that category.
// Never fill a car case with wine merely to populate all five rarities.
export function categoryCasePool(catalog,category) {
  const themed=catalog.cases.find(box=>box.id===category);
  if(complete(themed?.items))return themed.items;
  const candidates=[...new Map(catalog.cases.flatMap(box=>box.items||[])
    .filter(item=>matchesTheme(item,category)).map(item=>[String(item.auctionId??item.id),item])).values()];
  const rebuild=items=>buildEditionItems({id:category,category},items.map(item=>[{...item,id:item.auctionId??item.id,finalPrice:item.price}]),0,null,50);
  if(candidates.length>=5){const pool=rebuild(candidates);if(complete(pool))return pool;}
  return starterCatalog(catalog.rotationDate).cases.find(box=>box.id===category).items;
}
export function loadCaseStoreCatalog(dataDir, now = Date.now()) {
  const catalog=loadCaseCatalog(dataDir,now);
  return complete(catalog.cases.find(box=>box.id==='fundkiste')?.items)?catalog:starterCatalog(catalog.rotationDate);
}

// Choose the nearest feasible whole-token price when the real category has a
// value gap. Never sell an underpriced almost-certain jackpot just because the
// half-price floor excludes every ordinary item from the usual draw branch.
function balancedPrice(items,weights,initial,previous,indexes) {
  const values=items.map(item=>estimatedValueTokens(item,indexes));
  const tail=ECONOMY_BALANCE.caseLowValueTailPercent/100,usual=1-tail;
  const tailMean=tail*expectedItemValue(items,weights,item=>estimatedValueTokens(item,indexes));
  const target=ECONOMY_BALANCE.caseOpeningReturnTarget,floor=ECONOMY_BALANCE.caseUsualMinimumReturnPercent/100;
  const candidates=new Set([initial,previous+1]);
  for(const value of values){candidates.add(Math.ceil((tailMean+usual*value)/target));candidates.add(Math.floor(value/floor));}
  const viable=[...candidates].filter(cost=>{
    if(!Number.isSafeInteger(cost)||cost<=previous||cost<1)return false;
    const pool=values.filter(value=>value>=cost*floor);
    return pool.length&&target*cost>=tailMean+usual*Math.min(...pool)-1e-8&&target*cost<=tailMean+usual*Math.max(...pool)+1e-8;
  }).sort((a,b)=>Math.abs(Math.log(a/initial))-Math.abs(Math.log(b/initial))||a-b);
  if(!viable.length)throw new Error('insufficient_category_value_range');
  return viable[0];
}

const priceCache=new Map();
function categoryPrices(items,indexes) {
  const key=JSON.stringify(items.map(item=>[item.auctionId,item.rarity,item.price,estimatedValueTokens(item,indexes)]));
  if(priceCache.has(key))return priceCache.get(key);
  const prices=[];
  for(const tier of STORE_TIERS){
    const live=expectedItemValue(items,tier.weights,item=>estimatedValueTokens(item,indexes));
    prices.push(balancedPrice(items,tier.weights,Math.max((prices.at(-1)||0)+1,Math.ceil(live/ECONOMY_BALANCE.paidCaseReturn)),prices.at(-1)||0,indexes));
  }
  // Jackpot calibration can remove an unsupported expensive outcome in a
  // gapped pool. Refit the price as well, instead of quietly lowering return.
  for(let pass=0;pass<8;pass++){
    let next=null,changed=false;
    for(let i=2;i>=0;i--){
      const weights=STORE_TIERS[i].weights;
      let outcomes=caseOutcomeDistribution(items,weights,{basis:prices[i],indexes});
      const original=outcomes.filter(o=>o.item.rarity==='legendary').reduce((sum,o)=>sum+o.probability,0);
      const probability=next===null?original:Math.min(original,next*.8);
      if(probability<original-1e-14)outcomes=caseOutcomeDistribution(items,weights,{basis:prices[i],indexes,legendaryProbability:probability});
      const mean=outcomes.reduce((sum,o)=>sum+o.value*o.probability,0);
      if(mean<prices[i]*ECONOMY_BALANCE.caseOpeningReturnTarget-1e-7){
        const price=balancedPrice(items,weights,Math.max(1,Math.floor(mean/ECONOMY_BALANCE.caseOpeningReturnTarget)),prices[i-1]||0,indexes);
        if(price<prices[i]){prices[i]=price;changed=true;}
      }
      next=probability;
    }
    if(!changed)break;
  }
  if(priceCache.size>=128)priceCache.delete(priceCache.keys().next().value);
  priceCache.set(key,prices);return prices;
}

export function quoteCaseStore(catalog, indexes = {}, {luckPercent=0,caseDiscountPercent=0,rebates=[]} = {}) {
  const pools=new Map(STORE_CATEGORIES.map(category=>[category.id,categoryCasePool(catalog,category.id)]));
  const prices=new Map([...pools].map(([category,items])=>{
    try{return [category,categoryPrices(items,indexes)];}
    catch(error){
      if(error.message!=='insufficient_category_value_range')throw error;
      const fallback=starterCatalog(catalog.rotationDate).cases.find(box=>box.id===category).items;
      pools.set(category,fallback);return [category,categoryPrices(fallback,indexes)];
    }
  }));
  const distributions=[];
  const cases = STORE_CASES.map(box => {
    const items=pools.get(box.category);
    const cost=prices.get(box.category)[STORE_TIERS.findIndex(tier=>tier.id===box.tier)];
    const drawItems=items;
    const outcomes=caseOutcomeDistribution(drawItems,box.weights,{basis:cost,indexes,luckPercent});
    distributions.push(outcomes);
    const regularCost=discountedCaseCost(cost,caseDiscountPercent);
    const rebate=rebates.filter(rebate=>rebate.caseId==='all'||rebate.caseId===box.id)
      .sort((a,b)=>b.percent-a.percent || b.endsAt-a.endsAt || a.id.localeCompare(b.id))[0] || null;
    const finalCost=rebate?Math.ceil(regularCost*(100-rebate.percent)/100):regularCost;
    return { id: box.id, category:box.category,tier:box.tier,design:box.design, name: box.name, nameDe: box.nameDe, badge: box.badge, cost:finalCost, regularCost, rebate, valueBasis:cost, items:drawItems };
  });
  // Independent value fits can invert the advertised rarity progression.
  // Keep Elite's fitted jackpot chance and require a meaningful increase
  // between adjacent tiers. Refit useful ordinary finds after calibration.
  let nextChance=null;
  for(let i=cases.length-1;i>=0;i--){
    if(i===cases.length-1||cases[i].category!==cases[i+1].category){nextChance=null;}
    const box=cases[i];
    const original=distributions[i].filter(outcome=>outcome.item.rarity==='legendary').reduce((sum,outcome)=>sum+outcome.probability,0);
    box.legendaryProbability=nextChance===null?original:Math.min(original,nextChance*.8);
    const outcomes=box.legendaryProbability<original-1e-14
      ?caseOutcomeDistribution(box.items,STORE_CASES[i].weights,{basis:box.valueBasis,indexes,luckPercent,legendaryProbability:box.legendaryProbability})
      :distributions[i];
    box.dropChances=RARITIES.map(rarity=>({rarity:rarity.id,percent:100*outcomes.filter(outcome=>outcome.item.rarity===rarity.id).reduce((sum,outcome)=>sum+outcome.probability,0)}));
    nextChance=box.legendaryProbability;
  }
  const revision = createHash('sha256').update(JSON.stringify({ version: 5, legendary:cases.map(box=>box.legendaryProbability), balance:[ECONOMY_BALANCE.caseOpeningReturnTarget,ECONOMY_BALANCE.caseUsualMinimumReturnPercent,ECONOMY_BALANCE.caseLowValueTailPercent], pools:cases.map(box=>box.items), bases:cases.map(box=>box.valueBasis), values:cases.map(box=>box.items.map(item=>estimatedValueTokens(item,indexes))), pool: catalog.revision,
    definitions: STORE_CASES, ...(luckPercent?{luckPercent}:{}), costs: cases.map(box => box.cost), ...(rebates.length?{rebates:cases.map(box=>box.rebate)}:{}) })).digest('hex');
  return { revision, luckPercent, caseDiscountPercent, rotationDate: catalog.rotationDate, rotatesAt: catalog.rotatesAt, categories:STORE_CATEGORIES, cases };
}

// Public store responses contain prices and aggregate rarity odds only.
export function publicCaseStore(quote) {
  return {...quote,cases:quote.cases.map(({items,valueBasis,legendaryProbability,...box})=>box)};
}

// The legacy column name 'tier' stores the purchased case id; retain it so
// old receipts stay readable and idempotent through the store redesign.
export function ensureCaseStoreSchema(db) {
  ensureCaseStockSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS case_purchases (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    tier TEXT NOT NULL, item TEXT NOT NULL CHECK(json_valid(item)),
    PRIMARY KEY(user_id, request_id)
  ) STRICT`);
}
