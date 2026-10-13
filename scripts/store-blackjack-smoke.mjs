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
import { buyBusiness, stockBusiness, businessDashboard, unstockBusiness } from '../src/businesses.mjs';
import { visitStore } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';

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
const wine = buyBusiness(dir, owner, 'wine', 'popup').shop, toys = buyBusiness(dir, owner, 'toys', 'popup').shop, tech = buyBusiness(dir, owner, 'electronics', 'popup').shop;
const addItem = (id, category, title) => accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id, owner.id, JSON.stringify({ title, price: 30, marketCategory: category, rarity: 'common' }), Date.now()));
for (let n = 0; n < 12; n++) addItem(`wine-${n}`, 'wine', n < 10 ? 'Riesling' : 'Merlot');
for (let n = 0; n < 12; n++) addItem(`toy-${n}`, 'collectibles', `Toy ${n % 3}`);
stockBusiness(dir, owner, wine.id, Array.from({ length: 9 }, (_, n) => `wine-${n}`));
const thiefToken = await accounts.register({username:'blackjack-player',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}), thief=accounts.user(thiefToken);
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts }), writes = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/account/businesses/stock') writes.push(Date.now());
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
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:thiefToken,url:base}]);
  let mode='win',spinRequests=0;
  await page.route('**/api/account/stores/heist/spin',async route=>{spinRequests++;await route.continue();});
  await page.route('**/api/account/stores/heist/action',async route=>{
    const response=await route.fetch(),payload=await response.json();
    if(payload.heist?.outcome==='police') accounts.db(db=>db.prepare('UPDATE store_heists SET roll=? WHERE id=?').run(mode==='escape'?999999:0,payload.heist.id));
    await route.fulfill({response,json:payload});
  });
  // Deterministic isolated UI fixtures replace the test hand after a real
  // start request; production APIs never accept a deck or outcome.
  await page.route('**/api/account/stores/heist/start',async route=>{
    const cash=accounts.profile(thief).tokens,inventoryId=route.request().postDataJSON().inventoryId;
    const response=await route.fetch(),payload=await response.json();if(response.status()!==200)return route.fulfill({response});
    const id=payload.receipt.id,player=['lose','escape'].includes(mode)?[2,3]:mode==='hit'?[4,17]:[9,8],dealer=mode==='push'?[22,21]:['lose','escape'].includes(mode)?[9,8]:[6,10],used=new Set([...player,...dealer]);
    const game={player,dealer,deck:[...Array.from({length:52},(_,n)=>n).filter(n=>!used.has(n))],turn:0,outcome:'active'};
    accounts.db(db=>{db.prepare('UPDATE users SET tokens=? WHERE id=?').run(cash,thief.id);db.prepare('DELETE FROM player_justice WHERE user_id=?').run(thief.id);db.prepare('UPDATE inventory SET user_id=? WHERE id=?').run(owner.id,inventoryId);db.prepare('INSERT OR IGNORE INTO business_stock(business_id,inventory_id,stocked_at,asking_price) VALUES (?,?,?,?)').run(wine.id,inventoryId,Date.now(),route.request().postDataJSON().expectedPrice);db.prepare("UPDATE store_heists SET status='active',result=NULL,blackjack=? WHERE id=?").run(JSON.stringify(game),id);});
    payload.user=accounts.profile(thief);payload.store=visitStore(dir,thief,wine.id).store;payload.heist=payload.store.heist;await route.fulfill({response,json:payload});
  });
  const reset=()=>accounts.db(db=>db.prepare('UPDATE store_heists SET created_at=created_at-1800001').run());
  const open=async()=>{await page.goto(base+`/stores?shop=${wine.id}`);await page.waitForSelector('[data-store="heist"]');await page.locator('[data-store="heist"]').first().click();await page.waitForSelector('.store-heist-dialog[open]');};
  const language=async lang=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
  const estimate=async()=>{
    const risk=await page.locator('.blackjack-risk strong').innerText(),amounts=risk.match(/\d+/g).map(Number),actual=visitStore(dir,thief,wine.id).store.stock[0].theft.fine;
    assert.equal(amounts.length,2);assert.ok(amounts[0]<actual&&amounts[1]>actual,'rounded range must bracket the actual fine');assert.ok(!amounts.includes(actual),'the estimate must not display the exact fine');
  };
  await open();await estimate();assert.equal(await page.locator('.blackjack-details').evaluate(el=>el.open),false);
  assert.equal(await page.locator('.blackjack-details div').isVisible(),false);assert.equal(await page.locator('.blackjack-warning').count(),0);
  await page.locator('.blackjack-details summary').click();assert.equal(await page.locator('.blackjack-details div').isVisible(),true);assert.match(await page.locator('.blackjack-details').innerText(),/unpaid debt leads to jail/);await page.locator('.blackjack-details summary').click();
  // Switching language keeps the compact preflight and estimate in sync.
  await page.evaluate(()=>{document.querySelector('#language-select').value='de';document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await page.locator('#store-heist-title').innerText(),'Ein riskantes Blatt');await estimate();
  await page.evaluate(()=>{document.querySelector('#language-select').value='en';document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('[data-store="start-heist"]').isDisabled(),false);assert.equal(await page.locator('[data-store="choose-color"]').count(),0);await page.locator('[data-store="close-heist"]').click();
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});for(const lang of ['en','de']){await language(lang);await page.locator('[data-store="heist"]').first().click();await estimate();assert.equal(await page.locator('.blackjack-details').evaluate(el=>el.open),false);assert.ok(await page.locator('.store-heist-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}));await page.screenshot({path:`/tmp/jg-blackjack-rules-${width}-${lang}.png`});await page.locator('[data-store="close-heist"]').click();}}
  await page.setViewportSize({width:1440,height:900});await language('en');await page.locator('[data-store="heist"]').first().click();
  const before=accounts.profile(thief).tokens;await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="hit"]');
  assert.equal(accounts.profile(thief).tokens,before);await estimate();assert.equal(await page.locator('.blackjack-card.is-hidden').count(),1);await page.waitForTimeout(300);await page.screenshot({path:'/tmp/jg-blackjack-hand.png'});
  await page.locator('[data-store="stand"]').click();await page.waitForFunction(()=>document.querySelector('.blackjack-status')?.textContent.includes('You beat'));assert.equal(await page.locator('.police-wheel').count(),0);assert.equal(spinRequests,0);assert.equal(accounts.inventory(thief).length,1);assert.equal(accounts.profile(thief).tokens,before);await page.screenshot({path:'/tmp/jg-blackjack-win.png'});await page.locator('.store-action-row [data-store="close-heist"]').click();
  // A push gives no item and no fine, independent of the fair-game quote.
  reset();mode='push';await open();await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="stand"]');await page.locator('[data-store="stand"]').click();await page.waitForFunction(()=>document.querySelector('.blackjack-status')?.textContent.includes('A tie'));assert.equal(accounts.profile(thief).tokens,before);await page.locator('.store-action-row [data-store="close-heist"]').click();
  reset();mode='hit';await open();await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="hit"]');await page.locator('[data-store="hit"]').click();await page.waitForFunction(()=>document.querySelector('.blackjack-table section:last-child h3 span')?.textContent==='21'); // Ace adds eleven to ten, auto-stand.
  await page.waitForSelector('.store-action-row [data-store="close-heist"]');await page.locator('.store-action-row [data-store="close-heist"]').click();
  // Losing leaves the fine untouched until the private saved wheel is spun.
  reset();mode='escape';await open();await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="stand"]');await page.locator('[data-store="stand"]').click();await page.waitForSelector('[data-store="spin-police"]');
  const pending=visitStore(dir,thief,wine.id).store.heist;assert.equal(pending.outcome,'police');assert.ok(!('sector' in pending.policeWheel));assert.equal(accounts.profile(thief).tokens,before);assert.equal(spinRequests,0);
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:900});await page.evaluate(lang=>{document.querySelector('#language-select').value=lang;document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true}));},lang);
    assert.equal(await page.locator('.police-wheel .is-caught').count(),2);assert.equal(await page.locator('.police-wheel .is-escape').count(),8);
    assert.match(await page.locator('.police-wheel-odds').innerText(),/80%/);assert.match(await page.locator('.police-wheel-odds').innerText(),/20%/);
    assert.ok(await page.locator('.store-heist-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if([1440,320].includes(width))await page.locator('.store-heist-dialog').screenshot({path:`/tmp/jg-police-wheel-${width}-${lang}.png`});
  }
  await page.locator('[data-store="close-heist"]').click();await page.reload();await page.waitForSelector('[data-store="resume"]');await page.locator('[data-store="resume"]').click();assert.equal(visitStore(dir,thief,wine.id).store.heist.id,pending.id);
  await page.evaluate(()=>{document.querySelector('#language-select').value='en';document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true}));});
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-store="spin-police"]').press('Enter');await page.waitForFunction(()=>document.querySelector('.blackjack-status')?.textContent.includes('You escaped'));
  assert.equal(spinRequests,1);assert.equal(accounts.profile(thief).tokens,before);assert.equal(accounts.profile(thief).justice.offences,0);assert.equal(accounts.inventory(thief).length,2);
  await page.locator('.store-heist-dialog').screenshot({path:'/tmp/jg-police-escaped-320.png'});await page.locator('.police-wheel-content [data-store="close-heist"]').last().click();await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:900});
  // A hand resumes unchanged after navigation/reload; no client reroll.
  reset();mode='lose';await open();await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="stand"]');await page.locator('[data-store="close-heist"]').first().click();await page.reload();await page.waitForSelector('[data-store="resume"]');await page.locator('[data-store="resume"]').click();assert.equal(await page.locator('.blackjack-table section:last-child h3 span').innerText(),'7');await page.locator('[data-store="stand"]').click();await page.waitForSelector('[data-store="spin-police"]');assert.equal(accounts.profile(thief).tokens,before);await page.locator('[data-store="spin-police"]').dblclick();await page.keyboard.press('Escape');assert.equal(await page.locator('.store-heist-dialog').evaluate(el=>el.open),true);await page.waitForFunction(()=>document.querySelector('.blackjack-status')?.textContent.includes('Caught!'));assert.equal(spinRequests,2);assert.ok((await page.locator('.blackjack-consequence').innerText()).includes('120'));await page.screenshot({path:'/tmp/jg-blackjack-fine.png'});await page.locator('.police-wheel-content [data-store="close-heist"]').last().click();
  // Zero cash is allowed; loss seizes all stock and enforces a jail lock.
  accounts.db(db=>db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(thief.id));reset();mode='lose';await open();assert.equal(await page.locator('[data-store="start-heist"]').isEnabled(),true);await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="stand"]');await page.locator('[data-store="stand"]').click();await page.waitForSelector('[data-store="spin-police"]');assert.equal(await page.locator('.justice-dialog[open]').count(),0);await page.locator('[data-store="spin-police"]').click();await page.waitForSelector('.justice-dialog[open]');
  assert.equal(accounts.inventory(thief).length,0);assert.ok(accounts.profile(thief).justice.offences>=1);
  for(const route of ['/api/account/inventory','/api/account/net-worth','/api/stores','/api/town'])assert.equal((await context.request.get(base+route)).status(),423);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.justice-dialog').evaluate(el=>el.open),true);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});for(const lang of ['en','de']){await page.evaluate(lang=>{document.querySelector('#language-select').value=lang;document.querySelector('#language-select').dispatchEvent(new Event('change',{bubbles:true}));},lang);assert.ok(await page.locator('.justice-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`/tmp/jg-jail-${width}-${lang}.png`});}}
  await page.reload();await page.waitForSelector('.justice-dialog[open]');
  accounts.db(db=>db.prepare('UPDATE player_justice SET jailed_until=? WHERE user_id=?').run(Date.now()-1,thief.id));await page.locator('[data-justice-check]').click();await page.waitForFunction(()=>!document.querySelector('.justice-dialog').open);assert.equal((await context.request.get(base+'/api/account/inventory')).status(),200);
  assert.deepEqual(errors,[]);await context.close();console.log('Blackjack UI passed: compact entry, collapsed rules/consequences, rounded fine estimates on entry and active hands, live language switch; free entry; private cards; hit/stand, win/push skip wheel; private persistent 80/20 wheel, escape/caught, double-click protection, reduced motion, fine after animation; persisted resume; zero-cash seizure and jail; server lock across routes; Escape/reload enforcement; release; EN/DE responsive checks at 1440/768/390/320px; no JS errors.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
