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
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const go=async()=>{await page.goto(base+'/skills');await page.waitForSelector('.skill-active-branches');};
  const language=async lang=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
  await go();assert.equal(await page.locator('[data-skill-points]').innerText(),'20');assert.equal(await page.locator('.skill-branch').count(),3);assert.equal(await page.locator('.skill-future-branch').count(),6);assert.equal(await page.locator('.skill-rank.is-future').count(),3);
  for(const width of [1440,1024,768,600,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){
    await language(lang);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
    assert.ok(await page.locator('.skill-branch').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} branch overflow`);
    assert.ok(await page.locator('.skill-future-branch').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} locked branch overflow`);
    assert.doesNotMatch(await page.locator('.skill-influence').innerText(),/%/);
    if([1440,390].includes(width))await page.screenshot({path:`/tmp/jg-skills-${width}-${lang}.png`,fullPage:true});
  }}
  await page.setViewportSize({width:1440,height:1000});await language('en');const stale=await context.newPage();stale.on('pageerror',error=>errors.push(error.message));await stale.goto(base+'/skills');await stale.waitForSelector('[data-skill-id="luck"]');
  const click=async id=>{await page.locator(`[data-skill-id="${id}"]`).click();};
  let request,postCount=0;await page.route('**/api/account/skills/upgrade',async route=>{postCount++;const payload=route.request().postDataJSON();if(postCount===1){request=payload.requestId;await route.fetch();await route.abort();}else{assert.equal(payload.requestId,request);await route.continue();}});
  await click('luck');await page.waitForSelector('.skill-tree-page .account-error');assert.equal(accounts.profile(owner).skills.available,19);await click('luck');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='19');assert.equal(postCount,2);await page.unroute('**/api/account/skills/upgrade');
  await stale.locator('[data-skill-id="luck"]').click();await stale.waitForSelector('.skill-tree-page .account-error');await stale.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='19');assert.equal(await stale.locator('.skill-luck .is-owned').count(),1);await stale.close();
  await click('luck');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='16');await click('luck');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='10');assert.equal(await page.locator('.skill-luck [data-skill-id]').count(),0);assert.match(await page.locator('.skill-luck .skill-current-effect').innerText(),/7%/);
  await click('influence');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='9');assert.doesNotMatch(await page.locator('.skill-influence').innerText(),/%/);
  await click('security');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='8');await click('security');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='5');assert.equal(await page.locator('[data-skill-id="security"]').isDisabled(),true);
  await page.reload();await page.waitForSelector('.skill-active-branches');assert.equal(await page.locator('[data-skill-points]').innerText(),'5');assert.equal(await page.locator('.site-nav a[href="/skills"] .skill-nav-points').innerText(),'5');
  await page.goto(base+'/shop');await page.waitForSelector('.case-boutique');assert.match(await page.locator('.skill-luck-notice').innerText(),/7%/);
  await page.goto(base+'/auction-house?stock=wine');await page.waitForSelector('.stock-palette-art');await page.locator('[data-economy="primary"]').first().click();await page.waitForSelector('.economy-dialog[open]');await page.locator('.auction-room-contents summary').click();assert.match(await page.locator('.auction-room-contents .skill-luck-notice').innerText(),/7%/);await page.locator('[data-economy="close"]').click();
  const guest=await browser.newContext({viewport:{width:390,height:900}}),anonymous=await guest.newPage();anonymous.on('pageerror',error=>errors.push(error.message));await anonymous.goto(base+'/skills');await anonymous.waitForSelector('.skill-login');assert.equal(await anonymous.locator('[data-skill-points]').count(),0);await guest.close();
  await page.goto(base+'/inventory');await page.waitForSelector('.collection-empty');assert.equal(await page.locator('.skill-tree-page').count(),0);
  assert.deepEqual(errors,[]);console.log('Skill tree UI passed: existing-level points, ranks/costs, six future branches, rank IV locked, qualitative Influence, 1440–320px EN/DE without overflow, accepted-response retry, stale-tab reconciliation, persisted upgrades, insufficient-points guard, live luck on cases/palettes, guest gate, sidebar badge and navigation cleanup.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
