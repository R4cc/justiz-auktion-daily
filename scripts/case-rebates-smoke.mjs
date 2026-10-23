// Account/admin browser smoke uses an isolated database and synthetic players.
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

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-case-rebates-ui-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await api(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const buf = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  await page.goto(base+'/admin');await page.waitForSelector('[data-admin-tab="rebates"]');
  await page.locator('[data-admin-tab="rebates"]').click();
  const language=async(target,lang)=>target.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  await page.locator('#case-rebate-form [name="caseId"]').selectOption('electronics-elite');
  await page.locator('#case-rebate-form [name="percent"]').fill('35');
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(page,lang);
    assert.equal(await page.locator('#case-rebate-form [name="caseId"]').inputValue(),'electronics-elite');
    assert.equal(await page.locator('#case-rebate-form [name="percent"]').inputValue(),'35');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`admin rebate form overflow at ${width} ${lang}`);
    await page.screenshot({path:`/tmp/jg-case-rebate-admin-${width}-${lang}.png`});
  }
  const submit=async()=>{await page.locator('#case-rebate-form button[type="submit"]').click();await page.waitForFunction(()=>!accountBusy);assert.equal(await page.locator('#case-rebate-form .account-error').innerText(),'');assert.ok(await page.locator('#case-rebate-form button[type="submit"]').isEnabled());};
  await submit();assert.equal(await page.locator('.admin-rebate-row').count(),1);
  const buyerToken=await accounts.register({username:'rebate-shopper',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}),buyer=accounts.user(buyerToken);
  accounts.db(db=>db.prepare('UPDATE users SET tokens=1000000 WHERE id=?').run(buyer.id));
  const shopper=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),shop=await shopper.newPage();
  shop.on('pageerror',error=>errors.push(error.message));await shopper.addCookies([{name:'jg_session',value:buyerToken,url:base}]);
  await shop.goto(base+'/shop?category=electronics');await shop.waitForSelector('[data-account="select-store-case"][data-id="electronics-elite"]');
  await shop.locator('[data-account="select-store-case"][data-id="electronics-elite"]').click();
  const offer=await shop.evaluate(()=>accountStore.cases.find(box=>box.id==='electronics-elite'));
  assert.equal(offer.rebate.percent,35);assert.equal(offer.cost,Math.ceil(offer.regularCost*.65));
  assert.equal(await shop.locator('.case-price-row del').count(),1);
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await shop.setViewportSize({width,height:1000});await language(shop,lang);
    assert.match(await shop.locator('.case-rebate-notice').innerText(),/35%/);
    assert.ok(await shop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`shop rebate overflow at ${width} ${lang}`);
    await shop.locator('.case-showcase-info').screenshot({path:`/tmp/jg-case-rebate-shop-${width}-${lang}.png`});
  }
  const before=accounts.profile(buyer).tokens;
  await shop.locator('[data-account="buy-case"]').click();await shop.waitForSelector('.case-reveal[open]');
  assert.equal(accounts.profile(buyer).tokens,before-offer.cost);
  assert.equal(accounts.inventory(buyer)[0].caseCost,offer.cost);
  await shop.locator('.case-reveal [data-account="close-reveal"]').first().click();
  await page.locator('[data-account="stop-case-rebate"]').click();await page.waitForFunction(()=>!accountBusy);
  assert.ok(await page.locator('#case-rebate-form button[type="submit"]').isEnabled());
  await shop.evaluate(()=>refreshCaseStock(accountVisit));assert.equal(await shop.locator('.case-rebate-notice').count(),0);
  assert.equal(await shop.evaluate(()=>accountStore.cases.find(box=>box.id==='electronics-elite').cost),offer.regularCost);
  await page.locator('#case-rebate-form [name="caseId"]').selectOption('all');
  await page.locator('#case-rebate-form [name="percent"]').fill('25');await submit();
  await shop.evaluate(()=>refreshCaseStock(accountVisit));
  assert.ok(await shop.evaluate(()=>accountStore.cases.every(box=>box.rebate.percent===25&&box.cost===Math.ceil(box.regularCost*.75))));
  // Expire the isolated schedule; no sleep or production clock manipulation.
  accounts.db(db=>db.prepare('UPDATE case_rebates SET starts_at=?,ends_at=? WHERE percent=25').run(Date.now()-3600000,Date.now()-1));
  await shop.evaluate(()=>refreshCaseStock(accountVisit));assert.equal(await shop.locator('.case-rebate-notice').count(),0);
  const local=value=>{const date=new Date(value);return new Date(value-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  await page.locator('#case-rebate-form [name="percent"]').fill('100');
  await page.locator('#case-rebate-form [name="startsAt"]').fill(local(Date.now()+3600000));
  await page.locator('#case-rebate-form [name="endsAt"]').fill(local(Date.now()+7200000));await submit();
  await shop.evaluate(()=>refreshCaseStock(accountVisit));assert.equal(await shop.locator('.case-rebate-notice').count(),0);
  accounts.db(db=>db.prepare('UPDATE case_rebates SET starts_at=? WHERE percent=100').run(Date.now()-1));
  await shop.evaluate(()=>refreshCaseStock(accountVisit));
  assert.ok(await shop.evaluate(()=>accountStore.cases.every(box=>box.cost===0)));
  const freeBefore=accounts.profile(buyer).tokens;
  await shop.locator('[data-account="buy-case"]').click();await shop.waitForSelector('.case-reveal[open]');
  assert.equal(accounts.profile(buyer).tokens,freeBefore);
  assert.ok(accounts.inventory(buyer).some(item=>item.caseCost===0));
  assert.deepEqual(errors,[]);await context.close();await shopper.close();
  console.log('Case rebates passed: EN/DE at 1440/768/390/320px; preserved form selections; one-case and all-case schedules; real discounted charges and sealed cost; stop and expiry refresh prices; scheduled start; stock-limited free cases; repeated submissions remain usable; no JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
