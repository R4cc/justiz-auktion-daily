import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/account.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function renderPersistentWallet('),source.indexOf('function updateNavigation('));
function fixture() {
  const classes=new Map(),attributes=new Map(),label={textContent:''},contextual={textContent:''};let value='',writes=0;
  const amount={get textContent(){return value;},set textContent(next){value=next;writes++;}};
  const wallet={hidden:true,querySelector:selector=>selector==='#wallet-amount'?amount:label,
    classList:{toggle:(key,on)=>classes.set(key,on)},setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
  const context=vm.createContext({document:{getElementById:()=>wallet,querySelectorAll:()=>[contextual],body:{classList:{toggle:(key,on)=>classes.set(key,on)}}},
    t:en=>en,justizEuro:value=>'J€ '+new Intl.NumberFormat('en-GB').format(value)});
  vm.runInContext(renderer,context);
  return {context,wallet,amount,label,contextual,classes,attributes,writes:()=>writes,render:user=>{context.user=user;vm.runInContext('renderPersistentWallet(user)',context);}};
}

test('persistent wallet shows only available money, including zero, and clears private amounts on logout',()=>{
  const f=fixture();f.render({tokens:1250,heldInBids:800,inventoryMarketValue:5000});
  assert.equal(f.wallet.hidden,false);assert.equal(f.amount.textContent,'J€ 1,250');assert.equal(f.contextual.textContent,'J€ 1,250');assert.equal(f.classes.get('has-wallet'),true);
  f.render({tokens:0});assert.equal(f.amount.textContent,'J€ 0');assert.equal(f.wallet.hidden,false);
  f.render(null);assert.equal(f.wallet.hidden,true);assert.equal(f.amount.textContent,'');assert.equal(f.contextual.textContent,'');assert.equal(f.classes.get('has-wallet'),false);
});

test('wallet accepts gains and spending, keeps large amounts exact and avoids repeated announcements',()=>{
  const f=fixture();f.render({tokens:1250});const before=f.writes();f.render({tokens:1250});assert.equal(f.writes(),before);
  f.render({tokens:1000});assert.equal(f.amount.textContent,'J€ 1,000');
  f.render({tokens:Number.MAX_SAFE_INTEGER});assert.equal(f.amount.textContent,'J€ 9,007,199,254,740,991');assert.equal(f.classes.get('is-long'),true);
  f.context.t=(_,de)=>de;f.render({tokens:1000});assert.equal(f.label.textContent,'Verfügbar');assert.equal(f.attributes.get('aria-label'),'Verfügbares Guthaben');
});

test('a delayed background profile cannot overwrite a newer confirmed wallet update',async()=>{
  const flow=source.slice(source.indexOf('async function loadNotifications('),source.indexOf('function startNotifications('));
  let respond,started;const waiting=new Promise(resolve=>{started=resolve;}),updates=[];
  const context=vm.createContext({account:{id:'player',tokens:100},accountRevision:0,notificationRequest:0,notificationBusy:false,
    notificationPanel:{hidden:true},document:{hidden:false},renderNotificationPanel:()=>{},showNotificationToast:()=>{},
    accountApi:async route=>route==='notifications'?{notifications:[],fresh:[]}:new Promise(resolve=>{respond=resolve;started();}),
    updateAccount:user=>{context.account=user;context.accountRevision++;updates.push(user);}});
  vm.runInContext(flow,context);const pending=vm.runInContext('loadNotifications(true)',context);await waiting;
  context.updateAccount({id:'player',tokens:200});respond({user:{id:'player',tokens:100}});await pending;
  assert.equal(context.account.tokens,200);assert.equal(updates.length,1);
});
