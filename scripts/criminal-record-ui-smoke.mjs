// Isolated browser regression: real caught theft plus historical pagination.
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
import { startStoreHeist,actStoreHeist,visitStore,playerCriminalRecord } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-criminal-record-ui-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'criminal-record-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})}),accounts=new Accounts(dir,{flags});
const adminToken=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(adminToken),now=Date.now();
accounts.db(db=>{db.prepare('UPDATE users SET tokens=1000000 WHERE id=?').run(owner.id);db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('thief','Repeat_offender','disabled',100000,?)").run(now);db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('wine',owner.id,JSON.stringify({title:'Wine',price:100,marketCategory:'wine'}),now);});
const shop=buyBusiness(dir,owner,'wine','popup',{now}).shop;stockBusiness(dir,owner,shop.id,['wine'],{now});
const thief={id:'thief'},entry=visitStore(dir,thief,shop.id,{now}).store.stock[0],heist=startStoreHeist(dir,thief,{shopId:shop.id,inventoryId:entry.id,expectedPrice:entry.price,expectedFine:entry.theft.fine,requestId:'crime-browser-attempt-001'},{now,draw:max=>max-1});
accounts.db(db=>db.prepare('UPDATE store_heists SET blackjack=? WHERE id=?').run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[1,4,5],turn:0,outcome:'active'}),heist.id));
actStoreHeist(dir,thief,{heistId:heist.id,action:'stand',turn:0,requestId:'crime-browser-stand-001'},{now});
accounts.db(db=>{const insert=db.prepare(`INSERT INTO store_heists(id,user_id,business_id,owner_id,inventory_id,sequence,roll,chance,fee,created_at,ready_at,expires_at,status,result,blackjack,settled_at)
 VALUES(?,'thief',?,?,'wine','[]',0,0,?,?,?,?,'caught','{}',?,?)`);for(let n=0;n<13;n++){const at=now-(n+1)*86400000;insert.run('historical-'+n,shop.id,owner.id,100+n,at,at+1000,at+600000,n===12?null:'{}',n===12?null:at+2000);}});
const thiefToken=accounts.atomic(db=>accounts.session(db,'thief')),expected=playerCriminalRecord(dir,thief,{limit:50}),economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:thiefToken,url:base}]);
 await page.goto(base+'/profile');await page.waitForSelector('.criminal-record-entry');assert.equal(await page.locator('.criminal-record-entry').count(),10);
 const top=page.locator('.criminal-record-entry').first();assert.equal(await top.getAttribute('data-offense'),heist.id);assert.match(await top.innerText(),/Fine/);assert.equal(await top.locator('time').getAttribute('datetime'),new Date(now).toISOString());
 await page.locator('[data-account="criminal-record-more"]').click();await page.waitForFunction(()=>document.querySelectorAll('.criminal-record-entry').length===14);assert.equal(await page.locator('[data-account="criminal-record-more"]').count(),0);assert.equal(await page.locator('.criminal-record-entry').nth(10).evaluate(el=>el===document.activeElement),true);
 assert.equal(await page.locator('.criminal-record-entry').evaluateAll(nodes=>new Set(nodes.map(el=>el.dataset.offense)).size),14);assert.match(await page.locator('.criminal-record-entry').last().innerText(),/recording time unavailable.*Mischief fee/s);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);assert.equal(await page.locator('.criminal-record-entry').count(),14);assert.equal(await page.locator('#criminal-record-title').innerText(),lang==='en'?'Criminal record':'Strafregister');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' '+lang+' page overflow');assert.ok(await page.locator('.criminal-record-entry').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1)),width+' '+lang+' row overflow');if([1440,390].includes(width))await page.locator('.profile-criminal-record').screenshot({path:`/tmp/jg-crime-${width}-${lang}.png`});}}
 const response=await context.request.get(base+'/api/account/criminal-record?userId='+owner.id);assert.equal(response.status(),200);assert.equal((await response.json()).total,expected.total);
 await context.addCookies([{name:'jg_session',value:adminToken,url:base}]);await page.goto(base+'/profile');await page.waitForSelector('.criminal-record-clear');assert.equal(await page.locator('.criminal-record-entry').count(),0);
 const guest=await browser.newContext(),anonymous=await guest.newPage();await anonymous.goto(base+'/profile');assert.equal((await guest.request.get(base+'/api/account/criminal-record')).status(),401);await guest.close();
 assert.deepEqual(errors,[]);console.log('Criminal record UI passed: real offense, exact date/fine, historical entries and unknown dates, full pagination with keyboard focus, account isolation and empty state, EN/DE 1440–320px without overflow.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
