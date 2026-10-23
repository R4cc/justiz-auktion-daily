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
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { listItem } from '../src/resale.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { marketIndexes } from '../src/market.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-inventory-items-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const wine = buyBusiness(dir, owner, 'wine', 'popup').shop;
const addItem = (id, category, title, rarity='common') => accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id,owner.id,JSON.stringify({title,price:30,marketCategory:category,rarity}),Date.now()));
for(let n=0;n<5;n++)addItem(`wine-${n}`,'wine','Riesling');
for(let n=0;n<3;n++)addItem(`tech-${n}`,'electronics','Monitor',n===2?'rare':'common');
for(let n=0;n<2;n++)addItem(`book-${n}`,'books_media','Reference book');
addItem('other-0',undefined,'Miscellaneous find');
addItem('sold-wine','wine','Previously sold wine');
accounts.db(db=>db.prepare('UPDATE inventory SET sold_at=? WHERE id=?').run(Date.now(),'sold-wine'));
for(let n=0;n<26;n++)addItem(`tool-${n}`,'tools',`Tool ${n}`);
stockBusiness(dir,owner,wine.id,['wine-0','wine-1']);
listItem(dir,owner,{inventoryId:'wine-2',startPrice:20,endsAt:new Date(Date.now()+3600000).toISOString()});
const catalog=loadCaseStoreCatalog(dir),quote=accounts.db(db=>quoteCaseStore(catalog,marketIndexes(db,Date.now())));
for(let n=0;n<2;n++)accounts.buyCase(owner,catalog,quote.cases[0].id,`inventory-case-${n}-0001`,quote.revision);
const longTitle='Vintage professional multi-purpose workshop equipment with a very long name <img src=x onerror="window.bad=true">';
accounts.db(db=>db.prepare('INSERT INTO inventory VALUES (?,?,?,?,NULL)').run('gallery-item',owner.id,JSON.stringify({title:longTitle,price:140,marketCategory:'tools',rarity:'epic',image:'/assets/makita.jpg',images:['/assets/makita.jpg','/assets/hilti.jpg'],description:'Details <img src=x onerror="window.bad=true"> remain plain text.',condition:'Gebraucht',fulfillment:'Abholung'}),Date.now()));
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
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
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const go=async path=>{await page.goto(base+path);await page.waitForSelector('.inventory-card-trigger');};
  const open=async id=>{await page.locator(`[data-inventory-card="${id}"]`).click({position:{x:25,y:65}});await page.waitForSelector('.inventory-item-dialog[open]');};
  const close=async()=>{await page.locator('[data-inventory-close]').click();await page.waitForFunction(()=>!document.querySelector('.inventory-item-dialog').open);};
  const language=async lang=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
  // Stable category-return fixtures exercise positive, negative, flat and
  // unavailable chips without changing this listing/valuation regression.
  await page.route('**/api/market',async route=>{const response=await route.fetch(),payload=await response.json();payload.categories=payload.categories.map(category=>({...category,changePercent24h:({wine:4.2,electronics:-2.6,tools:0})[category.category]??null}));await route.fulfill({response,json:payload});});
  await go('/inventory?focus=gallery-item');
  assert.match(await page.locator('[data-inventory-card="gallery-item"] [data-market-trend="tools"]').innerText(),/0\.0%.*24h/s);
  assert.equal(await page.locator('.sealed-case-item [data-market-trend]').count(),0);
  assert.match(await page.locator('.inventory-grid [data-market-trend="tools"]').first().getAttribute('title'),/last 24 hours/);
  assert.equal(await page.locator('.inventory-grid details,.inventory-grid .trader-item-facts,.inventory-grid .trader-item-actions').count(),0);
  await open('gallery-item');assert.equal(await page.locator('.inventory-item-dialog [data-market-trend="tools"]').count(),1);assert.equal(await page.locator('.inventory-item-dialog details[open]').count(),0);assert.equal(await page.locator('#inventory-item-title').innerText(),longTitle);
  await page.locator('[data-inventory-image="1"]').click();assert.equal(await page.locator('.inventory-detail-image > img').getAttribute('src'),'/assets/hilti.jpg');
  await page.locator('[data-item-section="about"] > summary').click();assert.equal(await page.locator('[data-item-section="about"] img').count(),0);assert.equal(await page.evaluate(()=>window.bad),undefined);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.inventory-item-dialog').open);assert.equal(await page.locator('[data-inventory-detail="gallery-item"]').evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-inventory-detail="gallery-item"]').press('Enter');await page.waitForSelector('.inventory-item-dialog[open]');assert.equal(await page.locator('.inventory-item-dialog details[open]').count(),0);await close();
  for(const width of [1440,1024,768,600,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){
    await language(lang);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
    assert.ok(await page.locator('.inventory-find').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} card overflow`);
    await page.locator('.inventory-grid').scrollIntoViewIfNeeded();if([1440,390,320].includes(width))await page.locator('.inventory-grid').screenshot({path:`/tmp/jg-item-cards-${width}-${lang}.png`});
    await open('gallery-item');assert.ok(await page.locator('.inventory-item-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}),`${width} ${lang} dialog overflow`);
    assert.equal(await page.locator('.inventory-item-dialog details[open]').count(),0);
    if([1440,390,320].includes(width))await page.locator('.inventory-item-dialog').screenshot({path:`/tmp/jg-item-details-${width}-${lang}.png`});
    await close();
  }}
  await page.setViewportSize({width:1440,height:1000});await language('en');
  const readItems=()=>accounts.inventory(owner,{includeStores:true});
  // Quick list one copy once, in place; preserve all filters and shelved stock.
  await go('/inventory?state=available&category=wine&rarity=common&worth=all');assert.match(await page.locator('.inventory-grid [data-market-trend="wine"]').first().innerText(),/↗.*\+4\.2%.*24h/s);const wineId=await page.locator('.inventory-card-trigger').first().getAttribute('data-inventory-detail');
  const before=accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM resale_auctions').get().n);
  await page.route('**/api/account/resale/listings',async route=>{const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,200));await route.fulfill({response});});
  await page.locator('.inventory-quick-list[data-economy="quick-list"]').first().dblclick();await page.waitForFunction(()=>accountItems.filter(item=>item.listed&&item.marketCategory==='wine').length===2);
  assert.equal(await page.locator('.inventory-item-dialog').evaluate(el=>el.open),false);assert.ok(page.url().includes('category=wine')&&page.url().includes('state=available')&&page.url().includes('worth=all')&&page.url().includes('rarity=common'));
  assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM resale_auctions').get().n),before+1);assert.equal(readItems().filter(item=>item.storeId===wine.id).length,2);
  const listing=accounts.db(db=>db.prepare('SELECT * FROM resale_auctions WHERE inventory_id=?').get(wineId));assert.equal(listing.start_price,21);assert.ok(listing.ends_at-listing.started_at>895000&&listing.ends_at-listing.started_at<=900000);assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM resale_auction_items WHERE auction_id=?').get(listing.id).n),1);await page.unroute('**/api/account/resale/listings');
  // Quick listing in details refreshes its state without reopening or relisting.
  await go('/inventory?category=books_media');const bookId=await page.locator('.inventory-card-trigger').first().getAttribute('data-inventory-detail');await open(bookId);await page.locator('.inventory-item-dialog [data-economy="quick-list"]').click();await page.waitForFunction(()=>document.querySelector('.inventory-item-dialog .inventory-state')?.textContent==='Listed');assert.equal(await page.locator('.inventory-item-dialog [data-economy="quick-list"]').count(),0);assert.equal(await page.locator('.inventory-item-dialog').evaluate(el=>el.open),true);await close();
  // Advanced listing remains the existing quantity/price/duration flow.
  await go('/inventory?category=electronics&state=available');const techId=await page.locator('.inventory-find:has(.inventory-copy-count) .inventory-card-trigger').first().getAttribute('data-inventory-detail');await open(techId);await page.locator('.inventory-item-dialog [data-economy="list"]').click();await page.waitForSelector('form[data-economy-form="list"]');assert.equal(await page.locator('.inventory-item-dialog').evaluate(el=>el.open),false);assert.equal(await page.locator('input[name="quantity"]').inputValue(),'2');await page.locator('input[name="quantity"]').fill('1');await page.locator('[data-economy-form="list"] [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('.economy-dialog').open&&accountItems.some(item=>item.listed&&item.marketCategory==='electronics'));assert.equal(new URL(page.url()).pathname,'/inventory');assert.equal(new URL(page.url()).searchParams.get('category'),'electronics');
  // A transient write failure leaves the item usable, and a stale second tab
  // cannot create another listing or leave a false available state behind.
  await go('/inventory?category=electronics');assert.match(await page.locator('.inventory-grid [data-market-trend="electronics"]').first().innerText(),/↘.*-2\.6%.*24h/s);
  await go('/inventory?category=books_media');assert.match(await page.locator('.inventory-grid [data-market-trend="books_media"]').first().innerText(),/—.*24h/s);
  await go('/inventory?focus=gallery-item');const quick=page.locator('[data-inventory-card="gallery-item"] [data-economy="quick-list"]');
  await page.route('**/api/account/resale/listings',route=>route.fulfill({status:503,json:{error:'unavailable'}}),{times:1});await quick.click();await page.waitForFunction(()=>document.querySelector('[data-inventory-card="gallery-item"] [data-economy="quick-list"]')?.disabled===false);assert.equal(readItems().find(item=>item.id==='gallery-item').listed,false);
  listItem(dir,owner,{inventoryId:'gallery-item',startPrice:98,endsAt:new Date(Date.now()+900000).toISOString()});
  const previous=accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM resale_auctions').get().n);await quick.click();await page.waitForFunction(()=>accountItems.find(item=>item.id==='gallery-item')?.listed===true);assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM resale_auctions').get().n),previous);assert.equal(await quick.count(),0);
  // Listed finds open details without offering a quick listing.
  // Listed copies may merge into an existing card; use its current representative.
  await go('/inventory?state=listed&category=wine');await open(await page.locator('.inventory-card-trigger').first().getAttribute('data-inventory-detail'));assert.equal(await page.locator('.inventory-item-dialog [data-economy="quick-list"]').count(),0);assert.equal(await page.locator('.inventory-detail-actions a').getAttribute('href'),'/auction-house?view=mine');await close();
  // Shelf items remain manageable in the store, and reappear only after return.
  await go('/inventory?focus=wine-0');assert.ok(await page.evaluate(()=>accountItems.every(item=>!item.storeId)));assert.equal(await page.locator('[data-inventory-card="wine-0"]').count(),0);
  const shelvedIds=readItems().filter(item=>item.storeId===wine.id).map(item=>item.id);await page.goto(base+'/stores?shop='+wine.id+'&tab=stock');await page.waitForSelector('[data-shop-stock]');await page.locator('#account-content [data-side="remove"]').first().fill('1');await page.locator('#account-content [data-side="remove"]').first().dispatchEvent('change');await page.locator('[data-shop-stock] [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-stock-summary]')?.textContent==='1 → 1 / 10');
  const returned=readItems().find(item=>shelvedIds.includes(item.id)&&!item.storeId);assert.ok(returned);assert.equal(readItems().filter(item=>item.storeId===wine.id).length,1);await go('/inventory?focus='+returned.id);await open(returned.id);assert.equal(await page.locator('.inventory-state.is-stocked').count(),0);await close();
  // Existing action links still reach stock selection from the details handoff.
  await go('/inventory?focus='+returned.id+'&action=stock');await page.waitForSelector('[data-trader="stock-confirm"]');assert.equal(await page.locator('.inventory-item-dialog').evaluate(el=>el.open),false);await page.locator('[data-trader="close"]').click();
  // Sealed cases stay sealed in details and can be opened via their normal flow.
  await go('/inventory?category=cases');assert.equal(await page.locator('.sealed-case-item [data-market-trend]').count(),0);const caseId=await page.locator('.inventory-card-trigger').first().getAttribute('data-inventory-detail');await open(caseId);assert.equal(await page.locator('.inventory-detail-sections [data-item-section="about"]').count(),0);assert.equal(await page.locator('.inventory-item-dialog .inventory-case-art').count(),1);
  await page.locator('.inventory-item-dialog [data-account="open-inventory-case"]').click();await page.waitForSelector('.case-unboxed',{timeout:15000});assert.equal(await page.locator('.inventory-item-dialog').evaluate(el=>el.open),false);assert.equal(readItems().filter(item=>item.kind==='case').length,1);await page.locator('[data-account="close-reveal"]').first().click();
  // Navigation closes the details; legacy feature-off selling remains usable.
  await go('/inventory?focus=gallery-item');await open('gallery-item');await page.evaluate(()=>navigateAccountPage('/leaderboard'));await page.waitForSelector('.leaderboard-page');assert.equal(await page.locator('.inventory-item-dialog').evaluate(el=>el.open),false);
  await go('/inventory?focus=tool-0');await page.evaluate(()=>{economyFlags.resales=false;renderInventory();});assert.equal(await page.locator('.inventory-grid [data-economy="quick-list"]').count(),0);await open('tool-0');assert.equal(await page.locator('.inventory-item-dialog [data-account="sell"]').count(),1);await close();
  await page.evaluate(()=>{economyFlags.market=false;renderInventory();});assert.equal(await page.locator('.inventory-grid [data-market-trend]').count(),0);
  await page.unroute('**/api/market');await page.route('**/api/market',route=>route.fulfill({status:503,json:{error:'unavailable'}}),{times:1});await go('/inventory?focus=gallery-item');assert.equal(await page.locator('.inventory-grid [data-market-trend]').count(),0);assert.ok(await page.locator('.inventory-card-trigger').count()>0);
  assert.deepEqual(errors,[]);console.log('Inventory item UI passed: compact shared 24h category chips, positive/negative/flat/unavailable states, no sealed-case trend; compact cards; whole-card/keyboard details; collapsed sections and gallery; escaped copy; one-copy quick listing with price/duration, duplicate-click protection, in-place filters and shelf preservation; modal state refresh; transient failure and stale-tab recovery; advanced listing; listed states, hidden shelf stock, store-to-inventory return and deep-link stock; sealed case opening; navigation cleanup; legacy selling; EN/DE at 1440/1024/768/600/390/320px; no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
