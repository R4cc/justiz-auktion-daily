import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {caseCatalog,matchesTheme} from '../src/cases.mjs';
import {quoteCaseStore,publicCaseStore,STORE_CASES,STORE_CATEGORIES,LEGACY_STORE_CASES} from '../src/case-store.mjs';
import {caseOutcomeDistribution} from '../src/case-outcomes.mjs';
import {caseStockLimit} from '../src/case-stock.mjs';
import {Accounts} from '../src/accounts.mjs';
import {closeDataStore,upsertAuctions} from '../src/database.mjs';
import {prepareMysteryCase,insertSealedCase} from '../src/sealed-cases.mjs';
import {createCaseRebate} from '../src/case-rebates.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');
const real=JSON.parse(readFileSync(new URL('../seed/category-case-auctions.json',import.meta.url),'utf8')).auctions;
const themes=[['electronics','Laptop','Elektronik',20],['cars','BMW PKW','Fahrzeuge',500],['wine','Riesling Wein','Getränke',3],['tools','Bohrhammer','Werkzeuge',15],['jewellery','Gold Armbanduhr','Schmuck & Uhren',30],['collectibles','Lego Modell','Sammlerstücke',10]];
const broad=themes.flatMap(([category,title,group,base],i)=>Array.from({length:60},(_,n)=>({id:50000+i*100+n,title:`${title} ${50000+i*100+n}`,category:group,finalPrice:Math.round(base*(n+1)**1.4),image:'/test.jpg'})));

test('category pools are closed; each three-tier ladder improves price and rarity while meeting return criteria',()=>{
 for(const source of [[],real,broad])for(const offset of [0,1,7])for(const index of [50,100,150]){
  const catalog=caseCatalog(source,now+offset*86400000),indexes=Object.fromEntries(['electronics','vehicles','wine','tools','watches_jewelry','collectibles'].map(id=>[id,index]));
  let ordinary=null;
  for(const luckPercent of [0,7,32]){
   const quote=quoteCaseStore(catalog,indexes,{luckPercent});
   assert.equal(quote.cases.length,18);assert.equal(quote.categories.length,6);
   for(const category of STORE_CATEGORIES){
    const boxes=quote.cases.filter(box=>box.category===category.id);let previous=null;
    for(const box of boxes){
     const definition=STORE_CASES.find(entry=>entry.id===box.id);
     // Resolve original source records so wine descriptions remain available
     // for the same eligibility predicate used to build themed editions.
     for(const item of box.items){const original=[...source,...real].find(row=>row.id===item.auctionId);assert.ok(original&&matchesTheme(original,category.id),`${box.id}: wrong category`);}
     const outcomes=caseOutcomeDistribution(box.items,definition.weights,{basis:box.valueBasis,indexes,luckPercent,legendaryProbability:box.legendaryProbability});
     const ev=outcomes.reduce((sum,outcome)=>sum+outcome.value*outcome.probability,0)/box.valueBasis;
     const useful=outcomes.reduce((sum,outcome)=>sum+(outcome.value>=box.valueBasis*.5?outcome.probability:0),0);
     assert.ok(useful>=.99-1e-10,`${box.id}: useful floor`);
     if(!luckPercent)assert.ok(Math.abs(ev-.95)<1e-8,`${box.id}: ${ev}`);
     else{const base=ordinary.cases.find(entry=>entry.id===box.id);assert.equal(box.cost,base.cost);assert.ok(box.legendaryProbability>=base.legendaryProbability-1e-12);}
     if(previous){
      assert.ok(box.cost>previous.cost);assert.ok(box.legendaryProbability>previous.legendaryProbability);
      for(let minimum=1;minimum<5;minimum++){
       const tail=entry=>entry.dropChances.slice(minimum).reduce((sum,chance)=>sum+chance.percent,0);
       assert.ok(tail(box)>=tail(previous)-1e-8,`${box.id}: rarity progression at ${minimum}`);
      }
     }
     previous=box;
    }
   }
   const publicQuote=publicCaseStore(quote);assert.ok(publicQuote.cases.every(box=>!('items' in box)&&!('valueBasis' in box)&&!('legendaryProbability' in box)));
   if(!luckPercent)ordinary=quote;
  }
 }
 assert.equal(STORE_CASES.reduce((sum,box)=>sum+caseStockLimit(box.id),0),228,'total supply stays close to the former225');
});

test('new category winners are private and frozen; every retired case receipt and saved winner still opens',async t=>{
 const dir=await mkdtemp('/tmp/jg-category-cases-'),accounts=new Accounts(dir,{now:()=>now}),user={id:'buyer',admin:true};
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,admin,created_at) VALUES('buyer','buyer','disabled',10000000,1,?)").run(now));
 upsertAuctions(dir,broad);const catalog=caseCatalog(broad,now),quote=quoteCaseStore(catalog);
 for(const definition of STORE_CASES){
  const item=accounts.buyCase(user,catalog,definition.id,`category-purchase-${definition.id}`,quote.revision);
  assert.equal(item.caseCategory,definition.category);assert.equal(item.caseStoreTier,definition.tier);assert.equal(item.caseDesign,definition.design);assert.ok(!('reward' in item));
  const saved=accounts.db(db=>JSON.parse(db.prepare('SELECT reward FROM sealed_cases WHERE inventory_id=?').get(item.id).reward));
  const reward=accounts.openSealedCase(user,item.id);assert.equal(reward.auctionId,saved.auctionId);assert.ok(quote.cases.find(box=>box.id===definition.id).items.some(candidate=>candidate.auctionId===reward.auctionId));
 }
 for(const definition of LEGACY_STORE_CASES){
  const prepared=prepareMysteryCase(catalog,{...definition,name:'Saved old case',badge:'OLD'},{now,random:()=>0});
  accounts.atomic(db=>{insertSealedCase(db,user.id,prepared,now);db.prepare('INSERT INTO case_purchases VALUES(?,?,?,?)').run(user.id,`old-category-receipt-${definition.id}`,definition.id,JSON.stringify(prepared.item));});
  const before=accounts.profile(user).tokens;closeDataStore(dir);
  const replay=accounts.buyCase(user,catalog,definition.id,`old-category-receipt-${definition.id}`,'old-quote');assert.equal(replay.id,prepared.item.id);assert.equal(accounts.profile(user).tokens,before);
  assert.equal(accounts.openSealedCase(user,prepared.item.id).auctionId,prepared.reward.auctionId);
  assert.throws(()=>accounts.buyCase(user,catalog,definition.id,`retired-new-request-${definition.id}`,quote.revision),/catalog_changed/);
 }
 accounts.db(db=>db.prepare('INSERT INTO case_rebates VALUES(?,?,?,?,?,?,?,?,NULL)').run('old-sale',user.id,'old-rebate-request-0001','vault',20,now,now+100000,now));
 assert.equal(createCaseRebate(dir,user,{caseId:'vault',percent:20,startsAt:now,endsAt:now+100000,requestId:'old-rebate-request-0001'},{now}).id,'old-sale');
});


test('tiny live value ranges use viable real same-category stock instead of breaking every quote',()=>{
 const tiny=Array.from({length:8},(_,n)=>({id:80000+n,title:`Laptop ${80000+n}`,category:'Elektronik',finalPrice:n+1,image:'/test.jpg'}));
 const quote=quoteCaseStore(caseCatalog(tiny,now),{electronics:12.5});
 const boxes=quote.cases.filter(box=>box.category==='electronics');
 assert.ok(boxes[0].cost<boxes[1].cost&&boxes[1].cost<boxes[2].cost);
 assert.ok(boxes.every(box=>box.items.every(item=>real.some(original=>original.id===item.auctionId&&matchesTheme(original,'electronics')))));
});
