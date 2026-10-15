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
import { buyBusiness } from '../src/businesses.mjs';
import { featureFlags } from '../src/features.mjs';
import { tickMarketDrift } from '../src/market.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-palette-ui-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const varieties=['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'];
upsertAuctions(dir,varieties.map((name,index)=>({id:82000+index,title:name+' Wine',category:'Getränke',finalPrice:10*(index+1)**2,image:'/assets/makita.jpg'})));
tickMarketDrift(dir,{now:Date.now()-48*3600_000});tickMarketDrift(dir);
const shop=buyBusiness(dir,owner,'wine','popup').shop;
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
  const {stockPaletteCatalog,buyStockPalette}=await import('../src/stock-palettes.mjs');
  const {bidOnPaletteAuction,getPaletteAuctionRewards}=await import('../src/palette-auctions.mjs');
  const catalog=stockPaletteCatalog(dir),legacyOffer=catalog.offers.find(o=>o.id==='wine-budget');
  const legacy=buyStockPalette(dir,owner,{offerId:legacyOffer.id,revision:catalog.revision,requestId:'legacy-owned-palette-0001'},{allowLegacyPurchase:true});
  accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('rival','Rival','disabled',1000000,36100,?)").run(Date.now()));
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const language=async lang=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
  const overflow=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflow');
  await page.goto(base+'/auction-house');await page.waitForSelector('.house-lot .stock-palette-art');assert.equal(await page.locator('.site-nav a[href="/palettes"]').count(),0);assert.equal(await page.locator('.house-palettes-card,[data-palette-buy]').count(),0);
  const board=await page.evaluate(async()=>await(await fetch('/api/palette-auctions')).json()),lot=board.auctions.find(a=>a.stockOffer?.id==='wine-standard');assert.ok(lot);assert.equal('quantity' in lot,false);assert.equal('quantity' in lot.stockOffer,false);assert.deepEqual(lot.items,[]);assert.equal(lot.stockOffer.openingMode,'opening-v2');assert.match(await page.locator(`[data-economy="primary"][data-id="${lot.id}"] [data-market-trend="wine"]`).innerText(),/%.*24h/s);assert.ok(board.auctions.some(a=>a.stockOffer?.id==='wine-budget'));assert.ok(board.auctions.some(a=>a.stockOffer?.id==='wine-premium'));
  for(const width of [1440,1024,768,600,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){
    await language(lang);await overflow(`${width} ${lang}`);assert.ok(await page.locator('.house-lot').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} lot overflow`);
    await page.locator(`[data-economy="primary"][data-id="${lot.id}"]`).click();await page.waitForSelector('.economy-dialog[open]');assert.equal(await page.locator('.auction-room [data-market-trend="wine"]').count(),1);assert.equal(await page.locator('[data-economy-form="primary"]').count(),1);await page.locator('.auction-room-contents summary').click();assert.equal(await page.locator('.palette-pool').count(),0);await overflow('room '+width+' '+lang);
    if([1440,390].includes(width))await page.locator('.economy-dialog[open]').screenshot({path:`/tmp/jg-palette-auction-${width}-${lang}.png`});
    await page.locator('[data-economy="close"]').click();
  }}
  await page.setViewportSize({width:1440,height:1000});await language('en');await page.locator(`[data-economy="primary"][data-id="${lot.id}"]`).click();
  const initial=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),max=lot.reserve+1000;
  await page.locator('.auction-bid-dock input[name="amount"]').fill(String(max));await page.locator('.auction-bid-dock button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.auction-bid-dock')?.textContent.includes('Your reserved maximum'));
  assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),initial-max);assert.equal(accounts.inventory(owner,{includeStores:true}).length,0);
  bidOnPaletteAuction(dir,{id:'rival'},lot.id,max+500);await page.evaluate(()=>accountApi('me').then(result=>updateAccount(result.user)));assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),initial);
  await page.locator('[data-economy="close"]').click();await page.goto(base+'/auction-house?view=bids');await page.waitForSelector('.house-lot.is-outbid');await page.locator(`[data-economy="primary"][data-id="${lot.id}"]`).click();await page.locator('.auction-bid-dock input[name="amount"]').fill(String(max+1500));await page.locator('.auction-bid-dock button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.auction-bid-dock')?.textContent.includes('Your reserved maximum'));
  // Deterministic jackpot opening in this isolated fixture. The real request
  // cannot supply its random seed, quantity or outcome.
  await page.route('**/api/account/palette-auctions/*/rewards',async route=>{const id=route.request().url().split('/').at(-2);getPaletteAuctionRewards(dir,owner,id,{random:max=>max-1});await route.continue();});
  accounts.db(db=>db.prepare('UPDATE primary_palette_auctions SET ends_at=? WHERE id=?').run(Date.now()-1,lot.id));await page.locator('[data-economy="close"]').click();await page.goto(base+'/auction-house?view=bids');await page.waitForSelector(`[data-unopened-reward="palette:${lot.id}"]`);assert.equal(accounts.inventory(owner,{includeStores:true}).length,0);await page.locator(`[data-unopened-reward="palette:${lot.id}"]`).click();await page.waitForSelector('.palette-reveal-screen');assert.equal(new URL(page.url()).pathname,'/auction-house');assert.equal(new URL(page.url()).searchParams.get('reveal'),lot.id);assert.equal(accounts.inventory(owner,{includeStores:true}).length,144);
  assert.ok(!(await page.locator('.palette-reveal-header h1').innerText()).includes('144'));await page.locator('[data-palette-pull]').click();await page.waitForSelector('[data-palette-reel="quantity"]');await page.locator('[data-palette-pull]').click();await page.waitForSelector('.palette-multiplier-win');
  await page.reload();await page.waitForSelector('.palette-reveal-screen');assert.equal(accounts.inventory(owner,{includeStores:true}).length,144);await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){await language(lang);await overflow('reveal '+width+' '+lang);}}
  await language('en');for(let index=0;index<3;index++){await page.locator('[data-palette-pull]').click();await page.waitForSelector('[data-palette-reel="quantity"]');await page.locator('[data-palette-pull]').click();await page.waitForSelector('.palette-multiplier-win');await page.screenshot({path:`/tmp/jg-auction-palette-reveal-${index}.png`,fullPage:true});await overflow('multiplier win');await page.locator('[data-palette-pull]').click();}
  await page.waitForSelector('.palette-haul-summary');assert.equal(await page.locator('.palette-summary-items article').count(),3);const counts=await page.locator('.palette-summary-items article>span').allTextContents();assert.equal(counts.reduce((sum,text)=>sum+Number(text.replace('×','')),0),144);await overflow('summary');await page.locator('.palette-summary-actions a[href="/inventory"]').click();await page.waitForSelector('.inventory-grid');
  await page.goto(base+'/stores?shop='+shop.id+'&tab=stock');await page.waitForSelector('.shop-supply-link');assert.equal(new URL(await page.locator('.shop-supply-link').getAttribute('href'),base).searchParams.get('stock'),'wine');await page.locator('.shop-tabs a').first().click();await page.waitForSelector('[data-business="quick-restock"]');const restocked=page.waitForResponse(response=>response.url().endsWith('/api/account/businesses/stock/transfer')&&response.ok());await page.locator('[data-business="quick-restock"]').click();await restocked;await page.waitForFunction(()=>!document.querySelector('.is-packing'));assert.equal(accounts.inventory(owner,{includeStores:true}).filter(item=>item.storeId===shop.id).length,shop.capacity);
  await page.goto(base+'/palettes?category=wine');await page.waitForSelector('.house-header');assert.equal(new URL(page.url()).pathname,'/auction-house');assert.equal(new URL(page.url()).searchParams.get('stock'),'wine');assert.equal(await page.locator('.palette-page').count(),0);await page.waitForSelector('.stock-palette-art');
  // Existing paid palettes remain discoverable from winnings and old opening links.
  await page.goto(base+'/auction-house?view=bids');await page.waitForSelector(`a[href="/auction-house?open-palette=${legacy.id}"]`);await page.goto(base+'/palettes?open='+legacy.id);await page.waitForSelector('.palette-reveal-screen');assert.equal(new URL(page.url()).pathname,'/auction-house');assert.equal(accounts.inventory(owner,{includeStores:true}).length,150);await page.locator('[data-palette-finish]').click();await page.waitForSelector('.inventory-grid');
  const denied=await page.evaluate(async()=>{const r=await fetch('/api/account/stock-palettes/buy',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'JUSTIZGUESSR'},body:JSON.stringify({offerId:'wine-budget',requestId:'blocked-palette-client-0001',allowLegacyPurchase:true})});return r.status;});assert.equal(denied,404);
  assert.deepEqual(errors,[]);console.log('Auction palette UI passed: unknown totals and private contents until first opening, variable jackpot quantities, starting-price odds and repeat-safe reveal; shared real rolling-24h category trends on cards and bid rooms; normal Auction House only, no shop/sidebar/buy action, budget and premium lots, retained art/icons, real bidding/outbid refunds/proxy settlement, unchanged item-then-quantity reveal, reload idempotency, inventory and Quick Restock, old purchase preservation and URL redirects, blocked instant purchase, EN/DE 1440–320px with no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
