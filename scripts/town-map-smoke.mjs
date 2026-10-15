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
 page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
 const shot=async name=>{await page.locator('[data-notification="dismiss"]').evaluateAll(nodes=>nodes.forEach(node=>node.click()));await page.screenshot({path:'/tmp/town-redesign-'+name+'.png',fullPage:!name.startsWith('purchase')});};
 const go=async route=>{await page.goto(base+route);await page.waitForSelector('.town-page');};
 const language=async lang=>page.locator('#language-select').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
 const filter=async()=>{const details=page.locator('.town-filters');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
 const fits=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' horizontal overflow');
 const select=async id=>{await page.locator(`[data-town-select="${id}"]`).filter({visible:true}).click();await page.waitForSelector('.town-preview');};
 const close=async()=>{if(await page.locator('.town-preview').count())await page.locator('[data-town-clear]').click();};
 const plotQuote=()=>townMap(dir,owner);
 await go('/town?view=shops');
 assert.equal(await page.locator('.town-district-chip').count(),6);assert.equal(await page.locator('.town-pin').count(),0);
 assert.equal(await page.locator('.town-preview').count(),0,'no unused empty sidebar');
 assert.ok(await page.locator('.town-map-shell').isVisible());await shot('overview-1440');
 // Each district drills down to exactly its durable server plots.
 for(const district of plotQuote().districts){
   await page.locator(`[data-town-area="${district.id}"]`).click();
   const ids=plotQuote().plots.filter(p=>p.districtId===district.id).map(p=>p.id).sort();
   assert.deepEqual((await page.locator('.town-pin').evaluateAll(nodes=>nodes.map(n=>n.dataset.townSelect))).sort(),ids);
   assert.ok(await page.locator('.town-map-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),'100% fits the neighborhood');
   for(const pin of await page.locator('.town-pin').all()){
     const geometry=await pin.boundingBox();assert.ok(geometry.width>=44&&geometry.height>=44,'markers have usable hit targets');
     assert.ok(await pin.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'marker center is not covered');
   }
   await page.locator('[data-town-fit]').click();assert.equal(await page.locator('.town-district-chip').count(),6);
 }
 // Selection and zoom keep the same live canvas and keyboard focus.
 await page.locator('[data-town-area="leopoldstadt"]').click();
 await page.evaluate(()=>window.smokeCanvas=document.querySelector('.town-canvas'));
 await select(wine.location.plotId);assert.ok(await page.evaluate(()=>window.smokeCanvas===document.querySelector('.town-canvas')));
 assert.ok(await page.locator('.town-selection a.primary-button').isVisible());await shot('selected-1440');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.town-preview').count(),0);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.townSelect),wine.location.plotId);
 await page.locator('.town-map-scroll').focus();await page.keyboard.press('+');await page.keyboard.press('+');
 assert.equal(await page.locator('.town-canvas').getAttribute('data-zoom'),'3');
 assert.ok(await page.locator('.town-map-scroll').evaluate(el=>document.activeElement===el),'keyboard zoom keeps map focus');
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
 assert.ok(await page.locator('.town-map-scroll').evaluate(el=>el.scrollLeft>0||el.scrollTop>0));
 await page.keyboard.press('-');assert.equal(await page.locator('.town-canvas').getAttribute('data-zoom'),'2');
 await page.locator('[data-town-zoom="1"]').click();
 await page.locator('.town-map-scroll').evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});

 const drag=await page.locator('.town-map-scroll').boundingBox();await page.mouse.move(drag.x+drag.width-15,drag.y+20);await page.mouse.down();await page.mouse.move(drag.x+drag.width-120,drag.y+20,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('.town-map-scroll').scrollLeft>0,{},{timeout:3000});
 assert.ok(await page.locator('.town-map-scroll').evaluate(el=>el.scrollLeft>0),'mouse drag pans the map');

 await page.locator('.town-map-scroll').evaluate(el=>{el.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));});
 assert.equal(await page.locator('.town-map-scroll.is-dragging').count(),0);
 // My stores has one direct list; visiting and returning preserves mode and scroll.
 await page.locator('[data-town-view="mine"]').click();assert.equal(await page.locator('.town-place-row').count(),2);assert.ok(await page.locator('.town-place-directory').isVisible());
 await select(wine.location.plotId);await page.locator('.town-selection a.primary-button').click();await page.waitForSelector('.shop-header');
 await page.locator('.shop-back').click();await page.waitForSelector('.town-page');
 assert.equal(await page.locator('[data-town-view="mine"]').getAttribute('aria-pressed'),'true');assert.ok(await page.locator('.town-place-directory').isVisible());
 assert.ok(await page.locator('.town-preview').isVisible());await close();
 // List / map handoff keeps selection and opens its neighborhood.
 await select(wine.location.plotId);await page.locator('[data-town-display="map"]').click();
 assert.ok(await page.locator('.town-pin.is-selected').isVisible());assert.match(page.url(),/district=leopoldstadt/);
 await page.locator('[data-town-zoom="1"]').click();
 const pan=await page.locator('.town-map-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;el.scrollTop=el.scrollHeight;return {x:el.scrollLeft,y:el.scrollTop};});
 await page.locator('.town-selection a.primary-button').click();await page.waitForSelector('.shop-header');await page.locator('.shop-back').click();await page.waitForSelector('.town-page');
 const returned=await page.locator('.town-map-scroll').evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}));assert.ok(Math.abs(returned.x-pan.x)<2&&Math.abs(returned.y-pan.y)<2,'return restores pan '+JSON.stringify({pan,returned,url:page.url()}));await close();
 // Filters apply equally to map/list and offer a useful empty-state recovery.
 await go('/town?view=shops&display=list');await filter();await page.locator('[data-town-type]').selectOption('electronics');
 assert.equal(await page.locator('.town-place-row').count(),1);await page.locator('[data-town-district]').selectOption('neubau');
 assert.equal(await page.locator('.town-place-row').count(),0);assert.ok(await page.locator('.town-empty [data-town-reset]').filter({visible:true}).isVisible());
 await page.locator('.town-empty [data-town-reset]').filter({visible:true}).click();assert.equal(await page.locator('.town-place-row').count(),25);
 // Both languages, phone through 4K, overview, district, list and selected cards.
 for(const width of [320,390,600,768,1024,1440,3840])for(const lang of ['en','de']){
   await page.setViewportSize({width,height:width<=600?844:1000});await go('/town?view=shops');await language(lang);await fits(`${width} ${lang} overview`);
   for(const chip of await page.locator('.town-district-chip').all())assert.ok(await chip.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${width} district signs do not overlap`);
   if([390,1440].includes(width)&&lang==='en')await shot('overview-'+width);
   await page.locator('[data-town-area="favoriten"]').click();await fits(`${width} ${lang} district`);
   await page.locator('.town-pin').first().click();await fits(`${width} ${lang} selection`);
   const card=await page.locator('.town-selection').boundingBox();if(width<=1000)assert.ok(card.y>=0&&card.y+card.height<=(width<=600?844:1000)+1,'selection is inside viewport '+JSON.stringify({width,lang,card}));
   if([390,1440].includes(width)&&lang==='en')await shot('selected-'+width);
   await close();await page.locator('.town-pin').last().click();
   if(width<=1000)assert.ok(await page.locator('.town-pin.is-selected').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'selection card does not cover the selected marker');
   await close();await page.locator('[data-town-display="list"]').click();await fits(`${width} ${lang} list`);
   assert.equal(await page.locator('.town-place-row').count(),5);
 }
 // Bad links and corrupt session state normalize to a usable map.
 for(const suffix of ['?zoom=not-a-number','?zoom=1.5','?zoom=Infinity','?district=no-such-district&view=wrong&type=wrong&plot=missing','?display=wrong&zoom=-5']){
   await go('/town'+suffix);assert.ok(await page.locator('.town-canvas').isVisible());assert.doesNotMatch(await page.locator('.town-zoom').innerText(),/NaN|undefined/);await fits(suffix);
 }
 await page.evaluate(()=>sessionStorage.setItem(`jg:town:${account.id}`,'null'));await go('/town');assert.equal(await page.locator('.town-district-chip').count(),6);
 // A failed town read displays the existing page retry and recovers in place.
 await page.route('**/api/town',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporarily_unavailable'})}));
 await page.goto(base+'/town');await page.waitForSelector('[data-account="refresh"]');await page.unroute('**/api/town');
 await page.locator('[data-account="refresh"]').click();await page.waitForSelector('.town-page');
 // Native touch panning works without intercepting taps on store markers.
 const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),tp=await touch.newPage();
 tp.on('pageerror',e=>errors.push(e.message));await tp.goto(base+'/town?district=leopoldstadt&zoom=3');await tp.waitForSelector('.town-pin');
 const touchMap=await tp.locator('.town-map-scroll').boundingBox(),cdp=await touch.newCDPSession(tp),tx=touchMap.x+touchMap.width-15,ty=touchMap.y+25;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty,id:1}]});
 for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-n*20,y:ty,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await tp.waitForFunction(()=>document.querySelector('.town-map-scroll').scrollLeft>0,{},{timeout:5000});await touch.close();
 // An obsolete delayed map reply must not replace another account page.
 let release,started;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
 const snapshot=plotQuote();await page.route('**/api/town',async route=>{started();await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify(snapshot)});});
 const oldNavigation=page.evaluate(()=>navigateAccountPage('/town'));await ready;await page.evaluate(()=>navigateAccountPage('/profile'));release();await oldNavigation;
 assert.ok(await page.locator('.profile-hub').isVisible());assert.equal(await page.locator('.town-page').count(),0);await page.unroute('**/api/town');
 // Purchase prices/capacity are visible before review for all six store types.
 await page.setViewportSize({width:390,height:844});await go('/town?view=open');await language('en');
 const free=plotQuote().plots.find(p=>!p.occupied&&p.size==='popup');await select(free.id);await page.locator('[data-town-open]').click();await page.waitForSelector('.town-purchase-dialog[open]');
 assert.equal(await page.locator('.town-type-price').count(),6);
 for(const type of plotQuote().types){
   await page.locator(`.town-type-choice [value="${type.id}"]`).check();
   assert.equal(await page.locator('.town-buy-summary>strong').innerText(),await page.evaluate(v=>justizEuro(v),free.costs[type.id]));
   assert.ok(await page.locator('.town-buy-summary').isVisible());
 }
 await shot('purchase-390');await page.locator('[data-town-review]').click();assert.ok(await page.locator('.town-purchase [type="submit"]').isVisible());
 await page.locator('[data-town-back]').click();assert.ok(await page.locator('.town-type-grid').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('.town-purchase-dialog[open]').count(),0);await close();
 // Low balances, level locks and guests cannot submit purchases.
 const before=accounts.profile(owner).tokens;accounts.db(db=>db.prepare('UPDATE users SET tokens=1 WHERE id=?').run(owner.id));
 await go('/town?plot='+free.id);await page.locator('[data-town-open]').click();assert.ok(await page.locator('[data-town-review]').isDisabled());assert.match(await page.locator('.town-purchase-note').innerText(),/need|fehlen/);await page.keyboard.press('Escape');
 accounts.db(db=>db.prepare('UPDATE users SET tokens=?,xp=0 WHERE id=?').run(before,owner.id));
 const locked=plotQuote().plots.find(p=>!p.occupied&&p.size==='medium');await go('/town?plot='+locked.id);await page.locator('[data-town-open]').click();assert.ok(await page.locator('[data-town-review]').isDisabled());assert.match(await page.locator('.town-purchase-note').innerText(),/level|Level/);await page.keyboard.press('Escape');
 accounts.db(db=>db.prepare('UPDATE users SET xp=36100 WHERE id=?').run(owner.id));
 const guest=await browser.newContext({viewport:{width:320,height:844},reducedMotion:'reduce'}),gp=await guest.newPage();gp.on('pageerror',e=>errors.push(e.message));
 await gp.goto(base+'/town?plot='+free.id);await gp.waitForSelector('[data-town-open]');await gp.locator('[data-town-open]').click();assert.equal(await gp.locator('.town-purchase [type="submit"], [data-town-review]').count(),0);assert.ok(await gp.locator('.town-purchase a[href="/login"]').isVisible());await guest.close();
 // A rival taking a plot between review and confirmation is handled cleanly.
 await go('/town?plot='+free.id);await page.locator('[data-town-open]').click();await page.locator('[data-town-review]').click();
 buyBusiness(dir,{id:'mira'},'toys',null,{plotId:free.id});const beforeConflict=accounts.profile(owner).tokens;
 await page.locator('.town-purchase [type="submit"]').click();await page.waitForSelector('.town-purchase-dialog[open]',{state:'hidden'});assert.equal(accounts.profile(owner).tokens,beforeConflict);assert.equal(businessDashboard(dir,owner).shops.length,2);
 // Real confirmed purchase charges exactly once and uses server capacity.
 const buy=plotQuote().plots.find(p=>!p.occupied&&p.size==='popup');await go('/town?plot='+buy.id);await page.locator('[data-town-open]').click();await page.locator('.town-type-choice [value="cars"]').check();await page.locator('[data-town-review]').click();
 const beforeBuy=accounts.profile(owner).tokens;await page.locator('.town-purchase [type="submit"]').click();await page.waitForSelector('.business-shop');
 assert.equal(accounts.profile(owner).tokens,beforeBuy-buy.costs.cars);const bought=businessDashboard(dir,owner).shops.find(s=>s.location.plotId===buy.id);assert.equal(bought.capacity,buy.carCapacity);
 const remaining=plotQuote().plots.find(p=>!p.occupied);await go('/town?plot='+remaining.id);await page.locator('[data-town-open]').click();assert.ok(await page.locator('[data-town-review]').isDisabled());assert.match(await page.locator('.town-purchase-note').innerText(),/limit|Ladenlimit/);await page.keyboard.press('Escape');
 // Dense town, all six store types, long escaped names and all25 locations.
 for(const [i,p] of plotQuote().plots.filter(p=>!p.occupied).entries()){
   const id='dense-'+i;accounts.db(db=>db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',100000000,36100,?)").run(id,'Merchant_'+i,Date.now()));
   const shop=buyBusiness(dir,{id},plotQuote().types[i%6].id,null,{plotId:p.id}).shop;
   accounts.db(db=>db.prepare('UPDATE businesses SET store_name=? WHERE id=?').run('A long shop name <img src=x> & collectors '+i,shop.id));
 }
 for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});await go('/town?view=shops&display=list');assert.equal(await page.locator('.town-place-row').count(),25);assert.equal(await page.locator('.town-place-row img').count(),0);await fits('dense list '+width);
   await page.locator('[data-town-display="map"]').click();
   let count=0;for(const a of plotQuote().districts){await page.locator(`[data-town-area="${a.id}"]`).click();count+=await page.locator('.town-pin.is-store').count();await fits('dense '+a.id+' '+width);await page.locator('[data-town-fit]').click();}assert.equal(count,25);
   if(width===390)await shot('dense-overview-390');
 }
 // Occupied plots whose owner cannot trade remain reserved, never purchasable.
 const reserved=plotQuote().plots.find(p=>p.business?.owner==='Merchant_0');accounts.db(db=>db.prepare('UPDATE users SET banned=1 WHERE id=?').run('dense-0'));
 await go('/town?plot='+reserved.id);assert.equal(await page.locator('[data-town-open]').count(),0);assert.ok(await page.locator('.town-pin.is-reserved').isVisible());
 assert.deepEqual(errors,[]);await context.close();
 console.log('Town map passed: six district drilldowns; live selection/zoom and keyboard focus; map/list/filters/empty recovery; saved return state; mouse/native touch pan and stale-read protection; EN/DE320–3840px; guest, funds/level/store-limit gates; all six prices; rival-plot conflict; real confirmed purchase/capacity; malformed links, read retry and dense25-store town.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
