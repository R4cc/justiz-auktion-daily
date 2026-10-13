import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { buyStoreItem, reviewStore, visitStore, likeStoreReview } from '../src/storefronts.mjs';
import { priceFeedback, reviewPriceOpinion, recordNpcStoreFeedback, INFLUENCE_SUPPORT } from '../src/store-reviews.mjs';
import { upgradeSkill } from '../src/skill-tree.mjs';
const now = Date.parse('2026-10-12T12:30:00Z'), week = 7 * 86400000;
async function fixture(t, margin=20) {
  const dir = await mkdtemp('/tmp/jg-review-test-'), accounts = new Accounts(dir,{now:()=>now});
  const owner={id:'owner',admin:true}, buyer={id:'buyer'}, other={id:'other'};
  accounts.db(db=>{for(const user of [owner,buyer,other])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,admin,created_at) VALUES(?,?,'disabled',1000000,36100,?,?)").run(user.id,user.id+'Name',Number(Boolean(user.admin)),now);
    for(let n=0;n<10;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('wine-'+n,owner.id,JSON.stringify({title:'Review wine '+n,price:100,marketCategory:'wine',rarity:'rare'}),now);});
  const shop=buyBusiness(dir,owner,'wine','popup',{now}).shop;
  accounts.db(db=>db.prepare("UPDATE businesses SET id='review-shop' WHERE id=?").run(shop.id));shop.id='review-shop';
  stockBusiness(dir,owner,shop.id,Array.from({length:10},(_,n)=>'wine-'+n),{now});
  accounts.db(db=>db.prepare("UPDATE businesses SET profit_margin=?,size='large',traffic_popularity=1.5 WHERE id=?").run(margin,shop.id));
  const buy=user=>buyStoreItem(dir,user,{shopId:shop.id,inventoryId:user.id==='buyer'?'wine-0':'wine-1',expectedPrice:100+margin,requestId:'verified-buy-'+user.id+'-0001'},{now});
  const review=(user,stars,comment='')=>reviewStore(dir,user,{shopId:shop.id,stars,comment},{now});
  const view=(at=now,user=buyer)=>visitStore(dir,user,shop.id,{now:at}).store;
  const like=(user,reviewerId=buyer.id,liked=true,at=now)=>likeStoreReview(dir,user,{shopId:shop.id,reviewerId,liked},{now:at});
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  return {dir,accounts,owner,buyer,other,shop,buy,review,view,like};
}
test('Influence support grows on existing reviews; player likes are unique, removable and self-like protected',async t=>{
 const f=await fixture(t);f.buy(f.buyer);f.review(f.buyer,4,'Fair price');
 assert.equal(f.view().reviews[0].likes,0);f.like(f.other);f.like(f.other);
 assert.equal(f.view().reviews[0].likes,1);assert.equal(f.view(now,f.other).reviews[0].liked,true);
 for(let rank=1;rank<=3;rank++){
  upgradeSkill(f.dir,f.buyer,{skillId:'influence',rank,requestId:'influence-review-rank-'+rank},{now});
  assert.equal(f.view().reviews[0].likes,INFLUENCE_SUPPORT[rank]+1);assert.equal(f.view().reviews[0].influenceRank,rank);
 }
 f.like(f.other,f.buyer.id,false);f.like(f.other,f.buyer.id,false);assert.equal(f.view().reviews[0].likes,12);
 assert.throws(()=>f.like(f.buyer),/own_review/);assert.throws(()=>f.like(f.other,'missing'),/review_not_found/);
 assert.throws(()=>f.like(f.other,f.buyer.id,'true'),/invalid_store_reaction/);
 assert.equal(f.view(now,null).reviews[0].username,'bu****');assert.equal(f.view(now,null).reviews[0].canLike,false);
 assert.doesNotMatch(JSON.stringify(f.view()),/reviewWeight|password_hash/);
});
test('NPC price feedback reflects paid value and personality; unrelated and negated claims receive no automatic agreement',()=>{
 assert.equal(priceFeedback({cheapness:1},100,100).stars,5);
 assert.equal(priceFeedback({cheapness:1},120,100).stars,4);
 assert.equal(priceFeedback({cheapness:1},135,100).sentiment,'price_high');
 assert.equal(priceFeedback({cheapness:0},135,100).sentiment,'fair');
 assert.equal(priceFeedback({cheapness:0},200,100).stars,1);
 for(const text of ['Prices are too high','Expensive wine','Die Preise sind zu hoch','Zu teuer'])assert.equal(reviewPriceOpinion(2,text),'price_high');
 for(const text of ['Fair price','Great value','Günstig','Ein fairer Preis','Inexpensive wine'])assert.equal(reviewPriceOpinion(5,text),'fair');
 for(const text of ['Not expensive','Nicht zu teuer','Bad service','Cheap but overpriced','Unfair price','Not a fair price'])assert.equal(reviewPriceOpinion(1,text),null);
 assert.equal(reviewPriceOpinion(5,''),'fair');assert.equal(reviewPriceOpinion(3,''),null);
});
test('real NPC sales leave reviews and agreement likes exactly once; players remain first and accounting is unchanged',async t=>{
 const f=await fixture(t,100);f.buy(f.buyer);f.review(f.buyer,1,'Prices are too high');f.buy(f.other);f.review(f.other,5,'Great value');
 assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM store_npc_feedback').get().n),0);
 const before=f.accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(f.owner.id).tokens);
 const store=f.view(now+week),feedback=f.accounts.db(db=>db.prepare('SELECT * FROM store_npc_feedback').all());
 assert.equal(feedback.length,8);assert.equal(store.reviews.filter(r=>r.npc).length>0,true);
 assert.equal(store.reviews.slice(0,2).every(r=>!r.npc),true);assert.equal(store.reviews.slice(2).every(r=>r.npc),true);
 assert.equal(store.reviews.find(r=>r.reviewerId==='buyer').likes,new Set(feedback.map(row=>row.npc_id)).size);assert.equal(store.reviews.find(r=>r.reviewerId==='other').likes,0);
 assert.ok(feedback.every(row=>row.paid===2*row.reference && row.sentiment==='price_high'));
 const earned=f.accounts.db(db=>db.prepare('SELECT SUM(price) total FROM business_sales WHERE id LIKE ?').get('npc:%').total);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(f.owner.id).tokens),before);
 assert.equal(businessDashboard(f.dir,f.owner,{now:now+week}).shops[0].cashReady,earned+400);
 assert.equal(businessDashboard(f.dir,f.owner,{now:now+week}).shops[0].sales,10);
 const likes=store.reviews.find(r=>r.reviewerId==='buyer').likes;
 const sale=feedback[0];f.accounts.db(db=>recordNpcStoreFeedback(db,{saleId:sale.sale_id,shopId:f.shop.id,category:'wine',paid:sale.paid,reference:sale.reference,now:sale.created_at}));
 closeDataStore(f.dir);assert.equal(f.view(now+week).reviews.find(r=>r.reviewerId==='buyer').likes,likes);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM store_npc_feedback').get().n),8);
 // Editing cannot retain agreement earned for a contradictory older claim.
 reviewStore(f.dir,f.buyer,{shopId:f.shop.id,stars:5,comment:'Fair price'},{now:now+week});
 assert.equal(f.view(now+week).reviews.find(r=>r.reviewerId==='buyer').likes,0);
 f.accounts.resetEconomy(f.owner,'RESET ECONOMY');
 for(const table of ['store_review_likes','store_npc_feedback','store_reviews'])assert.equal(f.accounts.db(db=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),0);
});
test('fair-price NPCs support matching reviews; saving unchanged text preserves likes and bans remove votes and reviews',async t=>{
 const f=await fixture(t);f.buy(f.buyer);f.review(f.buyer,5,'Fair price');f.buy(f.other);f.review(f.other,1,'Too expensive');
 f.like(f.other);const view=f.view(now+week);
 assert.ok(view.reviews.find(r=>r.reviewerId==='buyer').likes>1);assert.equal(view.reviews.find(r=>r.reviewerId==='other').likes,0);
 const likes=view.reviews.find(r=>r.reviewerId==='buyer').likes;
 reviewStore(f.dir,f.buyer,{shopId:f.shop.id,stars:5,comment:'Fair price'},{now:now+week});
 assert.equal(f.view(now+week).reviews.find(r=>r.reviewerId==='buyer').likes,likes);
 f.accounts.db(db=>db.prepare("UPDATE users SET banned=1 WHERE id='other'").run());
 const banned=f.view(now+week);assert.equal(banned.reviews.find(r=>r.reviewerId==='buyer').likes,likes-1);assert.equal(banned.reviews.some(r=>r.reviewerId==='other'),false);
 assert.throws(()=>f.like(f.other),/login_required/);
 f.accounts.db(db=>db.prepare("INSERT INTO player_justice(user_id,jailed_until) VALUES('buyer',?)").run(now+week+60000));
 assert.throws(()=>f.like(f.buyer,'owner',true,now+week),/player_jailed/);
});
test('failed feedback persistence rolls back the sale and can retry without re-selling inventory',async t=>{
 const f=await fixture(t);f.accounts.db(db=>db.exec("CREATE TRIGGER fail_feedback BEFORE INSERT ON store_npc_feedback BEGIN SELECT RAISE(ABORT,'feedback_failed'); END"));
 const before=f.accounts.db(db=>db.prepare("SELECT tokens FROM users WHERE id='owner'").get().tokens);
 assert.throws(()=>f.view(now+week),/feedback_failed/);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM business_sales').get().n),0);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM inventory WHERE sold_at IS NULL').get().n),10);
 assert.equal(f.accounts.db(db=>db.prepare("SELECT tokens FROM users WHERE id='owner'").get().tokens),before);
 f.accounts.db(db=>db.exec('DROP TRIGGER fail_feedback'));assert.equal(f.view(now+week).stock.length,0);
 assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM store_npc_feedback').get().n),10);
});
test('like HTTP endpoint keeps session/CSRF guards and retry-safe desired state',async t=>{
 const f=await fixture(t);f.buy(f.buyer);f.review(f.buyer,5);
 const {createServer}=await import('node:http'),{createAccountApi}=await import('../src/account-api.mjs');
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const api=await createAccountApi({dataDir:f.dir,json,env:{COOKIE_SECURE:'false'},flags:{businesses:true},dailyPayload:async()=>({auctions:[]})});
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await api(req,res,url))return;json(res,404,{});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const token=f.accounts.atomic(db=>f.accounts.session(db,'other')),payload={shopId:f.shop.id,reviewerId:'buyer',liked:true};
 const post=(cookie='jg_session='+token,csrf=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/account/stores/review/like`,{method:'POST',headers:{'content-type':'application/json',cookie,...(csrf?{'x-requested-with':'JUSTIZGUESSR'}:{})},body:JSON.stringify(payload)});
 assert.equal((await post('')).status,401);assert.equal((await post(undefined,false)).status,403);
 assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal(f.view().reviews[0].likes,1);
});
