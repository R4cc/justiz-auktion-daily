import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/higher-lower.js',import.meta.url),'utf8');
const answerFunctions=source.slice(source.indexOf('async function guessHigherLower('),source.indexOf('function higherLowerImage('));

test('Higher or Lower unlocks choices after a temporary answer failure and allows a retry',async()=>{
  const buttons=[{disabled:false},{disabled:false}],errors=[],renders=[];
  let failures=1;
  const run={server:{id:'run'},index:1,revealed:false,streak:0,auctions:[{actualBid:100},{}]};
  const context=vm.createContext({
    state:{view:'higher-lower'},higherLowerRun:run,
    app:{querySelectorAll:()=>buttons},showToast:message=>errors.push(message),
    renderHigherLower:()=>{renders.push(run.pending);buttons.forEach(button=>button.disabled=Boolean(run.pending));},
    accountGameAnswer:async()=>{
      if(failures--)throw new Error('Temporary failure');
      return {auctions:[{actualBid:100},{actualBid:200}],correct:true,streak:1};
    },
    hlBest:()=>0,hlStorageKey:()=> 'best',localStorage:{setItem(){}},
    window:{scrollTo(){}}
  });
  vm.runInContext(answerFunctions,context);
  await vm.runInContext("guessHigherLower('higher')",context);
  assert.deepEqual(errors,['Temporary failure']);
  assert.equal(run.pending,false);
  assert.equal(run.revealed,false);
  assert.equal(buttons.some(button=>button.disabled),false,'failed answer must restore enabled choices');
  assert.deepEqual(renders,[false]);
  await vm.runInContext("guessHigherLower('higher')",context);
  assert.equal(run.revealed,true);
  assert.equal(run.correct,true);
  assert.equal(run.streak,1);
});
