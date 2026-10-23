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
import { buyBusiness, stockBusiness, unstockBusiness } from '../src/businesses.mjs';
import { visitStore } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-theft-security-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const wine = buyBusiness(dir, owner, 'wine', 'popup').shop;
const addItem = (id, category, title) => accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id, owner.id, JSON.stringify({ title, price: 30, marketCategory: category, rarity: 'common' }), Date.now()));
for (let n = 0; n < 12; n++) addItem(`wine-${n}`, 'wine', n < 10 ? 'Riesling' : 'Merlot');
stockBusiness(dir, owner, wine.id, Array.from({ length: 9 }, (_, n) => `wine-${n}`));
const thiefToken = await accounts.register({username:'blackjack-player',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}), thief=accounts.user(thiefToken);
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
// Additional real stock for the new multi-stage path; ordinary smoke retains its cheap targets.
addItem('valuable-wine','wine','Collector wine');
accounts.db(db=>{
  db.prepare("UPDATE inventory SET item=json_set(item,'$.price',15000) WHERE id='valuable-wine'").run();
  db.prepare('UPDATE users SET tokens=1000000 WHERE id=?').run(thief.id);
});
stockBusiness(dir,owner,wine.id,['valuable-wine']);
let mode='win';
const forceHand=(id,security,turn)=>accounts.db(db=>{
  const later=security.completedWins>0,player=later&&mode==='lose'?[2,3]:[9,8],dealer=later&&mode==='push'?[22,21]:later&&mode==='lose'?[9,8]:[6,10],used=new Set([...player,...dealer]);
  const game={player,dealer,deck:Array.from({length:52},(_,n)=>n).filter(n=>!used.has(n)),turn,outcome:'active',security};
  db.prepare("UPDATE store_heists SET status='active',result=NULL,blackjack=? WHERE id=?").run(JSON.stringify(game),id);
});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:thiefToken,url:base}]);
  await page.route('**/api/account/stores/heist/start',async route=>{
    const response=await route.fetch(),payload=await response.json();assert.equal(response.status(),200,JSON.stringify(payload));
    const id=payload.receipt.id;
    forceHand(id,{requiredWins:3,completedWins:0},0);
    payload.user=accounts.profile(thief);payload.store=visitStore(dir,thief,wine.id).store;payload.heist=payload.store.heist;
    await route.fulfill({response,json:payload});
  });
  await page.route('**/api/account/stores/heist/action',async route=>{
    const input=route.request().postDataJSON(),before=accounts.db(db=>JSON.parse(db.prepare('SELECT blackjack FROM store_heists WHERE id=?').get(input.heistId).blackjack));
    const response=await route.fetch(),payload=await response.json();assert.equal(response.status(),200,JSON.stringify(payload));
    if(input.action==='continue') {
      // Keep the browser scenario deterministic after the real server deals.
      forceHand(input.heistId,before.security,before.turn+1);
      payload.heist=visitStore(dir,thief,wine.id).store.heist;
    }
    if(payload.heist?.outcome==='police')accounts.db(db=>db.prepare('UPDATE store_heists SET roll=999999 WHERE id=?').run(input.heistId));
    await route.fulfill({response,json:payload});
  });
  const language=lang=>page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  const target=()=>page.locator('[data-store="heist"][data-item="valuable-wine"]');
  const fit=async()=>assert.ok(await page.locator('.store-heist-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}));
  await page.goto(base+`/stores?shop=${wine.id}`);await target().waitFor();
  for(const width of [1440,768,390,320])for(const lang of ['en','de']) {
    await page.setViewportSize({width,height:1000});await language(lang);await target().click();
    assert.equal(await page.locator('.blackjack-security li').count(),3);
    assert.match(await page.locator('.blackjack-intro-copy').innerText(),lang==='en'?/Win 3 hands/:/Gewinne 3 Blätter/);
    await fit();await page.locator('[data-store="close-heist"]').click();
  }
  const start=async()=>{await target().click();await page.locator('[data-store="start-heist"]').click();await page.locator('[data-store="stand"]').waitFor();};
  await language('en');await start();
  const initial=visitStore(dir,thief,wine.id).store.heist;
  assert.equal(initial.security.requiredWins,3);assert.equal(initial.blackjack.dealer[1],null);
  await page.locator('[data-store="stand"]').click();await page.locator('[data-store="continue"]').waitFor();
  assert.equal(visitStore(dir,thief,wine.id).store.heist.security.completedWins,1);
  assert.equal(accounts.inventory(thief).length,0);assert.equal(accounts.profile(thief).heat.stars,.5);
  for(const width of [1440,768,390,320])for(const lang of ['en','de']) {
    await page.setViewportSize({width,height:1000});await language(lang);await fit();
    assert.equal(await page.locator('.blackjack-security li.is-cleared').count(),1);
    assert.equal(await page.locator('.blackjack-actions button').count(),1);
    assert.equal(await page.locator('[data-store="hit"]').count(),0);
    if([1440,320].includes(width))await page.locator('.store-heist-dialog').screenshot({path:`/tmp/jg-theft-security-${width}-${lang}.png`});
  }
  await page.locator('[data-store="close-heist"]').click();await page.reload();await page.locator('[data-store="resume"]').click();
  await page.locator('[data-store="continue"]').waitFor();await page.waitForFunction(()=>document.activeElement?.dataset.store==='continue');
  await page.locator('[data-store="continue"]').press('Enter');await page.locator('[data-store="stand"]').waitFor();
  await page.waitForFunction(()=>document.activeElement?.dataset.store==='hit');
  assert.equal(visitStore(dir,thief,wine.id).store.heist.expiresAt,initial.expiresAt);
  await page.locator('[data-store="stand"]').click();await page.locator('[data-store="continue"]').waitFor();
  assert.equal(accounts.inventory(thief).length,0);assert.equal(accounts.profile(thief).heat.stars,.5);
  await page.locator('[data-store="continue"]').click();await page.locator('[data-store="stand"]').waitFor();
  await page.locator('[data-store="stand"]').click();await page.locator('.store-action-row [data-store="close-heist"]').waitFor();
  assert.equal(accounts.inventory(thief).length,1);assert.equal(accounts.profile(thief).heat.stars,2.5);
  assert.equal(await page.locator('.blackjack-security li.is-cleared').count(),3);
  assert.equal(await page.locator('.store-action-row button').count(),1);
  await fit();await page.locator('.store-action-row [data-store="close-heist"]').click();
  // Restore the same real item only in this isolated fixture to test later-stage terminal paths.
  for(const terminal of ['push','lose']) {
    accounts.db(db=>{db.prepare('UPDATE inventory SET user_id=? WHERE id=?').run(owner.id,'valuable-wine');db.prepare('INSERT INTO business_stock(business_id,inventory_id,stocked_at,asking_price) VALUES(?,?,?,?)').run(wine.id,'valuable-wine',Date.now(),18000);});
    mode=terminal;await page.reload();await target().waitFor();await start();
    await page.locator('[data-store="stand"]').click();await page.locator('[data-store="continue"]').waitFor();
    await page.locator('[data-store="continue"]').click();await page.locator('[data-store="stand"]').waitFor();
    await page.locator('[data-store="stand"]').click();
    if(terminal==='lose') {await page.locator('[data-store="spin-police"]').waitFor();await page.locator('[data-store="spin-police"]').click();}
    await page.locator('.store-action-row [data-store="close-heist"], .police-wheel-content>[data-store="close-heist"]').waitFor();
    assert.equal(visitStore(dir,thief,wine.id).store.heist.outcome,terminal==='push'?'push':'escaped');
    assert.equal(accounts.inventory(thief).length,0);await page.locator('[data-store="close-heist"]').click();
    if(terminal==='push')unstockBusiness(dir,owner,wine.id,'valuable-wine');
  }
  assert.deepEqual(errors,[]);await context.close();
  console.log('Value-based theft UI passed: 15k target, three fair security stages, no early loot or extra Heat, explicit keyboard continuation, progress after reload, shared deadline, final transfer, later-stage tie/loss and police escape; EN/DE at 1440/768/390/320px; reduced motion; no browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
