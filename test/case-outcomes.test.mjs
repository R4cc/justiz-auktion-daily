import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {caseOutcomeDistribution,drawCaseOutcome} from '../src/case-outcomes.mjs';
import {priceCaseCatalog,caseCatalog} from '../src/cases.mjs';
import {STORE_CASES,quoteCaseStore,loadCaseStoreCatalog} from '../src/case-store.mjs';
import {prepareMysteryCase,insertSealedCase} from '../src/sealed-cases.mjs';
import {Accounts} from '../src/accounts.mjs';
import {closeDataStore,upsertAuctions} from '../src/database.mjs';
import {acquireItems} from '../src/trader.mjs';
import {estimatedValueTokens,marketIndexes} from '../src/market.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');
const rarities=['common','uncommon','rare','epic','legendary'];
const items=rarities.flatMap((rarity,tier)=>Array.from({length:10},(_,n)=>({
  auctionId:tier*10+n,title:tier===0&&n===0?'Cheap wine':'Laptop '+(tier*10+n),rarity,price:tier===0&&n===0?11:[600,1000,1600,3000,8000][tier]+n*[100,150,300,600,1000][tier],category:'Elektronik',image:'/test.jpg'})));
const mean=outcomes=>outcomes.reduce((sum,outcome)=>sum+outcome.value*outcome.probability,0);
const probability=(outcomes,predicate)=>outcomes.reduce((sum,outcome)=>sum+(predicate(outcome)?outcome.probability:0),0);

test('expensive cases almost always return useful value; the actual sampler matches the value-aware odds',()=>{
  const outcomes=caseOutcomeDistribution(items,STORE_CASES[4].weights,{basis:2000});
  assert.ok(Math.abs(mean(outcomes)/2000-.95)<1e-9);
  assert.ok(probability(outcomes,outcome=>outcome.value<1000)<=.01+1e-12);
  assert.ok(probability(outcomes,outcome=>outcome.value===11)<.001);
  assert.ok(probability(outcomes,outcome=>outcome.value>=2000)>.1);
  const counts=new Map(),samples=50000;
  for(let ticket=0;ticket<samples;ticket++){
    const winner=drawCaseOutcome(outcomes,max=>Math.floor((ticket+.5)/samples*max));
    counts.set(winner.auctionId,(counts.get(winner.auctionId)||0)+1);
  }
  for(const outcome of outcomes)assert.ok(Math.abs((counts.get(outcome.item.auctionId)||0)/samples-outcome.probability)<=2/samples);
});

test('Luck improves rarity and value without changing prices; sparse and equal-valued pools stay finite',()=>{
  for(const definition of STORE_CASES){
    const base=caseOutcomeDistribution(items,definition.weights,{basis:2000});
    for(const luckPercent of [3,7,25,32]){
      const lucky=caseOutcomeDistribution(items,definition.weights,{basis:2000,luckPercent});
      assert.ok(mean(lucky)>=mean(base)-1e-8);
      assert.ok(mean(lucky)<=mean(base)*(1+luckPercent/100)+1e-8);
      assert.ok(probability(lucky,outcome=>outcome.item.rarity==='legendary')>=probability(base,outcome=>outcome.item.rarity==='legendary'));
      assert.ok(probability(lucky,outcome=>outcome.value<1000)<=.01+1e-12);
    }
  }
  for(const price of [1,100,10000]){
    const equal=items.map(item=>({...item,price})),outcomes=caseOutcomeDistribution(equal,STORE_CASES[0].weights,{basis:2000});
    assert.ok(outcomes.every(outcome=>Number.isFinite(outcome.probability)&&outcome.probability>0));
    assert.equal(Math.round(mean(outcomes)),price);
    assert.equal(drawCaseOutcome(outcomes,()=>0).price,price);
  }
});

test('published odds match prepared winners, prices and rebates do not weaken contents, and seeds remain private',()=>{
  const catalog={revision:'fixture',rotationDate:'2026-10-23',cases:[{id:'fundkiste',available:true,items}]};
  const normal=quoteCaseStore(catalog),sale=quoteCaseStore(catalog,{}, {caseDiscountPercent:50,rebates:[{id:'sale',caseId:'all',percent:50,endsAt:now+10000}]});
  const freeOptions={rebates:[{id:'free',caseId:'all',percent:100,endsAt:now+10000}]};
  const freeCold=quoteCaseStore(catalog,{electronics:100},freeOptions),freeHot=quoteCaseStore(catalog,{electronics:110},freeOptions);
  assert.ok(freeCold.cases.every(box=>box.cost===0)&&freeHot.cases.every(box=>box.cost===0));
  assert.notEqual(freeCold.revision,freeHot.revision,'changed outcome values invalidate even a free price quote');
  for(const [i,definition]of STORE_CASES.entries()){
    const offer=normal.cases[i],discount=sale.cases[i];
    assert.equal(offer.valueBasis,discount.valueBasis);assert.deepEqual(offer.items,discount.items);assert.deepEqual(offer.dropChances,discount.dropChances);
    const outcomes=caseOutcomeDistribution(offer.items,definition.weights,{basis:offer.valueBasis,legendaryProbability:offer.legendaryProbability});
    for(const chance of offer.dropChances)assert.ok(Math.abs(chance.percent/100-probability(outcomes,outcome=>outcome.item.rarity===chance.rarity))<1e-9);
    for(const q of [.001,.1,.5,.9,.999]){
      const random=max=>Math.floor(q*max);
      const prepared=prepareMysteryCase(catalog,definition,{now,random,valueBasis:offer.valueBasis,drawItems:offer.items,legendaryProbability:offer.legendaryProbability});
      assert.equal(prepared.reward.auctionId,drawCaseOutcome(outcomes,random).auctionId);
      assert.equal(prepared.item.caseBalanceVersion,1);assert.ok(!('reward'in prepared.item));
    }
  }
});

test('legendary odds increase along the price ladder across rotations, markets and Luck, preserving useful returns',()=>{
  const starter=JSON.parse(readFileSync(new URL('../seed/auctions.json',import.meta.url),'utf8')).auctions;
  const synthetic=Array.from({length:160},(_,n)=>({id:20000+n,title:`Laptop ${20000+n}`,category:'Elektronik',finalPrice:Math.round(10*(n+1)**1.8),image:'/test.jpg'}));
  for(const archive of [starter,synthetic])for(const day of [0,1,7])for(const index of [50,100,150]){
    const catalog=caseCatalog(archive,now+day*86400000),indexes={electronics:index,cars:200-index,wine:index};
    let previousLuck=null;
    for(const luckPercent of [0,7,32]){
      const quote=quoteCaseStore(catalog,indexes,{luckPercent});let previousChance=0;
      for(const [i,box]of quote.cases.entries()){
        if(i%3===0)previousChance=0;
        const options={basis:box.valueBasis,indexes,luckPercent,legendaryProbability:box.legendaryProbability};
        const outcomes=caseOutcomeDistribution(box.items,STORE_CASES[i].weights,options);
        const chance=probability(outcomes,outcome=>outcome.item.rarity==='legendary');
        assert.ok(chance>previousChance,`${box.id}: legendary chance must increase with price`);previousChance=chance;
        assert.ok(Math.abs(box.dropChances.at(-1).percent/100-chance)<1e-12);
        assert.ok(Math.abs(outcomes.reduce((sum,outcome)=>sum+outcome.probability,0)-1)<1e-12);
        assert.ok(outcomes.every(outcome=>Number.isFinite(outcome.probability)&&outcome.probability>0));
        assert.ok(probability(outcomes,outcome=>outcome.value>=box.valueBasis*.5)>=.99-1e-12);
        const independent=caseOutcomeDistribution(box.items,STORE_CASES[i].weights,{basis:box.valueBasis,indexes,luckPercent});
        const ordinaryMaximum=Math.max(...outcomes.filter(outcome=>outcome.item.rarity!=='legendary').map(outcome=>outcome.value));
        assert.ok(mean(outcomes)>=Math.min(mean(independent),ordinaryMaximum*.99)-1e-8);
        if(previousLuck)assert.ok(chance>=previousLuck.cases[i].legendaryProbability-1e-12,'Luck never reduces legendary odds');
        // Exercise both sides of the actual legendary sampler interval, rather
        // than checking labels alone. Highest-value legendary items are last.
        for(const factor of [.9,1.1]){
          const random=max=>Math.floor((1-chance*factor)*max);
          const prepared=prepareMysteryCase(catalog,STORE_CASES[i],{now,random,valueBasis:box.valueBasis,drawItems:box.items,...options});
          assert.equal(prepared.reward.rarity==='legendary',factor<1);
          assert.equal(prepared.reward.auctionId,drawCaseOutcome(outcomes,random).auctionId);
        }
      }
      previousLuck=quote;
    }
  }
});

async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'jg-case-value-')),accounts=new Accounts(dir,{now:()=>now}),user={id:'buyer'};
  accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('buyer','buyer','disabled',100000,?)").run(now));
  upsertAuctions(dir,Array.from({length:100},(_,n)=>({id:1000+n,title:`Laptop model ${1000+n}`,category:'Elektronik',finalPrice:50*(n+1),image:'/test.jpg'})));
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const insert=(price,cost=2000,version=0)=>{
    const catalog=loadCaseStoreCatalog(dir,now),prepared=prepareMysteryCase(catalog,STORE_CASES[4],{now,random:()=>0});
    prepared.item.caseCost=cost;if(version)prepared.item.caseBalanceVersion=version;
    prepared.reward={...prepared.reward,title:'Saved wine',rarity:'common',price,sellValue:price,marketCategory:'wine',caseCost:cost};
    accounts.atomic(db=>{insertSealedCase(db,user.id,prepared,now);acquireItems(db,user.id,[prepared.item.id],cost,cost?'purchase':'reward',now);});
    return prepared;
  };
  return {dir,accounts,user,insert};
}

test('existing unopened paid cases upgrade once, preserve acquisition costs and replay across restarts',async t=>{
  const f=await fixture(t),old=f.insert(11),before=f.accounts.profile(f.user).tokens;
  const result=f.accounts.openSealedCase(f.user,old.item.id,{random:max=>max-1});
  assert.ok(estimatedValueTokens(result)>=1000);assert.equal(result.id,old.reward.id);assert.equal(result.caseCost,2000);
  assert.equal(f.accounts.profile(f.user).tokens,before);
  closeDataStore(f.dir);
  assert.deepEqual(f.accounts.openSealedCase(f.user,old.item.id,{random:()=>{throw Error('reroll');}}),result);
  assert.equal(f.accounts.inventory(f.user).filter(item=>item.id===result.id).length,1);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT cost FROM item_acquisitions WHERE inventory_id=?').get(result.id).cost),2000);
});

test('valuable saved wins, free cases and newly balanced frozen cases remain intact; tiny old outcomes stay rare',async t=>{
  const f=await fixture(t);
  for(const [price,cost,version]of [[8000,2000,0],[11,0,0],[11,2000,1]]){
    const prepared=f.insert(price,cost,version);
    assert.deepEqual(f.accounts.openSealedCase(f.user,prepared.item.id,{random:()=>{throw Error('must not reroll');}}),prepared.reward);
  }
  const rare=f.insert(11);
  assert.deepEqual(f.accounts.openSealedCase(f.user,rare.item.id,{random:()=>0}),rare.reward);
  assert.deepEqual(f.accounts.openSealedCase(f.user,rare.item.id,{random:()=>{throw Error('retry');}}),rare.reward);
});

test('failed first openings roll back upgrades, stock ownership and the sealed result together',async t=>{
  const f=await fixture(t),prepared=f.insert(11);
  f.accounts.db(db=>db.exec("CREATE TRIGGER fail_case_find BEFORE INSERT ON inventory WHEN json_extract(NEW.item,'$.kind') IS NULL BEGIN SELECT RAISE(ABORT,'opening_failed'); END"));
  assert.throws(()=>f.accounts.openSealedCase(f.user,prepared.item.id,{random:max=>max-1}),/opening_failed/);
  const saved=f.accounts.db(db=>db.prepare('SELECT reward,opened_at FROM sealed_cases WHERE inventory_id=?').get(prepared.item.id));
  assert.equal(saved.opened_at,null);assert.deepEqual(JSON.parse(saved.reward),prepared.reward);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT sold_at FROM inventory WHERE id=?').get(prepared.item.id).sold_at),null);
  f.accounts.db(db=>db.exec('DROP TRIGGER fail_case_find'));
  assert.ok(estimatedValueTokens(f.accounts.openSealedCase(f.user,prepared.item.id,{random:max=>max-1}))>=1000);
});


test('legacy paid direct-open cases also use value-aware draws within their own theme and keep retry receipts',async t=>{
  const f=await fixture(t),catalog=loadCaseStoreCatalog(f.dir,now),quote=f.accounts.db(db=>priceCaseCatalog(catalog,marketIndexes(db,now)));
  const offer=quote.cases.find(box=>box.id==='fundkiste'),before=f.accounts.profile(f.user).tokens;
  const item=f.accounts.openCase(f.user,quote,offer.id,'legacy-balanced-case-0001',quote.revision,{random:max=>Math.floor(max*.75)});
  assert.ok(offer.items.some(candidate=>candidate.auctionId===item.auctionId));
  assert.ok(estimatedValueTokens(item)>=offer.cost*.5);
  assert.equal(f.accounts.profile(f.user).tokens,before-offer.cost);
  assert.deepEqual(f.accounts.openCase(f.user,quote,offer.id,'legacy-balanced-case-0001',quote.revision,{random:()=>{throw Error('redraw');}}),item);
});
