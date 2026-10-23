import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const art = await readFile(new URL('../dist/case-art.js', import.meta.url), 'utf8');
const buySource = source.slice(source.indexOf('async function buyStoreCase('), source.indexOf('function renderLegacyShop('));
const resultSource = source.slice(source.indexOf('function caseResultActions('), source.indexOf('function tierCard('));
const handlerSource = source.slice(source.lastIndexOf("document.addEventListener('click', async event => {"), source.indexOf("document.addEventListener('submit', async event => {"));
const flush = () => new Promise(resolve => setImmediate(resolve));
const item = {id:'sealed-one',kind:'case',caseType:'lost-property',title:'Lost Property Case',titleDe:'Fundbüro-Kiste'};
const find = {id:'find-one',title:'Actual item',rarity:'common',price:100};
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function fixture() {
  const pending = new Map(), calls = [], focused = [];
  const store = {revision:'quote',cases:[{id:'lost-property',cost:174,stock:{remaining:4}},{id:'vault',cost:300,stock:{remaining:2}}]};
  let handler, renders = 0, shows = 0;
  const caseReveal = {open:false,innerHTML:'',showModal(){this.open=true;shows++;},close(){this.open=false;},querySelector(selector){return {focus(){focused.push(selector);}};}};
  const context = vm.createContext({
    account:{id:'buyer',tokens:500},accountStore:store,accountSelectedStoreCase:'lost-property',
    caseStockRequest:0,accountVisit:1,currentAccountPage:'/shop',accountBusy:false,
    accountItems:[item],accountCatalog:null,traderStores:[],economyFlags:{businesses:true,resales:true},
    caseReveal,caseRevealState:null,accountContent:{querySelector(){return null;},querySelectorAll(){return []; }},
    localStorage:{getItem:key=>pending.get(key),setItem:(key,value)=>pending.set(key,value),removeItem:key=>pending.delete(key)},
    crypto:{randomUUID:()=> 'saved-purchase-request'},accountEscape:escape,rarityLabel:String,t:en=>en,euro:String,justizEuro:value=>`J€ ${value}`,
    updateAccount(user){context.account=user;},renderAccountPage(){renders++;},updateCasePurchaseButtons(){},
    showToast(){},traderItemActions:()=>'<button>Keep</button>',
    document:{addEventListener(type,fn){handler=fn;}},
    accountApi:async(route,payload)=>{calls.push({route,payload});if(route==='cases/buy')return {item,user:{id:'buyer',tokens:326},store};if(route==='inventory/case/open')return {item:find,user:{id:'buyer',tokens:326}};if(route==='case-store')return store;if(route==='businesses')return {shops:[{id:'store'}]};return {items:[find]};},
    spinCaseReel:async()=>{}
  });
  vm.runInContext(art+buySource+resultSource+handlerSource,context);
  const click=(action,id)=>handler({target:{closest:()=>({dataset:{account:action,id},isConnected:false})}});
  return {context,pending,calls,caseReveal,click,focused,get renders(){return renders;},get shows(){return shows;}};
}

test('case purchase retries reuse their receipt and offer open or continue without opening automatically', async()=>{
  const f=fixture(), realApi=f.context.accountApi;
  f.context.accountApi=async()=>{throw Error('offline');};
  await assert.rejects(vm.runInContext("buyStoreCase('lost-property',1)",f.context),/offline/);
  assert.equal(f.pending.size,1);assert.equal(f.caseReveal.open,false);
  f.context.accountApi=realApi;
  await vm.runInContext("buyStoreCase('lost-property',1)",f.context);
  assert.equal(f.pending.size,0);assert.equal(f.context.account.tokens,326);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.requestId,'saved-purchase-request');
  assert.match(f.caseReveal.innerHTML,/data-account="open-inventory-case" data-id="sealed-one"/);
  assert.match(f.caseReveal.innerHTML,/Continue/);
  assert.equal(f.caseReveal.open,true);
});

test('purchase response updates the wallet but never opens a popup after navigation', async()=>{
  const f=fixture();f.context.accountVisit=2;
  await vm.runInContext("buyStoreCase('lost-property',1)",f.context);
  assert.equal(f.context.account.tokens,326);assert.equal(f.renders,0);assert.equal(f.shows,0);
});

test('closing while opening stays responsive and cannot reopen the item popup; find and stores remain available',async()=>{
  const f=fixture();f.caseReveal.open=true;
  let finishSpin;
  f.context.spinCaseReel=()=>new Promise(resolve=>{finishSpin=resolve;});
  const opening=f.click('open-inventory-case',item.id);await flush();
  assert.equal(f.context.accountBusy,true);
  assert.match(f.caseReveal.innerHTML,/Opening case/);
  assert.doesNotMatch(f.caseReveal.innerHTML,/Actual item|rarity-common/);
  await f.click('close-reveal');assert.equal(f.caseReveal.open,false);
  finishSpin();await opening;
  assert.equal(f.context.accountBusy,false);assert.equal(f.caseReveal.open,false);
  assert.equal(f.context.accountItems[0].id,find.id);assert.equal(f.context.traderStores[0].id,'store');
  assert.equal(f.calls.filter(call=>call.route==='inventory/case/open').length,1);
});

test('dismissing a purchased case while the opening request is pending does not reopen the dialog',async()=>{
  const f=fixture();f.caseReveal.open=true;
  const realApi=f.context.accountApi;let finish;
  f.context.accountApi=(route,payload)=>route==='inventory/case/open'?new Promise(resolve=>{finish=resolve;}):realApi(route,payload);
  const opening=f.click('open-inventory-case',item.id);await flush();
  await f.click('close-reveal');finish({item:find,user:{id:'buyer',tokens:326}});await opening;
  assert.equal(f.caseReveal.open,false);assert.equal(f.shows,0);assert.equal(f.context.accountItems[0].id,find.id);
});

test('opened inventory and purchased cases show Continue and an optional available repeat purchase', async () => {
  for (const resales of [true, false]) for (const page of ['/shop', '/inventory']) {
    const f = fixture(); f.context.currentAccountPage = page; f.context.economyFlags.resales = resales;
    await f.click('open-inventory-case', item.id);
    assert.equal(f.context.accountBusy, false);
    assert.equal((f.caseReveal.innerHTML.match(/<(?:button|a)\b/g) || []).length, 2);
    assert.match(f.caseReveal.innerHTML, /Buy another case · J€ 174/);
    assert.match(f.caseReveal.innerHTML, /class="primary-button" data-account="close-reveal">Continue/);
    assert.doesNotMatch(f.caseReveal.innerHTML, /<a\b|View in inventory|Exit/);
    assert.doesNotMatch(f.caseReveal.innerHTML, /dialog-close|Keep item|Sell now|data-trader|disabled/);
    assert.equal(f.calls.filter(call => call.route === 'cases/buy').length, 0);
    await f.click('buy-case', 'lost-property');
    assert.equal(f.calls.filter(call => call.route === 'cases/buy').length, 1);
    assert.equal(f.calls.filter(call => call.route === 'inventory/case/open').length, 1);
    assert.match(f.caseReveal.innerHTML, /Continue/);
  }
});

test('buy another uses the opened case type and current quote, even when another showroom case is selected', async () => {
  const f = fixture(); f.context.accountItems = [{ ...item, caseType: 'vault' }];
  await f.click('open-inventory-case', item.id);
  assert.match(f.caseReveal.innerHTML, /data-account="buy-case" data-id="vault"/);
  assert.match(f.caseReveal.innerHTML, /Buy another case · J€ 300/);
  for (const [tier, caseId] of [['common','lost-property'],['epic','vault']]) {
    const html = vm.runInContext(`caseResultActions({id:'find'}, {caseTier:'${tier}'})`, f.context);
    assert.equal(html, '<button class="primary-button" data-account="close-reveal">Continue</button>');
  }
});

test('sold-out, unaffordable, free and unknown cases leave only Continue', async () => {
  const f = fixture();
  for(const [sealed,remaining,tokens]of [[{caseType:'lost-property'},0,500],[{caseType:'lost-property'},2,1],[{caseTier:'legendary'},2,500],[{},2,500],[{caseType:'retired-case'},2,500]]){
    f.context.accountStore.cases[0].stock.remaining=remaining;f.context.account.tokens=tokens;f.context.sealed=sealed;
    const html=vm.runInContext("caseResultActions({id:'find'},sealed)",f.context);
    assert.equal(html,'<button class="primary-button" data-account="close-reveal">Continue</button>');
  }
});

test('case illustrations escape labels and resolve unknown IDs to a known design',()=>{
  const f=fixture();
  const html=vm.runInContext('caseArtwork({id:"bad\\\" onclick=\\\"x",badge:"<img src=x>"})',f.context);
  assert.match(html,/case-design-lost-property/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/onclick=|<img/);
});
