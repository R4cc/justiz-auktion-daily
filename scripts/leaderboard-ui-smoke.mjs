// Optional browser check using an isolated real account API and game data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { featureFlags } from '../src/features.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dir = await mkdtemp('/tmp/jg-leaderboard-ui-');
const env = { ADMIN_USERNAME:'admin', ADMIN_PASSWORD:'leaderboard-browser-password', COOKIE_SECURE:'false' }, flags = featureFlags(env);
const json = (res,status,value) => {res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed = JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const lots = seed.auctions.slice(0,5).map(lot=>({...lot,actualBid:lot.currentBid}));
const api = await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:lots})}), accounts = new Accounts(dir,{flags});
const adminToken = await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}), admin = accounts.user(adminToken), players = [];
for(const [username,value,multiplier] of [['Collector_With_A_Very_Long_Name',8765432,2],['AppraisalAce',4200,1],['MuseumKeeper',2600,1.5],['RisingTrader',1200,3]]){
  const token = await accounts.register({username,password:env.ADMIN_PASSWORD,code:accounts.codes(admin,1)[0]}), user = accounts.user(token);
  accounts.db(db=>db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run('item-'+user.id,user.id,JSON.stringify({title:'Collected artwork',price:value,marketCategory:'collectibles',rarity:'rare'}),Date.now()));
  const run = accounts.startGame(user,'daily',()=>lots);for(let n=0;n<5;n++)accounts.answer(user,run.id,n,Math.round(lots[n].actualBid*multiplier));
  players.push({user,token});
}
const viewer = players[3], economy = createEconomyApi({dataDir:dir,json,flags,accounts});
const server = createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
  const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));
  res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/leaderboard');await page.waitForSelector('.leaderboard-page');
  const guestNames=await page.locator('.podium-name').allTextContents();assert.ok(guestNames.every(name=>name.includes('****')));assert.equal(await page.locator('.leaderboard-personal .leaderboard-you').count(),0);
  assert.equal(await page.locator('.site-nav a[href="/leaderboard"]').isVisible(),true);
  assert.equal(await page.locator('.site-nav a[href="/leaderboard"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('.site-nav a[href="/leaderboard"] [data-nav-icon="/leaderboard"]').count(),1);
  await context.addCookies([{name:'jg_session',value:viewer.token,url:base}]);await page.reload();await page.waitForSelector('.leaderboard-personal-rank');
  assert.equal(await page.locator('.podium-place-1 .podium-name').innerText(),players[0].user.username);
  assert.equal(await page.locator('.leaderboard-personal-rank > strong').innerText(),'#4');assert.equal(await page.locator('tbody tr.is-me').count(),1);
  const setLanguage=async lang=>{const hidden=!(await page.locator('#language-select').isVisible());if(hidden)await page.locator('[data-action="sidebar"]').click();await page.locator('#language-select').selectOption(lang);if(hidden)await page.keyboard.press('Escape');};
  for(const route of ['/leaderboard','/leaderboard?view=daily']){
    await page.goto(base+route);await page.waitForSelector('.leaderboard-podium');
    const expected = accounts.leaderboard(route.includes('daily')?'daily':'collection').leaders;
    assert.deepEqual(await page.locator('.podium-name').allTextContents(),expected.slice(0,3).map(leader=>leader.username));
    for(const width of [1440,1024,768,600,390,320]){
      await page.setViewportSize({width,height:1000});
      for(const lang of ['en','de']){
        await setLanguage(lang);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} ${width} ${lang} page overflow`);
        assert.ok(await page.locator('.leaderboard-wrap').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${route} ${width} ${lang} table overflow`);
        assert.ok(await page.locator('.podium-player-card').evaluateAll(cards=>cards.every(card=>card.scrollWidth<=card.clientWidth+1)),`${route} ${width} ${lang} podium overflow`);
        const positions=await page.locator('.podium-player').evaluateAll(cards=>cards.map(card=>({rank:Number(card.querySelector('.podium-avatar > span').textContent),x:card.getBoundingClientRect().x})));
        assert.ok(positions.find(p=>p.rank===2).x<positions.find(p=>p.rank===1).x&&positions.find(p=>p.rank===1).x<positions.find(p=>p.rank===3).x);
        assert.equal(await page.locator('.leaderboard-modes a[aria-current="page"]').count(),1);
        assert.ok(await page.locator('.leaderboard-modes a[aria-current="page"]').evaluate(el=>{const style=getComputedStyle(el);return style.color!==style.backgroundColor;}), 'Active mode label must stay visible');
        if([1440,390,320].includes(width))await page.screenshot({path:`/tmp/jg-leaderboard-${route.includes('daily')?'daily':'collection'}-${width}-${lang}.png`,fullPage:true});
      }
    }
  }
  await page.setViewportSize({width:1440,height:1000});await setLanguage('en');
  await page.locator('.leaderboard-refresh').click();await page.waitForSelector('.leaderboard-page');assert.ok(page.url().endsWith('?view=daily'));assert.equal(await page.locator('.podium-place-1 .podium-name').innerText(),'AppraisalAce');
  await page.locator('.leaderboard-modes a[href="/leaderboard"]').focus();await page.keyboard.press('Enter');await page.waitForURL(base+'/leaderboard');await page.waitForSelector('.podium-place-1');
  await page.setViewportSize({width:390,height:1000});await page.locator('[data-action="sidebar"]').click();await page.locator('.site-nav a[href="/leaderboard"]').click();assert.equal(await page.locator('.site-header').evaluate(el=>el.classList.contains('is-open')),false);
  // Sparse results render only real players, and an empty Daily offers a start action.
  const board=accounts.leaderboard();let sample=board;
  await page.route('**/api/account/leaderboard*',route=>route.fulfill({json:sample}));
  for(const count of [0,1,2,3]){
    sample={...board,view:'daily',leaders:board.leaders.slice(0,count).map(leader=>({...leader,score:0}))};
    await page.goto(base+'/leaderboard?view=daily');await page.waitForSelector('.leaderboard-page');
    assert.equal(await page.locator('.podium-player').count(),count);assert.equal(await page.locator('tbody tr').count(),count);
    if(!count){assert.equal(await page.locator('.leaderboard-empty a').getAttribute('href'),'/');assert.equal(await page.locator('.leaderboard-personal-rank > strong').innerText(),'—');}
  }
  sample={...board,leaders:[{...board.leaders[0],username:'<img src=x onerror="window.bad=true">'}]};await page.reload();await page.waitForSelector('.podium-player');assert.equal(await page.locator('.podium-name img, .leaderboard-player img').count(),0);assert.equal(await page.evaluate(()=>window.bad),undefined);
  assert.deepEqual(errors,[]);
  console.log('Leaderboard UI passed: sidebar trophy/active link, real podium order and metrics, guest privacy, personal standing, both modes, keyboard switching, refresh, mobile drawer; EN/DE at 1440/1024/768/600/390/320px; long names/large values; empty and 1/2/3-player results; escaped names; no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
