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
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { saveStoreSettings } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';
import { townMap } from '../src/town-map.mjs';

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
const additional=[];
for(const [user,type,name,color] of [[owner,'jeweler','The Golden Cabinet','amber'],[{id:'mira'},'hardware','Good Bones Supply','forest'],[{id:'mira'},'cars','Second Gear','slate']]){
 const plot=townMap(dir,user).plots.find(plot=>!plot.occupied);
 const shop=buyBusiness(dir,user,type,null,{plotId:plot.id}).shop;additional.push(shop);
 saveStoreSettings(dir,user,{shopId:shop.id,name,motto:'',color,securityGuard:false,profitMargin:20,requestId:'market-fixture-'+shop.id});
}
for(const [shop,user,name,color] of [[wine,owner,'The Cork & Goose','berry'],[toys,owner,'Tiny Treasures','plum'],[tech,{id:'mira'},'Analog & Again','ocean']])saveStoreSettings(dir,user,{shopId:shop.id,name,motto:shop.id===wine.id?'Bottles worth bidding for.':'',color,securityGuard:false,profitMargin:20,requestId:'market-fixture-'+shop.id});
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await api(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const buf = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-security-policy': "default-src 'self'; img-src 'self' data: https://www.justiz-auktion.de https://i.imgur.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'", 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
try {
 const context=await browser.newContext({viewport:{width:1536,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('https://i.imgur.com/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')}));
 await context.addCookies([{name:'jg_session',value:token,url:base}]);
 const shot=async name=>page.screenshot({path:'/tmp/store-marketplace-'+name+'.png',fullPage:true});
 const ready=()=>page.waitForSelector('.market-store-card');
 await page.goto(base+'/town');await page.waitForURL('**/stores');await ready();
 assert.equal(await page.locator('.market-store-card').count(),6);
 assert.equal(await page.locator('.marketplace-categories a').count(),7);
 assert.equal(await page.locator('a[href="/stores"][data-feature="businesses"]').innerText(),'Stores');
 await shot('desktop');
 await page.locator('.marketplace-categories a').filter({hasText:'Wine store'}).click();
 await page.waitForURL('**/stores?type=wine');await ready();assert.equal(await page.locator('.market-store-card').count(),1);
 assert.match(await page.locator('.market-store-card h2').innerText(),/Cork/);
 await page.locator('.market-store-card .market-visit').click();await page.waitForSelector('.shop-header');
 assert.match(await page.locator('.shop-header h1').innerText(),/Cork/);
 await page.locator('.shop-back').click();await ready();assert.match(page.url(),/type=wine/);
 await page.goto(base+'/stores');await ready();
 await page.locator('[name="inStock"]').check();await page.waitForURL('**inStock=1**');await ready();
 assert.equal(await page.locator('.market-store-card').count(),2);
 await page.locator('[name="sort"]').selectOption('stock');await page.waitForURL('**sort=stock');await ready();
 assert.match(await page.locator('.market-store-card h2').first().innerText(),/Cork/);
 await page.goto(base+'/stores');await ready();
 const district=businessDashboard(dir,owner).shops.find(shop=>shop.id===wine.id).location.districtId;
 await page.locator('[name="district"]').selectOption(district);await page.waitForURL('**district='+district+'**');await ready();
 assert.ok((await page.locator('.market-store-card').count())<6);
 await page.locator('[name="minRating"]').selectOption('4');await page.waitForSelector('.marketplace-empty');
 await page.locator('.marketplace-empty a').click();await ready();
 await page.locator('#market-search').fill('Analog');await page.locator('.marketplace-searchbar [type="submit"]').click();await ready();
 await page.waitForURL('**query=Analog**');assert.equal(await page.locator('.market-store-card').count(),1);
 await page.locator('.market-store-card .market-visit').click();await page.waitForSelector('.visitor-stock-card');
 assert.equal(await page.locator('.visitor-stock-card').count(),3);await shot('storefront');
 const quantity=businessDashboard(dir,{id:'mira'}).shops.find(shop=>shop.id===tech.id).stock.length;
 await page.locator('[data-store="buy"]').first().click();
 await page.waitForFunction(()=>document.querySelector('.shop-inline-status')?.textContent.includes('inventory'));
 assert.equal(businessDashboard(dir,{id:'mira'}).shops.find(shop=>shop.id===tech.id).stock.length,quantity-1);
 await page.goto(base+'/stores?shop='+wine.id+'&tab=settings');await page.waitForSelector('[data-shop-settings]');
 await page.locator('[name="storeName"]').fill('Cork & Canvas');await page.locator('[name="color"][value="ocean"]').check();
 await page.locator('[name="bannerUrl"]').fill('https://imgur.com/abc1234');await page.locator('[name="iconUrl"]').fill('https://i.imgur.com/def5678.png');
 await shot('settings');
 await page.locator('[data-shop-settings] [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-draft-status]')?.textContent==='Settings saved');
 const saved=businessDashboard(dir,owner).shops.find(shop=>shop.id===wine.id);assert.equal(saved.color,'ocean');assert.equal(saved.bannerUrl,'https://i.imgur.com/abc1234.png');assert.equal(saved.iconUrl,'https://i.imgur.com/def5678.png');
 await page.goto(base+'/stores?query=Cork');await ready();assert.equal(await page.locator('.market-store-card.brand-ocean').count(),1);
 await page.waitForFunction(()=>[...document.querySelectorAll('.market-store-card img')].every(img=>img.complete&&img.naturalWidth>0));
 await page.locator('.market-store-card .market-visit').click();await page.waitForSelector('[data-shop-settings],.shop-overview-actions');
 assert.equal(await page.locator('.shop-header.brand-ocean').count(),1);
 await page.goto(base+'/town?view=open');await page.waitForSelector('.town-page');assert.equal(await page.locator('.town-page h1').innerText(),'Store locations');
 await page.locator('.town-place-row').first().click();await page.waitForSelector('[data-town-open]');await page.locator('[data-town-open]').click();await page.waitForSelector('.town-purchase-dialog[open]');
 assert.ok(await page.locator('.town-purchase [name="type"]').count());await page.keyboard.press('Escape');
 for(const width of [390,768]){
  await page.setViewportSize({width,height:900});await page.goto(base+'/stores');await ready();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}px`);
  assert.ok(await page.locator('#market-search').evaluate(input=>input.getBoundingClientRect().width>120),'Search input must remain usable on phones');
  await shot('mobile-'+width);
 }
 await page.setViewportSize({width:1536,height:1100});
 await page.locator('#language-select').selectOption('de');await page.waitForFunction(()=>document.querySelector('.marketplace-heading h1')?.textContent==='Läden');
 assert.match(await page.locator('.marketplace-filters').innerText(),/Bezirk/);
 await context.clearCookies();await page.goto(base+'/stores');await ready();assert.match(await page.locator('.market-store-owner').first().innerText(),/\*\*/);
 assert.deepEqual(errors,[]);
 console.log('Marketplace browser checks passed: directory, URL filters, sorting, shared purchases, branding, location picker, responsive layouts, German and guests.');
} finally {await browser.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
