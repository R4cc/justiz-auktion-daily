import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAccountApi } from '../src/account-api.mjs';
import { closeDataStore } from '../src/database.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp('/tmp/jg-changelog-badge-');
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const api=await createAccountApi({dataDir:dir,env:{COOKIE_SECURE:'false'},json,dailyPayload:async()=>({auctions:[]})});
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');if(await api(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
  const filename=path.extname(url.pathname)?url.pathname:'/index.html';
  const content=await readFile(path.join(root,'dist',filename));res.writeHead(200,{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});res.end(content);
}catch(error){json(res,500,{error:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
try{
  for(const width of [1440,768,390,320])for(const lang of ['en','de']){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const badge=page.locator('.site-nav a[href="/changelog"] .nav-new-tag'),link=page.locator('.site-nav a[href="/changelog"]');
    await page.goto(base+'/login');await page.waitForFunction(()=>document.querySelector('.site-nav a[href="/changelog"] .nav-new-tag'));
    await page.evaluate(lang=>{const select=document.querySelector('#language-select');select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
    if(width<=900)await page.locator('.sidebar-toggle').click();
    await link.scrollIntoViewIfNeeded();assert.equal(await badge.innerText(),lang==='de'?'NEU':'NEW');
    const box=await badge.boundingBox(),label=await link.locator('.nav-link-label').boundingBox();assert.ok(box.x+box.width<=width&&box.x>=label.x+label.width-1);
    if(width===1440&&lang==='en')await page.screenshot({path:'/tmp/changelog-new-desktop.png',fullPage:true});
    if(width===320&&lang==='de')await page.screenshot({path:'/tmp/changelog-new-mobile.png',fullPage:true});
    // Keyboard navigation acknowledges the entries once the Changelog renders.
    await link.focus();await page.keyboard.press('Enter');await page.waitForSelector('.changelog-page');assert.equal(await badge.count(),0);
    await page.goto(base+'/login');await page.waitForFunction(()=>window.changelogUi);assert.equal(await badge.count(),0);
    const other=await context.newPage();await other.goto(base+'/changelog');await other.waitForSelector('.changelog-page');assert.equal(await other.locator('.site-nav a[href="/changelog"] .nav-new-tag').count(),0);await other.close();
    // A real new entry on the same date restores the badge without changing a manual version.
    const source=await readFile(path.join(root,'dist/changelog-ui.js'),'utf8');
    const entry={date:'2026-10-20',title:'Same-day badge fixture',en:'A new entry.',de:'Ein neuer Eintrag.'};
    await page.route('**/changelog-ui.js*',route=>route.fulfill({status:200,contentType:'text/javascript',body:source.replace('const entries = [',`const entries = [${JSON.stringify(entry)},`)}));
    await page.reload();await page.waitForFunction(()=>document.querySelector('.site-nav a[href="/changelog"] .nav-new-tag'));
    assert.equal(await badge.count(),1);await page.goto(base+'/changelog');await page.waitForSelector('.changelog-page');assert.equal(await badge.count(),0);
    assert.equal(await page.locator('.changelog-entry').filter({hasText:'Same-day badge fixture'}).count(),1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('Changelog NEW badge passed: EN/DE at 1440/768/390/320px, keyboard navigation, successful-render dismissal, reload persistence, direct links, and new entries on the same date.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDataStore(dir);await rm(dir,{recursive:true,force:true});}
