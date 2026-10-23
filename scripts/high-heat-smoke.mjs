import {playerHeat,POLICE_CHECK_INTERVAL} from '../src/theft-heat.mjs';
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
const api = await createAccountApi({ dataDir: dir, json, env, flags, policeRandom:()=>0, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
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
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const heat=()=>accounts.db(db=>{playerHeat(db,owner.id);db.prepare('INSERT INTO player_heat VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(owner.id,10,Date.now());db.prepare('UPDATE police_activity_checks SET checked_at=checked_at-?').run(POLICE_CHECK_INTERVAL+1);});
  heat();await page.goto(base+'/profile');await page.waitForSelector('.theft-heat');
  assert.doesNotMatch(await page.locator('.theft-heat').innerText(),/×|multiplier|Multiplikator/);
  assert.match(await page.locator('.heat-risk').innerText(),/15%/);
  await page.goto(base+'/shop');await page.waitForSelector('[data-account="buy-case"]');
  const before=accounts.profile(owner).tokens;
  await page.locator('[data-account="buy-case"]').click();await page.waitForSelector('.police-recognition-content');
  const first=accounts.profile(owner).justice.policeEncounter;assert.ok(first);assert.equal(first.fineMultiplier,30);
  assert.equal(accounts.inventory(owner).length,1);assert.equal(await page.locator('.case-purchase-content').count(),0);
  assert.ok(accounts.profile(owner).tokens<before);assert.equal(accounts.profile(owner).justice.offences,1);
  const language=async lang=>page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);
    assert.doesNotMatch(await page.locator('.police-recognition-content').innerText(),/×|multiplier|Multiplikator/);
    assert.ok(await page.locator('[data-police-choice="pay"]').isEnabled());
    assert.ok(await page.locator('.justice-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if([1440,320].includes(width))await page.locator('.justice-dialog').screenshot({path:`/tmp/jg-police-recognition-${width}-${lang}.png`});
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('.justice-dialog').evaluate(el=>el.open),true);
  await page.reload();await page.waitForSelector('.police-recognition-content');assert.equal(accounts.profile(owner).justice.policeEncounter.id,first.id);
  const cash=accounts.profile(owner).tokens;
  await page.locator('[data-police-choice="pay"]').evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(()=>!account.justice.policeEncounter);
  assert.equal(accounts.profile(owner).tokens,cash-first.fine);assert.equal(accounts.profile(owner).heat.stars,3);
  assert.equal(accounts.profile(owner).justice.offences,1);assert.equal(accounts.inventory(owner).length,1);
  const sealed=accounts.inventory(owner)[0];accounts.db(db=>db.prepare('UPDATE users SET tokens=0 WHERE id=?').run(owner.id));heat();
  await page.goto(base+'/inventory');await page.waitForSelector(`[data-account="open-inventory-case"][data-id="${sealed.id}"]`);
  await page.locator(`[data-account="open-inventory-case"][data-id="${sealed.id}"]`).click();await page.waitForSelector('.police-recognition-content');
  assert.equal(await page.locator('[data-police-choice="pay"]').isDisabled(),true);
  const second=accounts.profile(owner).justice.policeEncounter;assert.equal(second.sentenceMinutes,120);
  assert.equal(accounts.inventory(owner).filter(item=>item.kind==='case').length,0);assert.equal(accounts.inventory(owner).length,1);
  await page.locator('[data-police-choice="jail"]').press('Enter');await page.waitForSelector('[data-jail-countdown]');
  assert.equal(accounts.profile(owner).justice.jailed,true);assert.equal(accounts.profile(owner).tokens,0);assert.equal(accounts.inventory(owner).length,1);
  assert.match(await page.locator('.justice-content').innerText(),/gewählt|chose/);
  for(const route of ['/api/account/inventory','/api/account/net-worth','/api/stores','/api/town'])assert.equal((await context.request.get(base+route)).status(),423);
  for(const width of [1440,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);
    assert.ok(await page.locator('.justice-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if(width===320)await page.locator('.justice-dialog').screenshot({path:`/tmp/jg-police-recognition-jail-${lang}.png`});
  }
  await page.reload();await page.waitForSelector('[data-jail-countdown]');
  accounts.db(db=>db.prepare('UPDATE player_justice SET jailed_until=? WHERE user_id=?').run(Date.now()-1,owner.id));
  await page.locator('[data-justice-check]').click();await page.waitForFunction(()=>!account.justice.jailed);
  await page.goto(base+'/profile?tab=record');await page.waitForSelector('.criminal-record-entry');assert.equal(await page.locator('.criminal-record-entry').count(),2);
  assert.deepEqual(errors,[]);await context.close();console.log('High-Heat UI passed: real committed case purchase/opening followed by recognition; saved items; 30x fine; cash payment once on double click; insufficient-cash jail choice; repeat sentence; persisted non-dismissible encounter and jail; locked economy/account APIs; release; criminal record; EN/DE at desktop/tablet/mobile widths; no JS errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
