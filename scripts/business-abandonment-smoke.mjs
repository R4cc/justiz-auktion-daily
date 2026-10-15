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
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { townMap } from '../src/town-map.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-town-redesign-');
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
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const before=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get('mira').tokens);
  accounts.db(db=>db.prepare('UPDATE businesses SET last_restock_at=?,cash_balance=90 WHERE id=?').run(Date.now()-20*86400000-60000,tech.id));
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:width<800?844:1000});
    await page.goto(base+'/town?view=open&display=list&plot='+tech.location.plotId);
    await page.waitForSelector('.town-page');
    await page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
    const buy=page.locator('.town-selection [data-town-open]');await buy.waitFor({state:'visible'});
    assert.match(await buy.innerText(),lang==='de'?/Verlassenen Laden kaufen/:/Purchase abandoned store/);
    await buy.focus();await page.keyboard.press('Enter');
    await page.locator('dialog[open] .town-purchase').waitFor();
    assert.ok(await page.locator('dialog[open] button[type=submit]').isEnabled());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${lang} page overflow`);
    assert.ok(await page.locator('dialog[open]').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${width} ${lang} modal overflow`);
    await page.screenshot({path:`/tmp/abandoned-store-${width}-${lang}.png`,fullPage:true});
    await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
  }
  const denied=await context.request.post(base+'/api/account/businesses/takeover',{data:{shopId:tech.id,expectedPrice:1200,requestId:'csrf-abandonment-0001'}});
  assert.equal(denied.status(),403);
  await page.goto(base+'/stores?shop='+tech.id);await page.waitForSelector('.shop-header');
  await page.locator('.shop-header a[href^="/town?plot="]').last().click();await page.waitForSelector('.town-page');
  await page.locator('.town-selection [data-town-open]').click();
  const resultPromise=page.waitForResponse(r=>r.url().endsWith('/api/account/businesses/takeover')&&r.request().method()==='POST');
  await page.locator('dialog[open] button[type=submit]').click();
  const response=await resultPromise;assert.equal(response.status(),200);const result=await response.json();
  await page.waitForSelector('.business-shop');assert.equal(await page.locator('.business-shop').count(),3);
  assert.equal(result.shop.type,'electronics');assert.equal(result.shop.abandoned,false);assert.equal(result.shop.stock.length,0);
  const after=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get('mira').tokens);assert.equal(after,before+90);
  assert.equal(accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE id LIKE ? AND user_id=? AND sold_at IS NULL').get('tech-%','mira').n),3);
  assert.equal(accounts.db(db=>db.prepare('SELECT retired FROM businesses WHERE id=?').get(tech.id).retired),1);
  await page.goto(base+'/changelog');await page.waitForSelector('.changelog-page');assert.match(await page.locator('.changelog-page').innerText(),/Store Activity & Balance/);
  assert.deepEqual(errors,[]);await context.close();
  console.log('Abandoned-store UI passed EN/DE at 1440, 768, 390 and 320px; keyboard, CSRF, takeover, returned assets and changelog verified.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
