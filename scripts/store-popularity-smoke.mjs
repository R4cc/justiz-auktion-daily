// Optional browser regression check with isolated data; npm test needs no browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { buyBusiness, stockBusiness, businessDashboard, unstockBusiness } from '../src/businesses.mjs';
import { townMap } from '../src/town-map.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(),'jg-store-popularity-'));
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('mira','Mira','disabled',1000000,36100,?)").run(Date.now()));
const wine = buyBusiness(dir, owner, 'wine', 'popup').shop, toys = buyBusiness(dir, owner, 'toys', 'popup').shop, tech = buyBusiness(dir, {id:'mira'}, 'electronics', 'popup').shop;
const addItem = (id, category, title) => accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id, owner.id, JSON.stringify({ title, price: 30, marketCategory: category, rarity: 'common' }), Date.now()));
for (let n = 0; n < 12; n++) addItem(`wine-${n}`, 'wine', n < 10 ? 'Riesling' : 'Merlot');
for (let n = 0; n < 12; n++) addItem(`toy-${n}`, 'collectibles', `Toy ${n % 3}`);
stockBusiness(dir, owner, wine.id, Array.from({ length: 9 }, (_, n) => `wine-${n}`));
for(let i=0;i<3;i++)accounts.db(db=>db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('tech-'+i,'mira',JSON.stringify({title:['Vintage camera','Portable music player','Wireless headphones'][i],price:80,marketCategory:'electronics',rarity:['common','uncommon','rare'][i],image:'/assets/makita.jpg'}),Date.now()));
stockBusiness(dir,{id:'mira'},tech.id,['tech-0','tech-1','tech-2']);
accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=1540 WHERE id=?').run(wine.id));
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts }), writes = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && ['/api/account/businesses/stock/transfer','/api/account/businesses/settings'].includes(url.pathname)) writes.push(Date.now());
    if (await api(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const buf = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
// Use real weighted reviews and a residential plot to exercise both penalties.
accounts.db(db=>{db.prepare("UPDATE businesses SET plot_id='hietzing-4' WHERE id=?").run(wine.id);for(let i=0;i<20;i++){const id='critic-'+i;db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',1000,?)").run(id,id,Date.now());db.prepare("INSERT INTO store_reviews(business_id,user_id,stars,comment,updated_at) VALUES(?,?,1,'',?)").run(wine.id,id,Date.now());}});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);

 await page.goto(base+'/businesses');await page.waitForSelector('.shop-popularity-tip');
 assert.equal(await page.locator('.shop-card details[data-popularity-breakdown]').count(),0);
 const card=page.locator('.business-shop').filter({has:page.locator('[data-business="collect-cash"][data-shop="'+wine.id+'"]')});
 const geometry=()=>page.locator('.shop-card,.shop-open-card').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};}));
 const stable=(before,after,label)=>{assert.equal(after.length,before.length);before.forEach((rect,i)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(rect[key]-after[i][key])<1,label+' '+i+' '+key+': '+rect[key]+' -> '+after[i][key]);});};
 for(const width of [1440,1024,768,390,320])for(const lang of ['en','de']){
   await page.setViewportSize({width,height:width<=390?740:1000});
   await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
   const tip=card.locator('.shop-popularity-tip'),button=tip.locator('button'),popup=tip.locator('[role=tooltip]');
   await button.scrollIntoViewIfNeeded();const initial=await geometry();
   assert.ok(await button.locator('.store-popularity-track').evaluate(el=>el.getBoundingClientRect().width>100),'popularity meter is visible');
   if(width>900)await button.hover();else await button.tap();
   await page.waitForFunction(()=>[...document.querySelectorAll('.shop-popularity-tip [role=tooltip]')].some(el=>getComputedStyle(el).opacity==='1'));
   stable(initial,await geometry(),'popularity '+width+' '+lang);
   const bounds=await popup.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=(width<=390?740:1000),'tooltip fits '+width+' '+lang+' '+JSON.stringify(bounds));
   assert.match(await popup.innerText(),lang==='en'?/Poor reviews/:/Schlechte Bewertungen/);
   const traffic=businessDashboard(dir,owner).shops.find(s=>s.id===wine.id).popularityBreakdown.visitorEffectPercent;
   const trafficText=await page.evaluate(traffic=>(traffic>0?'+':traffic<0?'−':'')+number(Math.abs(traffic))+'% '+t('visitors','Besucher'),traffic);
   assert.ok((await popup.innerText()).includes(trafficText),trafficText+' in '+await popup.innerText());
   assert.equal(await button.getAttribute('aria-describedby'),await popup.getAttribute('id'));
   await page.mouse.move(0,0);await button.focus();assert.equal(await popup.evaluate(el=>getComputedStyle(el).opacity),'1');
   await page.screenshot({path:path.join(os.tmpdir(),'jg-store-popularity-'+width+'-'+lang+'.png'),fullPage:true});
   await page.keyboard.press('Escape');assert.equal(await popup.evaluate(el=>getComputedStyle(el).visibility),'hidden');
   await button.blur();await page.mouse.move(0,0);
   accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=? WHERE id=?').run(width===320?1000000000000:1000000,wine.id));
   await page.evaluate(()=>businessUi.refresh(accountVisit));
   let release;const held=new Promise(resolve=>release=resolve);
   await page.route('**/api/account/businesses/collect',async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
   const collect=card.locator('[data-business="collect-cash"]');await collect.scrollIntoViewIfNeeded();const before=await geometry();
   await collect.click();await page.waitForSelector('.business-cash-button.is-collecting');
   stable(before,await geometry(),'collecting '+width+' '+lang);release();
   await page.waitForFunction(()=>!document.querySelector('.business-cash-button.is-collecting'));
   assert.match(await card.locator('.business-cash-status').innerText(),lang==='en'?/Collected/:/eingesammelt/);
   stable(before,await geometry(),'collected '+width+' '+lang);
   assert.ok(await card.locator('.business-cash-copy,.business-cash-status').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)),'cash text fits '+width+' '+lang);
   await page.unroute('**/api/account/businesses/collect');
   await page.evaluate(()=>businessUi.refresh(accountVisit));stable(before,await geometry(),'statistics refresh '+width+' '+lang);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits '+width+' '+lang);
   await card.screenshot({path:path.join(os.tmpdir(),'jg-store-card-'+width+'-'+lang+'.png')});
 }
 await page.evaluate(()=>{const select=document.querySelector('#language-select');select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await card.locator('[data-business="open-restock"]').click();await page.waitForSelector('.shop-task[open] [data-shop-stock]');await page.keyboard.press('Escape');
 await card.locator('[data-business="open-edit"]').click();await page.waitForSelector('.shop-task[open] [data-shop-settings]');await page.keyboard.press('Escape');
 await card.locator('a.primary-button').click();await page.waitForSelector('[data-popularity-breakdown][open]');const expected=businessDashboard(dir,owner).shops.find(s=>s.id===wine.id).popularityPercent;assert.match(await page.locator('.shop-popularity-total dd').innerText(),new RegExp(expected+'%'));
 for(const label of ['Shelf fill','Stock value']) {
   const points=await page.locator('.shop-popularity-explanation dl > div').evaluateAll((rows,label)=>rows.find(row=>row.querySelector('dt')?.textContent.startsWith(label))?.querySelector('dd')?.textContent,label);
   assert.match(points,/^0\s/,`${label} should be neutral with 9/10 low-value stock`);
 }
 for(const width of [1440,768,390,320])for(const lang of ['en','de']){await page.setViewportSize({width,height:1000});await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);assert.match(await page.locator('[data-popularity-breakdown]').innerText(),lang==='en'?/Poor reviews/:/Schlechte Bewertungen/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('.shop-popularity-explanation').evaluate(el=>el.scrollWidth<=el.clientWidth+1));if([1440,320].includes(width))await page.screenshot({path:path.join(os.tmpdir(),`store-popularity-${width}-${lang}.png`),fullPage:true});}

 // The register on the full management page also retains its dimensions.
 for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1000});
   accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=? WHERE id=?').run(width===320?1000000000000:12345,wine.id));
   await page.evaluate(()=>businessUi.refresh(accountVisit));
   const surface=page.locator('.shop-surface'),size=()=>surface.evaluate(el=>[el.getBoundingClientRect().width,el.getBoundingClientRect().height]);
   const before=await size();let release;const held=new Promise(resolve=>release=resolve);
   await page.route('**/api/account/businesses/collect',async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
   await page.locator('.shop-overview-actions [data-business="collect-cash"]').click();await page.waitForSelector('.business-cash-button.is-collecting');
   assert.deepEqual(await size(),before,'owner register collecting '+width);release();
   await page.waitForFunction(()=>!document.querySelector('.business-cash-button.is-collecting'));
   assert.deepEqual(await size(),before,'owner register collected '+width);
   await page.unroute('**/api/account/businesses/collect');
 }
 await page.goto(base+'/stores?shop='+tech.id);await page.waitForSelector('.visitor-storefront');assert.equal(await page.locator('[data-popularity-breakdown]').count(),0);assert.deepEqual(errors,[]);console.log('Popularity UI passed: portfolio hover/focus/touch tooltip and stable collecting/collected card geometry, owner breakdown, negative review points, separate location traffic, EN/DE 1440–320px, private owner scope, no overflow or JS errors.');await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
