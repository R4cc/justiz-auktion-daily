// Optional pallet-results browser regression with real bids, opening APIs and isolated data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
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
  const legacy=buyStockPalette(dir,owner,{offerId:legacyOffer.id,revision:catalog.revision,requestId:'priced-legacy-pallet-001'},{allowLegacyPurchase:true,random:()=>0});
  accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('rival','Rival','disabled',1000000,36100,?)").run(Date.now()));
  const board=await(await fetch(base+'/api/palette-auctions')).json(),lot=board.auctions.find(a=>a.stockOffer?.id==='wine-standard');assert.ok(lot);
  bidOnPaletteAuction(dir,owner,lot.id,lot.reserve+5000);bidOnPaletteAuction(dir,{id:'rival'},lot.id,lot.reserve+1000);
  const winningBid=accounts.db(db=>db.prepare('SELECT current_bid FROM primary_palette_auctions WHERE id=?').get(lot.id).current_bid);
  assert.ok(winningBid>lot.reserve,'overview must use the actual bid, not the reserve or escrow maximum');
  accounts.db(db=>db.prepare('UPDATE primary_palette_auctions SET ends_at=? WHERE id=?').run(Date.now()-1,lot.id));
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const language=async lang=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
  const overflow=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflow');
  let auctionQuote;
  await page.route('**/api/account/palette-auctions/*/rewards',async route=>{const id=route.request().url().split('/').at(-2);getPaletteAuctionRewards(dir,owner,id,{random:max=>max-1});const response=await route.fetch();auctionQuote=(await response.json()).valuation;await route.fulfill({response});});
  await page.goto(base+'/auction-house?reveal='+lot.id);await page.waitForSelector('.palette-reveal-screen');
  assert.equal(accounts.inventory(owner,{includeStores:true}).length,144);assert.equal(auctionQuote.costTokens,winningBid);
  assert.ok(!(await page.locator('.palette-reveal-header h1').innerText()).includes('144'));
  assert.equal(await page.locator('.palette-market-price,.palette-value-overview').count(),0,'prices and return stay hidden before a pull');
  // Reload must preserve every original reward while quoting the live market.
  await page.reload();await page.waitForSelector('.palette-reveal-screen');
  const actualInventory=accounts.inventory(owner,{includeStores:true});assert.equal(actualInventory.length,144);
  assert.equal(actualInventory.reduce((sum,item)=>sum+item.estimatedValueTokens,0),auctionQuote.totalValueTokens,'overview matches the current inventory market values');
  await page.emulateMedia({reducedMotion:'reduce'});
  const money=amount=>page.evaluate(value=>justizEuro(value),amount);
  await language('en');
  for(let index=0;index<3;index++){
    if(index===0)await page.locator('[data-palette-pull]').press('Enter');else await page.locator('[data-palette-pull]').click();
    await page.waitForSelector('[data-palette-reel="quantity"]');
    assert.equal(await page.locator('.palette-market-price dd').innerText(),await money(auctionQuote.rewards[index].unitValueTokens));
    assert.equal(await page.locator('.palette-drop-value,.palette-value-overview').count(),0,'quantity and final return remain hidden until revealed');
    await page.locator('[data-palette-pull]').click();await page.waitForSelector('.palette-multiplier-win');
    assert.equal(await page.locator('.palette-drop-value strong').innerText(),await money(auctionQuote.rewards[index].totalValueTokens));
    if(index===0)for(const width of [1440,390,320])for(const lang of ['en','de']){
      await page.setViewportSize({width,height:1000});await language(lang);await overflow(`priced item ${width} ${lang}`);
      assert.match(await page.locator('.palette-market-price dt').innerText(),lang==='en'?/Market price \/ unit/:/Marktpreis \/ Stück/);
      assert.ok(await page.locator('.palette-locked-item,.palette-multiplier-win').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1)),`priced item fits ${width} ${lang}`);
      if([1440,320].includes(width))await page.screenshot({path:`/tmp/jg-palette-priced-item-${width}-${lang}.png`,fullPage:true});
    }
    await page.locator('[data-palette-pull]').click();
  }
  await page.waitForSelector('.palette-haul-summary');assert.equal(await page.locator('.palette-summary-items article').count(),3);
  const counts=await page.locator('.palette-summary-items article>span').allTextContents();assert.equal(counts.reduce((sum,text)=>sum+Number(text.replace('×','')),0),144);
  assert.equal(auctionQuote.costTokens,accounts.db(db=>db.prepare('SELECT current_bid FROM primary_palette_auctions WHERE id=?').get(lot.id).current_bid));
  const checkOverview=async quote=>{
    const values=page.locator('.palette-value-overview dd');
    assert.equal(await values.nth(0).innerText(),await money(quote.costTokens));
    assert.equal(await values.nth(1).innerText(),await money(quote.totalValueTokens));
    assert.ok((await values.nth(2).innerText()).includes(await money(Math.abs(quote.profitLossTokens))));
    assert.equal(await page.locator('.palette-summary-drop-value strong').count(),3);
    for(let i=0;i<3;i++)assert.equal(await page.locator('.palette-summary-drop-value strong').nth(i).innerText(),await money(quote.rewards[i].totalValueTokens));
    assert.equal(await page.locator(`.palette-value-overview .is-${quote.profitLossTokens>0?'profit':quote.profitLossTokens<0?'loss':'even'}`).count(),1);
  };
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);await overflow(`summary ${width} ${lang}`);await checkOverview(auctionQuote);
    assert.ok(await page.locator('.palette-value-overview>div,.palette-summary-items article').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1)),`profit/loss fits ${width} ${lang}`);
    if([1440,320].includes(width))await page.screenshot({path:`/tmp/jg-palette-profit-loss-${width}-${lang}.png`,fullPage:true});
  }
  assert.equal(await page.locator('.palette-reveal-screen button,.palette-reveal-screen a').count(),1);await page.locator('.palette-summary-actions [data-palette-finish]').press('Enter');await page.waitForSelector('.inventory-grid');
  // Existing paid pallets retain their purchase cost and the old opening link.
  const legacyResponse=page.waitForResponse(response=>response.url().endsWith('/api/account/stock-palettes/reveal'));
  await page.goto(base+'/palettes?open='+legacy.id);await page.waitForSelector('.palette-reveal-screen');
  const legacyQuote=(await(await legacyResponse).json()).valuation;
  assert.equal(new URL(page.url()).pathname,'/auction-house');assert.equal(accounts.inventory(owner,{includeStores:true}).length,150);
  assert.equal(legacyQuote.costTokens,legacy.cost);assert.ok(legacyQuote.profitLossTokens<0,'low rolls display a loss');
  for(let i=0;i<3;i++){
    await page.locator('[data-palette-pull]').click();await page.waitForSelector('[data-palette-reel="quantity"]');
    assert.equal(await page.locator('.palette-market-price dd').innerText(),await money(legacyQuote.rewards[i].unitValueTokens));
    await page.locator('[data-palette-pull]').click();await page.waitForSelector('.palette-multiplier-win');await page.locator('[data-palette-pull]').click();
  }
  await page.waitForSelector('.palette-haul-summary');await checkOverview(legacyQuote);await page.screenshot({path:'/tmp/jg-palette-loss-320-de.png',fullPage:true});await page.locator('[data-palette-finish]').press('Enter');await page.waitForSelector('.inventory-grid');
  assert.deepEqual(errors,[]);await context.close();
  console.log('Pallet results UI passed: current unit prices only after item reveal, quantity-adjusted drop values, final market value and signed profit/loss against actual winning bid and legacy purchase cost, stable rewards after reload, inventory-consistent values, keyboard controls, reduced motion, EN/DE at 1440/768/390/320px without overflow or page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
