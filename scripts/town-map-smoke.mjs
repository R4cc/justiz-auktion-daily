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
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { townMap } from '../src/town-map.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(),'jg-store-opening-'));
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
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await api(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const buf = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
 const go=async route=>{await page.goto(base+route);await page.waitForSelector('.town-page');};
 const language=async lang=>page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
 const fits=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' horizontal overflow');
 const quote=()=>townMap(dir,owner),balance=()=>accounts.profile(owner).tokens;
 await page.goto(base+'/stores');await page.waitForSelector('.market-store-card');
 await page.locator('.marketplace-heading a[href="/town?view=open"]').click();await page.waitForSelector('.town-page');
 assert.equal(await page.locator('.town-page h1').innerText(),'Open a store');
 assert.deepEqual(await page.locator('.town-location-tier h2').allTextContents(),['Budget','Midrange','Premium']);
 assert.equal(await page.locator('.town-location-district').count(),6);assert.equal(await page.locator('.town-place-row').count(),25);
 assert.equal(await page.locator('.town-map-shell,.town-canvas,.town-display-switch,.town-intents,[data-town-view]').count(),0);
 const choices=quote();
 for(const district of await page.locator('.town-location-district').all()){
  const ids=await district.locator('[data-town-open]').evaluateAll(nodes=>nodes.map(node=>node.dataset.townOpen));
  const prices=ids.map(id=>Math.min(...Object.values(choices.plots.find(p=>p.id===id).costs)));
  assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
 }
 for(const width of [3840,1920,1440,1024,900,768,600,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:1000});await language(lang);await fits(width+' '+lang);
  assert.equal(await page.locator('.town-place-row').count(),25);
  assert.ok(await page.locator('.town-place-row').first().evaluate(el=>el.getBoundingClientRect().height>=44));
  await page.locator('.town-place-row').first().focus();await page.keyboard.press('Enter');await page.waitForSelector('.town-purchase-dialog[open]');await fits(width+' '+lang+' purchase');
  assert.equal(await page.locator('.town-type-choice').count(),6);await page.keyboard.press('Escape');
  assert.ok(await page.locator('.town-place-row').first().evaluate(el=>document.activeElement===el));
  if(lang==='en'&&[1920,390,320].includes(width))await page.screenshot({path:path.join(os.tmpdir(),'store-opening-'+width+'.png'),fullPage:true});
 }
 await language('en');await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>sessionStorage.setItem('jg:town:'+account.id,JSON.stringify({view:'shops',listMode:false,zoom:3})));
 await go('/town?view=open&display=map&zoom=3');assert.equal(await page.locator('.town-map-shell').count(),0);assert.equal(new URL(page.url()).search,'');
 await page.goto(base+'/town?view=shops');await page.waitForSelector('.market-store-card');assert.equal(new URL(page.url()).pathname,'/stores');
 await page.goto(base+'/town?view=mine');await page.waitForSelector('.business-shop');assert.equal(new URL(page.url()).pathname,'/businesses');
 const free=quote().plots.find(p=>!p.occupied&&p.size==='popup');
 await go('/town?plot='+free.id);await page.waitForSelector('.town-purchase-dialog[open]');
 for(const type of choices.types){await page.locator('.town-type-choice [value="'+type.id+'"]').check();assert.equal(await page.locator('.town-buy-summary>strong').innerText(),await page.evaluate(v=>justizEuro(v),free.costs[type.id]));}
 await page.locator('[data-town-review]').click();await page.locator('[data-town-back]').click();assert.ok(await page.locator('.town-type-grid').isVisible());await page.keyboard.press('Escape');
 accounts.db(db=>db.prepare('UPDATE users SET tokens=1,xp=0 WHERE id=?').run(owner.id));
 await go('/town?plot='+free.id);assert.ok(await page.locator('[data-town-review]').isDisabled());assert.match(await page.locator('.town-purchase-note').innerText(),/need/);await page.keyboard.press('Escape');
 const locked=quote().plots.find(p=>!p.occupied&&p.size==='medium');await go('/town?plot='+locked.id);assert.ok(await page.locator('[data-town-review]').isDisabled());assert.match(await page.locator('.town-purchase-note').innerText(),/level/);await page.keyboard.press('Escape');
 const guest=await browser.newContext(),gp=await guest.newPage();await gp.goto(base+'/town');await gp.waitForSelector('.town-place-row');await gp.locator('.town-place-row').first().click();assert.ok(await gp.locator('.town-purchase a[href="/login"]').isVisible());await guest.close();
 accounts.db(db=>db.prepare('UPDATE users SET tokens=1000000,xp=36100 WHERE id=?').run(owner.id));
 await go('/town?plot='+free.id);await page.locator('[data-town-review]').click();
 buyBusiness(dir,{id:'mira'},'wine',null,{plotId:free.id});const beforeConflict=balance();
 await page.locator('.town-purchase [type="submit"]').click();await page.waitForSelector('.town-purchase-dialog[open]',{state:'hidden'});assert.equal(balance(),beforeConflict);
 assert.equal(await page.locator('.town-place-row').count(),25);
 const replacement=quote().plots.find(p=>!p.occupied&&p.streetName===free.streetName&&p.size===free.size);assert.ok(replacement);assert.notEqual(replacement.id,free.id);
 await go('/town?plot='+replacement.id);await page.locator('.town-type-choice [value="wine"]').check();await page.locator('[data-town-review]').click();const beforeBuy=balance();
 await page.locator('.town-purchase [type="submit"]').click();await page.waitForSelector('.business-shop');assert.equal(balance(),beforeBuy-replacement.costs.wine);assert.equal(businessDashboard(dir,owner).shops.length,3);
 await go('/town');await page.locator('.town-place-row').first().click();assert.ok(await page.locator('[data-town-review]').isDisabled());assert.match(await page.locator('.town-purchase-note').innerText(),/limit/);await page.keyboard.press('Escape');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.town-place-row').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 assert.deepEqual(errors,[]);console.log('Store opening passed: Budget/Midrange/Premium order, ascending prices, no map or tabs, legacy redirects, six store types, purchase/conflict/replenishment, funds/levels/player cap, guests, keyboard, EN/DE and 320–3840px.');
} finally {await browser.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
