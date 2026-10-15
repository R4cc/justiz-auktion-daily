// Exercise the deployed server wiring with an isolated database and real Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp('/tmp/jg-production-smoke-');
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const base=`http://127.0.0.1:${port}`,password='production-smoke-password';
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_USERNAME:'SmokeAdmin',ADMIN_PASSWORD:password,COOKIE_SECURE:'false',FETCH_MIN_INTERVAL_MS:'3600000',FETCH_INITIAL_INTERVAL_MS:'3600000',FETCH_MAX_INTERVAL_MS:'3600000',FETCH_IDLE_POLL_MS:'3600000'},stdio:['ignore','ignore','ignore']});
let browser;
try{
  let ready=false;
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw Error('Production server exited during startup');
    try{ready=(await fetch(base+'/healthz')).ok;}catch{}
    if(ready)break;await delay(100);
  }
  assert.ok(ready,'server becomes healthy');
  const response=await fetch(base+'/'),html=await response.text();assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  const assets=[...html.matchAll(/(?:src|href|data-src|data-href)="(\/[^"#]+\.(?:js|css)(?:\?[^"#]+)?)"/g)].map(match=>match[1]);
  assert.ok(assets.length>25);
  for(const asset of new Set(assets)){
    const res=await fetch(base+asset,{headers:{'accept-encoding':'br'}});
    assert.equal(res.status,200,asset);assert.match(res.headers.get('content-type'),asset.includes('.js')?/javascript/:/text\/css/);
    assert.equal(res.headers.get('content-encoding'),'br',asset);assert.match(res.headers.get('cache-control'),/immutable/);
    assert.equal(await res.text(),await readFile(new URL('dist'+asset.split('?')[0],new URL('..',import.meta.url)),'utf8'));
    const cached=await fetch(base+asset,{headers:{'if-none-match':res.headers.get('etag')}});assert.equal(cached.status,304,asset);
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to (load|execute)/i.test(message.text()))errors.push(message.text());});
  const login=await page.request.post(base+'/api/account/login',{data:{username:'SmokeAdmin',password},headers:{'x-requested-with':'JUSTIZGUESSR'}});assert.equal(login.status(),200);
  await page.goto(base+'/');await page.waitForSelector('.daily-home');
  for(const route of ['/profile','/inventory','/auction-house','/market','/town','/businesses','/stores','/skills','/shop','/leaderboard','/changelog','/admin']){
    await page.evaluate(route=>navigateAccountPage(route),route);
    assert.ok(await page.evaluate(()=>pageLoaded),`production ${route} loads`);
    assert.equal(await page.locator('#account-content h1').count(),1,route);
  }
  assert.deepEqual(errors,[]);
  console.log(`Production server passed: health, ${new Set(assets).size} versioned JS/CSS assets, Brotli integrity, cache/ETag, real login and all12 account routes under production CSP with no browser errors.`);
}finally{
  await browser?.close();
  if(server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');const fallback=setTimeout(()=>server.kill('SIGKILL'),3000);await exited;clearTimeout(fallback);}
  await rm(dir,{recursive:true,force:true});
}
