import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { pushNotification } from '../src/notifications.mjs';
import { featureFlags } from '../src/features.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dir = await mkdtemp('/tmp/jg-qol-inbox-');
const env = { ADMIN_USERNAME:'admin', ADMIN_PASSWORD:'qol-notifications-password', COOKIE_SECURE:'false' }, flags = featureFlags(env);
const json = (res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const seed = JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api = await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})});
const accounts = new Accounts(dir,{flags}), token = await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}), user = accounts.user(token);
accounts.db(db=>{for(let n=0;n<35;n++)pushNotification(db,user.id,{type:'store',sourceKey:`qol-${n}`,titleEn:`Sale ${n}`,titleDe:`Verkauf ${n}`,bodyEn:'A saved store sale.',bodyDe:'Ein gespeicherter Ladenverkauf.',href:'/businesses'},Date.now()-n*1000);});
const economy = createEconomyApi({dataDir:dir,json,flags,accounts});
const server = createServer(async(req,res)=>{try{
 const url = new URL(req.url,'http://localhost');if(await api(req,res,url)||await economy(req,res,url))return;
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
 const filename = url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname;
 const content = await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
 const context = await browser.newContext(), page = await context.newPage(), errors=[];
 page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
 await page.goto(base+'/profile');await page.waitForSelector('.profile-hub');
 for(const width of [1440,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:900});await page.evaluate(lang=>{document.querySelector('#language-select').value=lang;document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true}));},lang);
  await page.locator('#notification-button').click();await page.waitForFunction(()=>notificationUnreadCount===0);
  const id=await page.locator('a.notification-entry').nth(15).getAttribute('data-notification-id');
  await page.locator(`[data-notification-id="${id}"]`).focus();
  const scroll=await page.locator('.notification-list').evaluate(el=>el.scrollTop);assert.ok(scroll>0);
  await page.evaluate(()=>loadNotifications(false,false));
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.notificationId),id,`${width} ${lang} refresh retains focused notification`);
  assert.equal(await page.locator('.notification-list').evaluate(el=>el.scrollTop),scroll,`${width} ${lang} refresh retains scroll`);
  await page.evaluate(()=>document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true})));
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.notificationId),id,'language refresh retains focus');
  assert.equal(await page.locator('.notification-list').evaluate(el=>el.scrollTop),scroll,'language refresh retains scroll');
  await page.evaluate(id=>{accountNotifications=accountNotifications.filter(entry=>String(entry.id)!==id);renderNotificationPanel();},id);
  assert.ok(await page.locator('[data-notification="close"]').evaluate(el=>el===document.activeElement),'removed entry returns focus to close');
  assert.ok(await page.locator('#notification-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}),'inbox fits viewport');
  await page.keyboard.press('Escape');assert.ok(await page.locator('#notification-button').evaluate(el=>el===document.activeElement));
 }
 assert.deepEqual(errors,[]);await context.close();console.log('Notification QoL passed: polling/language refresh preserve focused entry and list scroll, removed entry focus fallback, Escape, EN/DE at1440/390/320px, no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
