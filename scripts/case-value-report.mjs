import {readFileSync} from 'node:fs';
import {caseCatalog,RARITIES} from '../src/cases.mjs';
import {quoteCaseStore,STORE_CASES} from '../src/case-store.mjs';
import {caseOutcomeDistribution} from '../src/case-outcomes.mjs';
import {MARKET_CATEGORIES,estimatedValueTokens} from '../src/market.mjs';
const input=process.argv[2]||'seed/auctions.json';
const themes=[['BMW PKW','Fahrzeuge',500],['Riesling Wein','Getränke',10],['Laptop Lenovo','Elektronik',50],['Bohrhammer Makita','Werkzeuge',25],['Gold Armbanduhr','Schmuck & Uhren',100],['Lego Modell','Sammlerstücke',20]];
const archive=input==='--stress'?themes.flatMap(([title,category,price],t)=>Array.from({length:80},(_,n)=>({id:10000+t*100+n,title:`${title} ${10000+t*100+n}`,category,finalPrice:Math.round(price*(n+1)**1.35),image:'/audit.jpg'}))):JSON.parse(readFileSync(input,'utf8')).auctions;
// Admin exports omit images. A placeholder only enables read-only catalog
// reconstruction; source data and the production archive remain untouched.
const source=archive.map(item=>({...item,image:item.image||'/audit.jpg'}));
const start=Date.parse('2026-10-23T12:00:00Z'),days=Number(process.argv[3])||30;
const rows=[];
for(const index of [50,100,150])for(let day=0;day<days;day++){
 const catalog=caseCatalog(source,start+day*86400000),indexes=Object.fromEntries(MARKET_CATEGORIES.map(category=>[category.id,index]));
 if(!catalog.cases[0].available)throw new Error('insufficient_audit_archive');
 const offers=quoteCaseStore(catalog,indexes).cases;
 for(let i=1;i<offers.length;i++)if(i%3&&!(offers[i].legendaryProbability>offers[i-1].legendaryProbability))throw new Error('inverted_legendary_odds');
 for(const box of offers){
  const definition=STORE_CASES.find(d=>d.id===box.id),outcomes=caseOutcomeDistribution(box.items,definition.weights,{basis:box.valueBasis,indexes,legendaryProbability:box.legendaryProbability});
  const original=box.items,baseline=[];
  for(const [n,rarity] of RARITIES.entries()){
   const pool=original.filter(item=>item.rarity===rarity.id);
   for(const item of pool)baseline.push({value:estimatedValueTokens(item,indexes),probability:definition.weights[n]/10000/pool.length});
  }
  const chance=(list,predicate)=>list.reduce((sum,item)=>sum+(predicate(item.value)?item.probability:0),0);
  const mean=list=>list.reduce((sum,item)=>sum+item.value*item.probability,0)/box.cost;
  const median=list=>{let p=0;for(const item of [...list].sort((a,b)=>a.value-b.value)){p+=item.probability;if(p>=.5)return item.value/box.cost;}};
  rows.push({index,id:box.id,legendary:outcomes.filter(outcome=>outcome.item.rarity==='legendary').reduce((sum,outcome)=>sum+outcome.probability,0),beforeMean:mean(baseline),mean:mean(outcomes),beforeLow:chance(baseline,value=>value<box.cost*.1),low:chance(outcomes,value=>value<box.cost*.1),usual:chance(outcomes,value=>value>=box.cost*.5),profit:chance(outcomes,value=>value>=box.cost),median:median(outcomes)});
 }
}
const avg=(list,key)=>list.reduce((sum,row)=>sum+row[key],0)/list.length;
const pct=value=>`${(value*100).toFixed(2)}%`;
console.log(`# Case value audit\n\nSource: ${input}; ${archive.length} archived lots; ${days} rotations. Six closed categories, three tiers each. Legendary progression is checked within each category. Exact reference-value probabilities, not production telemetry or guaranteed resale proceeds.\n`);
console.log('| Market | Case | Rarity-only mean return | Balanced mean return | Legendary | Rarity-only below tenth of cost | Balanced below tenth | At least half cost | Median return | Break-even or better |\n|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for(const index of [50,100,150])for(const definition of STORE_CASES){
 const group=rows.filter(row=>row.index===index&&row.id===definition.id);
 console.log(`| ${index} | ${definition.name} | ${pct(avg(group,'beforeMean'))} | ${pct(avg(group,'mean'))} | ${(avg(group,'legendary')*100).toFixed(6)}% | ${pct(avg(group,'beforeLow'))} | ${pct(avg(group,'low'))} | ${pct(avg(group,'usual'))} | ${pct(avg(group,'median'))} | ${pct(avg(group,'profit'))} |`);
}
console.log(`\nWorst chance of a very low return: ${pct(Math.max(...rows.map(row=>row.low)))}. Lowest usual-value probability: ${pct(Math.min(...rows.map(row=>row.usual)))}.`);
