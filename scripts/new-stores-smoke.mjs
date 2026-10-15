// Optional browser regression check with isolated data; npm test needs no browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { buyBusiness, stockBusiness, businessDashboard, unstockBusiness } from '../src/businesses.mjs';
import { townMap } from '../src/town-map.mjs';
import { supplyStockPaletteAuctions } from '../src/stock-palette-auctions.mjs';
import {listItem} from '../src/resale.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-business-owner-');
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
accounts.db(db=>{db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('new-owner','NewStoreOwner','disabled',1000000,36100,?)").run(Date.now());for(const [id,title,marketCategory,price] of [['ring','Silver ring','watches_jewelry',350],['drill','Cordless drill','tools',90],['surplus','Surplus container','other',50]])db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,'new-owner',JSON.stringify({title,marketCategory,price,rarity:'rare'}),Date.now());});
const newOwner={id:'new-owner'},newToken=accounts.atomic(db=>accounts.session(db,newOwner.id)),newShops={};
upsertAuctions(dir,[{id:99001,title:'Silver Ring',category:'Schmuck & Uhren',finalPrice:350,image:'/assets/makita.jpg'},{id:99002,title:'Cordless drill',category:'Werkzeuge',finalPrice:90,image:'/assets/makita.jpg'}]);
supplyStockPaletteAuctions(dir);
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'jg_session',value:newToken,url:base}]);
 for(const type of ['jeweler','hardware']){await page.goto(base+'/town?view=open');await page.waitForSelector('.town-place-row');const map=townMap(dir,newOwner),plot=map.plots.find(p=>!p.occupied&&p.size==='popup'),before=accounts.profile(newOwner).tokens;assert.equal(map.compatibleStock.jeweler,1);assert.equal(map.compatibleStock.hardware,2);await page.locator(`.town-place-row[data-town-select="${plot.id}"]`).click();await page.locator('[data-town-open]').click();assert.equal(await page.locator('.town-type-choice').count(),6);await page.locator(`.town-type-choice input[value="${type}"]`).check();assert.match(await page.locator('.town-type-choice.is-selected').innerText(),type==='jeweler'?/Jewelry & watches/:/Tools & Other/);await page.locator('[data-town-review]').click();assert.match(await page.locator('.town-buy-summary').innerText(),new RegExp(String(plot.costs[type]).replace(/\B(?=(\d{3})+(?!\d))/g,',')));await page.locator('.town-purchase [type="submit"]').click();await page.waitForSelector('.business-shop');newShops[type]=businessDashboard(dir,newOwner).shops.find(s=>s.type===type);assert.equal(accounts.profile(newOwner).tokens,before-plot.costs[type]);}
 for(const type of ['jeweler','hardware']){const shop=newShops[type];await page.locator(`[data-business="quick-restock"][data-shop="${shop.id}"]`).click();await page.waitForFunction(({type,n})=>[...document.querySelectorAll('.shop-card')].some(card=>card.classList.contains('shop-color-'+type)&&card.textContent.includes(n+' / 10')),{type,n:type==='jeweler'?1:2});await page.goto(base+'/stores?shop='+shop.id+'&tab=stock');await page.waitForSelector('[data-shop-stock]');assert.equal(await page.locator('.shop-header .town-product-icon').getAttribute('data-product-icon'),type);await page.locator('.shop-supply-link').click();await page.waitForSelector('.auction-house');assert.match(await page.locator('.house-filter-context').innerText(),type==='jeweler'?/Jeweler/:/Hardware store/);assert.ok(await page.locator('.house-lot').count()>0,'compatible supply remains reachable');await page.goto(base+'/businesses');await page.waitForSelector('.business-shop');}
 // Real purchases of both tools and Other stock, with correct owner register accounting.
 await context.addCookies([{name:'jg_session',value:token,url:base}]);for(const type of ['jeweler','hardware']){const shop=newShops[type];await page.goto(base+'/stores?shop='+shop.id);await page.waitForSelector('[data-store="buy"]');for(let n=type==='hardware'?2:1;n>0;n--){await page.locator('[data-store="buy"]').first().click();await page.waitForFunction(n=>document.querySelectorAll('.visitor-stock-card').length===n-1,n);}await page.waitForSelector('.shop-inline-status');assert.ok(businessDashboard(dir,newOwner).shops.find(s=>s.id===shop.id).cashReady>0);}
 await context.addCookies([{name:'jg_session',value:newToken,url:base}]);
 for(const width of [1440,390,320])for(const lang of ['en','de']){await page.setViewportSize({width,height:900});await page.goto(base+'/town?view=open');await page.waitForSelector('.town-place-row');await page.evaluate(lang=>{const s=document.querySelector('#language-select');s.value=lang;s.dispatchEvent(new Event('change',{bubbles:true}));},lang);await page.locator('[data-town-display="list"]').evaluate(el=>el.click());await page.locator('.town-place-row').first().click();await page.locator('[data-town-open]').click();assert.equal(await page.locator('.town-type-choice').count(),6);assert.ok(await page.locator('.town-purchase-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`/tmp/new-stores-opening-${width}-${lang}.png`});await page.keyboard.press('Escape');await page.goto(base+'/businesses');await page.waitForSelector('.business-shop');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await page.goto(base+'/changelog');await page.waitForSelector('.changelog-entry');assert.match(await page.locator('.changelog-entry').filter({has:page.getByRole('heading',{name:'New Stores',exact:true})}).innerText(),/1[.,]800/);assert.match(await page.locator('.changelog-entry').filter({has:page.getByRole('heading',{name:'New Stores',exact:true})}).innerText(),/1[.,]100/);assert.deepEqual(errors,[]);console.log('New stores passed: real opening/quoted prices, six-option menu, tools+Other and jewelry stocking, distinct artwork, compatible supplier filters, real purchases/registers, EN/DE 1440/390/320px, changelog.');await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
