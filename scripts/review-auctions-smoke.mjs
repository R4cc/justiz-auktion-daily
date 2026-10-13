import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { visitStore } from '../src/storefronts.mjs';
import { supplyReviewAuctions, REVIEW_AUCTION_DURATION_MS } from '../src/review-auctions.mjs';
import { settleAuction } from '../src/resale.mjs';
import { featureFlags } from '../src/features.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dir = await mkdtemp('/tmp/jg-review-browser-');
const env = { ADMIN_USERNAME:'admin', ADMIN_PASSWORD:'review-browser-password', COOKIE_SECURE:'false' }, flags=featureFlags(env), now=Date.now();
const json = (res,status,value) => { res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value)); };
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})}),accounts=new Accounts(dir,{flags});
const token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token);
accounts.db(db=>db.prepare('UPDATE users SET tokens=100000,xp=40000 WHERE id=?').run(owner.id));
const shop=buyBusiness(dir,owner,'wine','popup',{now}).shop;
const otherShop=buyBusiness(dir,owner,'electronics','popup',{now}).shop;
accounts.db(db=>{
  db.prepare('UPDATE businesses SET store_name=? WHERE id=?').run('The Review Store <shop>',shop.id);
  db.prepare('UPDATE businesses SET store_name=? WHERE id=?').run('Another choice',otherShop.id);
  for(let n=0;n<2;n++){
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at,sold_at) VALUES(?,?,?,?,?)').run('already-used-'+n,owner.id,JSON.stringify({kind:'review-pack',reviewCount:20,price:1200}),now,now);
    db.prepare('INSERT INTO store_review_packs VALUES(?,?,?,?,?)').run('already-used-'+n,20,otherShop.id,owner.id,now);
  }
  db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('smoke-wine',owner.id,JSON.stringify({title:'Local wine',price:100,marketCategory:'wine'}),now);
  for(let stars=1;stars<=5;stars++){
    db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',0,?)").run('reviewer-'+stars,'reviewer'+stars,now);
    db.prepare('INSERT INTO store_reviews VALUES(?,?,?,?,?)').run(shop.id,'reviewer-'+stars,stars,'Real feedback '+stars,now);
  }
});
stockBusiness(dir,owner,shop.id,['smoke-wine'],{now});
const day=Math.floor(now/86400000)*86400000;
const auction=supplyReviewAuctions(dir,{now:day+8*3600000}).auctions[0];
// Make the daily supply window live at the test's actual wall clock.
accounts.db(db=>db.prepare('UPDATE resale_auctions SET started_at=?,ends_at=? WHERE id=?').run(now,now+REVIEW_AUCTION_DURATION_MS,auction));
const lot=accounts.db(db=>db.prepare('SELECT * FROM resale_auctions WHERE id=?').get(auction));
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
  const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname;
  const content=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const lang=async value=>page.evaluate(value=>{const el=document.querySelector('#language-select');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const fits=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflow');
  await page.goto(base+'/auction-house');await page.waitForSelector(`[data-economy="resale"][data-id="${auction}"]`);
  await page.locator('[data-economy="lot-type"][data-id="reviews"]').click();
  assert.ok(await page.locator('.economy-lot .review-pack-art').count());
  for(const width of [1440,768,390,320])for(const language of ['en','de']){
    await page.setViewportSize({width,height:1000});await lang(language);await fits('auction '+width+' '+language);
  }
  await page.locator(`[data-economy="resale"][data-id="${auction}"]`).click();await page.waitForSelector('.auction-bid-form');
  assert.match(await page.locator('.auction-room-meta').innerText(),/Fünf-Sterne/);
  await page.locator('.auction-bid-form input[name="amount"]').fill(String(lot.start_price+100));
  await page.locator('.auction-bid-form button[type="submit"]').click();
  await page.waitForFunction(id=>document.querySelector(`.auction-bid-form[data-id="${id}"]`)?.textContent.includes('Dein aktuelles Höchstgebot'),auction);
  assert.equal(accounts.db(db=>db.prepare('SELECT current_bidder_id FROM resale_auctions WHERE id=?').get(auction).current_bidder_id),owner.id);
  accounts.db(db=>db.prepare('UPDATE resale_auctions SET ends_at=? WHERE id=?').run(Date.now()-1,auction));settleAuction(dir,auction);
  const pack=accounts.inventory(owner).find(item=>item.id===lot.inventory_id);assert.ok(pack);
  const post=async(data,headers={'x-requested-with':'JUSTIZGUESSR'})=>context.request.post(base+'/api/account/inventory/reviews/redeem',{data,headers});
  assert.equal((await post({inventoryId:pack.id,shopId:shop.id},{})).status(),403);
  await page.goto(base+'/inventory?focus='+encodeURIComponent(pack.id));await page.waitForSelector('.review-pack-card');
  for(const width of [1440,768,390,320])for(const language of ['en','de']){
    await page.setViewportSize({width,height:1000});await lang(language);await fits('inventory '+width+' '+language);
    await page.locator('[data-review-pack-action="choose"]').click();await page.waitForSelector('.review-pack-dialog[open]');
    assert.equal(await page.locator('.review-pack-dialog [data-review-pack-action="redeem"]').count(),2);
    assert.equal(await page.locator('.review-pack-dialog .review-cap-note').count(),1);
    assert.ok(await page.locator('.review-pack-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await page.locator('.review-store-choices > button').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)));
    if([1440,390].includes(width))await page.locator('.review-pack-dialog').screenshot({path:`/tmp/jg-review-redemption-${width}-${language}.png`});
    await page.locator('.review-pack-dialog [data-review-pack-action="close"]').click();
  }
  const before=visitStore(dir,owner,shop.id).store;
  await page.locator('[data-review-pack-action="choose"]').click();await page.waitForSelector('.review-pack-dialog[open]');
  await page.locator(`.review-pack-dialog [data-shop="${shop.id}"]`).click();await page.waitForFunction(()=>!document.querySelector('.review-pack-dialog').open&&!document.querySelector('.review-pack-card'));
  const receipt={inventoryId:pack.id,shopId:shop.id};assert.equal((await post(receipt)).status(),200);
  assert.equal((await post({...receipt,shopId:otherShop.id})).status(),409);
  const after=visitStore(dir,owner,shop.id).store;assert.equal(after.reviewCount,before.reviewCount+pack.reviewCount);assert.equal(after.reviews.length,before.reviews.length);
  await page.goto(base+'/stores?shop='+encodeURIComponent(shop.id));await page.waitForSelector('.store-rating-chart');
  assert.equal(await page.locator('[role="meter"]').count(),1);assert.equal(await page.locator('.store-rating-row').count(),5);
  for(const width of [1440,768,390,320])for(const language of ['en','de']){
    await page.setViewportSize({width,height:1000});await lang(language);await fits('owner '+width+' '+language);
    assert.equal(await page.locator('.store-rating-row').count(),5);
    if([1440,390].includes(width))await page.locator('.store-rating-summary').screenshot({path:`/tmp/jg-review-chart-${width}-${language}.png`});
  }
  await page.goto(base+'/businesses');await page.waitForSelector('.business-shop');assert.equal(await page.locator('.business-shop [role="meter"]').count(),2);
  await page.goto(base+'/town');await page.waitForSelector('.town-store-row');assert.equal(await page.locator('.town-store-row [role="meter"]').count(),2);
  const guest=await browser.newContext({viewport:{width:320,height:1000}}),anonymous=await guest.newPage();anonymous.on('pageerror',error=>errors.push(error.message));
  const unauth=await guest.request.post(base+'/api/account/inventory/reviews/redeem',{data:receipt,headers:{'x-requested-with':'JUSTIZGUESSR'}});assert.equal(unauth.status(),401);
  await anonymous.goto(base+'/stores');await anonymous.waitForSelector('.store-card');assert.equal(await anonymous.locator('.store-card [role="meter"]').count(),2);
  await anonymous.goto(base+'/stores?shop='+encodeURIComponent(shop.id));await anonymous.waitForSelector('.store-rating-chart');
  assert.equal(await anonymous.locator('.visitor-hero [role="meter"]').count(),1);assert.equal(await anonymous.locator('.store-rating-row').count(),5);
  assert.equal(await anonymous.locator('.store-review-card').count(),after.reviews.length);
  assert.ok(await anonymous.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);await guest.close();await context.close();
  console.log('Review auctions browser checks passed: real bid/settlement, CSRF/auth, redeem/retry/store choice, rating-only counts, popularity across all store views, EN/DE at 1440/768/390/320px and no page errors.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
