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
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const go=async()=>{await page.goto(base+'/');await page.waitForSelector('.daily-home');await page.waitForFunction(()=>dailyMeta?.gameNumber===285);await page.evaluate(()=>accountReady);};
  const language=async lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  const layout=async state=>{
    for(const width of [1440,1024,768,600,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){
      await language(lang);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${state} ${width} ${lang} page overflow`);
      assert.ok(await page.locator('.daily-challenge,.daily-reward-panel,.daily-mode,.daily-personal,.daily-next-links').evaluateAll(elements=>elements.every(el=>el.scrollWidth<=el.clientWidth+1)),`${state} ${width} ${lang} card overflow: ${JSON.stringify(await page.locator('.daily-challenge,.daily-reward-panel,.daily-mode,.daily-personal,.daily-next-links').evaluateAll(elements=>elements.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({class:el.className,width:el.clientWidth,scroll:el.scrollWidth}))))}`);
      assert.equal(await page.locator('.daily-home [data-action="play"]').count(),1);assert.equal(await page.locator('.daily-home [data-action="random"]').count(),1);assert.equal(await page.locator('.daily-home [data-action="higher-lower"]').count(),1);
      assert.ok(await page.locator('[data-menu-reset]').innerText()!=='--:--:--');
      if([1440,390,320].includes(width))await page.screenshot({path:`/tmp/jg-daily-menu-${state}-${width}-${lang}.png`,fullPage:true});
    }}
  };
  await go();assert.equal(await page.locator('.daily-play').innerText(),'Play Daily');assert.equal(await page.locator('.daily-menu-progress .is-done').count(),0);assert.equal(await page.locator('.daily-reward-login').count(),1);
  await layout('guest');await page.setViewportSize({width:1440,height:1000});await language('en');
  // The new menu keeps all three existing action contracts and actual screens.
  await page.locator('.daily-play').focus();await page.keyboard.press('Enter');await page.waitForSelector('.game-shell #price-input');assert.equal(await page.locator('.daily-home').count(),0);await page.evaluate(()=>renderStart());
  await page.locator('[data-action="random"]').click();await page.waitForSelector('.game-shell');assert.equal(await page.evaluate(()=>gameMode),'random');await page.evaluate(()=>renderStart());
  await page.locator('[data-action="higher-lower"]').click();await page.waitForSelector('.hl-screen .hl-choices');await page.locator('.hl-home').click();await page.waitForSelector('.daily-home');
  // Guest saved progress remains isolated and appears on the menu.
  await page.evaluate(()=>{localStorage.setItem(todayStorageKey(),JSON.stringify({view:'game',round:0,answers:[{guess:30,score:1000,error:0}],scoreVersion:2}));renderStart();});assert.equal(await page.locator('.daily-play').innerText(),'Continue Daily');assert.equal(await page.locator('.daily-menu-progress .is-done').count(),1);
  // Server progress from another device takes precedence over browser storage.
  const run=accounts.startGame(owner,'daily',()=>daily.auctions);playAnswer(accounts,owner,run.id,0,lots[0].actualBid);playAnswer(accounts,owner,run.id,1,lots[1].actualBid);
  await context.addCookies([{name:'jg_session',value:token,url:base}]);await go();assert.equal(await page.locator('.daily-play').innerText(),'Continue Daily');assert.equal(await page.locator('.daily-menu-progress .is-done').count(),2);assert.equal(await page.locator('.daily-reward-login').count(),0);
  assert.match(await page.locator('.daily-reward-amount strong').innerText(),/1[,.]000/);await layout('resume');await page.setViewportSize({width:1440,height:1000});await language('en');
  await page.locator('.daily-play').click();await page.waitForSelector('.game-shell');assert.equal(await page.evaluate(()=>accountDailyRun.id),run.id);await page.evaluate(()=>renderStart());
  for(let n=2;n<5;n++)playAnswer(accounts,owner,run.id,n,lots[n].actualBid);
  await go();assert.equal(await page.locator('.daily-play').innerText(),'View results');assert.equal(await page.locator('.daily-menu-progress .is-done').count(),5);assert.match(await page.locator('.daily-reward-amount strong').innerText(),/1[,.]000/);assert.match(await page.locator('.daily-challenge-bottom').innerText(),/5,000/);await layout('complete');
  await page.setViewportSize({width:1440,height:1000});await language('en');const balance=accounts.profile(owner).tokens;
  await page.locator('.daily-play').click();await page.waitForSelector('.results-screen');assert.equal(accounts.profile(owner).tokens,balance);
  await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());renderStart();});
  await page.locator('.daily-next-links a[href="/leaderboard"]').click();await page.waitForSelector('.leaderboard-page');assert.equal(await page.locator('.leaderboard-modes a[aria-current="page"]').getAttribute('href'),'/leaderboard?view=daily');
  await go();await page.evaluate(()=>{economyFlags.paletteAuctions=false;renderStart();});assert.equal(await page.locator('.daily-next-links a[href="/auction-house"]').count(),0);
  assert.deepEqual(errors,[]);console.log('Daily menu passed: all three existing games launch; guest/signed-in/resume/completed states; server progress across devices; correct rewards, no repeat payout; leaderboard and flag-aware auction links; keyboard; live reset; EN/DE at 1440/1024/768/600/390/320px; no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
