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
const thiefToken = await accounts.register({username:'roulette-player',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}), thief=accounts.user(thiefToken);
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
  const context = await browser.newContext({ viewport: {width:1440,height:1000} }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addCookies([{name:'jg_session',value:thiefToken,url:base}]);
  let roll = 0, finishes = 0;
  await page.route('**/api/account/stores/heist/finish', async route => {
    finishes++;
    const {heistId} = route.request().postDataJSON();
    accounts.db(db => db.prepare('UPDATE store_heists SET roll=? WHERE id=?').run(roll,heistId));
    await route.continue();
  });
  const resetCooldown = () => accounts.db(db => db.prepare('UPDATE store_heists SET created_at=created_at-1800001').run());
  const open = async () => { await page.goto(base+`/stores?shop=${wine.id}`); await page.waitForSelector('[data-store="heist"]'); await page.locator('[data-store="heist"]').first().click(); await page.waitForSelector('.store-heist-dialog[open]'); };
  const language = async lang => { const hidden=!(await page.locator('#language-select').isVisible()); if(hidden)await page.locator('[data-action="sidebar"]').click(); await page.locator('#language-select').selectOption(lang); if(hidden)await page.keyboard.press('Escape'); };
  await open();
  assert.equal(await page.locator('[data-store="start-heist"]').isDisabled(),true);
  assert.equal(await page.locator('[data-store="choose-color"]').count(),2);
  assert.equal(await page.locator('[data-store="move"], .store-direction-pad').count(),0);
  await page.locator('[data-store="close-heist"]').click();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    for(const lang of ['en','de']){
      await language(lang); await page.locator('[data-store="heist"]').first().click();
      assert.ok(await page.locator('.store-heist-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}),`${width} ${lang} dialog overflow`);
      assert.equal(await page.locator('[data-store="start-heist"]').isDisabled(),true);
      if([1440,320].includes(width))await page.screenshot({path:`/tmp/jg-roulette-pick-${width}-${lang}.png`});
      await page.locator('[data-store="close-heist"]').click();
    }
  }
  await page.setViewportSize({width:1440,height:900}); await language('en');
  await page.locator('[data-store="heist"]').first().click();
  await page.locator('[data-color="black"]').press('Enter');
  assert.equal(await page.locator('[data-color="black"]').getAttribute('aria-pressed'),'true');
  const entry = (await (await context.request.get(base+`/api/stores/${wine.id}`)).json()).store.stock[0];
  const before = accounts.profile(thief).tokens, startsBefore = accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM store_heists').get().n);
  await page.locator('[data-store="start-heist"]').dblclick(); await page.waitForSelector('.roulette-window');
  assert.equal(await page.locator('[data-store="choose-color"]').count(),0);
  await page.waitForFunction(()=>!!document.querySelector('.roulette-window .case-reel')?.getAnimations().length);
  await page.screenshot({path:'/tmp/jg-roulette-spin.png'});
  await page.waitForSelector('.roulette-window .is-pulled',{timeout:12000});
  await page.waitForSelector('.roulette-content .store-action-row');
  assert.match(await page.locator('[data-roulette-status]').innerText(),/Black.*Color matched/);
  assert.equal(await page.locator('.is-pulled strong').innerText(),'Black');
  assert.ok(await page.locator('.is-pulled').evaluate(el=>{const box=el.getBoundingClientRect(),window=el.closest('.case-window').getBoundingClientRect(),at=window.left+window.width/2;return at>=box.left&&at<=box.right;}));
  assert.equal(accounts.profile(thief).tokens,before-entry.theft.fee);
  assert.equal(accounts.inventory(thief).length,1);
  assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM store_heists').get().n),startsBefore+1);
  await page.screenshot({path:'/tmp/jg-roulette-win.png'});
  await page.locator('.store-action-row [data-store="close-heist"]').click();
  assert.equal(await page.locator('[data-store="heist"]').first().isDisabled(),true);
  // Choosing the other color does not turn a losing server roll into a win.
  resetCooldown();roll=999999;await open();await page.locator('[data-color="red"]').click();
  await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('.roulette-content .store-action-row',{timeout:12000});
  assert.match(await page.locator('[data-roulette-status]').innerText(),/Black.*Wrong color/);assert.equal(accounts.inventory(thief).length,1);
  await page.screenshot({path:'/tmp/jg-roulette-loss.png'});await page.locator('.store-action-row [data-store="close-heist"]').click();
  // Retry the same paid attempt after a transient settlement failure.
  resetCooldown();roll=0;await open();await page.locator('[data-color="red"]').click();
  await page.route('**/api/account/stores/heist/finish', route=>route.fulfill({status:503,json:{error:'unavailable'}}),{times:1});
  const balance = accounts.profile(thief).tokens;
  await page.locator('[data-store="start-heist"]').click();await page.waitForSelector('[data-store="retry-finish"]:visible');
  const paid = accounts.profile(thief).tokens;assert.ok(paid<balance);
  await page.locator('[data-store="retry-finish"]').click();await page.waitForSelector('.roulette-content .store-action-row',{timeout:12000});
  assert.equal(accounts.profile(thief).tokens,paid);assert.equal(accounts.inventory(thief).length,2);assert.match(await page.locator('.is-pulled strong').innerText(),/Red/);
  await page.locator('.store-action-row [data-store="close-heist"]').click();
  // A hidden animation cannot repeat a settled transfer after navigation.
  resetCooldown();await open();await page.locator('[data-color="black"]').click();await page.locator('[data-store="start-heist"]').click();
  await page.waitForFunction(()=>!!document.querySelector('.roulette-window .case-reel')?.getAnimations().length);
  const finished = finishes;await page.evaluate(()=>navigateAccountPage('/inventory'));await page.waitForURL('**/inventory');
  await page.waitForTimeout(5600);assert.equal(finishes,finished);assert.equal(accounts.inventory(thief).length,3);
  // Owners never receive theft controls for their own shelves; guests cannot pay.
  await context.clearCookies();await context.addCookies([{name:'jg_session',value:token,url:base}]);await page.goto(base+`/stores?shop=${wine.id}`);await page.waitForSelector('.store-owner-page');assert.equal(await page.locator('[data-store="heist"]').count(),0);
  await context.clearCookies();await page.reload();await page.waitForSelector('.store-notice');assert.equal(await page.locator('[data-store="heist"]').first().isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Roulette UI passed: EN/DE at 1440/768/390/320px; mandatory keyboard color choice, full shared reel and exact landing; winning and losing colors; one-time charge on double clicks and retries; interrupted spin; inventory conservation; cooldowns; own-store and guest restrictions; no JS errors.');
} finally {
  await browser.close(); await new Promise(resolve=>server.close(resolve)); closeDataStore(dir); await rm(dir,{recursive:true,force:true});
}
