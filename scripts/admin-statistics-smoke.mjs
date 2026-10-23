// Account/admin browser smoke uses an isolated database and synthetic players.
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
import { featureFlags } from '../src/features.mjs';
import { createSiteUsageTracker } from '../src/site-usage.mjs';
import { adminStatistics } from '../src/admin-statistics.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(),'jg-account-admin-ui-'));
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const siteUsage=createSiteUsageTracker({dataDir:dir});
const api = await createAccountApi({ dataDir: dir, json, env, flags, siteUsage, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const periodNow=Date.now();
accounts.db(db=>{db.prepare('UPDATE site_usage_meta SET started_at=? WHERE id=1').run(periodNow-17*86400000);for(let n=0;n<18;n++){
 const id='stats-'+n,createdAt=periodNow-n*86400000,day=new Date(createdAt).toISOString().slice(0,10);
 db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at,banned) VALUES(?,?,'disabled',?,?,?,?)").run(id,n===0?'<img src=x onerror=alert(1)>':'Player '+n,100*n,100*n*n,createdAt,Number(n===4));
 for(let game=0;game<=n%4;game++)db.prepare('INSERT INTO account_games VALUES(?,?,?,?,?,?)').run(id+'-'+game,id,day,game%2?'higher-lower':'daily',Number(game%2===0),'{}');
 db.prepare('INSERT INTO site_usage_daily VALUES(?,?,?,?,?,?)').run(day,'/api/account',10*(n+1),n%3,0,30*(n+1));
}});
const playerToken=await accounts.register({username:'StatsViewer',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]});
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');siteUsage.observe(req,res,url);
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
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[],statisticsRequests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/admin/statistics?'))statisticsRequests.push(request.url());});
 await context.addCookies([{name:'jg_session',value:token,url:base}]);await page.goto(base+'/admin');await page.waitForSelector('.admin-dashboard');
 assert.equal(statisticsRequests.length,0,'statistics load only when selected');
 await page.locator('[data-admin-tab="statistics"]').click();await page.waitForSelector('[data-admin-statistics][aria-busy="false"] .admin-stats-metric');
 assert.match(page.url(),/tab=statistics/);assert.equal(statisticsRequests.length,1);
 const accountsExpected=adminStatistics(dir,owner).users.total;
 assert.equal(await page.locator('.admin-stats-metric').filter({hasText:/^Player accounts/}).locator('strong').innerText(),String(accountsExpected));
 assert.equal(await page.locator('.admin-stats-table img').count(),0);assert.match(await page.locator('.admin-stats-table').last().innerText(),/<img src=x/);
 await page.locator('[data-admin-stats-days]').selectOption('7');await page.waitForSelector('[data-admin-statistics][aria-busy="false"]');assert.equal(await page.locator('.admin-stats-bars').first().locator('span').count(),7);
 await page.locator('[data-admin-stats-days]').focus();await page.selectOption('[data-admin-stats-days]','30');await page.waitForSelector('[data-admin-statistics][aria-busy="false"]');assert.ok(await page.locator('[data-admin-stats-days]').evaluate(el=>document.activeElement===el));await page.selectOption('[data-admin-stats-days]','7');await page.waitForSelector('[data-admin-statistics][aria-busy="false"]');
 const language=async lang=>page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
 for(const width of [1920,1440,1024,900,768,600,390,320])for(const lang of ['en','de']){
  await page.setViewportSize({width,height:1100});await language(lang);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' '+lang+' fits');
  assert.ok(await page.locator('[data-admin-stats-days]').isVisible());assert.ok(await page.locator('[data-admin-stats-refresh]').evaluate(el=>el.getBoundingClientRect().height>=44));
  if(lang==='en'&&[1440,390,320].includes(width)){await page.locator('[data-notification="dismiss"]').evaluateAll(nodes=>nodes.forEach(node=>node.click()));await page.screenshot({path:path.join(os.tmpdir(),'admin-statistics-'+width+'.png'),fullPage:true});}
 }
 await language('en');await page.setViewportSize({width:1440,height:1100});await page.goto(base+'/admin?tab=statistics');await page.waitForSelector('.admin-stats-metric');assert.equal(await page.locator('[data-admin-tab="statistics"]').getAttribute('aria-selected'),'true');
 await page.locator('[data-admin-tab="maintenance"]').focus();await page.keyboard.press('Home');assert.equal(await page.locator('[data-admin-tab="statistics"]').getAttribute('aria-selected'),'true');await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-admin-tab="market"]').getAttribute('aria-selected'),'true');
 await page.locator('[data-admin-tab="statistics"]').click();
 await page.route('**/api/account/admin/statistics?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'try_later'})}));
 await page.locator('[data-admin-stats-refresh]').click();await page.waitForSelector('[data-admin-statistics] [role="alert"]');assert.ok(await page.locator('[data-admin-stats-refresh]').isEnabled());
 await page.unroute('**/api/account/admin/statistics?*');await page.locator('[data-admin-stats-refresh]').click();await page.waitForSelector('[data-admin-statistics][aria-busy="false"]');assert.equal(await page.locator('[data-admin-statistics] [role="alert"]').count(),0);
 let release;const gate=new Promise(resolve=>{release=resolve;});const report=adminStatistics(dir,owner);await page.route('**/api/account/admin/statistics?*',async route=>{await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify(report)});});
 const requested=page.waitForRequest(request=>request.url().includes('/admin/statistics?'));await page.locator('[data-admin-stats-refresh]').click();await requested;
 await page.evaluate(()=>navigateAccountPage('/profile'));const late=page.waitForResponse(response=>response.url().includes('/admin/statistics?'));release();await late;await page.waitForSelector('.profile-hub');assert.equal(await page.locator('[data-admin-statistics]').count(),0);await page.unroute('**/api/account/admin/statistics?*');
 const regular=await browser.newContext(),regularPage=await regular.newPage();await regular.addCookies([{name:'jg_session',value:playerToken,url:base}]);await regularPage.goto(base+'/admin?tab=statistics');await regularPage.waitForFunction(()=>pageLoaded);assert.equal(await regularPage.locator('[data-admin-tab="statistics"],[data-admin-statistics]').count(),0);assert.equal((await regularPage.request.get(base+'/api/account/admin/statistics')).status(),403);await regular.close();
 const guest=await browser.newContext(),guestPage=await guest.newPage();assert.equal((await guestPage.request.get(base+'/api/account/admin/statistics')).status(),401);await guest.close();
 assert.deepEqual(errors,[]);console.log('Admin statistics browser checks passed: lazy loading, live aggregates, periods, charts, escaped usernames, deep links, keyboard tabs, EN/DE 320–1920px, failure/retry, stale replies and guest/player access boundaries.');
}finally{await browser.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));siteUsage.close();closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
