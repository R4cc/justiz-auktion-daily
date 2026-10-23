// Optional browser regression check with isolated data; npm test needs no browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';
import { tickEconomy } from '../src/economy-runtime.mjs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(),'jg-loading-'));
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
accounts.db(db=>{db.exec('BEGIN');const insert=db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)');for(let n=0;n<5000;n++)insert.run('large-'+n,owner.id,JSON.stringify({title:'Synthetic wine '+n,price:100,marketCategory:'wine',rarity:'common'}),Date.now());db.exec('COMMIT');});
let tickOnRequest=false,tickMs=0;
const loop=monitorEventLoopDelay({resolution:1});loop.enable();
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if(tickOnRequest&&url.pathname==='/api/account/me'){tickOnRequest=false;const start=performance.now();tickEconomy(dir);tickMs=performance.now()-start;}
    if (await api(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const buf = await readFile(path.join(root,process.env.WEB_BUILD==='1'?'web-build':'dist',filename));
    res.writeHead(200, { 'content-security-policy': "default-src 'self'; img-src 'self' data: https://www.justiz-auktion.de https://i.imgur.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'", 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), headless: true, args: ['--no-sandbox'] });
try {
  const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),errors=[];
  await context.addCookies([{name:'jg_session',value:token,url:base}]);
  page.on('pageerror',error=>errors.push(error.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  let requests=[],bodies=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/'))bodies.push(response.body().then(body=>body.length).catch(()=>0));});
  await page.route('**/api/**',async route=>{await new Promise(resolve=>setTimeout(resolve,100));await route.continue();});
  const measure=async(route,selector,cold=false,tick=false)=>{
    requests=[];bodies=[];loop.reset();tickOnRequest=tick;tickMs=0;
    const start=performance.now();
    if(cold)await page.goto(base+route,{waitUntil:'domcontentloaded'});else await page.evaluate(route=>navigateAccountPage(route),route);
    await page.waitForSelector(selector);
    const routeReadyMs=+(performance.now()-start).toFixed(1),payloads=await Promise.all(bodies);
    console.log(JSON.stringify({route,cold,tick,routeReadyMs,apiRequests:requests.filter(url=>url.startsWith('/api/')).length,apiBytes:payloads.reduce((a,b)=>a+b,0),eventLoopMaxMs:+(loop.max/1e6).toFixed(1),tickMs:+tickMs.toFixed(1)}));
  };
  await measure('/stores','.market-store-card',true);
  for(let sample=0;sample<3;sample++){
    await measure('/businesses','.business-shop');
    await measure('/stores?shop='+tech.id,'.visitor-stock-card');
    await measure('/stores?shop='+wine.id,'.shop-overview-actions');
  }
  await measure('/businesses','.business-shop',false,true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({runtime:process.version,viewport:390,cpuSlowdown:4,apiDelayMs:100,build:process.env.WEB_BUILD==='1'?'production':'source',fixture:'synthetic 5000-item owner; local server, no production tunnel'}));
}finally{
  loop.disable();await browser.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));
  closeDataStore(dir);await rm(dir,{recursive:true,force:true});
}
