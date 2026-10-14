import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/palette-ui.js',import.meta.url),'utf8');
const renderers=source.slice(source.indexOf('  function renderStage()'),source.indexOf('  async function spin('));
function render(phase,{profit=37,german=false}={}) {
  const rewards=[2,4,1].map((quantity,index)=>({quantity,item:{title:`Find ${index+1}`,rarity:'common'}}));
  const context=vm.createContext({
    stage:{phase,index:0,rewards,completed:[],offer:{tier:'standard',quantity:7}},
    busy:false,esc:String,t:(en,de)=>german?de:en,label:()=> 'Pallet',tier:()=> 'Standard',
    justizEuro:value=>`J€ ${value}`,number:(value,places)=>value.toFixed(places),rarityLabel:String,
    image:()=>'',reel:()=>'<div class="palette-slot-window"></div>',economyFlags:{businesses:true},
    accountContent:{innerHTML:'',querySelector:()=>null}
  });
  context.stage.valuation={costTokens:137-profit,totalValueTokens:137,profitLossTokens:profit,
    rewards:[{unitValueTokens:13,totalValueTokens:26},{unitValueTokens:20,totalValueTokens:80},{unitValueTokens:31,totalValueTokens:31}]};
  vm.runInContext(renderers+'\nrenderStage();',context);
  return context.accountContent.innerHTML;
}

test('pallet values appear only as the corresponding item and quantity are revealed',()=>{
  const hidden=render('item');assert.doesNotMatch(hidden,/palette-market-price|palette-drop-value|palette-value-overview/);
  const item=render('quantity');assert.match(item,/Market price \/ unit/);assert.match(item,/<dd>J€ 13<\/dd>/);
  assert.doesNotMatch(item,/palette-drop-value|palette-value-overview/);
  const quantity=render('result');assert.match(quantity,/Drop value<strong>J€ 26<\/strong>/);
  assert.doesNotMatch(quantity,/palette-value-overview/);
});

test('final overview shows paid cost, all multiplied values and signed profit with percentage',()=>{
  const markup=render('done');assert.match(markup,/Paid<\/dt><dd>J€ 100/);assert.match(markup,/Total market value<\/dt><dd>J€ 137/);
  assert.match(markup,/class="is-profit"/);assert.match(markup,/Estimated profit<\/dt><dd>\+J€ 37<small>\+37.0%/);
  assert.equal((markup.match(/palette-summary-drop-value/g)||[]).length,3);
  for(const value of [26,80,31])assert.match(markup,new RegExp(`Drop value<strong>J€ ${value}<`));
});

test('losses and break-even results use distinct labels, signs and localized copy',()=>{
  const loss=render('done',{profit:-63,german:true});assert.match(loss,/class="is-loss"/);
  assert.match(loss,/Geschätzter Verlust<\/dt><dd>−J€ 63<small>−31.5%/);assert.match(loss,/Bezahlt<\/dt><dd>J€ 200/);
  assert.match(loss,/Marktpreis \/ Stück/);
  const even=render('done',{profit:0});assert.match(even,/class="is-even"/);assert.match(even,/Break even<\/dt><dd>J€ 0<small>0.0%/);
  assert.doesNotMatch(even,/Estimated profit|Estimated loss|[+−]J€ 0/);
});
