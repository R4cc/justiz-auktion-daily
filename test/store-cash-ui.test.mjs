import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/business-ui.js',import.meta.url),'utf8');
const flow=source.slice(source.indexOf('  const esc ='),source.indexOf('  const ui='));
function fixture() {
  const calls=[],storage=new Map(),updates=[],pending=[];
  const shops=[{id:'a',cashReady:10},{id:'b',cashReady:20},{id:'c',cashReady:30}];
  let nextId=0;
  const context=vm.createContext({
    account:{id:'owner',tokens:100},accountVisit:1,
    accountEscape:String,t:en=>en,justizEuro:amount=>`J€ ${amount}`,typeName:String,infoTip:()=>'',CSS:{escape:String},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    crypto:{randomUUID:()=>`collection-${++nextId}`},
    ownedShop:id=>shops.find(shop=>shop.id===id),
    accountContent:{querySelectorAll:()=>[],querySelector:()=>null},
    document:{activeElement:null},window:{matchMedia:()=>({matches:true})},
    updateAccount:user=>{context.account=user;updates.push(user.tokens);},showToast:()=>{},refresh:async()=>{},
    accountApi:(route,payload)=>{calls.push({route,payload});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}
  });
  vm.runInContext(flow,context);
  const collect=id=>vm.runInContext(`collectCash({dataset:{shop:'${id}'}})`,context);
  const markup=id=>vm.runInContext(`collectCashMarkup(ownedShop('${id}'))`,context);
  return {context,shops,calls,pending,storage,updates,collect,markup};
}

test('each register sends its own request immediately; only its own pending button is locked', async () => {
  const f=fixture(),first=f.collect('a'),second=f.collect('b');
  assert.equal(f.calls.length,2);
  await f.collect('a');assert.equal(f.calls.length,2,'same-store double clicks stay idempotent');
  assert.match(f.markup('a'),/disabled/);assert.match(f.markup('b'),/disabled/);
  assert.doesNotMatch(f.markup('c'),/disabled/);
  vm.runInContext('busy=true',f.context);assert.doesNotMatch(f.markup('c'),/disabled/);
  f.pending[0].resolve({user:{id:'owner',tokens:110},cashReady:0,collectionVersion:1,collection:{amount:10}});
  await first;
  assert.match(f.markup('a'),/Register empty/);assert.match(f.markup('b'),/Collecting/);
  f.pending[1].resolve({user:{id:'owner',tokens:130},cashReady:0,collectionVersion:2,collection:{amount:20}});
  await second;assert.equal(f.context.account.tokens,130);
});

test('older overlapping responses cannot lower the confirmed wallet balance', async () => {
  const f=fixture(),first=f.collect('a'),second=f.collect('b');
  f.pending[1].resolve({user:{id:'owner',tokens:130},cashReady:0,collectionVersion:2,collection:{amount:20}});
  await second;assert.equal(f.context.account.tokens,130);
  f.pending[0].resolve({user:{id:'owner',tokens:110},cashReady:0,collectionVersion:1,collection:{amount:10}});
  await first;assert.equal(f.context.account.tokens,130);assert.deepEqual(f.updates,[130]);
  assert.equal(f.shops[0].cashReady,0);assert.equal(f.shops[1].cashReady,0);
});

test('payment and button completion do not wait for the coin spill', async () => {
  const f=fixture();vm.runInContext('cashCelebration=()=>new Promise(()=>{})',f.context);
  const first=f.collect('a');
  f.pending[0].resolve({user:{id:'owner',tokens:110},cashReady:0,collectionVersion:1,collection:{amount:10}});
  await first;assert.equal(f.context.account.tokens,110);assert.match(f.markup('a'),/Register empty/);
  const second=f.collect('b');assert.equal(f.calls.length,2);
  f.pending[1].resolve({user:{id:'owner',tokens:130},cashReady:0,collectionVersion:2,collection:{amount:20}});
  await second;assert.equal(f.context.account.tokens,130);
});

test('a lost response remains retryable with the original receipt key', async () => {
  const f=fixture(),first=f.collect('a');f.pending[0].reject(new Error('offline'));await first;
  assert.match(f.markup('a'),/Retry collection/);assert.doesNotMatch(f.markup('b'),/disabled/);
  const retry=f.collect('a');assert.equal(f.calls[0].payload.requestId,f.calls[1].payload.requestId);
  f.pending[1].resolve({user:{id:'owner',tokens:110},cashReady:0,collectionVersion:1,collection:{amount:10}});
  await retry;assert.equal(f.storage.size,0);assert.equal(f.context.account.tokens,110);
});
