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
const dir = await mkdtemp('/tmp/jg-account-admin-ui-');
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const nav=async route=>page.evaluate(route=>navigateAccountPage(route),route);
  const submit=async selector=>{await page.locator(selector+' button[type="submit"]').click();await page.waitForFunction(()=>!accountBusy);};
  const signIn=async(username,password)=>{await nav('/login');await page.locator('[name="username"]').fill(username);await page.locator('[name="password"]').fill(password);await submit('#account-form');};
  const signOut=async()=>{await page.evaluate(async()=>{await accountApi('logout',{});updateAccount(null);await navigateAccountPage('/login');});};
  const tab=async name=>page.locator(`[data-admin-tab="${name}"]`).click();
  await page.goto(base+'/register');await page.waitForSelector('#account-form');
  await page.locator('[name="username"]').fill('SmokePlayer');await page.locator('[name="password"]').fill(env.ADMIN_PASSWORD);await page.locator('[name="code"]').fill('0'.repeat(32));
  await submit('#account-form');assert.ok((await page.locator('#account-form .account-error').innerText()).length);
  await page.locator('[name="code"]').fill(accounts.codes(owner,1)[0]);await submit('#account-form');await page.waitForSelector('.profile-hub');
  const player=await page.evaluate(()=>({id:account.id,tokens:account.tokens}));
  await nav('/admin');assert.equal(await page.locator('.admin-dashboard').count(),0,'ordinary player cannot access admin tools');
  await signOut();assert.ok(await page.locator('#persistent-wallet').isHidden());
  await signIn('SmokePlayer','incorrect-password');assert.ok((await page.locator('#account-form .account-error').innerText()).length);
  await signIn('SmokePlayer',env.ADMIN_PASSWORD);await page.waitForSelector('.profile-hub');
  await signOut();await signIn('admin',env.ADMIN_PASSWORD);await nav('/admin');await page.waitForSelector('.admin-dashboard');
  // All admin tabs remain keyboard reachable, in both languages on phones.
  for(const width of [1440,390,320])for(const language of ['en','de']){
    await page.setViewportSize({width,height:1000});
    await page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},language);
    for(const name of ['market','players','auctions','access','rebates','maintenance']){
      await tab(name);assert.ok(await page.locator(`[data-admin-panel="${name}"]`).isVisible());
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`admin ${name} ${language} ${width} overflow`);
    }
    await page.locator('[data-admin-tab="maintenance"]').focus();await page.keyboard.press('Home');
    assert.equal(await page.locator('[data-admin-tab="market"]').getAttribute('aria-selected'),'true');
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-admin-tab="players"]').getAttribute('aria-selected'),'true');
  }
  await page.setViewportSize({width:1440,height:1000});
  await tab('players');await page.locator('#user-search').fill('does-not-exist');assert.equal(await page.locator('.user-row').count(),0);
  await page.locator('#user-search').fill('SmokePlayer');assert.equal(await page.locator('.user-row').count(),1);
  await page.locator('#grant-amount').fill('125');await page.locator(`[data-account="grant-user"][data-id="${player.id}"]`).click();await page.waitForFunction(()=>!accountBusy);
  assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(player.id).tokens),player.tokens+125);
  await page.locator(`[data-account="ban-toggle"][data-id="${player.id}"]`).click();await page.waitForFunction(()=>!accountBusy);
  assert.equal(accounts.db(db=>db.prepare('SELECT banned FROM users WHERE id=?').get(player.id).banned),1);
  await page.locator(`[data-account="ban-toggle"][data-id="${player.id}"]`).click();await page.waitForFunction(()=>!accountBusy);
  assert.equal(accounts.db(db=>db.prepare('SELECT banned FROM users WHERE id=?').get(player.id).banned),0);
  await tab('auctions');
  const newest=await page.evaluate(async ids=>{
    const api=accountApi;let release;
    const gate=new Promise(resolve=>{release=resolve;});
    accountApi=async path=>{const result=await api(path);if(path.includes('query='+ids[0]))await gate;return result;};
    try{
      accountAuctions.query=String(ids[0]);const old=loadAuctionBrowser(accountVisit);
      accountAuctions.query=String(ids[1]);await loadAuctionBrowser(accountVisit);
      release();await old;return accountAuctions.auctions.map(auction=>String(auction.id));
    }finally{release();accountApi=api;}
  },[seed.auctions[0].id,seed.auctions[1].id]);
  assert.deepEqual(newest,[String(seed.auctions[1].id)],'late archive reply cannot overwrite the latest search');
  await page.locator('#auction-search').fill(String(seed.auctions[0].id));
  await page.waitForFunction(id=>accountAuctions.query===id&&accountAuctions.auctions.length===1,String(seed.auctions[0].id));
  await page.locator('[data-account="auction-detail"]').click();await page.waitForSelector('.auction-reveal[open]');
  await page.locator('[data-account="close-auction"]').click();
  await tab('access');await page.locator('#code-form [name="count"]').fill('2');await submit('#code-form');
  assert.equal((await page.locator('.fresh-codes textarea').inputValue()).split('\n').length,2);
  const revoke=page.locator('[data-account="revoke"]').first(),revokeId=await revoke.getAttribute('data-id');await revoke.click();await page.waitForFunction(()=>!accountBusy);
  assert.equal(await page.locator(`[data-account="revoke"][data-id="${revokeId}"]`).count(),0);
  await tab('players');await page.locator('#user-search').fill('SmokePlayer');
  await page.locator(`[data-account="password-reset"][data-id="${player.id}"]`).click();await page.waitForFunction(()=>!accountBusy);
  const temporary=await page.locator('#admin-panel-players .fresh-codes textarea').inputValue();assert.ok(temporary.length>=12);
  await signOut();await signIn('SmokePlayer',temporary);await page.waitForSelector('#password-change-form');
  await nav('/inventory');assert.ok(await page.locator('#password-change-form').isVisible(),'temporary session must change password');
  await page.locator('[name="currentPassword"]').fill(temporary);await page.locator('[name="newPassword"]').fill('smoke-updated-password');await submit('#password-change-form');await page.waitForSelector('.profile-hub');
  await signOut();await signIn('SmokePlayer','smoke-updated-password');await page.waitForSelector('.profile-hub');
  assert.deepEqual(errors,[]);await context.close();
  console.log('Account/admin passed: invitation validation and registration, failed/successful login, logout privacy, role protection, keyboard tabs and EN/DE at 1440/390/320px, search/detail and stale reply handling, grants, bans, invite creation/revocation, temporary-password reset and forced password change.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
