import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/page-assets.js', import.meta.url), 'utf8');

test('feature dependencies stop on a download failure and concurrent retries execute each script once', async () => {
  const manifests = ['shared', 'consumer'].map(name => ({dataset:{pages:'/feature /other',src:`/${name}.js`}}));
  const downloaded = [], executed = [], preloaded = [], removed = [];
  let failShared = true;
  const context = vm.createContext({window:{},location:{href:'http://localhost/',pathname:'/'},URL,document:{
    querySelectorAll:selector => selector.startsWith('script') ? manifests : [],
    createElement:tag => ({tag,remove(){removed.push(this.src);}}),
    head:{append:node=>preloaded.push(node.href)},
    body:{append:node=>{
      downloaded.push(node.src);
      setImmediate(()=>{
        if(node.src==='/shared.js'&&failShared){node.onerror();return;}
        if(node.src==='/consumer.js')assert.ok(executed.includes('/shared.js'),'consumer requires a working dependency');
        executed.push(node.src);node.onload();
      });
    }}
  }});
  vm.runInContext(source,context);
  await assert.rejects(context.window.pageAssets.load('/feature'),/script_load_failed/);
  assert.deepEqual(downloaded,['/shared.js']);
  assert.deepEqual(executed,[]);
  assert.deepEqual(removed,['/shared.js']);
  assert.deepEqual(preloaded,['/shared.js','/consumer.js'],'downloads are preloaded together');
  failShared=false;
  await Promise.all([context.window.pageAssets.load('/feature'),context.window.pageAssets.load('/other')]);
  await context.window.pageAssets.load('/feature');
  assert.deepEqual(executed,['/shared.js','/consumer.js']);
  assert.deepEqual(downloaded,['/shared.js','/shared.js','/consumer.js']);
  assert.equal(preloaded.length,2);
});

test('a failed stylesheet clears its URL so assigning the same URL can retry', async () => {
  const listeners = new Map();let href='',attempts=0,fail=true;
  const link={dataset:{pages:'/feature',href:'/feature.css'},
    addEventListener:(event,listener)=>listeners.set(event,listener),
    removeEventListener:event=>listeners.delete(event),
    removeAttribute:name=>{if(name==='href')href='';},
    set href(value){
      if(href===value)return;
      href=value;attempts++;setImmediate(()=>listeners.get(fail?'error':'load')?.());
    }
  };
  const context=vm.createContext({window:{},location:{href:'http://localhost/',pathname:'/'},URL,document:{
    querySelectorAll:selector=>selector.startsWith('link')?[link]:[]
  }});
  vm.runInContext(source,context);
  await assert.rejects(context.window.pageAssets.load('/feature'),/stylesheet_load_failed/);
  assert.equal(href,'','a failed link must not retain its URL');
  fail=false;await context.window.pageAssets.load('/feature');
  assert.equal(attempts,2);assert.equal(href,'/feature.css');
});
