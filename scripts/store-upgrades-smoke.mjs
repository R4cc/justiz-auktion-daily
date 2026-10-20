import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { buyBusiness, businessDashboard } from '../src/businesses.mjs';
import { featureFlags } from '../src/features.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-upgrades-browser-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'upgrade-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
upsertAuctions(dir,JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8')).auctions);
const api=await createAccountApi({dataDir:dir,env,json,dailyPayload:async()=>({auctions:[]})});
const accounts=new Accounts(dir,env),token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token);
accounts.db(db=>db.prepare('UPDATE users SET tokens=1000000,xp=36100 WHERE id=?').run(owner.id));
const shop=buyBusiness(dir,owner,'wine','tiny').shop,plot=shop.location.plotId;
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
  const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname;
  const content=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const url=base+`/stores?shop=${shop.id}`;
  const language=async lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  const fits=async()=>{if(page.viewportSize().width<=900)await page.waitForFunction(()=>document.querySelector('.sidebar-panel').getBoundingClientRect().right<1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');};
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await page.goto(url);await page.waitForSelector('[data-business="open-upgrade"]');await language(lang);await fits();
    assert.match(await page.locator('.shop-upgrade').innerText(),/13[,.]500/);
    await page.locator('[data-business="open-upgrade"]').click();await page.waitForSelector('.shop-task[open] [data-business="start-upgrade"]');
    assert.match(await page.locator('.shop-task[open]').innerText(),/8/);assert.match(await page.locator('.shop-task[open]').innerText(),/25 → 60/);
    const box=await page.locator('.shop-task[open]').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
    assert.equal(await page.locator('.shop-task[open] [data-business="start-upgrade"]').isEnabled(),true);
    await page.keyboard.press('Escape');assert.ok(await page.locator('[data-business="open-upgrade"]').evaluate(el=>el===document.activeElement));
  }
  await page.setViewportSize({width:1440,height:1000});await language('en');await page.screenshot({path:'/tmp/store-upgrade-offer.png',fullPage:true});
  // Opening an upgrade from settings must retain the unsubmitted settings draft.
  await page.goto(url+'&tab=settings');await page.waitForSelector('[data-shop-settings]');
  await page.locator('[name="storeName"]').fill('Unsaved shop draft');await page.locator('[data-business="open-upgrade"]').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('[name="storeName"]').inputValue(),'Unsaved shop draft');
  // A committed payment with a lost response is recovered from persisted state.
  const balance=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);let requests=0;
  await page.route('**/api/account/businesses/upgrade',async route=>{requests++;await route.fetch();await route.abort('failed');});
  await page.locator('[data-business="open-upgrade"]').click();await page.locator('[data-business="start-upgrade"]').click();
  await page.waitForSelector('.shop-task[open] .shop-upgrade.is-building');
  assert.equal(requests,1);assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),balance-13500);
  await page.unroute('**/api/account/businesses/upgrade');await page.keyboard.press('Escape');
  await page.reload();await page.waitForSelector('.shop-upgrade.is-building');assert.equal(await page.locator('[data-business="start-upgrade"]').count(),0);
  assert.equal(businessDashboard(dir,owner).shops[0].size,'tiny');
  await page.setViewportSize({width:320,height:1000});await language('de');await fits();await page.screenshot({path:'/tmp/store-upgrade-building-mobile.png',fullPage:true});
  // Complete the saved construction without waiting on the live clock.
  accounts.db(db=>db.prepare('UPDATE businesses SET upgrade_started_at=upgrade_started_at-?,upgrade_ends_at=upgrade_ends_at-? WHERE id=?').run(8*3600000,8*3600000,shop.id));
  await page.reload();await page.waitForSelector('[data-business="open-upgrade"]');
  assert.match(await page.locator('.shop-upgrade').innerText(),/48/);assert.match(await page.locator('.shop-upgrade').innerText(),/60 → 150/);
  const complete=businessDashboard(dir,owner).shops[0];assert.equal(complete.size,'medium');assert.equal(complete.location.plotId,plot);assert.equal(complete.capacity,60);
  await page.screenshot({path:'/tmp/store-upgrade-complete-mobile.png',fullPage:true});await fits();
  accounts.db(db=>db.prepare('UPDATE users SET xp=0 WHERE id=?').run(owner.id));
  await page.reload();await page.waitForSelector('[data-business="open-upgrade"]');assert.equal(await page.locator('[data-business="open-upgrade"]').isDisabled(),true);
  const guest=await browser.newContext({viewport:{width:320,height:900}}),gp=await guest.newPage();await gp.goto(url);await gp.waitForSelector('.shop-header');assert.equal(await gp.locator('[data-business="open-upgrade"],[data-business="start-upgrade"]').count(),0);await guest.close();
  assert.deepEqual(errors,[]);await context.close();
  console.log('Store upgrades browser passed: EN/DE 1440–320px, quote/confirmation/focus, unsaved settings, lost-response payment, offline completion, larger capacity, 48h next upgrade, level gate and guest isolation.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
