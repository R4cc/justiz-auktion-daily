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
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(),'jg-loading-'));
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
    res.writeHead(200, { 'content-security-policy': "default-src 'self'; img-src 'self' data: https://www.justiz-auktion.de https://i.imgur.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'", 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}}), page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  let releaseCatalog, releaseDirectory, releaseVisit;
  const catalog = new Promise(resolve => releaseCatalog = resolve), directory = new Promise(resolve => releaseDirectory = resolve);
  let holdDirectory = true, visitGate = null, failDirectory = false;
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname; requests.push(pathname);
    if (pathname === '/api/stores' && failDirectory) {
      failDirectory = false; await route.fulfill({status:503,json:{error:'try_later'}}); return;
    }
    if (pathname === '/api/account/cases') await catalog;
    if (pathname === '/api/stores' && holdDirectory) await directory;
    if (pathname === '/api/account/stores/visit' && visitGate) await visitGate;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.continue();
  });
  const overflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fits viewport');
  await page.goto(base+'/stores', {waitUntil:'domcontentloaded'});
  await page.waitForSelector('.page-loading.is-stores');
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:1000}); await overflow();
    assert.equal(await page.locator('.loading-card').count(), 6);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.loading-picture').first().evaluate(node=>getComputedStyle(node).animationName), 'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await page.locator('.loading-picture').first().evaluate(node=>getComputedStyle(node).animationName), 'loading-shimmer');
  await page.waitForFunction(() => account !== null);
  assert.equal(await page.evaluate(() => accountCatalog), null, 'case catalog is still pending');
  holdDirectory = false; releaseDirectory();
  await page.waitForSelector('.market-store-card');
  assert.equal(await page.evaluate(() => accountCatalog), null, 'stores do not wait for case catalog');
  assert.equal(requests.filter(path=>path==='/api/account/businesses').length, 0);
  releaseCatalog(); await page.evaluate(() => catalogReady);
  const counts = () => Object.fromEntries(['/api/account/me','/api/account/businesses','/api/account/stores/visit'].map(path=>[path,requests.filter(entry=>entry===path).length]));
  const before = counts(); requests.length = 0;
  visitGate = new Promise(resolve => releaseVisit = resolve);
  // This is real link navigation, with the destination API held on the network.
  await page.locator(`.market-store-card a[href*="${tech.id}"]`).last().click();
  await page.waitForSelector('.page-loading.is-store-detail');
  for (const width of [1440,768,390,320]) { await page.setViewportSize({width,height:1000}); await overflow(); }
  releaseVisit(); visitGate = null;
  await page.waitForSelector('.visitor-stock-card');
  assert.deepEqual(counts(), {'/api/account/me':1,'/api/account/businesses':0,'/api/account/stores/visit':1});
  assert.equal(requests.filter(path=>path.startsWith('/api/stores/')).length, 0, 'no duplicate storefront GETs');
  assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM store_visits WHERE business_id=?').get(tech.id).n), 1);
  await page.locator('[data-store="buy"]').first().click();
  await page.waitForSelector('.shop-inline-status');
  assert.equal(await page.locator('.visitor-stock-card').count(), 2, 'purchase refreshes live stock');
  // Owners retain management data, drafts and local tab switching.
  await page.evaluate(id => { void navigateAccountPage('/stores?shop='+id+'&tab=settings'); }, wine.id);
  await page.waitForSelector('[data-shop-settings]');
  await page.locator('[name="storeName"]').fill('Loading check');
  await page.locator('[name="storeName"]').dispatchEvent('input');
  const ownerRequests = requests.length;
  await page.locator('.shop-tabs a').filter({hasText:'Stock'}).click();
  await page.waitForSelector('[data-shop-stock]');
  await page.locator('.shop-tabs a').filter({hasText:'Settings'}).click();
  assert.equal(await page.locator('[name="storeName"]').inputValue(), 'Loading check');
  assert.equal(requests.length, ownerRequests, 'owner tabs remain local');
  // A late store response cannot overwrite another page or restart polling.
  visitGate = new Promise(resolve => releaseVisit = resolve);
  await page.evaluate(id => { void navigateAccountPage('/stores?shop='+id); }, tech.id);
  await page.waitForRequest('**/api/account/stores/visit');
  await page.evaluate(() => navigateAccountPage('/changelog'));
  releaseVisit(); visitGate = null;
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => currentAccountPage), '/changelog');
  assert.equal(await page.locator('.visitor-storefront').count(), 0);
  // Retry path and anonymous browsing use fresh server responses.
  failDirectory = true;
  await page.evaluate(() => navigateAccountPage('/stores'));
  await page.waitForSelector('[data-account="refresh"]');
  await page.locator('[data-account="refresh"]').click(); await page.waitForSelector('.market-store-card');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#language-select').selectOption('de');
  assert.equal(await page.locator('.marketplace-heading h1').innerText(), 'Läden');
  await context.clearCookies(); requests.length = 0;
  await page.evaluate(id => navigateAccountPage('/stores?shop='+id), tech.id);
  await page.waitForSelector('.visitor-stock-card'); await overflow();
  assert.equal(counts()['/api/account/stores/visit'], 0, 'guests use read-only storefronts');
  assert.equal(counts()['/api/account/businesses'], 0);
  assert.deepEqual(errors, []);
  console.log('Loading browser checks passed: delayed catalog, immediate directory/store skeletons at 1440/768/390/320px, reduced motion, visitor request counts, purchases, owner drafts/local tabs, stale navigation, retry, German and guests.', {initial:before});
} finally {
  await browser.close(); server.closeIdleConnections(); await new Promise(resolve=>server.close(resolve));
  closeDataStore(dir); await rm(dir,{recursive:true,force:true});
}
