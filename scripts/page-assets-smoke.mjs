// Route asset regression with isolated data; no production account or data is used.
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
import { tickMarketDrift } from '../src/market.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-palette-ui-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const varieties=['Riesling','Merlot','Cabernet','Chardonnay','Pinot','Bordeaux','Barolo','Rioja','Malbec','Chianti'];
upsertAuctions(dir,varieties.map((name,index)=>({id:82000+index,title:name+' Wine',category:'Getränke',finalPrice:10*(index+1)**2,image:'/assets/makita.jpg'})));
tickMarketDrift(dir,{now:Date.now()-48*3600_000});tickMarketDrift(dir);
const shop=buyBusiness(dir,owner,'wine','popup').shop;
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
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requested=[],externalFonts=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{requested.push(new URL(request.url()).pathname);if(/https:\/\/fonts\.(?:googleapis|gstatic)\.com/.test(request.url()))externalFonts.push(request.url());});
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  await page.goto(base+'/');await page.waitForSelector('.daily-home');
  for(const asset of ['/store-ui.js','/town-ui.js','/profile-ui.js','/economy-ui.js','/trader-ui.js','/market-trend.js','/store-reputation-ui.js','/town.css','/profile.css'])assert.ok(!requested.includes(asset),`${asset} loaded on Daily`);
  const routes=['/town','/businesses','/stores?shop='+shop.id,'/inventory','/auction-house','/market','/profile','/skills','/changelog','/leaderboard','/shop','/admin'];
  for(const route of routes){
    await page.evaluate(path=>navigateAccountPage(path),route);
    assert.ok(await page.evaluate(()=>pageLoaded),`${route} did not load`);
    assert.equal(await page.locator('#account-content h1').count(),1,route);
    assert.equal(await page.locator('#account-content .account-error').filter({hasText:/ReferenceError|not defined|load_failed/}).count(),0,route);
  }
  await page.evaluate(()=>{window.firstProfileUi=window.profileUi;});
  await page.evaluate(()=>navigateAccountPage('/profile'));
  assert.ok(await page.evaluate(()=>window.profileUi===window.firstProfileUi),'SPA navigation must not execute scripts again');
  for(const width of [1440,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});
    await page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
    for(const route of ['/town','/inventory','/auction-house','/profile']){
      await page.evaluate(path=>navigateAccountPage(path),route);
      assert.ok(await page.evaluate(()=>pageLoaded),`${route} ${lang} ${width}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} ${lang} ${width} overflow`);
    }
  }
  const direct=await context.newPage(),sessions=[];
  direct.on('pageerror',error=>errors.push(error.message));direct.on('request',request=>{if(new URL(request.url()).pathname==='/api/account/me')sessions.push(request.url());});
  await direct.goto(base+'/profile');await direct.waitForSelector('.profile-hub');
  assert.equal(sessions.length,1,'direct entry must reuse its freshly fetched session');
  await direct.evaluate(()=>navigateAccountPage('/town'));assert.equal(sessions.length,2,'later navigation must refresh the session');
  // A failed dependency must be retryable without reloading the whole app.
  const recoveryContext=await browser.newContext(),recovery=await recoveryContext.newPage(),recoveryErrors=[];
  recovery.on('pageerror',error=>recoveryErrors.push(error.message));
  await recoveryContext.addCookies([{name:'jg_session',value:token,url:base}]);
  await recovery.goto(base+'/');await recovery.waitForSelector('.daily-home');
  await recovery.route('**/shop-ui.js?*',route=>route.abort());
  await recovery.evaluate(()=>navigateAccountPage('/town'));
  assert.equal(await recovery.evaluate(()=>pageLoaded),false,'failed feature load shows a retryable error');
  await recovery.unroute('**/shop-ui.js?*');
  await recovery.evaluate(()=>navigateAccountPage('/town'));
  assert.ok(await recovery.evaluate(()=>pageLoaded),'retry recovers after a dependency download fails');
  assert.equal(await recovery.locator('#account-content h1').count(),1);
  assert.deepEqual(recoveryErrors,[],'failed dependency must not execute dependent scripts');
  await recovery.route('**/profile.css?*',route=>route.abort());
  await recovery.evaluate(()=>navigateAccountPage('/profile'));
  assert.equal(await recovery.evaluate(()=>pageLoaded),false,'failed stylesheet shows a retryable error');
  await recovery.unroute('**/profile.css?*');
  await recovery.evaluate(()=>navigateAccountPage('/profile'));
  assert.ok(await recovery.evaluate(()=>pageLoaded),'retry recovers after a stylesheet download fails');
  await recovery.evaluate(()=>Promise.all([navigateAccountPage('/town'),navigateAccountPage('/inventory'),navigateAccountPage('/profile')]));
  assert.ok(await recovery.locator('.profile-hub').isVisible(),'latest navigation wins');
  assert.deepEqual(recoveryErrors,[]);
  await recoveryContext.close();
  assert.deepEqual(errors,[]);assert.deepEqual(externalFonts,[]);
  console.log('Page assets passed: Daily skips unused feature assets; all 12 routes load their dependencies; scripts execute once; direct/SPA session freshness; dependency/stylesheet failure retries and rapid navigation; EN/DE at 1440/390/320px; no overflow or JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
