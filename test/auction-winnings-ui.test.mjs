import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/auction-winnings-ui.js',import.meta.url),'utf8');
const house=await readFile(new URL('../dist/economy-ui.js',import.meta.url),'utf8');
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function setup(language='en'){
  const context=vm.createContext({window:{paletteUi:{art:()=>'<svg></svg>'}},accountEscape:escape,
    t:(en,de)=>language==='en'?en:de,number:String,caseArtwork:()=>'<svg></svg>',URLSearchParams,
    account:{id:'me'},data:{unopenedOwner:'me'},tab:'browse',economyFlags:{market:false},location:{search:'?type=items&seller=players'},
    accountContent:{innerHTML:''},esc:escape,caseArt:()=>'',categoryName:String,economyOverviewMarkup:()=>'',loginNotice:()=>'',justizEuro:String,name:lot=>lot.name});
  vm.runInContext(source,context);vm.runInContext(house.slice(house.indexOf('  function houseType('),house.indexOf('  function render()',house.indexOf('  function houseType('))),context);
  vm.runInContext('houseCard = entry => `<article data-history="${entry.lot.id}"></article>`',context);
  return context;
}
const reward={id:'won',kind:'palette',name:'My <sealed> palette',nameDe:'Meine <versiegelte> Palette',offer:{},href:'/auction-house?reveal=won'};
for(const language of ['en','de'])test(`unopened rewards stay above the live list on every tab, independent of filters (${language})`,()=>{
  const context=setup(language);context.data.unopened=[reward];context.data.paletteMine=[{id:'won',name:'Won',status:'ended'},{id:'opened',name:'Opened',status:'ended'}];context.data.archivedBids=[{id:'item',status:'ended',item:{title:'Item'}}];
  for(const tab of ['browse','bids','mine']){
    context.tab=tab;vm.runInContext('renderHouse()',context);const html=context.accountContent.innerHTML;
    assert.ok(html.indexOf('class="house-winnings"')<html.indexOf('class="auction-house-shortcuts'));
    assert.match(html,/data-unopened-reward="palette:won"/);assert.doesNotMatch(html,/<sealed>|<versiegelte>/);
    assert.match(html,language==='en'?/<h2 id="house-winnings-title">Unopened rewards<\/h2>/:/<h2 id="house-winnings-title">Ungeöffnete Gewinne<\/h2>/);
    assert.match(html,language==='en'?/<span class="house-winnings-action">Open /:/<span class="house-winnings-action">Öffnen /);
    assert.doesNotMatch(html,/data-history="won"/);
  }
});

test('opened, guest and previous-account queues do not leave an empty or stale reward section',()=>{
  const context=setup();context.data.unopened=[];vm.runInContext('renderHouse()',context);assert.doesNotMatch(context.accountContent.innerHTML,/class="house-winnings"/);
  context.data.unopened=[reward];context.data.unopenedOwner='someone-else';vm.runInContext('renderHouse()',context);assert.doesNotMatch(context.accountContent.innerHTML,/data-unopened-reward/);
  context.account=null;vm.runInContext('renderHouse()',context);assert.doesNotMatch(context.accountContent.innerHTML,/data-unopened-reward/);
});

test('active bids appear before unopened rewards and never repeat in bid history',()=>{
  const context=setup();context.data.unopened=[reward];context.tab='bids';
  context.data.paletteMine=[{id:'active',name:'Active',status:'active',endsAt:Date.now()+3600_000,
    currentBid:10,reserve:5,highestBid:10,leading:true},{id:'won',status:'ended',won:true}];
  vm.runInContext('renderHouse()',context);
  const html=context.accountContent.innerHTML;
  assert.ok(html.indexOf('class="house-active-bids"')<html.indexOf('class="house-winnings"'));
  assert.equal((html.match(/data-history="active"/g)||[]).length,1);
  assert.doesNotMatch(html,/data-history="won"/);
});

test('large queues keep six prominent rewards and disclose every remaining box without truncating them',()=>{
  const context=setup(),rewards=Array.from({length:10},(_,i)=>({...reward,id:'reward-'+i}));
  const html=context.window.auctionWinningsUi.markup(rewards);
  assert.equal((html.match(/data-unopened-reward/g)||[]).length,10);assert.match(html,/<details class="house-winnings-more">/);
  assert.equal((html.split('<details')[0].match(/data-unopened-reward/g)||[]).length,6);
  assert.match(html,/10 unopened rewards/);
});
