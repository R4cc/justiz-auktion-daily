import { readFileSync } from 'node:fs';
import { caseCatalog, dailyCaseWeights, dailyRewardCatalog } from '../src/cases.mjs';
import { CASE_TIERS } from '../src/sealed-cases.mjs';
import { quoteCaseStore, STORE_CASES } from '../src/case-store.mjs';
import { caseOutcomeDistribution } from '../src/case-outcomes.mjs';
import { ECONOMY_BALANCE as balance, expectedItemValue } from '../src/economy-balance.mjs';
import { MARKET_CATEGORIES } from '../src/market.mjs';
import { NPC_BUYERS, npcValuation } from '../src/npc-buyers.mjs';
import { businessItemSaleChance, SHOP_TYPES, SHOP_SIZES } from '../src/businesses.mjs';
import { LOAN_OFFERS } from '../src/loans.mjs';
import { luckWeights } from '../src/skill-effects.mjs';
import { dealBlackjack, handValue, playBlackjack } from '../src/blackjack.mjs';
import { theftQuote } from '../src/storefronts.mjs';
import { recognitionChance } from '../src/theft-heat.mjs';

// Read-only reference model: never connects to a player's database.
const input = process.argv[2] || 'seed/auctions.json';
const themes = [['BMW PKW','Fahrzeuge',500],['Riesling Wein','Getränke',10],
  ['Laptop Lenovo','Elektronik',50],['Bohrhammer Makita','Werkzeuge',25],
  ['Gold Armbanduhr','Schmuck & Uhren',100],['Lego Modell','Sammlerstücke',20]];
const archive = input === '--stress' ? themes.flatMap(([title,category,base],t) =>
  Array.from({length:60},(_,n)=>({id:1000+t*100+n,title:`${title} ${1000+t*100+n}`,
    category,finalPrice:Math.round(base*(n+1)**1.35),image:'/audit.jpg'})))
  : JSON.parse(readFileSync(input,'utf8')).auctions;
// Image-free admin exports need a catalog eligibility placeholder in this
// model only. Neither the archive file nor production data is changed.
const source = archive.map(item=>({...item,image:item.image||'/audit.jpg'}));
const start = Date.parse('2026-10-23T12:00:00Z');
const average = values=>values.reduce((a,b)=>a+b,0)/values.length;
const pct = value=>`${(value*100).toFixed(2)}%`;
const table = (heading,columns,rows)=>console.log(`\n## ${heading}\n\n| ${columns.join(' | ')} |\n| ${columns.map(()=> '---:').join(' | ')} |\n${rows.map(row=>`| ${row.join(' | ')} |`).join('\n')}`);
console.log(`# Economy balance audit — 23 October 2026\n\nSource: ${input}; ${archive.length} lots. Case figures average exact outcome distributions over 30 UTC rotations and uniform market indexes 50, 100 and 150. These are reproducible reference-value scenarios, not production telemetry or guaranteed sale proceeds. No player data is written.\n\nThe benchmark is a mixed casual economy: Daily income should support participation; trade and stores should reward capital, stock and time; theft should escalate in risk rather than replace ordinary income. The 20% cap applies to every numerical adjustment in this pass. Larger structural loopholes remain deferred.`);
table('Changes in this pass',['Setting','Before','After','Relative change'],[
 ['Higher or Lower per correct answer',25,balance.higherLowerPerCorrect,pct(balance.higherLowerPerCorrect/25-1)],
 ['Higher or Lower best-of-day cap',250,balance.higherLowerMax,pct(balance.higherLowerMax/250-1)],
 ['New loan overdue daily interest','36%',`${LOAN_OFFERS[0].overdueInterestPercent}%`,pct(LOAN_OFFERS[0].overdueInterestPercent/36-1)]
]);
console.log('\nThe three-correct threshold, daily top-ups and completed receipts remain intact. Started Higher or Lower runs retain their saved rates. New loans keep their five-day initial rates; all existing loan contracts retain saved fees, rates and deadlines.');

const results=[];
for(const index of [50,100,150])for(let day=0;day<30;day++){
 const indexes=Object.fromEntries(MARKET_CATEGORIES.map(category=>[category.id,index]));
 const catalog=caseCatalog(source,start+day*86400000);
 if(!catalog.cases.find(box=>box.id==='fundkiste')?.available)throw new Error('insufficient_audit_archive');
 for(const luckPercent of [0,32]){
  const offers=quoteCaseStore(catalog,indexes,{luckPercent}).cases;
  for(let i=1;i<offers.length;i++)if(!(offers[i].legendaryProbability>offers[i-1].legendaryProbability))throw new Error('inverted_legendary_odds');
  for(const [i,offer] of offers.entries()){
   const outcomes=caseOutcomeDistribution(offer.items,STORE_CASES[i].weights,{basis:offer.valueBasis,indexes,luckPercent,legendaryProbability:offer.legendaryProbability});
   results.push({index,luckPercent,id:offer.id,cost:offer.cost,
    mean:outcomes.reduce((sum,o)=>sum+o.value*o.probability,0)/offer.cost,
    usual:outcomes.reduce((sum,o)=>sum+(o.value>=offer.valueBasis*.5?o.probability:0),0),
    legendary:offer.legendaryProbability});
  }
 }
}
table('Current Case Store outcomes',['Market','Case','Mean cost','Mean return','Max Luck return','At least half cost','Legendary'],
 [50,100,150].flatMap(index=>STORE_CASES.map(box=>{
  const base=results.filter(row=>row.index===index&&row.id===box.id&&row.luckPercent===0);
  const lucky=results.filter(row=>row.index===index&&row.id===box.id&&row.luckPercent===32);
  return [index,box.name,average(base.map(row=>row.cost)).toFixed(0),pct(average(base.map(row=>row.mean))),pct(average(lucky.map(row=>row.mean))),pct(average(base.map(row=>row.usual))),`${(100*average(base.map(row=>row.legendary))).toFixed(6)}%`];
 })));
console.log(`\nLegendary odds ascend at every examined rotation, market and Luck setting. Lowest examined probability of receiving at least half the undiscounted cost: ${pct(Math.min(...results.map(row=>row.usual)))}. Sparse pools may prevent the return fit; this report measures actual available items. Existing poor unopened paid cases retain their first-opening upgrade rule. Discounts and rebates lower payment without lowering the draw basis.\n\nAt a 95% reference return, illustrative liquidation at 60% / 80% / 96% of value recovers 57% / 76% / 91.2% of full purchase cost. A sale at 120% of value would return 114% before waiting time, acquisition availability, store setup, guards, theft or price movement. Thus paid cases are not an unconditional currency sink through every selling route. The permanent half-price Prestige perk can produce about 190% reference return on payment; finite stock and the Prestige reset remain its intended constraints.`);

const pool=dailyRewardCatalog(caseCatalog(source,start),[],start).cases.find(box=>box.id==='fundkiste');
if(!pool?.available)throw new Error('insufficient_daily_pool');
table('Participation income',['Daily score','Cash','Free case mean value','With maximum Luck'],[0,2500,5000].map(score=>{
 const value=luck=>dailyCaseWeights(score).reduce((sum,w,i)=>sum+w/10000*expectedItemValue(pool.items,luckWeights(CASE_TIERS[i].weights,luck)),0);
 return [score,balance.daily,value(0).toFixed(2),value(32).toFixed(2)];
}));
console.log(`\nStarting cash is J€${balance.startingTokens}. Daily grants one bounded physical case plus cash once per UTC day. Higher or Lower now pays J€${balance.higherLowerPerCorrect} × final streak from ${balance.minimumStreak} correct, up to J€${balance.higherLowerMax}; improved runs only top up the best reward already paid that day. Daily grants 150 XP. Level 10 requires 8,100 XP, or 54 Daily completions without sale XP. Prestige resets spendable wealth and retains permanent, non-stacking perks; their current values are unchanged.`);

table('NPC resale reference ceilings',['Market','Ordinary minimum','Ordinary maximum','Preferred collector maximum','Mean show-up probability'],[50,100,150].map(index=>{
 const regular=[],collectors=[],shares=[];
 for(const npc of NPC_BUYERS){
  const value=npcValuation({price:10000,marketCategory:'electronics'},{electronics:index},npc,'audit-lot');
  (npc.collector&&npc.categories.includes('electronics')?collectors:regular).push(value.maxBid/(10000*index/100));shares.push(value.probability);
 }
 return [index,pct(Math.min(...regular)),pct(Math.max(...regular)),pct(Math.max(...collectors)),pct(average(shares))];
}));
console.log('\nThese are willingness-to-pay ceilings for one electronics example, not settlement prices. The configured preferred-collector cap is 105%; individual buyer ceilings can be lower. NPCs have finite wallets, category preferences, stable audiences and shared six-hour demand depth. Bulk quantity discounts bottom out at 75%; exhausted demand bottoms out at 35%. Escrow returns unused bids. Ordinary player trades move existing items and currency, with the important Prestige subsidy exceptions documented separately. Current production retires legacy wholesale supply instead of continually generating eight wholesale lots. Mystery palettes, individual NPC lots and player auctions supply stores.');

const wine=SHOP_TYPES.find(type=>type.id==='wine');
table('Store markup sensitivity',['Markup','Purchase chance / typical wine visitor','Profit per reference unit at hypothetical 85% cost','Expected profit / visitor'],[0,20,30,60,100].map(margin=>{
 const chance=businessItemSaleChance(wine,margin,wine.typicalValue),profit=1+margin/100-.85;
 return [`${margin}%`,pct(chance),pct(profit),(chance*profit).toFixed(4)];
}));
const popup=SHOP_SIZES.find(size=>size.id==='popup');
table('Store category capital comparison',['Type','Opening cost','Unlimited-restock units / day','Gross profit / day','Setup + replacement stock','Gross return / that capital'],SHOP_TYPES.map(type=>{
 const units=popup.visitorsPerHour*24*businessItemSaleChance(type,20,type.typicalValue);
 const profit=units*type.typicalValue*(1.2-.85),capital=popup.cost*type.costFactor+units*type.typicalValue*.85;
 return [type.id,popup.cost*type.costFactor,units.toFixed(2),profit.toFixed(0),capital.toFixed(0),pct(profit/capital)];
}));
console.log('\nBoth store tables use an illustrative 85% acquisition basis, not an active wholesale offer. The category table assumes neutral location, popularity 1, typical-value stock and continuous restocking; it excludes guards, losses, events, tax-like sinks and capacity. It is a comparative ceiling, not a daily income promise. A car pop-up holds one unit versus ten ordinary units, and variety/empty shelves further constrain turnover. Expensive goods sell more slowly through the square-root affordability penalty. The default 20% margin remains near the profit optimum for that illustrative cost basis. Security Guards charge 5% of tracked positive profit with loss carry-forward. Three-store limits, upgrades, town plots, reviews and events remain unchanged.');

let state=123456789;
const random=max=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/2**32*max);};
const hands=600000,counts={win:0,lose:0,push:0};
for(let n=0;n<hands;n++){
 const game=dealBlackjack(random);
 while(game.outcome==='active'){
  const {total,soft}=handValue(game.player),rank=Math.min(game.dealer[0]%13+1,10),dealer=rank===1?11:rank;
  const stand=soft?total>=19||total===18&&[2,7,8].includes(dealer):total>=17||total>=13&&dealer<=6||total===12&&dealer>=4&&dealer<=6;
  playBlackjack(game,stand?'stand':'hit');
 }
 counts[game.outcome]++;
}
console.log(`\n## Theft and Heat\n\n${hands.toLocaleString('en-US')} seeded fair single-deck hit/stand hands: ${pct(counts.win/hands)} win, ${pct(counts.lose/hands)} loss, ${pct(counts.push/hands)} push. Dealer stands on soft 17. No deck or cooldown adjustments are made.`);
table('J€100 theft reference scenarios',['Starting stars','Catch after loss','Saved fine','Fully paid expected net','Recognition / eligible check'],[0,1,2,4,6,8,9,10].map(heat=>{
 const quote=theftQuote(100,false,1,0,0,heat);
 return [heat/2,`${quote.policeCatchPercent}%`,quote.fine,(counts.win/hands*100-counts.lose/hands*quote.policeCatchPercent/100*quote.fine).toFixed(2),`${recognitionChance(heat)}%`];
}));
console.log('\nExpected net assumes the item realizes J€100 and the entire fine is paid; it omits time, Heat decay and later recognition. Insolvent settlement is a documented loophole, so this is not a conservation claim. Guards and Stealth modify catch odds but never the cards. Each committed attempt adds half a star and success adds more by value and quantity; accepted terms freeze before that increment. Half a star decays per thirty real minutes. Recognition begins at four stars, checks at most once every two minutes, and can impose a saved fine or timed jail. The approved curve, escalating fines and decay remain unchanged.');

table('New loan cash-flow limits',['Loan','Principal','First five days / day','After maturity / day','Debt at day 6, no payments','Previously at day 6'],LOAN_OFFERS.map(offer=>[
 offer.id,offer.principal,`${offer.dailyInterestPercent}%`,`${offer.overdueInterestPercent}%`,
 Math.ceil(offer.principal*(1+5*offer.dailyInterestPercent/100+offer.overdueInterestPercent/100)),
 Math.ceil(offer.principal*(1+5*offer.dailyInterestPercent/100+.36))
]));
console.log('\nOnly the overdue rate on new borrowing falls, by 16.67% relatively. Principal is liquidity, not income or equity; remaining debt is subtracted from net worth. Offline accrual, one active loan, the 24-hour borrowing cooldown, level/equity gates and overdue wallet collection remain unchanged. Old contracts are never repriced.');

const floor=(balance.paletteProfitChance*balance.paletteProfitReturnPercent+(100-balance.paletteProfitChance)*balance.paletteMinimumReturnPercent)/10000;
console.log(`\n## Palettes and supply\n\nMystery stock has eighteen category/size offers with one live auction per offer, 30/60/90-minute durations and a one-minute gap. The first opening uses the actual winning bid: ${balance.paletteProfitChance}% of branches return at least ${balance.paletteProfitReturnPercent}% in reference value; every other branch at least ${balance.paletteMinimumReturnPercent}%. The resulting minimum mean is ${pct(floor)}, before natural jackpots. Supplemented physical copies carry a share of the actual acquisition cost. Saved results replay unchanged. Competitive bids and opening-time markets matter; physical value is not cash.\n\nAt the minimum protected mean, realization at 60% or 80% of reference gives only ${pct(floor*.6)} or ${pct(floor*.8)} of the winning bid. Run \`node scripts/palette-profit-report.mjs\` or add \`--stress\` for the separate quantity/protection analysis. Legacy ordinary sealed cases retain their distinct supply and frozen outcome rules; current primary palette payments remove currency and opening creates physical inventory. No supply rates or palette protections change here.\n\n## Deferred structural issues and limits\n\nSee [documented economy loopholes](economy-loopholes.md) for unpaid theft compensation, repeat secondary-case Prestige subsidies, and profitable player-to-player Prestige wash trades. They are deliberately not patched under this pass's universal 20% limit. Ordinary receipt idempotency does not prevent those separate economic loops. Their existence limits claims about aggregate currency conservation.\n\nThis report does not model player cooperation, real liquidation rates, turnover, borrowing behavior or retention. Market frenzy and manual event timing can change outcomes after purchase. Historical archive snapshots and synthetic scenarios are references; tune further only with measured production behavior and separately approved structural fixes.`);
