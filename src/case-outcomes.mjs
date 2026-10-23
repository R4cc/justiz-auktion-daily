import { buildEditionItems } from './cases.mjs';
import { randomInt } from 'node:crypto';
import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { estimatedValueTokens } from './market.mjs';
import { luckWeights } from './skill-effects.mjs';

const rarities=['common','uncommon','rare','epic','legendary'];
const identity=item=>String(item.auctionId??item.id??`${item.title}:${item.price}`);
const valueOf=(item,indexes)=>estimatedValueTokens(item,indexes);

// Frozen category editions contain useful middle-value finds which the mixed
// edition can miss. Keep real items, every rarity and the original jackpots.
export function caseValuePool(catalog, source, basis, indexes={}) {
  const unique=new Map();
  for(const item of [...source,...(catalog?.cases||[]).filter(box=>box.available!==false).flatMap(box=>box.items||[])])
    if(!unique.has(identity(item)))unique.set(identity(item),item);
  const candidates=[...unique.values()];
  const distance=item=>Math.abs(Math.log(valueOf(item,indexes)/Math.max(1,basis*.85)));
  const order=(a,b)=>distance(a)-distance(b)||identity(a).localeCompare(identity(b),'en');
  const selected=new Map();
  const add=item=>{if(item)selected.set(identity(item),item);};
  for(const rarity of rarities)add(candidates.filter(item=>item.rarity===rarity).sort(order)[0]);
  for(const item of [...source].sort((a,b)=>valueOf(b,indexes)-valueOf(a,indexes)).slice(0,2))add(item);
  for(const item of candidates.sort(order)){
    if(selected.size>=Math.min(50,candidates.length))break;
    add(item);
  }
  // Use the shared edition rarity algorithm to rank the selected values.
  // Theme-relative rarities cannot be mixed directly: an ordinary car may be
  // worth more than a rare bottle of wine.
  const families=[...selected.values()].map(item=>[{...item,id:item.auctionId??item.id??identity(item),
    finalPrice:item.price,currentBid:item.price}]);
  return buildEditionItems({id:'store-value-pool',category:'mixed'},families,0,null,50);
}

const normalize=values=>{const sum=values.reduce((a,b)=>a+b,0);return values.map(value=>value/sum);};
function fitValueProbabilities(prior,values,target,basis) {
  const supported=values.filter((_,i)=>prior[i]>0),minimum=Math.min(...supported),maximum=Math.max(...supported);
  if(target<=minimum||target>=maximum){
    const boundary=target<=minimum?minimum:maximum;
    return normalize(prior.map((p,i)=>values[i]===boundary?p:0));
  }
  const distribution=exponent=>{
    const logs=prior.map((p,i)=>p>0?Math.log(p)+exponent*Math.log(values[i]/basis):-Infinity);
    const largest=Math.max(...logs);
    return normalize(logs.map(log=>Math.exp(log-largest)));
  };
  let low=-128,high=128;
  for(let n=0;n<60;n++){
    const mid=(low+high)/2,p=distribution(mid),mean=p.reduce((sum,p,i)=>sum+p*values[i],0);
    if(mean<target)low=mid;else high=mid;
  }
  return distribution((low+high)/2);
}
function tierProbabilities(items,weights) {
  const total=weights.reduce((a,b)=>a+b,0);
  const counts=rarities.map(rarity=>items.filter(item=>item.rarity===rarity).length);
  return items.map(item=>{const tier=rarities.indexOf(item.rarity);return weights[tier]/total/counts[tier];});
}

// Most draws come from a price-appropriate pool. A small ordinary draw tail
// preserves every real item and jackpot. Fit the usual pool's expectation to
// a modest return target instead of letting enormous jackpot values price it.
export function caseOutcomeDistribution(items,weights,{basis,indexes={},luckPercent=0,legendaryProbability}={}) {
  if(!items.length||!Number.isFinite(basis)||basis<=0)throw new Error('invalid_case_basis');
  const values=items.map(item=>valueOf(item,indexes));
  const baseline=tierProbabilities(items,weights),lucky=tierProbabilities(items,luckWeights(weights,luckPercent));
  const tail=ECONOMY_BALANCE.caseLowValueTailPercent/100;
  let eligible=values.map((value,i)=>baseline[i]>0&&value>=basis*ECONOMY_BALANCE.caseUsualMinimumReturnPercent/100);
  if(!eligible.some(Boolean)){
    const best=Math.max(...values.filter((_,i)=>baseline[i]>0));
    eligible=values.map((value,i)=>baseline[i]>0&&value===best);
  }
  const ordinaryMean=values.reduce((sum,value,i)=>sum+value*baseline[i],0);
  const target=(basis*ECONOMY_BALANCE.caseOpeningReturnTarget-tail*ordinaryMean)/(1-tail);
  const protectedProbabilities=fitValueProbabilities(baseline.map((p,i)=>eligible[i]?p:0),values,target,basis);
  // Apply Luck after fitting the unbuffed value model. Discounts never change
  // this basis, and Luck remains a relative improvement rather than repricing.
  let protectedLucky=normalize(protectedProbabilities.map((p,i)=>baseline[i]?p*lucky[i]/baseline[i]:0));
  const legendary=items.map(item=>item.rarity==='legendary');
  const tailLegendary=tail*lucky.reduce((sum,p,i)=>sum+(legendary[i]?p:0),0);
  const protectedLegendary=protectedLucky.reduce((sum,p,i)=>sum+(legendary[i]?p:0),0);
  const originalLegendary=tailLegendary+(1-tail)*protectedLegendary;
  if(Number.isFinite(legendaryProbability)&&legendaryProbability<originalLegendary-1e-14){
    // The store fits the whole price ladder together. Hold its calibrated
    // legendary chance fixed, then fit the remaining useful finds to retain
    // the original return instead of replacing jackpots with cheap losses.
    const share=Math.max(0,(legendaryProbability-tailLegendary)/(1-tail));
    const legend=protectedLucky.map((p,i)=>legendary[i]&&protectedLegendary?p/protectedLegendary:0);
    let ordinary=lucky.map((p,i)=>!legendary[i]&&eligible[i]?p:0);
    if(!ordinary.some(p=>p>0)){
      const best=Math.max(...values.filter((_,i)=>!legendary[i]&&lucky[i]>0));
      ordinary=lucky.map((p,i)=>!legendary[i]&&values[i]===best?p:0);
    }
    const originalMean=protectedLucky.reduce((sum,p,i)=>sum+p*values[i],0);
    const legendaryMean=legend.reduce((sum,p,i)=>sum+p*values[i],0);
    const rest=fitValueProbabilities(ordinary,values,(originalMean-share*legendaryMean)/(1-share),basis);
    protectedLucky=rest.map((p,i)=>(1-share)*p+share*legend[i]);
  }
  const probabilities=normalize(baseline.map((_,i)=>tail*lucky[i]+(1-tail)*protectedLucky[i]));
  return items.map((item,i)=>({item,probability:probabilities[i],value:values[i]}));
}

export function drawCaseOutcome(outcomes,random=randomInt) {
  let roll=random(2**40)/2**40;
  for(const outcome of outcomes){roll-=outcome.probability;if(roll<0)return outcome.item;}
  return outcomes.at(-1).item;
}

// Old paid cases get one upgrade opportunity on first opening. Keep valuable
// saved wins; replace only poor outcomes with a real, better-valued find.
export function improveUnopenedCase(winner,catalog,definition,{basis,indexes={},luckPercent=0,random=randomInt}={}) {
  const floor=basis*ECONOMY_BALANCE.caseUsualMinimumReturnPercent/100;
  if(!(basis>0)||valueOf(winner,indexes)>=floor)return winner;
  if(random(100)<ECONOMY_BALANCE.caseLowValueTailPercent)return winner;
  const source=catalog.cases.find(box=>box.id==='fundkiste')?.items||[];
  const items=caseValuePool(catalog,source,basis,indexes);
  const outcomes=caseOutcomeDistribution(items,definition.weights,{basis,indexes,luckPercent})
    .filter(outcome=>outcome.value>=floor&&outcome.value>valueOf(winner,indexes));
  if(!outcomes.length)return winner;
  const total=outcomes.reduce((sum,outcome)=>sum+outcome.probability,0);
  return drawCaseOutcome(outcomes.map(outcome=>({...outcome,probability:outcome.probability/total})),random);
}
