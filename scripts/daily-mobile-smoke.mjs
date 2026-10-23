// Isolated mobile coverage for Daily play, rewards, resume and related modes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Accounts} from '../src/accounts.mjs';
import {createGuestGameApi} from '../src/guest-game-api.mjs';
import {publicDailySummary} from '../src/game-rounds.mjs';
import {createAccountApi} from '../src/account-api.mjs';
import {createEconomyApi} from '../src/economy-api.mjs';
import {closeDataStore,upsertAuctions} from '../src/database.mjs';
import {featureFlags} from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-daily-mobile-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'daily-menu-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const lots=Array.from({length:40},(_,n)=>({id:10000+n,title:n===0?'Vintage camera with leather case':n===1?'Industrial precision workshop tool collection with original cases and accessories':`Auction find ${n}`,category:['Werkzeug','Fahrrad','Elektronik','Getränke'][n%4],currentBid:30+n*11,actualBid:30+n*11,startBid:10+n,condition:'used',image:'/favicon.png',images:['/favicon.png','/assets/justizguessr-logo.png'],description:'A carefully stored auction find. '+('Inspection notes and original accessories are included. '.repeat(n===1?20:2)),endAt:new Date(Date.now()-86400000).toISOString()}));
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
  res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':filename.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(buf);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try {
  const diagnostic=process.env.DAILY_MOBILE_DIAGNOSTIC==='1';
  const check=(condition,message,details)=>{if(!condition&&diagnostic)console.log('BASELINE:',message,details||'');else assert.ok(condition,message+(details?' '+JSON.stringify(details):''));};
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const language=lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  const ready=async()=>{await page.goto(base);await page.waitForSelector('.daily-home');await page.waitForFunction(()=>dailyMeta?.gameNumber===285);await page.evaluate(()=>accountReady);};
  const screenshot=async name=>{await page.evaluate(()=>document.querySelector('#notification-toasts')?.replaceChildren());await page.screenshot({path:'/tmp/daily-mobile-'+name+'.png',fullPage:true});};
  const fit=async state=>{
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),state+' page overflow');
    const overflow=await page.locator('.daily-challenge,.daily-reward-panel,.daily-mode,.hl-card,.results-score,.result-row,.auction-panel').evaluateAll(elements=>elements.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({class:el.className,width:el.clientWidth,scroll:el.scrollWidth})));
    check(!overflow.length,state+' internal overflow',overflow);
  };
  const target=async(selector,state)=>{
    const sizes=await page.locator(selector).evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>({action:el.dataset.action||el.className,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
    check(sizes.every(size=>size.width>=43.5&&size.height>=43.5),state+' touch targets under 44px',sizes);
  };
  await ready();
  for(const [width,height] of [[320,568],[390,844],[768,1024],[844,390]]){
    await page.setViewportSize({width,height});
    for(const lang of ['en','de']){await language(lang);await fit('menu '+width+' '+lang);await target('.daily-play,.daily-mode-play,.daily-next-links a','menu');}
  }
  await page.setViewportSize({width:390,height:844});await language('en');await screenshot('menu');
  await page.locator('.daily-play').click();await page.waitForSelector('#price-input');await page.waitForTimeout(80);
  check(await page.evaluate(()=>document.activeElement?.id!=='price-input'),'Touch entry must not automatically open the numeric keyboard');
  const firstMetrics=await page.evaluate(()=>({photo:document.querySelector('.auction-image-wrap').getBoundingClientRect().toJSON(),submit:document.querySelector('.submit-guess').getBoundingClientRect().toJSON(),viewport:innerHeight}));
  check(firstMetrics.photo.top>=0&&firstMetrics.submit.bottom<=firstMetrics.viewport-6,'Phone image and guess action fit the initial viewport',firstMetrics);
  await target('.carousel-arrow,.submit-guess','Daily round');
  check(await page.locator('#price-input').evaluate(input=>parseFloat(getComputedStyle(input).fontSize)>=16),'Guess input prevents iOS focus zoom');
  check(await page.locator('.input-hint > span').evaluate(span=>getComputedStyle(span).display==='none'),'Touch play hides the desktop Enter shortcut');
  const deadline=await page.evaluate(()=>accountDailyRun.roundDeadlineAt),timerDeadline=await page.evaluate(()=>guessDeadline);
  await page.locator('[data-action="next-image"]').click();await language('de');
  check(await page.evaluate(()=>accountDailyRun.roundDeadlineAt)===deadline,'Gallery/language cannot reset the server deadline');
  check(await page.evaluate(()=>guessDeadline)<=timerDeadline+100,'Gallery/language cannot extend the local timer');
  await screenshot('round');
  await page.screenshot({path:'/tmp/daily-mobile-round-viewport.png'});
  // Orientation and keyboard viewport changes must retain the same live guess.
  await page.locator('#price-input').fill('123.45');
  const orientationDeadline=await page.evaluate(()=>accountDailyRun.roundDeadlineAt),orientationTimer=await page.evaluate(()=>guessDeadline);
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);
  const landscape=await page.evaluate(()=>({control:document.querySelector('.guess-control').getBoundingClientRect().toJSON(),height:visualViewport?.height||innerHeight,headerBottom:Math.max(document.querySelector('.site-header').getBoundingClientRect().bottom,document.querySelector('.persistent-wallet')?.getBoundingClientRect().bottom||0)}));
  check(landscape.control.bottom<=landscape.height&&landscape.control.top>=landscape.headerBottom,'Focused guess control stays visible after rotating the phone',landscape);
  check(await page.locator('#price-input').inputValue()==='123.45','Orientation preserves the typed guess');
  check(await page.evaluate(()=>accountDailyRun.roundDeadlineAt)===orientationDeadline,'Orientation preserves the server deadline');
  check(await page.evaluate(()=>guessDeadline)<=orientationTimer+100,'Orientation cannot extend the local timer');
  await page.screenshot({path:'/tmp/daily-mobile-landscape-viewport.png'});
  await page.setViewportSize({width:390,height:844});
  for(let position=0;position<5;position++){
    const width=position===3?844:position===1?320:390,height=position===3?390:position===2?480:844;
    await page.setViewportSize({width,height});
    await page.locator('#price-input').fill(String(lots[position].actualBid));
    await fit('guess '+position);if(position===3)await screenshot('landscape-guess');
    if(position===2)await page.locator('#price-input').press('Enter');else await page.locator('#guess-form button[type="submit"]').click();await page.waitForSelector('.reveal-panel');await page.waitForTimeout(80);
    await fit('reveal '+position);await target('[data-action="next"]','Next round');
    const next=await page.locator('[data-action="next"]').boundingBox();
    check(next.y>=0&&next.y+next.height<=height,'Next action visible after submitting',next);
    if(position===1)await screenshot('long-title-reveal');
    await page.locator('[data-action="next"]').click();await page.waitForSelector(position===4?'.results-screen':'#price-input');
    if(position===0){
      const runId=await page.evaluate(()=>accountDailyRun.id),savedDeadline=await page.evaluate(()=>accountDailyRun.roundDeadlineAt);
      await ready();check(await page.locator('.daily-menu-progress .is-done').count()===1,'Menu shows persisted round progress');
      await page.locator('.daily-play').click();await page.waitForSelector('#price-input');
      check(await page.evaluate(()=>accountDailyRun.id)===runId,'Resume keeps the same Daily run');
      check(await page.evaluate(()=>accountDailyRun.roundDeadlineAt)===savedDeadline,'Resume preserves the active round deadline');
    }
  }
  await page.waitForSelector('.daily-case-dialog[open]');
  for(const [width,height] of [[320,568],[390,844],[844,390]]){
    await page.setViewportSize({width,height});for(const lang of ['en','de']){await language(lang);await fit('results '+width+' '+lang);await target('.daily-case-dialog button','Daily reward');
      check(await page.locator('.daily-case-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),'Reward dialog fits viewport');}
  }
  await page.locator('.daily-case-dialog [data-choice="keep"]').click();await page.waitForFunction(()=>!dailyCaseBusy&&!dailyCaseDialog.open);
  check(accounts.inventory(owner).filter(item=>item.kind==='case').length===1,'Daily case claim grants one real case');
  await page.setViewportSize({width:390,height:844});await screenshot('results');await target('.results-actions button','Results');
  const balance=accounts.profile(owner).tokens;await ready();
  check((await page.locator('.daily-menu-progress .is-done').count())===5,'Completed Daily progress is preserved');
  await page.locator('.daily-play').click();await page.waitForSelector('.results-screen');check(accounts.profile(owner).tokens===balance,'Revisiting results cannot reward twice');
  await page.evaluate(()=>renderStart());
  // A guest Higher or Lower run uses this fixture's ascending confirmed bids.
  await context.clearCookies();await ready();await language('en');await page.locator('[data-action="higher-lower"]').click();await page.waitForSelector('.hl-choices');
  for(const [width,height] of [[320,568],[390,844],[844,390]]){
    await page.setViewportSize({width,height});await fit('Higher or Lower '+width);await target('.hl-gallery button,.hl-choices button,.hl-home','Higher or Lower');}
  await page.setViewportSize({width:390,height:844});await screenshot('higher-lower');
  await page.locator('[data-action="hl-higher"]').click();await page.waitForSelector('[data-action="hl-next"]');
  check(await page.locator('.hl-price-reveal').evaluate(el=>getComputedStyle(el).animationName==='none'),'Reduced motion suppresses the price reveal animation');
  await page.locator('[data-action="hl-next"]').click();await page.waitForSelector('.hl-choices');
  await page.locator('[data-action="hl-lower"]').click();await page.waitForSelector('.hl-verdict');
  check((await page.locator('.hl-verdict').innerText()).includes('Game over'),'Higher or Lower wrong guess ends the run');
  await page.locator('.hl-home').click();await page.waitForSelector('.daily-home');
  const desktop=await browser.newContext({viewport:{width:1440,height:900}}),dp=await desktop.newPage();
  dp.on('pageerror',error=>errors.push(error.message));await dp.goto(base);await dp.waitForSelector('.daily-home');await dp.locator('.daily-play').click();await dp.waitForSelector('#price-input');await dp.waitForTimeout(80);
  check(await dp.evaluate(()=>document.activeElement?.id==='price-input'),'Desktop play keeps keyboard autofocus');
  check(errors.length===0,'No browser errors',errors);await desktop.close();await context.close();
  console.log((diagnostic?'Daily mobile diagnostics complete:':'Daily mobile checks passed:')+' EN/DE 320–844px, short screens, touch and desktop focus, gallery/deadlines, complete/revisit, real reward, Higher or Lower and reduced motion.');
} finally {await browser.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
