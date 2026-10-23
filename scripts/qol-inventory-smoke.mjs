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
import { listItem, placeBid } from '../src/resale.mjs';
import { prepareSealedCase, insertSealedCase } from '../src/sealed-cases.mjs';
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

const wonIds=[];
accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('qol-seller','QolSeller','disabled',10000,?)").run(Date.now()));
for(let n=0;n<8;n++){
  const now=Date.now(),prepared=prepareSealedCase(null,'common',{now,fallback:[{id:1,title:'Private reward',price:20,rarity:'common',image:'/assets/tv.jpg'}]});
  const box=accounts.db(db=>insertSealedCase(db,'qol-seller',prepared,now));wonIds.push(box.id);
  const lot=listItem(dir,{id:'qol-seller'},{inventoryId:box.id,startPrice:100,endsAt:new Date(now+60000).toISOString()},{now});placeBid(dir,owner,lot.id,100,{now});
  accounts.db(db=>db.prepare('UPDATE resale_auctions SET ends_at=? WHERE id=?').run(now-1,lot.id));
}

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
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const language=async value=>page.evaluate(value=>{const control=document.querySelector('#language-select');control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const inventory=async id=>{await page.goto(base+'/inventory?focus='+id);await page.waitForSelector(`[data-inventory-detail="${id}"]`);};
  const detail=async id=>{await page.locator(`[data-inventory-detail="${id}"]`).press('Enter');await page.waitForSelector('.inventory-item-dialog[open]');};
  for(const width of [1440,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await inventory('gallery-item');await language(lang);await detail('gallery-item');
    await page.locator('[data-inventory-image="0"]').focus();await page.keyboard.press('End');
    assert.equal(await page.locator('.inventory-detail-image > img').getAttribute('src'),'/assets/hilti.jpg');
    assert.equal(await page.locator('[data-inventory-image="1"]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-inventory-image="0"]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-inventory-image="1"]').getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Home');assert.equal(await page.locator('[data-inventory-image="0"]').getAttribute('aria-pressed'),'true');
    const summary=page.locator('[data-item-section="about"] > summary');await summary.click();await summary.focus();
    await page.evaluate(()=>renderInventory());assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
    await language(lang==='en'?'de':'en');assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('[data-item-section="about"]').getAttribute('open'),'');
    assert.ok(await page.locator('.inventory-item-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('[data-inventory-detail="gallery-item"]')===document.activeElement);

    await inventory('wine-3');await language(lang);await detail('wine-3');
    await page.locator('[data-item-section="manage"] > summary').click();await page.locator('.inventory-item-dialog [data-trader="stock"]').click();
    await page.waitForSelector('#trader-stock-title');const dialog=page.locator('dialog:has(#trader-stock-title)');
    await language(lang==='en'?'de':'en');assert.equal(await page.locator('#trader-stock-title').innerText(),lang==='en'?'Laden auswählen':'Choose a store');
    assert.match(await dialog.locator('[data-trader="stock-confirm"]').innerText(),lang==='en'?/Weinhandlung/:/Wine store/);
    await language(lang);assert.equal(await page.locator('#trader-stock-title').innerText(),lang==='en'?'Choose a store':'Laden auswählen');
    assert.ok(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}));
    await dialog.screenshot({path:`/tmp/jg-qol-stock-${width}-${lang}.png`});await dialog.locator('[data-trader="close"]').click();
  }

  // A delayed failure exposes a genuine pending state, restores retry controls,
  // and retains an accessible error through language repaint.
  await inventory('wine-3');await language('en');await detail('wine-3');
  await page.locator('[data-item-section="manage"] > summary').click();await page.locator('.inventory-item-dialog [data-trader="stock"]').click();
  let release;const held=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/account/businesses/stock',async route=>{await held;await route.fulfill({status:503,json:{error:'unavailable'}});},{times:1});
  const stockDialog=page.locator('dialog:has(#trader-stock-title)');await stockDialog.locator('[data-trader="stock-confirm"]').click();
  await page.waitForFunction(()=>document.querySelector('dialog:has(#trader-stock-title)').getAttribute('aria-busy')==='true');
  assert.equal(await stockDialog.locator('[data-trader="stock-confirm"]:enabled').count(),0);
  await language('de');assert.equal(await stockDialog.getAttribute('aria-busy'),'true');assert.equal(await stockDialog.locator('[data-trader="stock-confirm"]:enabled').count(),0);
  release();await page.waitForFunction(()=>document.querySelector('dialog:has(#trader-stock-title) .account-error').textContent.length>0);
  await page.waitForFunction(()=>document.querySelector('dialog:has(#trader-stock-title)').getAttribute('aria-busy')==='false');
  assert.equal(await stockDialog.locator('[data-trader="stock-confirm"]:enabled').count(),1);
  const error=await stockDialog.locator('.account-error').innerText();await language('en');assert.equal(await stockDialog.locator('.account-error').innerText(),error);
  await stockDialog.locator('[data-trader="stock-confirm"]').click();await page.waitForFunction(()=>!document.querySelector('dialog:has(#trader-stock-title)').open);
  assert.equal(accounts.inventory(owner,{includeStores:true}).find(item=>item.id==='wine-3').storeId,wine.id);

  await inventory('book-0');await detail('book-0');await page.locator('.inventory-item-dialog [data-economy="quick-list"]').click();
  await page.waitForFunction(()=>document.querySelector('.inventory-item-dialog .inventory-state')?.textContent==='Listed');
  assert.equal(await page.locator('.inventory-detail-actions a').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');

  // Board refresh and live language updates retain the expanded reward list
  // and its active keyboard target without changing the saved rewards.
  for(const width of [1440,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/auction-house');await page.waitForSelector('.house-winnings-more');await language(lang);
    const more=page.locator('.house-winnings-more');if(!await more.evaluate(el=>el.open))await more.locator('summary').click();
    const reward=more.locator('[data-unopened-reward]').last(),key=await reward.getAttribute('data-unopened-reward');await reward.focus();
    await page.evaluate(()=>window.economyUi.render());assert.equal(await more.evaluate(el=>el.open),true);
    assert.equal(await reward.evaluate(el=>el===document.activeElement),true);
    await language(lang==='en'?'de':'en');assert.equal(await more.evaluate(el=>el.open),true);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.unopenedReward),key);
    await language(lang);await more.locator('summary').focus();await page.evaluate(()=>window.economyUi.render());
    assert.equal(await more.locator('summary').evaluate(el=>el===document.activeElement),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await more.screenshot({path:`/tmp/jg-qol-winnings-${width}-${lang}.png`});
    await page.locator('[data-house-filter="view"]').selectOption('mine');assert.equal(await more.evaluate(el=>el.open),true);
    assert.equal(await page.locator('[data-house-filter="view"]').evaluate(el=>el===document.activeElement),true);
    await more.locator('summary').click();await page.evaluate(()=>window.economyUi.render());assert.equal(await more.evaluate(el=>el.open),false);
    assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM sealed_cases WHERE inventory_id IN ('+wonIds.map(()=>'?').join(',')+') AND opened_at IS NULL').get(...wonIds).n),8);
  }
  assert.deepEqual(errors,[]);
  console.log('Inventory QoL browser checks passed: gallery Arrow/Home/End and repaint focus; section/action focus; localized store selection, busy choices, failed-write retry and real stocking; expanded winnings and focus across board/filter/language refresh; saved rewards preserved; EN/DE at1440/390/320px without overflow or JS errors.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
