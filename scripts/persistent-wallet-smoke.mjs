// Optional shared-wallet browser regression using real purchases, collections and escrow.
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
import { buyStoreItem,tipStore } from '../src/storefronts.mjs';
import { featureFlags } from '../src/features.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-store-cash-ui-');
const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'store-cash-browser-password',COOKIE_SECURE:'false'},flags=featureFlags(env);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const seed=JSON.parse(await readFile(path.join(root,'seed/auctions.json'),'utf8'));upsertAuctions(dir,seed.auctions);
const api=await createAccountApi({dataDir:dir,json,env,flags,dailyPayload:async()=>({auctions:seed.auctions.slice(0,5)})});
const accounts=new Accounts(dir,{flags}),token=await accounts.login({username:'admin',password:env.ADMIN_PASSWORD}),owner=accounts.user(token);
accounts.db(db=>db.prepare('UPDATE users SET tokens=1000000,xp=36100 WHERE id=?').run(owner.id));
const shops=['wine','toys','electronics'].map(type=>{
  const shop=buyBusiness(dir,owner,type,'popup').shop;
  accounts.db(db=>{for(let n=0;n<3;n++)db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
    .run(type+'-'+n,owner.id,JSON.stringify({title:'Cash '+type+' '+n,price:30,businessCategory:type,marketCategory:type==='toys'?'collectibles':type,rarity:'common'}),Date.now());});
  stockBusiness(dir,owner,shop.id,Array.from({length:3},(_,n)=>type+'-'+n));return shop;
});
const buyerToken=await accounts.register({username:'CashCustomer',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}),buyer=accounts.user(buyerToken);
for(const [index,type] of ['wine','toys'].entries())buyStoreItem(dir,buyer,{shopId:shops[index].id,inventoryId:type+'-0',expectedPrice:36,requestId:'cash-ui-purchase-'+type});
tipStore(dir,buyer,{shopId:shops[0].id,amount:25,requestId:'cash-ui-tip-0000001'});
const balance=()=>accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);
const till=index=>accounts.db(db=>db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(shops[index].id).cash_balance);
const {listItem}=await import('../src/resale.mjs');
accounts.db(db=>{db.prepare('UPDATE users SET tokens=1000000 WHERE id=?').run(buyer.id);db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('wallet-auction',buyer.id,JSON.stringify({title:'Wallet test find',price:100,marketCategory:'electronics',rarity:'common',image:'/assets/makita.jpg'}),Date.now());});
const listing=listItem(dir,buyer,{inventoryId:'wallet-auction',startPrice:50,endsAt:new Date(Date.now()+3600000).toISOString()});
const before=balance(),economy=createEconomyApi({dataDir:dir,json,flags,accounts});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await api(req,res,url)||economy(req,res,url))return;if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});const filename=url.pathname==='/'||!path.extname(url.pathname)?'/index.html':url.pathname,buf=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(buf);}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'jg_session',value:token,url:base}]);
  const money=value=>page.evaluate(value=>justizEuro(value),value);
  const wallet=page.locator('#wallet-amount');
  const checkBalance=async expected=>{const formatted=await money(expected);await page.waitForFunction(expected=>document.querySelector('#wallet-amount').textContent===expected,formatted);};
  await page.goto(base+'/businesses');await page.waitForSelector('.business-shop');await checkBalance(before);
  await page.evaluate(()=>{window.walletNode=document.querySelector('#persistent-wallet');});
  await page.locator(`[data-business="collect-cash"][data-shop="${shops[0].id}"]`).click();await checkBalance(before+61);
  assert.equal(balance(),before+61);assert.equal(till(0),0);
  // Bidding removes the maximum from available money; it is held separately.
  await page.evaluate(async()=>await navigateAccountPage('/auction-house'));
  await page.locator(`[data-economy="resale"][data-id="${listing.id}"]`).click();await page.waitForSelector('.economy-dialog[open]');
  await page.locator('.auction-bid-dock input[name="amount"]').fill('100');await page.locator('.auction-bid-dock button[type="submit"]').click();
  await checkBalance(before+61-100);assert.equal(balance(),before+61-100);
  assert.equal(await page.evaluate(()=>account.heldInBids),100);
  assert.equal(await page.locator('[data-bid-budget]').innerText(),await money(before+61));
  const {placeBid}=await import('../src/resale.mjs');
  // Seller cannot bid: use a separate registered account for the refund.
  const rivalToken=await accounts.register({username:'WalletRival',password:env.ADMIN_PASSWORD,code:accounts.codes(owner,1)[0]}),rival=accounts.user(rivalToken);
  placeBid(dir,rival,listing.id,200);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await checkBalance(before+61);
  assert.equal(await page.locator('[data-bid-budget]').innerText(),await money(before+61));
  await page.locator('[data-economy="close"]').click();
  // A confirmed case purchase updates the shared balance before its popup closes.
  await page.evaluate(async()=>await navigateAccountPage('/shop'));await page.waitForSelector('.case-buy-button');
  const caseCost=await page.evaluate(()=>accountStore.cases.find(box=>box.id===accountSelectedStoreCase).cost);
  await page.locator('.case-buy-button').click();await page.waitForSelector('.case-purchase-content');await checkBalance(before+61-caseCost);
  await page.locator('[data-account="close-reveal"]').first().click();
  for(const route of ['/inventory','/businesses','/town','/stores','/auction-house','/market','/skills','/profile','/leaderboard','/changelog','/admin','/shop']){
    await page.evaluate(async route=>await navigateAccountPage(route),route);await checkBalance(balance());
    assert.ok(await page.evaluate(()=>window.walletNode===document.querySelector('#persistent-wallet')),route+' retains one wallet element');
    assert.equal(await page.locator('#account-content .economy-overview-primary,.case-wallet,.house-wallet,.business-hero-account>strong').count(),0,route+' has no duplicate standalone wallet');
  }
  await page.locator('.wordmark').click();await checkBalance(balance());assert.ok(await page.locator('#persistent-wallet').isVisible());
  await page.evaluate(async()=>await navigateAccountPage('/businesses'));
  const language=async lang=>{const toggle=page.locator('[data-action="sidebar"]'),mobile=await toggle.isVisible();if(mobile&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('#language-select').selectOption(lang);if(mobile&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();};
  const fits=async label=>{
    const geometry=await page.locator('#persistent-wallet').evaluate(el=>{const r=el.getBoundingClientRect(),amount=el.querySelector('#wallet-amount'),p=document.querySelector('#mobile-progression'),b=p.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:amount.scrollWidth>amount.clientWidth+1,overlap:innerWidth<=900&&Math.min(r.right,b.right)-Math.max(r.left,b.left)>1};});
    assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.top>=0&&geometry.bottom<=geometry.height,`${label}: wallet in viewport ${JSON.stringify(geometry)}`);
    assert.equal(geometry.overflow,false,`${label}: exact amount fits`);assert.equal(geometry.overlap,false,`${label}: money and XP do not overlap`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' page fits');
  };
  for(const width of [2560,1440,1024,900,768,600,390,320])for(const lang of ['en','de']){
    await page.setViewportSize({width,height:1000});await language(lang);
    for(const amount of [0,1234567,...([1440,390,320].includes(width)?[1e12,Number.MAX_SAFE_INTEGER]:[])]){
      await page.evaluate(tokens=>updateAccount({...account,tokens}),amount);await checkBalance(amount);await fits(`${width} ${lang} ${amount}`);
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await fits(`${width} ${lang} ${amount} scrolled`);
    }
    if([1440,390,320].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`/tmp/jg-persistent-wallet-${width}-${lang}.png`});
      await page.evaluate(()=>updateAccount({...account,tokens:12450}));await page.screenshot({path:`/tmp/jg-persistent-wallet-normal-${width}-${lang}.png`});}
  }
  // Navigation and inbox must not cover the persistent balance on phones.
  await page.locator('[data-action="sidebar"]').click();
  assert.ok(await page.locator('#persistent-wallet').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}));
  await page.locator('[data-action="sidebar"]').click();await page.locator('#notification-button').click();await fits('inbox open');await page.locator('[data-notification="close"]').click();
  // Refresh from the server when returning to a previously hidden tab.
  accounts.db(db=>db.prepare('UPDATE users SET tokens=4321 WHERE id=?').run(owner.id));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await checkBalance(4321);
  await page.evaluate(async()=>{await accountApi('logout',{});updateAccount(null);await navigateAccountPage('/login');});
  assert.ok(await page.locator('#persistent-wallet').isHidden());assert.equal(await wallet.textContent(),'');
  await page.locator('#account-form input[name="username"]').fill('admin');await page.locator('#account-form input[name="password"]').fill(env.ADMIN_PASSWORD);await page.locator('#account-form button[type="submit"]').click();await checkBalance(4321);
  assert.deepEqual(errors,[]);await context.close();
  console.log('Persistent wallet passed: one shared element across Daily and 12 account pages; live register collection, bid escrow and passive refund, case spending, visibility refresh, logout/login privacy; exact zero through maximum-safe balances, scroll persistence, EN/DE 2560–320px, navigation/inbox coexistence and no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
