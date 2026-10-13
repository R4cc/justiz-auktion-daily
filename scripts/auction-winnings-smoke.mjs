import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { prepareSealedCase, insertSealedCase } from '../src/sealed-cases.mjs';
import { createPaletteAuction, bidOnPaletteAuction } from '../src/palette-auctions.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { listItem, placeBid } from '../src/resale.mjs';
import { featureFlags } from '../src/features.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-winnings-browser-'),now=Date.now();
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'winnings-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const themes=[['Elektronik','Laptop Lenovo',40],['Werkzeuge','Bohrhammer Makita',20],['Getränke','Riesling Wein',8],['Fahrzeuge','BMW PKW',500],['Schmuck & Uhren','Gold Armbanduhr',90],['Sammlerstücke','Lego Modell',15]];
upsertAuctions(dir,themes.flatMap(([category,title,price],n)=>Array.from({length:12},(_,i)=>({id:1000+n*100+i,title:`${title} ${n} ${1000+n*100+i}`,category,currentBid:price*(i+1),image:'/assets/tv.jpg'}))));
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:[]})}),accounts=new Accounts(dir,{flags});
const token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token),seller={id:'seller'};
accounts.db(db=>{db.prepare('UPDATE users SET tokens=10000000,xp=40000 WHERE id=?').run(owner.id);db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('seller','BoxSeller','disabled',10000,?)").run(now);});
const prepared=prepareSealedCase(null,'common',{now,fallback:[{id:1,title:'SECRET CASE FIND',price:20,rarity:'common',image:'/assets/tv.jpg'}]});
const box=accounts.db(db=>insertSealedCase(db,seller.id,prepared,now));
const caseLot=listItem(dir,seller,{inventoryId:box.id,startPrice:100,endsAt:new Date(now+3600000).toISOString()},{now});placeBid(dir,owner,caseLot.id,100,{now});
accounts.db(db=>db.prepare("INSERT INTO inventory(id,user_id,item,created_at) VALUES('ordinary','seller',?,?)").run(JSON.stringify({id:'ordinary',title:'Ordinary won item',price:30,rarity:'common'}),now));
const itemLot=listItem(dir,seller,{inventoryId:'ordinary',startPrice:30,endsAt:new Date(now+3600000).toISOString()},{now});placeBid(dir,owner,itemLot.id,30,{now});
const edition=loadPaletteCatalog(dir,{now}).palettes.find(entry=>entry.id==='fundkiste');assert.ok(edition.available);
const palette=createPaletteAuction(dir,{editionId:edition.editionId,requestId:'winnings-browser-primary-0001'},{now,random:()=>0});bidOnPaletteAuction(dir,owner,palette.id,palette.reserve,{now});
accounts.db(db=>{db.prepare('UPDATE resale_auctions SET ends_at=?').run(now-1);db.prepare('UPDATE primary_palette_auctions SET ends_at=? WHERE id=?').run(now-1,palette.id);});
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname;const content=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const language=async value=>page.evaluate(value=>{const select=document.querySelector('#language-select');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await page.goto(base+'/auction-house');await page.waitForSelector('.house-winnings-card');
  assert.equal(await page.locator('.house-winnings-card').count(),2);assert.equal(await page.locator('.house-winnings-count').innerText(),'2');
  assert.equal(await page.locator('.house-winnings').innerText().then(text=>text.includes('Ordinary won item')),false);
  assert.doesNotMatch(await page.locator('.house-winnings').innerText(),/SECRET CASE FIND/);
  const payload=await (await context.request.get(base+'/api/account/auction-winnings')).json();assert.equal(payload.rewards.length,2);
  for(const width of [1440,1024,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px ${lang} page overflow`);
    assert.ok(await page.locator('.house-winnings-card').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)),`${width}px ${lang} card clipping`);
    assert.equal(await page.locator('#house-winnings-title').innerText(),lang==='en'?'Unopened rewards':'Ungeöffnete Gewinne');
    const first=await page.locator('.house-winnings').boundingBox(),next=await page.locator('.auction-house-shortcuts').boundingBox();assert.ok(first.y+first.height<=next.y+1);
    await page.evaluate(()=>document.querySelector('#notification-toasts').replaceChildren());
    if([1440,390].includes(width))await page.locator('.house-winnings').screenshot({path:`/tmp/jg-winnings-${width}-${lang}.png`});
  }
  for(const tab of ['bids','mine','browse']){
    await page.locator(`[data-economy="tab"][data-id="${tab}"]`).click();assert.equal(await page.locator('.house-winnings-card').count(),2);
    if(tab==='bids')assert.ok((await page.locator('#account-content').innerText()).includes('Ordinary won item'));
  }
  await page.locator('[data-economy="lot-type"][data-id="items"]').click();assert.equal(await page.locator('.house-winnings-card').count(),2);
  const trigger=page.locator(`[data-unopened-reward="case:${box.id}"]`);await trigger.focus();await page.keyboard.press('Enter');
  await page.waitForURL('**/inventory?focus=*');await page.waitForSelector('.case-reveal[open]');
  assert.notEqual(accounts.db(db=>db.prepare('SELECT opened_at FROM sealed_cases WHERE inventory_id=?').get(box.id).opened_at),null);
  await page.goto(base+'/auction-house');await page.waitForSelector('.house-winnings-card');assert.equal(await page.locator('.house-winnings-card').count(),1);
  await page.locator(`[data-unopened-reward="palette:${palette.id}"]`).click();await page.waitForURL('**/auction-house?reveal=*');
  await page.waitForSelector('.palette-reveal-screen');
  assert.notEqual(accounts.db(db=>db.prepare('SELECT revealed_at FROM primary_palette_auctions WHERE id=?').get(palette.id).revealed_at),null);
  await page.goto(base+'/auction-house');await page.waitForSelector('.house-header');assert.equal(await page.locator('.house-winnings').count(),0);
  const guest=await browser.newContext(),anonymous=await guest.newPage();anonymous.on('pageerror',error=>errors.push(error.message));
  assert.equal((await guest.request.get(base+'/api/account/auction-winnings')).status(),401);
  await anonymous.goto(base+'/auction-house');await anonymous.waitForSelector('.house-header');assert.equal(await anonymous.locator('.house-winnings').count(),0);
  assert.deepEqual(errors,[]);await guest.close();await context.close();
  console.log('Auction winnings browser checks passed: owned sealed rewards above every tab/filter, ordinary-item separation, real case/palette opening and removal, keyboard navigation, private guest access, EN/DE at 1440/1024/768/390/320px and no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
