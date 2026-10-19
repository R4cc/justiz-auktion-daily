// Visitor UI regression with real one-item purchases and isolated store stock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore,upsertAuctions } from '../src/database.mjs';
import { buyBusiness,stockBusiness } from '../src/businesses.mjs';
import { customizeStore,visitStore } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-visitor-storefront-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'visitor-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env),now=Date.now();
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})}),accounts=new Accounts(dir,{flags});
const token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),buyer=accounts.user(token);
accounts.db(db=>db.prepare('UPDATE users SET tokens=300000,xp=36100 WHERE id=?').run(buyer.id));
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(await api(req,res,url)||economy(req,res,url))return;
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
 const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname;
 const content=await readFile(path.join(root,'dist',filename));
 res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.addCookies([{name:'jg_session',value:token,url:base}]);
 const language=async lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
 const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
 for(const width of [1440,768,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/loans');await page.waitForSelector('.loan-offer');await language(lang);
  assert.equal(await page.locator('.loan-offer').count(),4);assert.equal(await page.locator('[data-loan="review"]:enabled').count(),4);await overflow();
  await page.locator('[data-loan="review"][data-offer="starter"]').click();await page.waitForSelector('.loan-confirm[open]');
  assert.match(await page.locator('.loan-confirm').innerText(),/720/);assert.match(await page.locator('.loan-confirm').innerText(),/960/);
  const box=await page.locator('.loan-confirm').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.loan-confirm[open]').count(),0);
  assert.ok(await page.locator('[data-loan="review"][data-offer="starter"]').evaluate(el=>el===document.activeElement));
 }
 await page.setViewportSize({width:1440,height:1000});await language('en');await page.screenshot({path:'/tmp/loans-offers-desktop.png',fullPage:true});
 const borrowRequests=[];let loseBorrow=true;
 await page.route('**/api/account/loans/borrow',async route=>{borrowRequests.push(route.request().postDataJSON().requestId);if(loseBorrow){loseBorrow=false;await route.fetch();return route.abort('failed');}await route.continue();});
 await page.locator('[data-loan="review"][data-offer="starter"]').click();await page.locator('[data-loan="borrow"]').click();
 await page.waitForSelector('[data-loan="retry"]');assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(buyer.id).tokens),300500);
 await page.reload();await page.waitForSelector('[data-loan="retry"]');await page.locator('[data-loan="retry"]').click();await page.waitForFunction(()=>document.querySelector('.loan-success')?.textContent.includes('paid into'));
 assert.equal(borrowRequests.length,2);assert.equal(borrowRequests[0],borrowRequests[1]);assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(buyer.id).tokens),300500);
 assert.equal(await page.locator('[data-loan="review"]:enabled').count(),0);await page.unroute('**/api/account/loans/borrow');
 await page.locator('[data-loan-repay] input').fill('200');await page.locator('[data-loan-repay] button').click();await page.waitForFunction(()=>document.querySelector('.loan-success')?.textContent.includes('Repayment'));
 assert.ok(accounts.db(db=>db.prepare('SELECT remaining FROM player_loans').get().remaining)<500);
 await page.setViewportSize({width:390,height:1000});await page.waitForFunction(()=>document.querySelector('.sidebar-panel').getBoundingClientRect().right<1);await overflow();await page.screenshot({path:'/tmp/loans-active-mobile.png',fullPage:true});
 // A committed repayment with a lost response replays once, including reload.
 const repayRequests=[];let loseRepay=true;
 await page.route('**/api/account/loans/repay',async route=>{repayRequests.push(route.request().postDataJSON().requestId);if(loseRepay){loseRepay=false;await route.fetch();return route.abort('failed');}await route.continue();});
 await page.locator('[data-loan-repay] button').click();await page.waitForSelector('[data-loan="retry"]');
 const paidBalance=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(buyer.id).tokens);
 await page.reload();await page.waitForSelector('[data-loan="retry"]');await page.locator('[data-loan="retry"]').click();await page.waitForFunction(()=>Boolean(document.querySelector('.loan-history')));
 assert.equal(repayRequests[0],repayRequests[1]);assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(buyer.id).tokens),paidBalance);
 assert.equal(await page.locator('.loan-active').count(),0);assert.equal(await page.locator('[data-loan="review"]:enabled').count(),0);await page.unroute('**/api/account/loans/repay');
 // Advance a saved contract by changing fixture timestamps, without touching the live clock.
 accounts.db(db=>{db.prepare('UPDATE player_loans SET created_at=created_at-?').run(2*86400000);});
 await page.reload();await page.waitForSelector('[data-loan="review"]:enabled');await page.locator('[data-loan="review"][data-offer="starter"]').click();await page.locator('[data-loan="borrow"]').click();await page.waitForSelector('.loan-active');
 accounts.db(db=>{db.prepare('UPDATE player_loans SET created_at=created_at-?,due_at=due_at-?,accrued_at=accrued_at-? WHERE paid_at IS NULL').run(4*86400000,4*86400000,4*86400000);db.prepare('UPDATE users SET tokens=100 WHERE id=?').run(buyer.id);});
 for(const lang of ['en','de']){await page.goto(base+'/loans');await page.waitForSelector('.loan-active.is-overdue');await language(lang);await overflow();assert.ok(await page.locator('[data-loan-repay] button').isDisabled());}
 assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(buyer.id).tokens),0);
 await page.screenshot({path:'/tmp/loans-overdue-mobile.png',fullPage:true});
 // Both gates matter; guests see a login destination.
 accounts.db(db=>{db.prepare('UPDATE player_loans SET paid_at=? WHERE paid_at IS NULL').run(Date.now());db.prepare('UPDATE users SET xp=0,tokens=1000 WHERE id=?').run(buyer.id);});
 await page.goto(base+'/loans');await page.waitForSelector('.loan-offer.is-locked');assert.equal(await page.locator('.loan-offer.is-locked').count(),4);
 const guest=await browser.newContext({viewport:{width:320,height:800}}),gp=await guest.newPage();await gp.goto(base+'/loans');await gp.waitForSelector('#account-content a[href="/login"]');await guest.close();
 assert.deepEqual(errors,[]);console.log('Loans browser: four offers, EN/DE 1440–320px, confirmation and keyboard focus, offline-response retries across reload, partial/full repayment, cooldown, overdue collection, lock gates and guest access passed.');
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
