// Optional real-browser review regression using isolated data and real sales.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore,upsertAuctions } from '../src/database.mjs';
import { buyBusiness,stockBusiness } from '../src/businesses.mjs';
import { buyStoreItem,reviewStore,visitStore } from '../src/storefronts.mjs';
import { upgradeSkill } from '../src/skill-tree.mjs';
import { featureFlags } from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-reviews-ui-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'reviews-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env),old=Date.now()-14*86400000;
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})}),accounts=new Accounts(dir,{flags});
const token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),admin=accounts.user(token);
accounts.db(db=>{for(const [id,name] of [['owner','Shop_owner'],['buyer','Reviewer_with_a_very_long_name_<img src=x>'],['other','OtherBuyer']])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',1000000,36100,?)").run(id,name,old);
 for(let n=0;n<10;n++)db.prepare("INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,'owner',?,?)").run('review-wine-'+n,JSON.stringify({title:'Review wine '+n,price:100,marketCategory:'wine',rarity:'rare'}),old);});
const shop=buyBusiness(dir,{id:'owner'},'wine','popup',{now:old}).shop;
accounts.db(db=>db.prepare("UPDATE businesses SET id='review-shop' WHERE id=?").run(shop.id));shop.id='review-shop';
stockBusiness(dir,{id:'owner'},shop.id,Array.from({length:10},(_,n)=>'review-wine-'+n),{now:old});
accounts.db(db=>db.prepare("UPDATE businesses SET profit_margin=100,size='large',traffic_popularity=1.5 WHERE id=?").run(shop.id));
for(const [id,n,stars,comment] of [['buyer',0,1,'Prices are too high <script>window.bad=true</script>'],['other',1,5,'Great value']]){
 buyStoreItem(dir,{id},{shopId:shop.id,inventoryId:'review-wine-'+n,expectedPrice:200,requestId:'review-browser-buy-'+id},{now:old});
 reviewStore(dir,{id},{shopId:shop.id,stars,comment},{now:old});
}
for(let rank=1;rank<=3;rank++)upgradeSkill(dir,{id:'buyer'},{skillId:'influence',rank,requestId:'review-browser-influence-'+rank},{now:old});
const initial=visitStore(dir,admin,shop.id).store,target=initial.reviews.find(r=>r.reviewerId==='buyer');
assert.ok(initial.reviews.some(r=>r.npc));assert.ok(target.likes>12);
const ownerToken=accounts.atomic(db=>accounts.session(db,'owner')),buyerToken=accounts.atomic(db=>accounts.session(db,'buyer'));
const economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,url=base+'/stores?shop='+shop.id;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
 const errors=[],context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
 await page.goto(url);await page.waitForSelector('.store-review-card.is-npc');
 assert.equal(await page.locator('.store-review-card.is-player').count(),2);assert.equal(await page.locator('.store-review-card img,.store-review-card script').count(),0);assert.equal(await page.evaluate(()=>window.bad),undefined);
 const ordered=await page.locator('.store-review-card').evaluateAll(cards=>cards.map(card=>card.classList.contains('is-npc')));assert.equal(ordered.slice(0,2).every(npc=>!npc),true);assert.equal(ordered.slice(2).every(Boolean),true);
 const like=page.locator('.store-review-like[data-reviewer="buyer"]');assert.equal(await like.getAttribute('aria-pressed'),'false');await like.click();await page.waitForFunction(()=>document.querySelector('.store-review-like[data-reviewer="buyer"]')?.getAttribute('aria-pressed')==='true');assert.match(await like.innerText(),new RegExp(String(target.likes+1)+' likes'));assert.equal(await like.evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.store-review-like[data-reviewer="buyer"]')?.getAttribute('aria-pressed')==='false');assert.match(await like.innerText(),new RegExp(String(target.likes)+' likes'));
 const language=async lang=>{await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);};
 const fits=async label=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' page overflow');assert.ok(await page.locator('.store-review-card,.store-review-like').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1)),label+' review overflow');};
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});for(const lang of ['en','de']){await language(lang);await fits(width+' '+lang);assert.match(await page.locator('.store-review-influence').innerText(),lang==='en'?/Leading voice/:/Meinungsführer/);assert.match(await page.locator('.store-review-card.is-npc p').first().innerText(),lang==='en'?/price was too high/:/Preis war zu hoch/);if([1440,390].includes(width))await page.locator('.store-reviews').screenshot({path:`/tmp/jg-reviews-${width}-${lang}.png`});}}
 await context.addCookies([{name:'jg_session',value:ownerToken,url:base}]);await page.goto(url);await page.waitForSelector('.shop-tabs');await page.locator('.shop-tabs a').filter({hasText:/Reviews|Bewertungen/}).click();await page.waitForSelector('.store-reviews .store-review-card');assert.equal(await page.locator('.store-review-influence').count(),1);await fits('owner 320');
 await context.addCookies([{name:'jg_session',value:buyerToken,url:base}]);await page.goto(url);await page.waitForSelector('.visitor-review-compose summary');await page.locator('.visitor-review-compose summary').click();await page.waitForSelector('.store-review-form');assert.equal(await page.locator('button.store-review-like[data-reviewer="buyer"]').count(),0);assert.equal(await page.locator('.store-review-card[data-reviewer="buyer"] .store-review-like').count(),1);await fits('reviewer 320');
 const guest=await browser.newContext({viewport:{width:320,height:1000}}),anonymous=await guest.newPage();anonymous.on('pageerror',error=>errors.push(error.message));await anonymous.goto(url);await anonymous.waitForSelector('.store-review-card.is-npc');assert.equal(await anonymous.locator('button.store-review-like').count(),0);assert.ok(!(await anonymous.locator('.store-review-list').innerText()).includes('Reviewer_with_a_very_long_name'));assert.equal(await anonymous.locator('.store-review-influence').count(),1);await guest.close();
 assert.deepEqual(errors,[]);console.log('Store reviews UI passed: real NPC purchases and likes, player-first ordering, Influence, accessible like/unlike with keyboard/focus, owner/reviewer/guest views, escaped content, translated NPC feedback, EN/DE 1440–320px without overflow.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
