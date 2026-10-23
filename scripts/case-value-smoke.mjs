import {loadCaseStoreCatalog,STORE_CASES} from '../src/case-store.mjs';
import {prepareMysteryCase,insertSealedCase} from '../src/sealed-cases.mjs';
import {acquireItems} from '../src/trader.mjs';
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
// Force only the legacy upgrade's random branch in this isolated fixture.
// Purchased cases still use the production private draw and saved outcome.
const realOpen=Accounts.prototype.openSealedCase;
Accounts.prototype.openSealedCase=function(user,id){return realOpen.call(this,user,id,{random:max=>Math.floor(max*.75)});};
upsertAuctions(dir,Array.from({length:150},(_,n)=>({id:90000+n,title:`Laptop model ${90000+n}`,category:'Elektronik',finalPrice:n?50*n:11,image:'/favicon.png'})));
const catalog=loadCaseStoreCatalog(dir),old=prepareMysteryCase(catalog,STORE_CASES[4],{random:()=>0});
old.item.title='Existing unopened case';old.item.titleDe='Bestehende ungeöffnete Kiste';old.item.caseCost=2000;
old.reward={...old.reward,title:'Old cheap wine',price:11,sellValue:11,rarity:'common',marketCategory:'wine',caseCost:2000};
accounts.atomic(db=>{insertSealedCase(db,owner.id,old);acquireItems(db,owner.id,[old.item.id],2000,'purchase',Date.now());});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  await page.goto(base+'/shop');await page.waitForSelector('.case-selector');
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});
    await page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
    for(const definition of STORE_CASES){
      await page.locator(`[data-account="select-store-case"][data-id="${definition.id}"]`).click();
      const correct=await page.evaluate(()=>{
        const box=accountStore.cases.find(box=>box.id===accountSelectedStoreCase),labels=[...document.querySelectorAll('.case-odds-list dd')].map(node=>node.textContent);
        return labels.every((label,index)=>label===caseChanceLabel(box.dropChances[index].percent)&&Number(label.replace(',','.').replace('%',''))>0)
          &&accountStore.cases.every((offer,index,list)=>!index||offer.dropChances.at(-1).percent>list[index-1].dropChances.at(-1).percent);
      });assert.equal(correct,true);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    if(width===320)await page.locator('.case-showcase-info').screenshot({path:`/tmp/jg-case-value-odds-${lang}.png`});
  }
  const before=accounts.profile(owner).tokens;
  await page.locator('[data-account="buy-case"]').click();await page.waitForSelector('.case-purchase-content');
  const bought=accounts.inventory(owner).find(item=>item.caseBalanceVersion===1);
  assert.ok(bought);assert.equal(accounts.profile(owner).tokens,before-bought.caseCost);
  const frozen=accounts.db(db=>JSON.parse(db.prepare('SELECT reward FROM sealed_cases WHERE inventory_id=?').get(bought.id).reward));
  await page.locator('.case-reveal [data-account="open-inventory-case"]').click();await page.waitForSelector('.case-unboxed');
  const opened=accounts.inventory(owner).find(item=>item.id===frozen.id);assert.equal(opened.auctionId,frozen.auctionId);assert.equal(opened.price,frozen.price);
  for(const width of [1440,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});
    await page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
    assert.equal(await page.locator('.case-reveal-actions a').count(),0);
    assert.equal(await page.locator('.case-reveal-actions button').count(),2);
    assert.equal(await page.locator('.case-reveal-actions [data-account="close-reveal"]').innerText(),lang==='en'?'Continue':'Weiter');
    assert.ok(await page.locator('.case-reveal[open]').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.locator('.case-reveal[open]').screenshot({path:`/tmp/jg-case-modal-actions-${width}-${lang}.png`});
  }
  const cashBeforeRepeat=accounts.profile(owner).tokens,sealedBeforeRepeat=accounts.inventory(owner).filter(item=>item.kind==='case').length;
  await page.locator('.case-reveal-actions [data-account="buy-case"]').click();await page.waitForSelector('.case-purchase-content');
  assert.equal(accounts.profile(owner).tokens,cashBeforeRepeat-bought.caseCost);
  assert.equal(accounts.inventory(owner).filter(item=>item.kind==='case').length,sealedBeforeRepeat+1);
  await page.locator('.case-reveal-actions [data-account="close-reveal"]').click();
  await page.goto(base+'/inventory');await page.waitForSelector(`[data-account="open-inventory-case"][data-id="${old.item.id}"]`);
  await page.locator(`[data-account="open-inventory-case"][data-id="${old.item.id}"]`).click();await page.waitForSelector('.case-unboxed');
  const upgraded=accounts.inventory(owner).find(item=>item.id===old.reward.id);
  assert.ok(upgraded.estimatedValueTokens>=1000);assert.equal(upgraded.caseCost,2000);
  const replay=await page.evaluate(async id=>(await accountApi('inventory/case/open',{id})).item,old.item.id);
  assert.equal(replay.id,upgraded.id);assert.equal(replay.price,upgraded.price);
  await page.locator('.case-reveal[open]').screenshot({path:'/tmp/jg-case-value-existing-upgrade.png'});
  assert.deepEqual(errors,[]);await context.close();
  console.log('Case value UI passed: all five actual rarity odds, EN/DE at 1440/768/390/320px; private paid draw matches confirmed opening; actual cost; existing cheap unopened case upgrades through the normal inventory flow; persistent retry; no overflow or JS errors.');
}finally{Accounts.prototype.openSealedCase=realOpen;await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
