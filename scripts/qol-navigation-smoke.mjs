// Isolated real-account browser coverage for the Daily menu and its game links.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Accounts} from '../src/accounts.mjs';
import {createGuestGameApi} from '../src/guest-game-api.mjs';
import {publicDailySummary} from '../src/game-rounds.mjs';
import {playAnswer} from '../test/helpers/play-answer.mjs';
import {createAccountApi} from '../src/account-api.mjs';
import {createEconomyApi} from '../src/economy-api.mjs';
import {closeDataStore,upsertAuctions} from '../src/database.mjs';
import {featureFlags} from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-daily-menu-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'daily-menu-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const lots=Array.from({length:40},(_,n)=>({id:10000+n,title:`Auction find ${n}`,category:['Werkzeug','Fahrrad','Elektronik','Getränke'][n%4],currentBid:30+n*11,actualBid:30+n*11,image:'/favicon.png',description:'A carefully stored auction find.',endAt:new Date(Date.now()-86400000).toISOString()}));
upsertAuctions(dir,lots);
const daily={date:new Date().toISOString().slice(0,10),gameNumber:285,auctions:lots.slice(0,5)};
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>daily}),accounts=new Accounts(dir,{flags});
const token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token);
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const guestApi=createGuestGameApi({dataDir:dir,json,env,dailyPayload:async()=>daily,randomPayload:async()=>({auctions:lots.slice(5,10)}),higherLowerPayload:async()=>({auctions:lots.slice(10,18)})});
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||await economy(req,res,url)||await guestApi(req,res,url))return;
  if(url.pathname==='/api/daily')return json(res,200,publicDailySummary(daily));
  if(url.pathname==='/api/random')return json(res,200,{auctions:lots.slice(5,10)});
  if(url.pathname==='/api/higher-lower')return json(res,200,{auctions:lots.slice(10,18)});
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
  const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));
  res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let releaseMeta,releaseDaily,releaseRandom;
  const metadataGate=new Promise(resolve=>releaseMeta=resolve),dailyGate=new Promise(resolve=>releaseDaily=resolve);
  let dailyStarts=0,randomStarts=0;
  await page.route('**/api/daily',async route=>{await metadataGate;await route.continue();});
  await page.route('**/api/games/start',async route=>{
    const mode=route.request().postDataJSON().mode;
    if(mode==='daily' && ++dailyStarts===1)await dailyGate;
    if(mode==='random' && ++randomStarts===1)await new Promise(resolve=>releaseRandom=resolve);
    await route.continue();
  });
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.daily-home');await page.evaluate(()=>accountReady);
  assert.equal(await page.evaluate(()=>dailyMeta),null,'metadata is still pending');
  await page.locator('.daily-play').click();await page.waitForSelector('#app [aria-busy="true"]');
  await page.waitForFunction(()=>state.view==='daily-loading');
  assert.equal(dailyStarts,1,'Daily launch does not wait for the metadata request');
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'H1','loading status receives keyboard focus');
  // Cancel, then immediately start again while the first request remains in flight.
  await page.locator('#app [data-action="home"]').focus();await page.keyboard.press('Enter');await page.waitForSelector('.daily-home');
  await page.locator('.daily-play').click();await page.waitForSelector('.game-shell #price-input');
  assert.equal(dailyStarts,2,'a cancelled start cannot lock out the next start');
  // Returning responses must not hijack a different page.
  await page.locator('a[data-page][href="/inventory"]').first().click();await page.waitForFunction(()=>currentAccountPage==='/inventory'&&pageLoaded);
  const dailyResponse=page.waitForResponse(response=>response.url().endsWith('/api/games/start')&&response.request().postDataJSON().mode==='daily');
  releaseMeta();releaseDaily();await dailyResponse;await page.waitForFunction(()=>dailyMeta?.gameNumber===285);await page.evaluate(()=>Promise.resolve());
  assert.equal(await page.evaluate(()=>currentAccountPage),'/inventory');assert.equal(new URL(page.url()).pathname,'/inventory');
  await page.locator('.wordmark').click();await page.waitForSelector('.daily-home');
  await page.locator('[data-action="random"]').click();await page.waitForSelector('#app [aria-busy="true"]');
  const language=async lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  for(const width of[1440,768,390,320])for(const lang of['en','de']){
    await page.setViewportSize({width,height:900});await language(lang);
    assert.equal(await page.locator('#app h1').innerText(),lang==='en'?'Loading…':'Wird geladen …');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`loading overflow ${width} ${lang}`);
    assert.ok(await page.locator('#app [data-action="home"]').isVisible());
    if(width===320||width===1440)await page.screenshot({path:`/tmp/jg-qol-loading-${width}-${lang}.png`,fullPage:true});
  }
  await page.locator('#app [data-action="home"]').focus();await page.keyboard.press('Enter');await page.waitForSelector('.daily-home');
  const randomResponse=page.waitForResponse(response=>response.url().endsWith('/api/games/start')&&response.request().postDataJSON().mode==='random');
  releaseRandom();await randomResponse;await page.evaluate(()=>Promise.resolve());assert.equal(await page.evaluate(()=>state.view),'start');
  await page.setViewportSize({width:1440,height:1000});await language('en');
  // Temporary start errors return focus to the same action, allowing Enter to retry.
  for(const action of['play','random','higher-lower']){
    await page.route('**/api/games/start',route=>route.fulfill({status:503,json:{error:'try_later'}}),{times:1});
    await page.locator(`#app [data-action="${action}"]`).focus();await page.keyboard.press('Enter');
    await page.waitForFunction(action=>state.view==='start'&&document.activeElement?.dataset.action===action,action);
  }
  await page.keyboard.press('Enter');await page.waitForSelector('.hl-choices');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'hl-higher','first Higher or Lower choice is keyboard ready');
  await page.route('**/api/games/answer',route=>route.fulfill({status:503,json:{error:'try_later'}}),{times:1});
  await page.locator('[data-action="hl-lower"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>higherLowerRun?.pending===false&&document.activeElement?.dataset.action==='hl-lower');
  assert.equal(await page.locator('.hl-challenger .hl-price').innerText(),'?');
  assert.equal(await page.locator('.hl-choices button:disabled').count(),0);
  await page.keyboard.press('Enter');await page.waitForSelector('.hl-verdict');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'higher-lower');
  assert.deepEqual(errors,[]);
  console.log('Game navigation QoL passed: Daily starts while metadata is pending; visible keyboard-accessible loading; immediate restart after cancellation; stale Daily/Free Play responses preserve navigation; EN/DE at1440/768/390/320px; game-start failure restores retry focus; Higher or Lower launch and answer-failure keyboard recovery; sealed answers and no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
