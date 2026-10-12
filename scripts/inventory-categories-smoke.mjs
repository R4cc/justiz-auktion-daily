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
const dir = await mkdtemp('/tmp/jg-inventory-categories-');
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
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/inventory');await page.waitForSelector('#account-content a[href="/login"]');assert.equal(await page.locator('.inventory-summary').count(),0);
  await context.addCookies([{name:'jg_session',value:token,url:base}]);await page.reload();await page.waitForSelector('.inventory-category-cards');
  const card=id=>page.locator(`[data-inventory-category="${id}"]`),count=async id=>parseInt(await card(id).locator('.inventory-category-copy > strong').innerText());
  assert.equal(await count('all'),39);assert.equal(await count('wine'),5);assert.equal(await count('electronics'),3);assert.equal(await count('books_media'),2);assert.equal(await count('other'),1);assert.equal(await count('cases'),2);assert.equal(await count('tools'),26);
  assert.equal(await page.locator('.inventory-category-card').count(),7);
  // Five duplicate wines span two shelf copies, one listing and two available copies.
  await card('wine').click();assert.equal(await page.locator('[data-inventory-filter="category"]').inputValue(),'wine');assert.equal(await page.locator('.inventory-grid .collection-item').count(),3);
  assert.equal(await count('wine'),5);assert.equal(await card('wine').getAttribute('aria-pressed'),'true');
  assert.equal(await card('wine').evaluate(el=>el===document.activeElement),true);
  assert.ok((await page.locator('.inventory-grid h3').allTextContents()).every(title=>title==='Riesling'));
  await page.locator('[data-inventory-filter="state"]').selectOption('available');assert.equal(await page.locator('.inventory-grid .collection-item').count(),1);assert.equal(await page.locator('.item-count').innerText(),'×2');assert.equal(await count('wine'),5);
  await page.locator('[data-inventory-filter="rarity"]').selectOption('rare');await card('electronics').click();assert.ok(page.url().includes('state=available')&&page.url().includes('rarity=rare')&&page.url().includes('category=electronics'));assert.equal(await page.locator('.inventory-grid .collection-item').count(),1);assert.equal(await count('electronics'),3);
  await page.locator('[data-inventory-filter="category"]').selectOption('wine');assert.equal(await card('wine').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.inventory-grid').count(),0);assert.equal(await count('wine'),5);
  await page.goto(base+'/inventory');await page.waitForSelector('.inventory-summary');
  await card('cases').click();assert.equal(await page.locator('[data-inventory-filter="category"]').inputValue(),'cases');assert.equal(await count('cases'),2);assert.ok(await page.locator('.sealed-case-item').count()>0);assert.equal(await page.locator('.inventory-grid .collection-item:not(.sealed-case-item)').count(),0);
  await card('other').click();assert.deepEqual(await page.locator('.inventory-grid h3').allTextContents(),['Miscellaneous find']);
  await card('tools').click();await page.locator('[data-account="page"][data-step="1"]').click();assert.equal(await page.locator('.inventory-grid .collection-item').count(),2);
  await card('wine').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.inventory-pages > span').innerText(),'1/1');
  await card('all').click();assert.equal(await page.locator('[data-inventory-filter="category"]').inputValue(),'all');assert.equal(new URL(page.url()).searchParams.has('category'),false);
  await page.goto(base+'/inventory?focus=tool-25');await page.waitForSelector('.inventory-summary');await card('wine').click();assert.equal(new URL(page.url()).searchParams.has('focus'),false);
  await page.goto(base+'/inventory');await page.waitForSelector('.inventory-summary');
  for(const width of [1440,1024,768,600,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const lang of ['en','de']){
      const hidden=!(await page.locator('#language-select').isVisible());if(hidden)await page.locator('[data-action="sidebar"]').click();await page.locator('#language-select').selectOption(lang);if(hidden)await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
      assert.ok(await page.locator('.inventory-category-card').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} card overflow`);
      assert.equal(await count('wine'),5);assert.equal(await count('all'),39);
      await card('wine').click();assert.equal(await page.locator('[data-inventory-filter="category"]').inputValue(),'wine');
      await page.evaluate(()=>window.scrollTo(0,0));
      if([1440,390,320].includes(width))await page.screenshot({path:`/tmp/jg-inventory-categories-${width}-${lang}.png`,fullPage:true});
      await card('all').click();
    }
  }
  // Counts update after an inventory transfer and do not count a sold row.
  const opened=await accounts.openSealedCase(owner,accounts.inventory(owner).find(item=>item.kind==='case').id);
  await page.reload();await page.waitForSelector('.inventory-summary');assert.equal(await count('cases'),1);assert.equal(await count('all'),39);assert.ok(opened.id);
  await page.route('**/api/account/inventory?includeStores=1',route=>route.fulfill({json:{items:[]}}));await page.reload();await page.waitForSelector('.inventory-summary');assert.equal(await count('all'),0);assert.equal(await page.locator('.inventory-category-card').count(),1);assert.equal(await page.locator('.inventory-grid').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Inventory category UI passed: raw copy totals across available/listed/store stock; sealed cases and uncategorized items; card/dropdown synchronization; preserved state/rarity; keyboard and focus; pagination reset; cleared item focus; refreshed counts after opening a case; guest and empty inventory; EN/DE at 1440/1024/768/600/390/320px; no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
