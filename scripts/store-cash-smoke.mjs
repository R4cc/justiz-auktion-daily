// Optional real-browser regression using actual purchases, tips and collection.
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
import { buyStoreItem,tipStore } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-store-cash-ui-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'store-cash-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})});
const accounts=new Accounts(dir,{flags}),token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token);
accounts.db(db=>db.prepare('UPDATE users SET tokens=1000000,xp=36100 WHERE id=?').run(owner.id));
const shops=['wine','toys','electronics'].map(type=>{
  const shop=buyBusiness(dir,owner,type,'popup').shop;
  accounts.db(db=>{for(let n=0;n<3;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
    .run(type+'-'+n,owner.id,JSON.stringify({title:'Cash '+type+' '+n,price:30,businessCategory:type,marketCategory:type==='toys'?'collectibles':type,rarity:'common'}),Date.now());});
  stockBusiness(dir,owner,shop.id,Array.from({length:3},(_,n)=>type+'-'+n));return shop;
});
const buyerToken=await accounts.register({username:'CashCustomer',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}),buyer=accounts.user(buyerToken);
for(const [index,type] of ['wine','toys'].entries())buyStoreItem(dir,buyer,{shopId:shops[index].id,inventoryId:type+'-0',expectedPrice:36,requestId:'cash-ui-purchase-'+type});
tipStore(dir,buyer,{shopId:shops[0].id,amount:25,requestId:'cash-ui-tip-0000001'});
const balance=()=>accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);
const till=index=>accounts.db(db=>db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(shops[index].id).cash_balance);
const before=balance(),economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  let loseResponse=false,loseRefresh=false,holdFirst=true,releaseFirst,markFirstPaid;
  const firstReply=new Promise(resolve=>{releaseFirst=resolve;}),firstPaid=new Promise(resolve=>{markFirstPaid=resolve;}),replies=[];
  await page.route('**/api/account/businesses',async route=>{
    if(loseRefresh){loseRefresh=false;return route.abort('failed');}
    await route.continue();
  });
  await page.route('**/api/account/businesses/collect',async route=>{
    requests.push(route.request().postDataJSON());
    if(loseResponse){loseResponse=false;await route.fetch();return route.abort('failed');}
    if(holdFirst){holdFirst=false;const response=await route.fetch();replies[0]=await response.json();markFirstPaid();await firstReply;return route.fulfill({response});}
    const response=await route.fetch();replies.push(await response.json());await route.fulfill({response});
  });
  const button=index=>page.locator(`[data-business="collect-cash"][data-shop="${shops[index].id}"]`);
  const load=async()=>{await page.goto(base+'/businesses');await page.waitForSelector('[data-business="collect-cash"]');};
  await load();assert.equal(await page.locator('[data-business="collect-cash"]').count(),3);
  assert.equal(balance(),before);assert.equal(till(0),61);assert.equal(till(1),36);assert.equal(till(2),0);
  assert.ok(await button(0).isEnabled());assert.ok(await button(2).isDisabled());
  // Hold the first response after payment. Other registers must remain usable.
  await button(0).evaluate(el=>{el.click();el.click();});
  await page.waitForFunction(()=>document.querySelector('.business-cash-button.is-collecting'));
  await firstPaid;assert.ok(await button(1).isEnabled());await button(1).click();
  await page.waitForSelector('.business-cash-celebration',{state:'attached'});
  const pauseSpills=()=>page.evaluate(()=>document.querySelectorAll('.business-cash-celebration').forEach(el=>el.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=180;})));
  await pauseSpills();
  assert.equal(requests.length,2,'both requests dispatch without waiting for an animation or another reply');
  assert.equal(till(0),0);assert.equal(till(1),0);assert.equal(balance(),before+97);
  assert.match(await button(1).innerText(),/Register empty/);
  assert.match(await button(0).innerText(),/Collecting/);
  assert.equal(await page.evaluate(()=>account.tokens),before+97);
  releaseFirst();
  await page.waitForFunction(()=>!document.querySelector('.business-cash-button.is-collecting'));
  await pauseSpills();
  assert.equal(await page.locator('.business-cash-coin').count(),28);
  assert.ok(replies[1].collectionVersion>replies[0].collectionVersion,'receipts order wallet snapshots');
  assert.equal(await page.evaluate(()=>account.tokens),before+97,'delayed older reply cannot reduce wallet');
  assert.ok(await button(0).isDisabled());assert.ok(await button(1).isDisabled());
  assert.match(await button(0).locator('..').innerText(),/Collected J€ 61/);
  assert.equal(await button(1).locator('..').locator('.business-cash-status').evaluate(el=>el===document.activeElement),true,'another completion cannot steal focus');
  assert.ok(await page.locator('.business-cash-celebration').evaluateAll(layers=>layers.every(el=>el.getAnimations({subtree:true}).every(animation=>animation.effect.getComputedTiming().endTime<=510))),'every spill finishes in about half a second');
  await page.screenshot({path:'/tmp/jg-store-cash-burst-1440.png'});
  await page.evaluate(()=>document.querySelectorAll('.business-cash-celebration').forEach(el=>el.getAnimations({subtree:true}).forEach(animation=>animation.finish())));
  await page.waitForFunction(()=>!document.querySelector('.business-cash-celebration'));
  // The server pays, but the response is lost. Reload and retry the same key.
  tipStore(dir,buyer,{shopId:shops[0].id,amount:25,requestId:'cash-ui-retry-tip-1'});await load();loseResponse=true;
  await button(0).click();await page.waitForFunction(()=>[...document.querySelectorAll('[data-business="collect-cash"]')].some(el=>el.textContent.includes('Retry collection')));
  assert.equal(balance(),before+122);assert.equal(till(0),0);await load();assert.ok(await button(0).isEnabled());
  await button(0).click();await page.waitForSelector('.business-cash-celebration',{state:'attached'});await page.locator('.business-cash-celebration').waitFor({state:'detached'});
  assert.equal(requests[2].requestId,requests[3].requestId);assert.equal(balance(),before+122);assert.equal(till(1),0);
  // Long values and every individual control fit in both languages.
  accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=? WHERE id=?').run(1000000000000,shops[2].id));
  buyStoreItem(dir,buyer,{shopId:shops[1].id,inventoryId:'toys-1',expectedPrice:36,requestId:'cash-ui-keyboard-buy'});await load();
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
    assert.equal(await page.locator('[data-business="collect-cash"]').count(),3);
    assert.match(await button(1).innerText(),lang==='en'?/Collect cash/:/Kasse einsammeln/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
    assert.ok(await page.locator('.business-cash-button,.business-cash-copy,.business-cash-status').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} collect overflow`);
    if([1440,320].includes(width))await button(1).locator('..').screenshot({path:`/tmp/jg-store-cash-${width}-${lang}.png`});
  }
  await page.emulateMedia({reducedMotion:'reduce'});loseRefresh=true;await button(1).press('Enter');
  await page.waitForFunction(()=>!document.querySelector('.business-cash-button.is-collecting'));assert.equal(await page.locator('.business-cash-celebration').count(),0);
  assert.equal(balance(),before+158);assert.equal(till(1),0);assert.equal(till(2),1000000000000);
  assert.ok(await button(1).isDisabled(),'confirmed collection remains accurate when the statistics refresh fails');
  assert.match(await button(1).locator('..').innerText(),/36.*eingesammelt/);
  await page.emulateMedia({reducedMotion:'no-preference'});await button(2).press('Enter');
  await page.waitForSelector('.business-cash-celebration',{state:'attached'});
  assert.ok(await page.locator('.business-cash-reward').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));
  await page.locator('.business-cash-celebration').waitFor({state:'detached'});
  assert.equal(till(2),0);assert.equal(balance(),before+158+1000000000000);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'large collected wallet must fit');
  assert.deepEqual(errors,[]);await context.close();
  console.log('Store cash UI passed: one button per store, sales/tips held until click, half-second coin spill, concurrent collections with out-of-order replies, immediate wallet/control updates during animations, empty disabled, double-click paid once, lost response survives reload and retries same receipt, keyboard/focus, reduced motion, long balances, EN/DE 1440/768/390/320px without overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
