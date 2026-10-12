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
import { recordNetWorth } from '../src/net-worth.mjs';
import { imposeFine } from '../src/justice.mjs';
import { listItem, placeBid } from '../src/resale.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { marketIndexes } from '../src/market.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-net-worth-ui-');
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
// Synthetic observations are isolated test fixtures, never production backfill.
const captured=Date.now(), day=86400000;
accounts.db(db=>{for(let n=0;n<=540;n++){
  const cash=Math.round(30000+n*50+Math.sin(n/15)*700);
  db.prepare('UPDATE users SET tokens=? WHERE id=?').run(cash,owner.id);
  recordNetWorth(db,owner.id,{now:captured-45*day+n*2*3600000});
}});
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
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  assert.equal((await context.request.get(base+'/api/account/net-worth?range=all')).status(),401);
  await page.goto(base+'/inventory');await page.waitForSelector('#account-content a[href="/login"]');assert.equal(await page.locator('.net-worth-chart').count(),0);
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  await page.reload();await page.waitForSelector('[data-worth-plot]');
  const read=async range=>(await (await context.request.get(base+'/api/account/net-worth?range='+range)).json());
  assert.equal((await context.request.get(base+'/api/account/net-worth?range=__proto__')).status(),400);
  const own=await read('all'), attemptedOther=await (await context.request.get(base+'/api/account/net-worth?range=all&userId=someone-else')).json();
  assert.equal(attemptedOther.current.total,own.current.total);assert.equal(attemptedOther.trackedSince,own.trackedSince);
  for(const range of ['1d','1w','1m','all']){
    await page.locator(`[data-worth-range="${range}"]`).click();await page.waitForSelector('.net-worth-chart[aria-busy="false"]');
    const payload=await read(range);assert.ok(payload.points.length>1&&payload.points.length<=403);
    assert.equal(payload.current.total,payload.current.cash+payload.current.heldBids+payload.current.items+payload.current.businesses+payload.current.sealedPalettes-payload.current.fineDebt);
    assert.equal(payload.current.businesses,1000);assert.equal(await page.locator(`[data-worth-range="${range}"]`).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.worth-breakdown > div').count(),4);
    const expected=await page.evaluate(value=>justizEuro(value),payload.current.total);assert.equal(await page.locator('.worth-summary > strong').innerText(),expected);
    await page.locator('[data-worth-plot]').focus();await page.keyboard.press('Home');assert.ok((await page.locator('[data-worth-inspection]').innerText()).includes(await page.evaluate(value=>justizEuro(value),payload.points[0].total)));
    await page.keyboard.press('ArrowRight');await page.keyboard.press('End');assert.equal(await page.locator('[data-worth-marker]').getAttribute('visibility'),'visible');
  }
  await page.locator('[data-inventory-category="wine"]').click();assert.equal(await page.locator('[data-worth-range="all"]').getAttribute('aria-pressed'),'true');assert.ok(page.url().includes('category=wine')&&page.url().includes('worth=all'));
  // A slow response from an earlier range cannot replace the newer selection.
  await page.route('**/api/account/net-worth?range=1w',async route=>{const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,700));await route.fulfill({response});});
  await page.locator('[data-worth-range="1w"]').click();await page.locator('[data-worth-range="1m"]').click();await page.waitForTimeout(850);assert.equal(await page.locator('[data-worth-range="1m"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.net-worth-chart').getAttribute('aria-busy'),'false');await page.unroute('**/api/account/net-worth?range=1w');
  for(const width of [1440,1024,768,600,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const lang of ['en','de']){
      const hidden=!(await page.locator('#language-select').isVisible());if(hidden)await page.locator('[data-action="sidebar"]').click();await page.locator('#language-select').selectOption(lang);if(hidden)await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
      assert.ok(await page.locator('.net-worth-chart').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${width} ${lang} chart overflow`);
      await page.locator('[data-worth-range="1d"]').click();await page.waitForSelector('[data-worth-plot]');await page.locator('[data-worth-plot]').tap({force:true}).catch(()=>page.locator('[data-worth-plot]').click());
      assert.equal(await page.locator('[data-worth-marker]').getAttribute('visibility'),'visible');
      await page.evaluate(()=>window.scrollTo(0,0));if([1440,390,320].includes(width))await page.screenshot({path:`/tmp/jg-net-worth-${width}-${lang}.png`,fullPage:true});
    }
  }
  // A fresh wealth response follows account changes without resetting filters.
  const before=await read('1d');accounts.grantUserTokens(owner,owner.id,250,'wealth-browser-grant-001');
  await page.evaluate(async()=>{const result=await accountApi('me');updateAccount(result.user);});
  await page.waitForFunction(total=>document.querySelector('.worth-summary > strong')?.textContent===justizEuro(total),before.current.total+250);
  assert.equal(new URL(page.url()).searchParams.get('category'),'wine');
  // Chart read failure is contained; inventory/category controls still work.
  await page.route('**/api/account/net-worth?range=all',route=>route.fulfill({status:503,json:{error:'unavailable'}}),{times:1});
  await page.locator('[data-worth-range="all"]').click();await page.waitForSelector('[data-worth-retry]');assert.equal(await page.locator('[data-inventory-category="wine"]').count(),1);
  await page.locator('[data-worth-retry]').click();await page.waitForSelector('[data-worth-plot]');
  // No invented past points: the first observation is a dot, including zero wealth.
  accounts.db(db=>{db.prepare('DELETE FROM net_worth_snapshots WHERE user_id=?').run(owner.id);db.prepare('UPDATE inventory SET sold_at=? WHERE user_id=?').run(Date.now(),owner.id);db.prepare('DELETE FROM business_stock').run();db.prepare('DELETE FROM businesses').run();db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(owner.id);});
  await page.goto(base+'/inventory?worth=all');await page.waitForSelector('[data-worth-plot]');assert.equal(await page.locator('.worth-line').count(),0);assert.equal(await page.locator('.worth-latest').count(),1);assert.equal((await read('all')).points.length,1);
  // Bidder-backed assets can leave collectible debt and negative net worth.
  addItem('debt-backed-item','wine','Protected bidder stock');
  accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES ('debt-bidder','debt-bidder','disabled',1000,?)").run(Date.now()));
  const backed=listItem(dir,owner,{inventoryId:'debt-backed-item',startPrice:20,endsAt:new Date(Date.now()+3600000).toISOString()});placeBid(dir,{id:'debt-bidder'},backed.id,100);
  accounts.db(db=>{recordNetWorth(db,owner.id,{now:Date.now()-60000});imposeFine(db,owner.id,400,Date.now());});
  await page.goto(base+'/inventory?worth=all');await page.waitForSelector('[data-worth-plot]');
  const debt=await read('all');assert.equal(debt.current.fineDebt,400);assert.equal(debt.current.total,-370);assert.equal(await page.locator('.worth-breakdown > div').count(),5);
  assert.ok(await page.locator('.worth-line').evaluate(el=>Array.from(el.points).every(point=>point.y>=18&&point.y<=214)));
  await page.screenshot({path:'/tmp/jg-net-worth-debt.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Net worth UI passed: authenticated private history; exact components; all four ranges; bounded real observations; keyboard/pointer inspection; preserved filters and refresh; stale-response rejection; account-change refresh; contained failures/retry; first-point, zero-wealth and negative-debt views; EN/DE at 1440/1024/768/600/390/320px; no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
