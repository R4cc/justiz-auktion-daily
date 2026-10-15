import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/account.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('async function loadAuctionBrowser('),source.indexOf('function renderAuctionDetail('));
function fixture(){
  const pending=[],messages=[],node={innerHTML:''};
  const context=vm.createContext({accountAuctions:{query:'old',page:1},accountVisit:1,auctionBrowserRequest:0,currentAccountPage:'/admin',
    accountContent:{querySelector:()=>node},auctionResultsMarkup:()=>context.accountAuctions.auctions.join(','),
    accountApi:path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject})),showToast:message=>messages.push(message)
  });
  vm.runInContext(functions,context);
  return {context,pending,messages,node,load:()=>context.loadAuctionBrowser(1)};
}
test('admin archive ignores late replies and failures from superseded searches',async()=>{
  const f=fixture(),old=f.load();f.context.accountAuctions.query='new';const latest=f.load();
  f.pending[1].resolve({page:1,auctions:['new result']});await latest;
  f.pending[0].resolve({page:1,auctions:['old result']});await old;
  assert.equal(f.context.accountAuctions.query,'new');assert.equal(f.node.innerHTML,'new result');
  const stale=f.load();f.context.accountAuctions.query='newer';f.pending[2].reject(new Error('stale failure'));await stale;
  assert.deepEqual(f.messages,[]);
});
test('admin archive shows current failures and remains retryable',async()=>{
  const f=fixture(),failed=f.load();f.pending[0].reject(new Error('Temporary failure'));await failed;
  assert.deepEqual(f.messages,['Temporary failure']);
  const retry=f.load();f.pending[1].resolve({page:1,auctions:['recovered']});await retry;
  assert.equal(f.node.innerHTML,'recovered');
});
