// Isolated, repeatable measurements. Never opens the application's runtime data.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { createServer } from 'node:http';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, transaction } from '../src/database.mjs';
import * as businesses from '../src/businesses.mjs';
import { listStores } from '../src/storefronts.mjs';
import { createAccountApi } from '../src/account-api.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-performance-'));
const now = Date.now(), user = { id:'performance' }, accounts = new Accounts(dir, {now:()=>now});
const loop = monitorEventLoopDelay({resolution:1});
let server;
try {
  accounts.db(db => db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',1000000,36100,?)").run(user.id,user.id,now));
  const shop = businesses.buyBusiness(dir,user,'wine','popup',{now}).shop;
  const db = accounts.db(db=>db), prepare = db.prepare.bind(db), exec = db.exec.bind(db);
  const token = accounts.db(db=>accounts.session(db,user.id));
  let prepares=0,execs=0,appMs;
  db.prepare=(...args)=>{prepares++;return prepare(...args);};
  db.exec=(...args)=>{execs++;return exec(...args);};
  const api=await createAccountApi({dataDir:dir,env:{},dailyPayload:async()=>({auctions:[]}),json:(res,status,value)=>{
    res.writeHead(status,{'content-type':'application/json','server-timing':`app;dur=${(performance.now()-res.started).toFixed(2)}`});res.end(JSON.stringify(value));
  }});
  server=createServer(async(req,res)=>{res.started=performance.now();if(!await api(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const measure=async(name,inventory,work)=>{
    await work();const samples=[];loop.enable();loop.reset();
    for(let i=0;i<5;i++){
      await new Promise(resolve=>setTimeout(resolve,5));
      prepares=0;execs=0;appMs=undefined;const start=performance.now(),value=await work();
      samples.push({ms:+(performance.now()-start).toFixed(2),prepares,execs,...(appMs===undefined?{}:{appMs}),bytes:Buffer.byteLength(JSON.stringify(value))});
    }
    await new Promise(resolve=>setTimeout(resolve,5));loop.disable();samples.sort((a,b)=>a.ms-b.ms);
    console.log(JSON.stringify({name,inventory,median:samples[2],maxMs:samples[4].ms,eventLoopMaxMs:+(loop.max/1e6).toFixed(2)}));
  };
  let previous=0;
  for(const inventory of [0,1000,5000]){
    transaction(db,()=>{const insert=db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)');
      for(let i=previous;i<inventory;i++)insert.run('perf-'+i,user.id,JSON.stringify({title:'Synthetic wine '+i,price:100,marketCategory:'wine',rarity:'common'}),now);
    });previous=inventory;
    await measure('profile',inventory,()=>accounts.profile(user));
    await measure('dashboard',inventory,()=>businesses.businessDashboard(dir,user,{now}));
    await measure('directory',inventory,()=>listStores(dir,user,{now}));
    if(businesses.businessRestockInventory)await measure('restock-page',inventory,()=>businesses.businessRestockInventory(dir,user,{shopId:shop.id,limit:48,now}));
    for(const query of ['',...(businesses.businessRestockInventory?['?view=summary']:[])]){
      await measure('api/businesses'+query,inventory,async()=>{
        const response=await fetch(base+'/api/account/businesses'+query,{headers:{cookie:'jg_session='+token}});
        if(!response.ok)throw new Error('Benchmark API failed: '+response.status);
        appMs=Number(response.headers.get('server-timing')?.split('dur=')[1]);return response.json();
      });
    }
  }
  console.log(JSON.stringify({runtime:process.version,fixture:'warm local disk, synthetic inventory, one owner and one empty store; excludes tunnel/network latency'}));
}finally{
  loop.disable();if(server){server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
  closeDataStore(dir);await rm(dir,{recursive:true,force:true});
}
