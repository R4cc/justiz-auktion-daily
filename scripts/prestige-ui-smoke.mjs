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
const dir = await mkdtemp('/tmp/jg-skill-tree-ui-');
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
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
 const go=async()=>{await page.goto(base+'/profile');await page.waitForSelector('.profile-prestige');};
 const language=async lang=>{const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
 accounts.db(db=>db.prepare('UPDATE users SET xp=8099 WHERE id=?').run(owner.id));await go();assert.equal(await page.locator('[data-prestige="open"]').isDisabled(),true);
 accounts.db(db=>db.prepare('UPDATE users SET xp=8100 WHERE id=?').run(owner.id));await go();
 for(const width of [3840,1440,768,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:1000});await language(lang);await page.locator('[data-prestige="open"]').click();await page.waitForSelector('.prestige-dialog[open]');
  assert.equal(await page.locator('.prestige-choice').count(),5);assert.equal(await page.locator('.prestige-confirm input').isChecked(),false);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} profile overflow`);
  assert.ok(await page.locator('.prestige-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${width} ${lang} dialog clipping`);
  assert.ok(await page.locator('.prestige-choice').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)));
  if(width===320&&lang==='de')await page.locator('.prestige-dialog').screenshot({path:'/tmp/jg-prestige-dialog-320-de.png'});
  await page.keyboard.press('Escape');await page.waitForSelector('.prestige-dialog',{state:'detached'});
 }
 await page.setViewportSize({width:1440,height:1000});await language('en');await page.locator('[data-prestige="open"]').click();
 await page.locator('input[name="buffId"][value="cases"]').check();
 const beforePrestige=accounts.profile(owner);
 let posts=0,requestId;
 await page.route('**/api/account/prestige',async route=>{posts++;const body=route.request().postDataJSON();if(posts===1){requestId=body.requestId;await route.fetch();await route.abort();}else{assert.equal(body.requestId,requestId);await route.continue();}});
 await page.locator('.prestige-dialog button[type="submit"]').click();assert.equal(posts,0);
 await page.locator('input[name="confirmation"]').check();await page.locator('.prestige-dialog button[type="submit"]').click();await page.waitForSelector('[data-prestige-error]:not([hidden])');
 assert.equal(accounts.profile(owner).prestige.count,1);await page.locator('.prestige-dialog button[type="submit"]').click();await page.waitForSelector('.prestige-dialog',{state:'detached'});await page.waitForSelector('.prestige-owned');
 assert.equal(posts,2);assert.equal(accounts.profile(owner).tokens,1000);assert.equal(accounts.profile(owner).progression.level,1);assert.equal(accounts.profile(owner).prestige.caseDiscountPercent,50);
 await page.unroute('**/api/account/prestige');
 await page.evaluate(old=>updateAccount(old),beforePrestige);assert.equal(await page.evaluate(()=>account.prestige.count),1);assert.equal(await page.evaluate(()=>account.tokens),1000);
 await go();assert.equal(await page.locator('[data-prestige="open"]').isDisabled(),true);
 assert.match(await page.locator('.prestige-owned').innerText(),/50% case costs/);
 const headers={cookie:'jg_session='+token};const personal=await(await fetch(base+'/api/account/case-store',{headers})).json(),guest=await(await fetch(base+'/api/account/case-store')).json();
 for(let n=0;n<personal.cases.length;n++)assert.equal(personal.cases[n].cost,Math.ceil(guest.cases[n].cost/2));
 accounts.db(db=>db.prepare('UPDATE users SET xp=8100 WHERE id=?').run(owner.id));await go();await page.locator('[data-prestige="open"]').click();assert.equal(await page.locator('.prestige-choice').count(),4);assert.equal(await page.locator('input[value="cases"]').count(),0);
 await page.locator('input[value="luck"]').check();await page.locator('input[name="confirmation"]').check();await page.locator('.prestige-dialog button[type="submit"]').click();await page.waitForSelector('.prestige-dialog',{state:'detached'});await page.waitForFunction(()=>document.querySelector('.profile-prestige h2')?.textContent.includes('2 / 5'));
 assert.equal(accounts.profile(owner).skills.luckPercent,25);assert.equal(accounts.profile(owner).prestige.caseDiscountPercent,50);
 await page.setViewportSize({width:320,height:1000});await language('de');await page.locator('.profile-prestige').screenshot({path:'/tmp/jg-prestige-profile-320-de.png'});
 await page.goto(base+'/shop');await page.waitForSelector('.case-boutique');assert.match(await page.locator('.skill-luck-notice').innerText(),/25%/);
 await page.goto(base+'/changelog');await page.waitForSelector('.changelog-list');assert.match(await page.locator('.changelog-list').innerText(),/Prestige/);
 const anonymous=await browser.newPage();await anonymous.goto(base+'/profile');await anonymous.waitForSelector('a[href="/login"]');assert.equal(await anonymous.locator('.profile-prestige').count(),0);
 assert.deepEqual(errors,[]);console.log('Prestige UI passed: level gate, EN/DE 3840–320px, keyboard close, explicit reset review, one-buff selection, accepted-response retry, persisted reset, repeated Prestige, non-stacking perks, personal half-price quotes, luck preview and guest gating.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
