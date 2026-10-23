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
import { listItem } from '../src/resale.mjs';
import { supplyNpcItemAuctions } from '../src/npc-item-supply.mjs';

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
const seller={id:'intelligence-seller'};
accounts.db(db=>{
  db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,'Item Seller','disabled',100000,?)").run(seller.id,Date.now());
  for(const [id,title] of [['under-market','Makita drill'],['above-market','Gold watch'],['bulk-1','Tool batch'],['bulk-2','Tool batch']])
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,seller.id,JSON.stringify({title,price:200,marketCategory:'tools',image:'/favicon.png'}),Date.now());
});
const end=new Date(Date.now()+3600_000).toISOString();
const low=listItem(dir,seller,{inventoryId:'under-market',startPrice:50,endsAt:end});
const high=listItem(dir,seller,{inventoryId:'above-market',startPrice:500,endsAt:end});
const bulk=listItem(dir,seller,{inventoryId:'bulk-1',quantity:2,startPrice:100,endsAt:end});
supplyNpcItemAuctions(dir);
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
  await go();assert.equal(await page.locator('[data-skill-points]').innerText(),'20');assert.equal(await page.locator('.skill-branch').count(),4);assert.equal(await page.locator('.skill-future-branch').count(),6);assert.equal(await page.locator('.skill-rank.is-future').count(),3);
  for(const width of [1440,1024,768,600,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){
    await language(lang);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
    assert.ok(await page.locator('.skill-branch').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} branch overflow`);
    assert.ok(await page.locator('.skill-future-branch').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth+1)),`${width} ${lang} locked branch overflow`);
    assert.doesNotMatch(await page.locator('.skill-influence').innerText(),/%/);
    if(width===320&&lang==='de')await page.locator('.skill-market-intelligence').screenshot({path:'/tmp/jg-intelligence-skill-320-de.png'});
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
  await page.goto(base+'/shop?category=electronics');await page.waitForSelector('.case-boutique');assert.match(await page.locator('.skill-luck-notice').innerText(),/7%/);
  await page.goto(base+'/auction-house?stock=wine');await page.waitForSelector('.stock-palette-art');await page.locator('[data-economy="primary"]').first().click();await page.waitForSelector('.economy-dialog[open]');await page.locator('.auction-room-contents summary').click();assert.match(await page.locator('.auction-room-contents .skill-luck-notice').innerText(),/7%/);await page.locator('[data-economy="close"]').click();
  const card=id=>page.locator(`.house-lot[data-id="${id}"]`);
  await page.goto(base+'/auction-house');await card(low.id).waitFor();
  assert.match(await card(low.id).locator('.listing-market-value').innerText(),/Market value/);
  assert.equal(await page.locator('.listing-market-comparison').count(),0);
  assert.equal(await card(bulk.id).locator('.listing-market-value').count(),0);
  await page.goto(base+'/skills');await page.waitForSelector('[data-skill-id="market-intelligence"]');
  assert.match(await page.locator('[data-skill-id="market-intelligence"]').innerText(),/5\s+points/);
  await click('market-intelligence');await page.waitForFunction(()=>document.querySelector('[data-skill-points]')?.textContent==='0');
  assert.equal(accounts.profile(owner).skills.spent,20);assert.equal(await page.locator('.skill-market-intelligence .is-owned').count(),1);
  await page.reload();await page.waitForSelector('.skill-market-intelligence .is-owned');
  for(const width of [1440,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/auction-house');await card(low.id).waitFor();await language(lang);
    assert.match(await card(low.id).locator('.listing-market-comparison').innerText(),lang==='en'?/below market/:/unter Marktwert/);
    assert.match(await card(high.id).locator('.listing-market-comparison').innerText(),lang==='en'?/above market/:/über Marktwert/);
    assert.equal(await card(bulk.id).locator('.listing-market-comparison').count(),0);
    assert.equal(await page.locator('.house-lot[data-economy="primary"] .listing-market-comparison').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} intelligence overflow`);
    assert.ok(await page.locator('.listing-market-value').evaluateAll(rows=>rows.every(row=>row.scrollWidth<=row.clientWidth+1)),`${width} ${lang} market row clipped`);
    if(width===320&&lang==='de')await card(low.id).screenshot({path:'/tmp/jg-intelligence-card-320-de.png'});
    if([1440,320].includes(width))await page.screenshot({path:`/tmp/jg-intelligence-${width}-${lang}.png`,fullPage:true});
  }
  await page.goto(base+'/changelog');await page.waitForSelector('.changelog-list');assert.match(await page.locator('.changelog-list').innerText(),/Market Intelligence/);
  const guest=await browser.newContext({viewport:{width:390,height:900}}),anonymous=await guest.newPage();anonymous.on('pageerror',error=>errors.push(error.message));await anonymous.goto(base+'/skills');await anonymous.waitForSelector('.skill-login');assert.equal(await anonymous.locator('[data-skill-points]').count(),0);
  await anonymous.goto(base+'/auction-house');await anonymous.locator(`.house-lot[data-id="${low.id}"] .listing-market-value`).waitFor();assert.equal(await anonymous.locator('.listing-market-comparison').count(),0);await guest.close();
  await page.goto(base+'/inventory');await page.waitForSelector('.collection-empty');assert.equal(await page.locator('.skill-tree-page').count(),0);
  assert.deepEqual(errors,[]);console.log('Skill tree UI passed: existing-level points, ranks/costs, six future branches, rank IV locked, qualitative Influence, 1440–320px EN/DE without overflow, accepted-response retry, stale-tab reconciliation, persisted upgrades, insufficient-points guard, live luck on cases/palettes, Market Intelligence five-point unlock and single-item comparisons, public market values, varied NPC items, guest gate, sidebar badge and navigation cleanup.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
