import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { skillTree, upgradeSkill } from '../src/skill-tree.mjs';
import { luckWeights, skillEffects } from '../src/skill-effects.mjs';
import { expectedItemValue } from '../src/economy-balance.mjs';
import { loadCaseStoreCatalog, quoteCaseStore, STORE_CASES } from '../src/case-store.mjs';
import { prepareMysteryCase } from '../src/sealed-cases.mjs';
import { stockPaletteCatalog, buyStockPalette, revealStockPalette, STOCK_PALETTE_TIERS } from '../src/stock-palettes.mjs';
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { visitStore, listStores, buyStoreItem, reviewStore, startStoreHeist, ensureStoreSchema } from '../src/storefronts.mjs';
import { marketIndexes } from '../src/market.mjs';
const now=Date.parse('2026-10-12T12:00:00Z');
async function fixture(t,xp=36100){
 const dir=await mkdtemp('/tmp/jg-skills-'),accounts=new Accounts(dir,{now:()=>now});
 accounts.db(db=>{for(const id of ['owner','buyer','other'])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',1000000,?,?)").run(id,id,xp,now);});
 const archive=['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'].map((title,index)=>({id:83000+index,title:title+' Wine',category:'Getränke',image:'/assets/makita.jpg',finalPrice:10*(index+1)**2}));upsertAuctions(dir,archive);
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 const user={id:'buyer'},tree=()=>skillTree(dir,user,{now}),upgrade=(id,rank,requestId=`skill-${id}-${rank}-request-0001`)=>upgradeSkill(dir,user,{skillId:id,rank,requestId},{now});
 return {dir,accounts,user,tree,upgrade};
}

test('points backfill from fresh XP at every level, accrue once, and are account-private',async t=>{
 const f=await fixture(t,0);
 for(let level=1;level<=20;level++){
  f.accounts.db(db=>db.prepare("UPDATE users SET xp=? WHERE id='buyer'").run(100*(level-1)**2));
  const tree=f.tree();assert.equal(tree.level,level);assert.equal(tree.earned,level);assert.equal(tree.available,level);assert.equal(f.tree().available,level);
  assert.equal(f.accounts.profile(f.user).skills.available,level);
 }
 f.upgrade('luck',1);assert.equal(f.tree().available,19);assert.equal(skillTree(f.dir,{id:'other'},{now}).available,1);
 assert.equal(f.tree().skills.filter(s=>s.available).length,4);assert.equal(f.tree().skills.filter(s=>!s.available).length,6);
});
test('Market Intelligence has one rank costing five points, with exact mixed-branch accounting and safe retries',async t=>{
 const f=await fixture(t,900); // Level four is one point short.
 const definition=f.tree().skills.find(skill=>skill.id==='market-intelligence');
 assert.equal(definition.name,'Market Intelligence');assert.equal(definition.ranks.length,1);
 assert.deepEqual(definition.ranks[0],{rank:1,cost:5,available:true});
 assert.throws(()=>f.upgrade('market-intelligence',1),/insufficient_skill_points/);
 f.accounts.db(db=>db.prepare("UPDATE users SET xp=1600 WHERE id='buyer'").run());
 assert.equal(f.upgrade('market-intelligence',1).available,0);
 assert.equal(f.upgrade('market-intelligence',1).spent,5);
 assert.equal(f.accounts.profile(f.user).skills.ranks['market-intelligence'],1);
 assert.equal(f.accounts.profile(f.user).skills.spent,5);
 assert.throws(()=>f.upgrade('market-intelligence',1,'stale-intelligence-request-001'),/skill_rank_changed/);
 assert.throws(()=>f.upgrade('market-intelligence',2),/skill_coming_soon/);
 assert.throws(()=>f.upgrade('luck',1),/insufficient_skill_points/);
 assert.equal(skillTree(f.dir,{id:'other'},{now}).ranks['market-intelligence'],undefined);
 f.accounts.db(db=>db.prepare("UPDATE users SET xp=36100 WHERE id='buyer'").run());
 for(let rank=1;rank<=3;rank++)f.upgrade('luck',rank);
 assert.equal(f.tree().spent,15);assert.equal(f.tree().available,5);
 f.accounts.resetEconomy({id:'owner',admin:true},'RESET ECONOMY');
 assert.equal(f.tree().spent,0);assert.equal(f.tree().ranks['market-intelligence'],undefined);
});
test('rank costs are 1, 3, 6, then locked 12; retries, stale tabs and forged fields cannot overspend',async t=>{
 const f=await fixture(t);const before=f.accounts.profile(f.user).tokens;
 for(const [rank,spent,bonus] of [[1,1,3],[2,4,5],[3,10,7]]){
  const tree=f.upgrade('luck',rank);assert.equal(tree.spent,spent);assert.equal(tree.available,20-spent);assert.equal(tree.luckPercent,bonus);
  assert.equal(f.upgrade('luck',rank).spent,spent);assert.throws(()=>f.upgrade('luck',rank,`stale-rank-request-${rank}-0001`),/skill_rank_changed/);
 }
 assert.throws(()=>f.upgrade('luck',4),/skill_coming_soon/);assert.throws(()=>f.upgrade('negotiation',1),/skill_coming_soon/);assert.throws(()=>f.upgrade('unknown',1),/invalid_skill/);
 assert.throws(()=>f.upgrade('influence',3),/skill_rank_changed/);assert.throws(()=>f.upgrade('influence','1'),/invalid_skill_rank/);
 assert.throws(()=>f.upgrade('security',1,'skill-luck-1-request-0001'),/request_conflict/);
 for(let rank=1;rank<=3;rank++)f.upgrade('security',rank);assert.equal(f.tree().available,0);
 assert.throws(()=>upgradeSkill(f.dir,f.user,{skillId:'influence',rank:1,requestId:'forged-point-request-0001',points:999,cost:0,userId:'other'},{now}),/insufficient_skill_points/);
 assert.equal(f.accounts.profile(f.user).tokens,before);assert.equal(f.tree().spent,20);
});
test('upgrades roll back rank and points if receipt persistence fails; reset clears skills',async t=>{
 const f=await fixture(t);f.accounts.db(db=>db.exec("CREATE TRIGGER reject_skill_receipt BEFORE INSERT ON skill_purchases BEGIN SELECT RAISE(ABORT,'receipt_failed'); END"));
 assert.throws(()=>f.upgrade('luck',1),/receipt_failed/);assert.equal(f.tree().available,20);assert.deepEqual(f.tree().ranks,{});
 f.accounts.db(db=>db.exec('DROP TRIGGER reject_skill_receipt'));f.upgrade('luck',1);
 f.accounts.resetEconomy({id:'owner',admin:true},'RESET ECONOMY');assert.equal(f.tree().available,1);assert.deepEqual(f.tree().ranks,{});
 assert.equal(f.accounts.db(db=>db.prepare('SELECT count(*) n FROM skill_purchases').get().n),0);
});
test('luck is exact integer relative weighting with expected return bounded below 88% at max rank',()=>{
 const rarities=['common','uncommon','rare','epic','legendary'];
 for(const definition of [...STORE_CASES,...STOCK_PALETTE_TIERS,{weights:[0,0,9000,980,20]},{weights:[0,0,0,0,10000]}]){
  for(const values of [[1,10,100,1000,10000],[1,1,1,1,100000000],[100,100,100,100,100]]){
   const items=rarities.map((rarity,index)=>({rarity,price:values[index]})),base=expectedItemValue(items,definition.weights);
   for(const bonus of [3,5,7]){const weights=luckWeights(definition.weights,bonus),boosted=expectedItemValue(items,weights);
    assert.ok(weights.every(Number.isSafeInteger));assert.ok(boosted<=base*(1+bonus/100)+1e-6);assert.ok(.82*boosted/base<.88);assert.ok(boosted>=base-1e-6);
   }
  }
 }
 assert.deepEqual(luckWeights([7500,2000,450,49,1],3),[750000,206000,46350,5047,103]);
 assert.throws(()=>luckWeights([1,2],50),/invalid_luck_bonus/);
});
test('paid case quotes show boosted odds at unchanged prices, real draws improve, and sealed rewards never reroll',async t=>{
 const f=await fixture(t),catalog=loadCaseStoreCatalog(f.dir,now),indexes=f.accounts.db(db=>marketIndexes(db,now)),base=quoteCaseStore(catalog,indexes);
 const old=f.accounts.buyCase(f.user,catalog,'electronics-standard','before-skill-case-0001',base.revision),stored=f.accounts.db(db=>db.prepare('SELECT reward FROM sealed_cases WHERE inventory_id=?').get(old.id).reward);
 for(let rank=1;rank<=3;rank++)f.upgrade('luck',rank);
 const lucky=quoteCaseStore(catalog,indexes,{luckPercent:7});assert.deepEqual(lucky.cases.map(c=>c.cost),base.cases.map(c=>c.cost));assert.notEqual(lucky.revision,base.revision);assert.equal(lucky.luckPercent,7);
 assert.ok(lucky.cases[0].dropChances[4].percent>base.cases[0].dropChances[4].percent);
 assert.throws(()=>f.accounts.buyCase(f.user,catalog,'electronics-standard','stale-skill-case-0001',base.revision),/catalog_changed/);
 const item=f.accounts.buyCase(f.user,catalog,'electronics-standard','after-skill-case-0001',lucky.revision);assert.equal(item.luckPercent,7);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT reward FROM sealed_cases WHERE inventory_id=?').get(old.id).reward),stored);
 const first=prepareMysteryCase(catalog,STORE_CASES[0],{random:max=>Math.floor(max*.745)}),second=prepareMysteryCase(catalog,STORE_CASES[0],{luckPercent:7,random:max=>Math.floor(max*.745)});
 assert.equal(first.reward.rarity,'common');assert.equal(second.reward.rarity,'uncommon');
});
test('stock palettes use owner luck in quote and frozen actual draws, without boosting quantity or prices',async t=>{
 const f=await fixture(t),base=stockPaletteCatalog(f.dir,{now,userId:'buyer'});
 const payload={offerId:'wine-standard',revision:base.revision,requestId:'before-skill-palette-0001'},old=buyStockPalette(f.dir,f.user,payload,{now,allowLegacyPurchase:true});
 const saved=f.accounts.db(db=>db.prepare('SELECT rewards FROM stock_palette_purchases WHERE id=?').get(old.id).rewards);
 for(let rank=1;rank<=3;rank++)f.upgrade('luck',rank);
 const lucky=stockPaletteCatalog(f.dir,{now,userId:'buyer'});assert.deepEqual(lucky.offers.map(o=>o.cost),base.offers.map(o=>o.cost));assert.notEqual(lucky.revision,base.revision);
 const a=base.offers.find(o=>o.id==='wine-standard'),b=lucky.offers.find(o=>o.id==='wine-standard');assert.deepEqual(b.weights,luckWeights(a.weights,7));assert.deepEqual(b.multiplierChances,a.multiplierChances);assert.ok(b.expectedMarket>a.expectedMarket);
 assert.equal(stockPaletteCatalog(f.dir,{now}).offers[0].luckPercent,0);
 const retried=buyStockPalette(f.dir,f.user,payload,{now,allowLegacyPurchase:true});assert.equal(retried.id,old.id);assert.equal(f.accounts.db(db=>db.prepare('SELECT rewards FROM stock_palette_purchases WHERE id=?').get(old.id).rewards),saved);
 assert.throws(()=>buyStockPalette(f.dir,f.user,{...payload,requestId:'stale-skill-palette-0001'},{now,allowLegacyPurchase:true}),/catalog_changed/);
 let randomMaxima=[];const bought=buyStockPalette(f.dir,f.user,{offerId:b.id,revision:lucky.revision,requestId:'after-skill-palette-0001'},{now,allowLegacyPurchase:true,random:max=>{randomMaxima.push(max);return max-1;}});
 assert.ok(randomMaxima.includes(b.weights.reduce((a,b)=>a+b,0)));const reveal=revealStockPalette(f.dir,f.user,bought.id,{now});assert.equal(reveal.offer.luckPercent,7);assert.equal(reveal.rewards.reduce((sum,r)=>sum+r.quantity,0),24);
});
test('security belongs to the store owner, applies across stores and validates live risk without changing the deck',async t=>{
 const f=await fixture(t),owner={id:'owner'},shop=buyBusiness(f.dir,owner,'wine','popup',{now}).shop;
 f.accounts.db(db=>{for(let n=0;n<3;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)').run('wine-'+n,'owner',JSON.stringify({title:'Riesling Wine',price:100,marketCategory:'wine'}),now);});stockBusiness(f.dir,owner,shop.id,['wine-0','wine-1'],{now});
 const second=buyBusiness(f.dir,owner,'wine','popup',{now}).shop;stockBusiness(f.dir,owner,second.id,['wine-2'],{now});
 const secondBefore=visitStore(f.dir,f.user,second.id,{now}).store.stock[0];
 const before=visitStore(f.dir,f.user,shop.id,{now}).store.stock[0];f.upgrade('security',1);assert.equal(visitStore(f.dir,f.user,shop.id,{now}).store.stock[0].theft.fine,before.theft.fine);
 for(let rank=1;rank<=3;rank++)upgradeSkill(f.dir,owner,{skillId:'security',rank,requestId:`owner-security-${rank}-request`},{now});
 const after=visitStore(f.dir,f.user,shop.id,{now}).store.stock[0];assert.equal(after.theft.fine,Math.ceil(before.theft.fine*1.3));assert.equal(after.theft.rules,before.theft.rules);
 assert.equal(visitStore(f.dir,f.user,second.id,{now}).store.stock[0].theft.fine,Math.ceil(secondBefore.theft.fine*1.3));
 const payload={shopId:shop.id,inventoryId:before.id,expectedPrice:before.price,expectedFine:before.theft.fine,requestId:'stale-security-heist-001'};
 assert.throws(()=>startStoreHeist(f.dir,f.user,payload,{now}),/store_risk_changed/);
 const draws=[];startStoreHeist(f.dir,f.user,{...payload,requestId:'fair-security-heist-0001',expectedFine:after.theft.fine},{now,draw:max=>{draws.push(max);return max-1;}});
 assert.equal(draws.length,51);assert.deepEqual(draws,Array.from({length:51},(_,index)=>52-index));
});
test('influence weights verified reviews, keeps one per author and hides numerical influence from the public tree',async t=>{
 const f=await fixture(t),owner={id:'owner'},other={id:'other'},shop=buyBusiness(f.dir,owner,'wine','popup',{now}).shop;
 f.accounts.db(db=>{for(let n=0;n<3;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)').run('review-wine-'+n,'owner',JSON.stringify({title:'Riesling Wine',price:100,marketCategory:'wine'}),now);});stockBusiness(f.dir,owner,shop.id,['review-wine-0','review-wine-1','review-wine-2'],{now});
 for(const [user,inventoryId,stars] of [[f.user,'review-wine-0',5],[other,'review-wine-1',1]]){
  buyStoreItem(f.dir,user,{shopId:shop.id,inventoryId,expectedPrice:120,requestId:'verified-purchase-'+user.id+'-001'},{now});reviewStore(f.dir,user,{shopId:shop.id,stars},{now});
 }
 assert.equal(visitStore(f.dir,null,shop.id,{now}).store.rating,3);
 for(let rank=1;rank<=3;rank++)f.upgrade('influence',rank);
 const view=visitStore(f.dir,null,shop.id,{now}).store;assert.equal(view.rating,3.5);assert.equal(view.reviewCount,2);assert.equal(listStores(f.dir,null,{now}).stores[0].rating,3.5);
 reviewStore(f.dir,f.user,{shopId:shop.id,stars:4},{now});assert.equal(visitStore(f.dir,null,shop.id,{now}).store.reviewCount,2);assert.equal(visitStore(f.dir,null,shop.id,{now}).store.rating,2.9);
 assert.doesNotMatch(JSON.stringify(f.tree()),/reviewWeight|125|150|175/);
 f.accounts.db(db=>db.prepare("UPDATE users SET banned=1 WHERE id='buyer'").run());assert.equal(visitStore(f.dir,null,shop.id,{now}).store.rating,1);
});
test('fresh bans, temporary passwords, jail and NPC identity block reads and upgrades',async t=>{
 const f=await fixture(t);
 for(const [change,error] of [["banned=1",/login_required/],["banned=0,must_change_password=1",/password_change_required/],["must_change_password=0,npc=1",/login_required/]]){
  f.accounts.db(db=>db.prepare("UPDATE users SET "+change+" WHERE id='buyer'").run());assert.throws(()=>f.tree(),error);assert.throws(()=>f.upgrade('luck',1),error);
 }
 f.accounts.db(db=>{db.prepare("UPDATE users SET npc=0 WHERE id='buyer'").run();db.prepare("INSERT INTO player_justice(user_id,jailed_until) VALUES('buyer',?)").run(now+60000);});
 assert.throws(()=>f.tree(),/player_jailed/);assert.throws(()=>f.upgrade('luck',1),/player_jailed/);
});

test('HTTP skill mutations enforce CSRF/session and personalized quotes include the newly unlocked luck',async t=>{
 const f=await fixture(t);const {createServer}=await import('node:http'),{createAccountApi}=await import('../src/account-api.mjs'),{createEconomyApi}=await import('../src/economy-api.mjs');
 const flags={palettes:true,resales:true,paletteAuctions:true,market:true,businesses:true},json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const api=await createAccountApi({dataDir:f.dir,json,env:{COOKIE_SECURE:'false'},flags,dailyPayload:async()=>({auctions:[]})}),economy=createEconomyApi({dataDir:f.dir,json,flags,accounts:f.accounts});
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;json(res,404,{error:'not_found'});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,token=f.accounts.atomic(db=>f.accounts.session(db,'buyer')),cookie='jg_session='+token;
 const post=(payload,csrf=true,session=cookie)=>fetch(base+'/api/account/skills/upgrade',{method:'POST',headers:{'content-type':'application/json',cookie:session,...(csrf?{'x-requested-with':'JUSTIZGUESSR'}:{})},body:JSON.stringify(payload)}),payload={skillId:'luck',rank:1,requestId:'http-skill-upgrade-001'};
 assert.equal((await fetch(base+'/api/account/skills')).status,401);assert.equal((await post(payload,true,'')).status,401);assert.equal((await post(payload,false)).status,403);
 const first=await post(payload);assert.equal(first.status,200);const result=await first.json();assert.equal(result.tree.available,19);assert.equal(result.user.skills.luckPercent,3);
 assert.equal((await(await post(payload)).json()).tree.available,19);assert.equal((await post({...payload,requestId:'http-stale-rank-0001'})).status,409);
 const intelligence={skillId:'market-intelligence',rank:1,requestId:'http-market-intelligence-001',cost:0,points:999,userId:'owner'};
 const unlocked=await(await post(intelligence)).json();assert.equal(unlocked.tree.available,14);assert.equal(unlocked.user.skills.ranks['market-intelligence'],1);
 assert.equal((await(await post(intelligence)).json()).tree.available,14);
 assert.equal(skillTree(f.dir,{id:'owner'},{now}).ranks['market-intelligence'],undefined);
 assert.equal((await post({...intelligence,rank:2,requestId:'http-market-rank-two-001'})).status,409);
 const personal=await(await fetch(base+'/api/account/case-store',{headers:{cookie}})).json(),guest=await(await fetch(base+'/api/account/case-store')).json();
 assert.equal(personal.luckPercent,3);assert.equal(guest.luckPercent,0);assert.deepEqual(personal.cases.map(c=>c.cost),guest.cases.map(c=>c.cost));
 const palettes=await(await fetch(base+'/api/stock-palettes',{headers:{cookie}})).json();assert.equal(palettes.offers[0].luckPercent,3);
 assert.equal((await(await fetch(base+'/api/stock-palettes')).json()).offers[0].luckPercent,0);
 f.accounts.db(db=>db.prepare("UPDATE users SET must_change_password=1 WHERE id='buyer'").run());assert.equal((await fetch(base+'/api/account/skills',{headers:{cookie}})).status,403);assert.equal((await post({...payload,rank:2,requestId:'http-temp-password-001'})).status,403);
});
