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
// Use real weighted reviews and a residential plot to exercise both penalties.
accounts.db(db=>{db.prepare("UPDATE businesses SET plot_id='hietzing-4' WHERE id=?").run(wine.id);for(let i=0;i<20;i++){const id='critic-'+i;db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',1000,?)").run(id,id,Date.now());db.prepare("INSERT INTO store_reviews(business_id,user_id,stars,comment,updated_at) VALUES(?,?,1,'',?)").run(wine.id,id,Date.now());}});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
 await page.goto(base+'/businesses');await page.waitForSelector('[data-popularity-breakdown]');assert.equal(await page.locator('[data-popularity-breakdown]').count(),2);assert.equal(await page.locator('[data-popularity-breakdown]').first().evaluate(el=>el.open),false);await page.locator('[data-popularity-breakdown] summary').first().press('Enter');assert.equal(await page.locator('[data-popularity-breakdown]').first().evaluate(el=>el.open),true);assert.match(await page.locator('[data-popularity-breakdown]').first().innerText(),/Poor reviews/);assert.match(await page.locator('[data-popularity-breakdown]').first().innerText(),/−35% visitors/);
 await page.goto(base+'/stores?shop='+wine.id);await page.waitForSelector('[data-popularity-breakdown][open]');const expected=businessDashboard(dir,owner).shops.find(s=>s.id===wine.id).popularityPercent;assert.match(await page.locator('.shop-popularity-total dd').innerText(),new RegExp(expected+'%'));
 for(const label of ['Shelf fill','Stock value']) {
   const points=await page.locator('.shop-popularity-explanation dl > div').evaluateAll((rows,label)=>rows.find(row=>row.querySelector('dt')?.textContent.startsWith(label))?.querySelector('dd')?.textContent,label);
   assert.match(points,/^0\s/,`${label} should be neutral with 9/10 low-value stock`);
 }
 for(const width of [1440,768,390,320])for(const lang of ['en','de']){await page.setViewportSize({width,height:1000});await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);assert.match(await page.locator('[data-popularity-breakdown]').innerText(),lang==='en'?/Poor reviews/:/Schlechte Bewertungen/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('.shop-popularity-explanation').evaluate(el=>el.scrollWidth<=el.clientWidth+1));if([1440,320].includes(width))await page.screenshot({path:`/tmp/store-popularity-${width}-${lang}.png`,fullPage:true});}
 await page.goto(base+'/stores?shop='+tech.id);await page.waitForSelector('.visitor-storefront');assert.equal(await page.locator('[data-popularity-breakdown]').count(),0);assert.deepEqual(errors,[]);console.log('Popularity UI passed: portfolio keyboard disclosure, owner breakdown, negative review points, separate −35% visitor traffic, EN/DE 1440–320px, private owner scope, no overflow or JS errors.');await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
