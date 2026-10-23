// Exercise typed guesses at expiry through the real account and guest APIs.
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
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-daily-timeout-');
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
  for(const mode of ['account','guest','random']) {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    if(mode==='account')await context.addCookies([{name:'jg_session',value:token,url:base}]);
    const menu=async()=>{await page.goto(base);await page.waitForSelector('.daily-home');await page.evaluate(()=>accountReady);};
    await menu();await page.locator(mode==='random'?'[data-action="random"]':'.daily-play').click();await page.waitForSelector('#price-input');
    for(const [position,value] of ['123,45','0','','invalid'].entries()) {
      if(position===0){await page.locator('#price-input').fill('12');await page.locator('#price-input').fill('123');}
      if(position>=2)await page.locator('#price-input').fill('777');
      await page.locator('#price-input').fill(value);
      await page.waitForFunction(()=>guessDraftWrites.size===0);
      const runId=await page.evaluate(()=>gameMode==='daily'?accountDailyRun.id:randomGameRun.id),table=mode==='account'?'account_games':'guest_game_runs';
      const expected=position===0?123.45:position===1?0:null;
      let stored=accounts.db(db=>JSON.parse(db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(runId).payload));
      if(expected!==null)assert.equal(stored.roundDraft.answer,expected);
      assert.equal(stored.answers.length,position,'Typing must not submit or reveal a price');
      // Move only this isolated fixture clock to expiry. The real API then
      // receives the automatic answer strictly after its stored deadline.
      if(mode==='guest'&&position===0){
        await page.waitForSelector('.reveal-panel',{timeout:30000});
      }else{
      stored.roundDeadlineAt=Date.now()-1;
      accounts.db(db=>db.prepare(`UPDATE ${table} SET payload=? WHERE id=?`).run(JSON.stringify(stored),runId));
      if(mode==='account'&&position===0){
        await menu();await page.locator('.daily-play').click();
      }else await page.evaluate(()=>{const run=gameMode==='daily'?accountDailyRun:randomGameRun;run.clientDeadlineAt=Date.now()-1;startGuessTimer();});
      }
      await page.waitForSelector('.reveal-panel');
      const answer=await page.evaluate(position=>state.answers[position],position);
      assert.equal(answer.guess,expected,`${mode} ${JSON.stringify(value)} must use the typed value at expiry`);
      assert.equal(answer.score>0,expected!==null);
      stored=accounts.db(db=>JSON.parse(db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(runId).payload));
      assert.equal(stored.answers[position],expected);
      assert.equal(stored.roundDraft,undefined);
      if(position<3){await page.locator('[data-action="next"]').click();await page.waitForSelector('#price-input');assert.equal(await page.locator('#price-input').inputValue(),'');}
    }
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Typed timeout guesses passed: signed-in Daily, guest Daily, Free Play, decimal comma, zero, empty/invalid fields, rapid edits, expired reload and next-round isolation.');
} finally {await browser.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
