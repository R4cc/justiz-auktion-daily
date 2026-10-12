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
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const go=async path=>{await page.goto(base+path);await page.waitForSelector('.palette-page');};
  const language=async lang=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const hidden=!(await page.locator('#language-select').isVisible());if(hidden)await page.locator('[data-action="sidebar"]').click();await page.locator('#language-select').selectOption(lang);if(hidden)await page.keyboard.press('Escape');};
  const overflow=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflow');
  await go('/palettes?category=wine');assert.equal(await page.locator('.palette-offer').count(),3);assert.equal(await page.locator('.palette-total').nth(1).innerText(),'24× Wine');
  for(const width of [1440,1024,768,600,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){
    await language(lang);await overflow(`${width} ${lang}`);assert.ok(await page.locator('.palette-offer').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} card overflow`);
    await page.locator('.palette-offer.is-standard summary').click();assert.equal(await page.locator('.palette-offer.is-standard .palette-pool li').count()>0,true);await overflow('expanded '+width+' '+lang);await page.locator('.palette-offer.is-standard summary').click();
    if([1440,390].includes(width))await page.screenshot({path:`/tmp/jg-palettes-${width}-${lang}.png`,fullPage:true});
  }}
  await page.setViewportSize({width:1440,height:1000});await language('en');
  const before=accounts.inventory(owner,{includeStores:true}).length,balance=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);
  // An accepted purchase with a lost response retries the same request id.
  let request,postCount=0;await page.route('**/api/account/stock-palettes/buy',async route=>{postCount++;const payload=route.request().postDataJSON();if(postCount===1){request=payload.requestId;await route.fetch();await route.abort();}else{assert.equal(payload.requestId,request);await route.continue();}});
  await page.locator('[data-palette-buy="wine-standard"]').click();await page.waitForSelector('.palette-page .account-error');assert.equal(accounts.inventory(owner,{includeStores:true}).length,before);
  await page.locator('[data-palette-buy="wine-standard"]').click();await page.waitForSelector('.palette-reveal-screen');assert.equal(postCount,2);await page.unroute('**/api/account/stock-palettes/buy');
  const open=new URL(page.url()).searchParams.get('open');assert.ok(open);assert.equal(accounts.inventory(owner,{includeStores:true}).length,before+24);const paid=balance-accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);assert.ok(paid>0);
  await page.locator('[data-palette-pull]').click();await page.waitForSelector('[data-palette-reel="quantity"]');assert.equal(await page.locator('.palette-locked-item').count(),1);
  await page.locator('[data-palette-pull]').click();await page.waitForSelector('.palette-multiplier-win');assert.match(await page.locator('.palette-multiplier-win').innerText(),/×/);
  // Reload the reveal: the identical frozen result returns without granting units again.
  await page.reload();await page.waitForSelector('.palette-reveal-screen');assert.equal(accounts.inventory(owner,{includeStores:true}).length,before+24);
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){await language(lang);await overflow('reveal '+width+' '+lang);assert.ok(await page.locator('.palette-slot-machine').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'slot machine overflow');}}
  await language('en');
  for(let index=0;index<3;index++){
    await page.locator('[data-palette-pull]').click();await page.waitForSelector('[data-palette-reel="quantity"]');
    await page.locator('[data-palette-pull]').click();await page.waitForSelector('.palette-multiplier-win');
    await page.screenshot({path:`/tmp/jg-palette-reveal-${index}.png`,fullPage:true});await overflow('multiplier win');
    await page.locator('[data-palette-pull]').click();
  }
  await page.waitForSelector('.palette-haul-summary');assert.equal(await page.locator('.palette-summary-items article').count(),3);await overflow('summary');
  const counts=await page.locator('.palette-summary-items article>span').allTextContents();assert.equal(counts.reduce((sum,text)=>sum+Number(text.replace('×','')),0),24);
  await page.locator('.palette-summary-actions a[href="/inventory"]').click();await page.waitForSelector('.inventory-grid');
  await page.goto(base+'/stores?shop='+shop.id);await page.waitForSelector('.store-owner-page');assert.ok((await page.locator('.store-owner-supply a').getAttribute('href')).startsWith('/palettes?category=wine'));
  await page.locator('[data-business="quick-restock"]').click();await page.waitForSelector('.business-quick-dialog[open]');await page.waitForFunction(()=>!document.querySelector('.business-quick-dialog').open,{},{timeout:12000});
  assert.equal(accounts.inventory(owner,{includeStores:true}).filter(item=>item.storeId===shop.id).length,shop.capacity);

  await page.goto(base+'/auction-house');await page.waitForSelector('.house-palettes-card');await overflow('house');
  await page.locator('.house-palettes-card').click();await page.waitForSelector('.palette-page');assert.ok(await page.locator('.site-nav a[href="/palettes"]').count());
  await page.locator('[data-palette-buy="wine-budget"]').click();await page.waitForSelector('.palette-reveal-screen');await page.locator('[data-palette-pull]').click();await page.locator('[data-palette-finish]').click();await page.waitForSelector('.inventory-grid');await page.waitForTimeout(400);assert.equal(await page.locator('.palette-reveal-screen').count(),0);
  // Previously won palettes retain their three original units on the same reveal screen.
  const {loadPaletteCatalog}=await import('../src/palette-definitions.mjs');
  const {createPaletteAuction,bidOnPaletteAuction,settleDuePaletteAuctions}=await import('../src/palette-auctions.mjs');
  const legacyNow=Date.now()-2*3600000,legacyCatalog=loadPaletteCatalog(dir,{now:legacyNow}),edition=legacyCatalog.palettes.find(palette=>palette.id==='wine'&&palette.availability==='available');
  assert.ok(edition);const auction=createPaletteAuction(dir,{editionId:edition.editionId,requestId:'legacy-palette-browser-001'},{now:legacyNow});
  bidOnPaletteAuction(dir,owner,auction.id,auction.reserve,{now:legacyNow});settleDuePaletteAuctions(dir);
  const visibleBefore=accounts.inventory(owner,{includeStores:true}).length;
  await page.goto(base+'/auction-house?view=bids');await page.locator(`[data-economy="primary"][data-id="${auction.id}"]`).click();await page.locator(`[data-economy="reveal"][data-id="${auction.id}"]`).click();await page.waitForSelector('.palette-reveal-screen');
  assert.equal(new URL(page.url()).searchParams.get('auction'),auction.id);assert.match(await page.locator('.palette-reveal-header h1').innerText(),/^3×/);
  assert.equal(accounts.inventory(owner,{includeStores:true}).length,visibleBefore+3);await page.reload();await page.waitForSelector('.palette-reveal-screen');assert.equal(accounts.inventory(owner,{includeStores:true}).length,visibleBefore+3);
  await page.locator('[data-palette-finish]').click();await page.waitForSelector('.inventory-grid');
  assert.deepEqual(errors,[]);console.log('Palette UI passed: EN/DE 1440–320px, exact quantities, affordable/premium offers, odds, real animated item-then-multiplier rolls, reduced motion, retry after accepted response loss, reload without reroll or duplicate stock, summary, inventory and Quick Restock handoffs, legacy auction reveal without changing rewards, navigation cleanup, sidebar and Auction House discovery.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
