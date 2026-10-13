// Optional real-browser regression with isolated data and a controlled event clock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { featureFlags } from '../src/features.mjs';
import { ensureMarketChaos, marketChaosHistoryTimes } from '../src/market-chaos.mjs';
import { marketState, marketHistory, tickMarketDrift } from '../src/market.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-market-chaos-ui-');
const activation=Date.parse('2026-10-01T12:00:00Z');
withDatabase(dir,db=>ensureMarketChaos(db,activation,{seed:'market-ui-seed'}));
tickMarketDrift(dir,{now:activation});
const startsAt=withDatabase(dir,db=>marketChaosHistoryTimes(db,activation,activation+7*86400_000))[0],endsAt=startsAt+3600_000;
let marketTime=startsAt+10*60_000,reads=0;tickMarketDrift(dir,{now:endsAt+3600_000});
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'market-chaos-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const accountApi=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})});
const accounts=new Accounts(dir),token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD});
const economyApi=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    // Same domain read models as the public API, with a controlled test clock.
    if(req.method==='GET'&&url.pathname==='/api/market'){reads++;return json(res,200,marketState(dir,{now:marketTime}));}
    if(req.method==='GET'&&url.pathname.startsWith('/api/market/')&&url.pathname.endsWith('/history')){
      const category=decodeURIComponent(url.pathname.slice('/api/market/'.length,-'/history'.length)),range=url.searchParams.get('range');
      return json(res,200,{category,range,updatedAt:new Date(marketTime).toISOString(),history:marketHistory(dir,category,{now:marketTime,range})});
    }
    if(await accountApi(req,res,url)||economyApi(req,res,url))return;
    if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
    const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));
    res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);
  }catch(error){json(res,500,{error:error.message});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  await page.clock.install({time:marketTime});await page.goto(base+'/market?category=electronics&range=1h');
  await page.waitForSelector('.market-chaos-banner');await page.waitForSelector('[data-market-plot]');
  assert.match(await page.locator('.market-chaos-banner').innerText(),/Market frenzy/);
  const countdown=page.locator('.market-chaos-banner time'),previous=await countdown.innerText();
  assert.equal(await countdown.getAttribute('data-economy-end'),String(endsAt));
  await page.clock.fastForward(1000);assert.notEqual(await countdown.innerText(),previous);
  const language=async lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);
    assert.match(await page.locator('.market-chaos-banner h2').innerText(),lang==='en'?/Market frenzy/:/Marktrausch/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
    assert.ok(await page.locator('.market-chaos-banner,.market-chaos-clock').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} banner overflow`);
    for(const range of ['1h','1d','1w','1m']){
      await page.locator(`[data-economy="market-range"][data-id="${range}"]`).click();
      await page.waitForFunction(range=>document.querySelector(`[data-economy="market-range"][data-id="${range}"]`)?.getAttribute('aria-pressed')==='true',range);
      await page.waitForSelector('[data-market-plot]');
      assert.equal(new URL(page.url()).searchParams.get('range'),range);
      const coordinates=await page.locator('.market-chart-line').getAttribute('points');assert.ok(!/NaN|Infinity/.test(coordinates));
    }
    if([1440,320].includes(width)){
      await page.screenshot({path:`/tmp/jg-market-chaos-${width}-${lang}.png`});
      await page.locator('.market-chaos-banner').screenshot({path:`/tmp/jg-market-chaos-banner-${width}-${lang}.png`});
    }
  }
  await page.locator('[data-market-plot]').focus();await page.keyboard.press('ArrowLeft');await page.waitForSelector('[data-market-tooltip]:not([hidden])');
  await page.locator('[data-economy="category"][data-id="wine"]').click();await page.waitForFunction(()=>document.querySelector('[data-economy="category"][data-id="wine"]')?.getAttribute('aria-pressed')==='true');
  await page.reload();await page.waitForSelector('.market-chaos-banner');assert.equal(new URL(page.url()).searchParams.get('category'),'wine');
  const beforeReads=reads;marketTime=endsAt;await page.clock.setSystemTime(marketTime);await page.clock.fastForward(16000);
  await page.waitForFunction(()=>!document.querySelector('.market-chaos-banner'));assert.ok(reads>beforeReads,'polling must clear the expired event');
  assert.equal(marketState(dir,{now:marketTime}).chaosEvent,null);
  const history=marketHistory(dir,'wine',{now:marketTime,range:'1h'});assert.ok(Math.max(...history.map(p=>p.indexValue))/Math.min(...history.map(p=>p.indexValue))>4);
  await page.locator('[data-economy="market-range"][data-id="1h"]').click();await page.waitForSelector('[data-market-plot]');
  await page.screenshot({path:'/tmp/jg-market-chaos-expired-320.png'});
  assert.deepEqual(errors,[]);await context.close();
  console.log('Market frenzy UI passed: real quotes/history, active event, live countdown, all chart ranges, category switching, keyboard inspection, reload persistence, polling removes expired event, retained pump/crash history, EN/DE 1440/768/390/320px without overflow or page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
