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
accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('mira','Mira','disabled',1000000,36100,?)").run(Date.now()));
const wine = buyBusiness(dir, owner, 'wine', 'popup').shop, toys = buyBusiness(dir, owner, 'toys', 'popup').shop, tech = buyBusiness(dir, {id:'mira'}, 'electronics', 'popup').shop;
const addItem = (id, category, title) => accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id, owner.id, JSON.stringify({ title, price: 30, marketCategory: category, rarity: 'common' }), Date.now()));
for (let n = 0; n < 12; n++) addItem(`wine-${n}`, 'wine', n < 10 ? 'Riesling' : 'Merlot');
for (let n = 0; n < 12; n++) addItem(`toy-${n}`, 'collectibles', `Toy ${n % 3}`);
stockBusiness(dir, owner, wine.id, Array.from({ length: 9 }, (_, n) => `wine-${n}`));
for(let i=0;i<3;i++)accounts.db(db=>db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('tech-'+i,'mira',JSON.stringify({title:['Vintage camera','Portable music player','Wireless headphones'][i],price:80,marketCategory:'electronics',rarity:['common','uncommon','rare'][i],image:'/assets/makita.jpg'}),Date.now()));
stockBusiness(dir,{id:'mira'},tech.id,['tech-0','tech-1','tech-2']);
accounts.db(db=>db.prepare('UPDATE businesses SET cash_balance=1540 WHERE id=?').run(wine.id));
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
 const language=async lang=>page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
 const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits viewport');
 const change=async(input,value)=>{await input.fill(value);await input.dispatchEvent('change');};
 for(const width of [1440,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/stores?shop='+wine.id+'&tab=stock');await page.waitForSelector('[data-shop-stock]');await language(lang);
  const add=page.locator('[data-side="add"]'),remove=page.locator('[data-side="remove"]');
  for(let i=0;i<await add.count();i++)await change(add.nth(i),'0');for(let i=0;i<await remove.count();i++)await change(remove.nth(i),'0');
  assert.equal(await add.first().getAttribute('max'),'1');await change(add.first(),'99');assert.equal(await add.first().inputValue(),'1');
  assert.ok(await add.first().locator('..').locator('[data-step="1"]').isDisabled());assert.equal(await add.nth(1).getAttribute('max'),'0');
  await change(remove.first(),'1');assert.equal(await add.nth(1).getAttribute('max'),'1');await change(add.nth(1),'99');assert.equal(await add.nth(1).inputValue(),'1');
  assert.equal(await remove.first().getAttribute('min'),'1');await change(remove.first(),'0');assert.equal(await remove.first().inputValue(),'1');assert.ok(await remove.first().locator('..').locator('[data-step="-1"]').isDisabled());assert.match(await page.locator('[data-stock-summary]').innerText(),/9 → 10 \/ 10/);assert.ok(await page.locator('[data-shop-stock] [type="submit"]').isEnabled());await overflow();
  // Drafts and limits survive both owner tabs and the task modal.
  await page.evaluate(()=>navigateAccountPage('/businesses'));await page.waitForSelector('.business-shop');await page.locator(`[data-business="open-restock"][data-shop="${wine.id}"]`).click();await page.waitForSelector('.shop-task[open]');
  assert.equal(await page.locator('dialog [data-side="add"]').first().inputValue(),'1');assert.equal(await page.locator('dialog [data-side="add"]').nth(1).inputValue(),'1');await page.locator('dialog [data-side="add"]').nth(1).fill('0');await page.locator('dialog [data-side="add"]').nth(1).dispatchEvent('change');assert.equal(await page.locator('dialog [data-side="remove"]').first().getAttribute('min'),'0');await page.locator('dialog [data-side="remove"]').first().locator('..').locator('[data-step="-1"]').click();assert.equal(await page.locator('dialog [data-side="remove"]').first().inputValue(),'0');await page.keyboard.press('Escape');
  await page.goto(base+'/stores?shop='+tech.id);await page.waitForSelector('.visitor-storefront');await language(lang);
  const tips=page.locator('[data-store="tip"]');assert.deepEqual(await tips.evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.amount))),[5,10,25]);
  const before=accounts.db(db=>db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(tech.id).cash_balance);
  await page.locator('[data-store="tip"][data-amount="10"]').click();await page.waitForFunction(()=>!document.querySelector('[data-store="tip"][disabled]'));
  assert.equal(accounts.db(db=>db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(tech.id).cash_balance),before+10);await overflow();
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/loans');await page.waitForSelector('[data-loan="review"]');await language('en');
 await page.locator('[data-loan="review"][data-offer="starter"]').click();await page.locator('[data-loan="borrow"]').click();await page.waitForSelector('[data-loan-repay]');
 let rejected=0;await page.route('**/api/account/loans/repay',async route=>{rejected++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'insufficient_tokens'})});});
 for(const width of [1440,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:1000});await language(lang);const input=page.locator('[data-loan-repay] input');await input.fill('37');
  await page.locator('[data-loan-repay] [type="submit"]').click();await page.waitForSelector('.account-error');assert.equal(await input.inputValue(),'37');
  await language(lang==='en'?'de':'en');assert.equal(await input.inputValue(),'37');await input.blur();await page.evaluate(()=>loansUi.load(accountVisit));assert.equal(await input.inputValue(),'37');
  await input.fill('');await page.evaluate(()=>loansUi.render());assert.equal(await input.inputValue(),'');await input.fill('37');await overflow();
 }
 assert.equal(rejected,6);await page.unroute('**/api/account/loans/repay');await page.locator('[data-loan-repay] [type="submit"]').click();
 await page.waitForSelector('.loan-success');assert.notEqual(await page.locator('[data-loan-repay] input').inputValue(),'37');
 assert.deepEqual(errors,[]);console.log('Store/loan QoL browser: EN/DE1440/390/320px, capacity-limited stock quantities with freed slots and task drafts, real10-token visitor tips, repayment drafts after rejected requests/language/render/empty input, successful repayment resets default, no page errors passed.');
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
