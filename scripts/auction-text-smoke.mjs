// Run with a local Chrome and Playwright; uses isolated data and no live auctions.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAuctionPage } from '../src/collector.mjs';
import { decodeHtmlEntities } from '../src/html-text.mjs';
import named from '../src/html-entities.json' with { type: 'json' };
import { Accounts } from '../src/accounts.mjs';
import { createGuestGameApi } from '../src/guest-game-api.mjs';
import { publicDailySummary } from '../src/game-rounds.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { upsertAuctions, readArchive, readDailyGames, saveDailyGame, closeDataStore } from '../src/database.mjs';
import { listItem } from '../src/resale.mjs';
import { featureFlags } from '../src/features.mjs';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-text-browser-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'auction-text-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8')).auctions;
const originalTitle='Makita &lpar;Pro&rpar; &plus; &frac12; &lsqb;Edition&rsqb; &lt;rev&gt; &quot;Ä&quot; &#x1F600; 文字';
const originalDescription='&lcub;OK&rcub; 2 &lt; 3 &gt; 1 &amp; &NotEqualTilde; &Ascr; 👩🏽‍🔧. &lt;img src=x onerror=&quot;window.injected=true&quot;&gt; &lt;script&gt;window.injected=true&lt;/script&gt;';
const parsed=parseAuctionPage(`<title>${originalTitle} (#300001)</title><h2 class="auktionstitel">${originalTitle}</h2><p>Aktuelles Gebot: 125,00 €</p><h3>Artikelbeschreibung</h3><p>${originalDescription}</p><h3>Details</h3>`,'https://www.justiz-auktion.de/Item-300001');
const fresh={...seed[0],...parsed,image:'/assets/makita.jpg',images:['/assets/makita.jpg'],correctPrice:125};
const legacy={...fresh,id:300002,title:'Monitor &lpar;Saved&rpar; &plus; &frac12;',description:'&lsqb;Archived&rsqb; &NotEqualTilde;',correctPrice:80};
const date=new Date().toISOString().slice(0,10);
upsertAuctions(dir,[...seed,fresh,legacy]);
saveDailyGame(dir,{date,gameNumber:286,generatedAt:new Date().toISOString(),auctions:[fresh,...seed.slice(1,5).map(item=>({...item,correctPrice:item.currentBid}))]});
const daily=()=>{const game=readDailyGames(dir).games[date];return {...game,auctions:game.auctions.map(item=>({...item,actualBid:item.correctPrice}))};};
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>daily()}),accounts=new Accounts(dir,{flags});
const token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token);
accounts.db(db=>{
  for(const [id,item] of [['fresh',fresh],['legacy',legacy]])db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(id,owner.id,JSON.stringify({...item,id,auctionId:item.id,price:item.correctPrice,marketCategory:'tools',rarity:'common'}),Date.now());
  db.prepare("DELETE FROM app_state WHERE key='auction_text_entities_v1'").run();
});
closeDataStore(dir);const saved=readArchive(dir).auctions.find(item=>item.id===legacy.id);
assert.equal(saved.title,'Monitor (Saved) + ½');
const listing=listItem(dir,owner,{inventoryId:'legacy',startPrice:80,endsAt:new Date(Date.now()+3600000).toISOString()});
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const guestApi=createGuestGameApi({dataDir:dir,json,env,dailyPayload:async()=>daily(),randomPayload:async()=>daily(),higherLowerPayload:async()=>({auctions:[fresh,saved].map(item=>({...item,actualBid:item.correctPrice}))})});
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/daily')return json(res,200,publicDailySummary(daily()));
  if(url.pathname==='/api/random')return json(res,200,daily());
  if(url.pathname==='/api/higher-lower')return json(res,200,{auctions:[fresh,saved].map(item=>({...item,actualBid:item.correctPrice}))});
  if(await api(req,res,url)||economy(req,res,url)||await guestApi(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
  const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname;
  const content=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  await page.goto(base);await page.waitForFunction(()=>typeof startGame==='function'&&dailyMeta&&account);
  // Use the browser's native HTML parser as an independent entity oracle.
  const references=[...Object.keys(named).map(name=>'&'+name),'&#0;','&#xD800;','&#x110000;','&#128;','&#x1f600;','&#x10ffff;'];
  const expected=await page.evaluate(references=>{const textarea=document.createElement('textarea');return references.map(reference=>{textarea.innerHTML=reference;return textarea.textContent;});},references);
  assert.deepEqual(references.map(reference=>decodeHtmlEntities(reference)),expected);
  await page.evaluate(()=>startGame());await page.waitForSelector('.auction-title');
  const language=async value=>page.evaluate(value=>{const el=document.querySelector('#language-select');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const safe=async()=>{
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow');
  };
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);
    assert.equal(await page.locator('.auction-title').innerText(),fresh.title);
    assert.equal(await page.locator('.auction-description').innerText(),fresh.description);
    assert.equal(await page.locator('.auction-description img,.auction-description script').count(),0);await safe();
    if([1440,320].includes(width))await page.locator('.auction-title').screenshot({path:`/tmp/jg-auction-text-daily-${width}-${lang}.png`});
  }
  await page.goto(base+'/inventory');await page.waitForSelector('[data-inventory-card="fresh"]');
  for(const id of ['fresh','legacy']){
    const item=id==='fresh'?fresh:saved;
    await page.locator(`[data-inventory-detail="${id}"]`).click();await page.waitForSelector('.inventory-item-dialog[open]');
    assert.equal(await page.locator('#inventory-item-title').innerText(),item.title);
    await page.locator('[data-item-section="about"] summary').click();
    assert.equal(await page.locator('[data-item-section="about"] p').first().innerText(),item.description);
    assert.equal(await page.locator('[data-item-section="about"] img,[data-item-section="about"] script').count(),0);await safe();
    await page.keyboard.press('Escape');
  }
  await page.goto(base+'/auction-house');await page.waitForSelector('[data-house-filter="view"]');await page.locator('[data-house-filter="view"]').selectOption('mine');await page.waitForSelector(`[data-economy="resale"][data-id="${listing.id}"]`);
  assert.equal(await page.locator(`[data-economy="resale"][data-id="${listing.id}"] h3`).innerText(),saved.title);
  await page.locator(`[data-economy="resale"][data-id="${listing.id}"]`).click();await page.waitForSelector('.auction-room');
  assert.equal(await page.locator('#economy-dialog-title').innerText(),saved.title);await safe();
  await page.goto(base+'/admin');await page.waitForSelector('[data-admin-tab="auctions"]');await page.locator('[data-admin-tab="auctions"]').click();
  await page.locator('#auction-search').fill('Makita (Pro)');await page.waitForSelector('[data-account="auction-detail"][data-id="300001"]');
  await page.locator('[data-account="auction-detail"][data-id="300001"]').click();await page.waitForSelector('#auction-detail-title');
  assert.equal(await page.locator('#auction-detail-title').innerText(),fresh.title);
  assert.equal(await page.locator('.auction-reveal-content .auction-description').innerText(),fresh.description);
  assert.equal(await page.locator('.auction-reveal-content .auction-description img,.auction-reveal-content .auction-description script').count(),0);await safe();
  const guest=await browser.newContext({viewport:{width:320,height:1000}}),anonymous=await guest.newPage();anonymous.on('pageerror',error=>errors.push(error.message));
  await anonymous.goto(base);await anonymous.waitForFunction(()=>typeof startHigherLower==='function'&&dailyMeta);
  await anonymous.evaluate(()=>startHigherLower());await anonymous.waitForSelector('.hl-card');
  assert.deepEqual(await anonymous.locator('.hl-card h2').allTextContents(),[fresh.title,saved.title]);
  assert.equal(await anonymous.evaluate(()=>window.injected),undefined);
  assert.deepEqual(errors,[]);await guest.close();await context.close();
  console.log('Auction text browser checks passed: 2231 named references match native HTML parsing; fresh/legacy titles and descriptions render safely in Daily, inventory, Auction House, admin archive and Higher or Lower; EN/DE at 1440/768/390/320px with no page errors.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
