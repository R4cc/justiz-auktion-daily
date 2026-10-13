import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffledDeck, handValue, dealBlackjack, playBlackjack, publicBlackjack } from '../src/blackjack.mjs';
import { theftQuote, POLICE_CATCH_PERCENT } from '../src/storefronts.mjs';
import { jailDuration } from '../src/justice.mjs';

test('standard deck, ace adjustment, naturals, soft 17, busts and ties use ordinary blackjack rules',()=>{
  const deck=shuffledDeck(max=>max-1);assert.equal(new Set(deck).size,52);assert.deepEqual(deck,Array.from({length:52},(_,n)=>n));
  assert.throws(()=>shuffledDeck(max=>max),/invalid_card_draw/);
  assert.deepEqual(handValue([0,13,8]),{total:21,soft:true,natural:false});assert.equal(handValue([0,13,8,22]).total,21);
  assert.equal(handValue([0,9]).natural,true);assert.equal(handValue([9,8,1]).natural,false);
  const game=(player,dealer,deck)=>({player,dealer,deck,turn:0,outcome:'active'});
  const soft=game([9,7],[0,5],[12]);assert.equal(playBlackjack(soft,'stand').outcome,'win');assert.equal(soft.dealer.length,2);
  assert.equal(playBlackjack(game([9,7],[22,20],[]),'stand').outcome,'push');
  assert.equal(playBlackjack(game([9,8],[22,23],[3]),'hit').outcome,'lose');
  const hidden=publicBlackjack(dealBlackjack(max=>max-1));assert.equal(hidden.dealer[1],null);assert.ok(!('deck' in hidden));
  // Deterministically place cards through a legitimate permutation for naturals.
  const drawFor=(prefix)=>{const target=[...prefix,...Array.from({length:52},(_,n)=>n).filter(n=>!prefix.includes(n))],deck=Array.from({length:52},(_,n)=>n);return max=>{const i=max-1,j=deck.indexOf(target[i]);[deck[i],deck[j]]=[deck[j],deck[i]];return j;};};
  assert.equal(dealBlackjack(drawFor([0,2,9,3])).outcome,'win');assert.equal(dealBlackjack(drawFor([2,0,3,9])).outcome,'lose');assert.equal(dealBlackjack(drawFor([0,13,9,22])).outcome,'push');
});
test('fair cards retain normal odds; the police wheel reduces expected loss fines by 80% and makes ordinary theft profitable',t=>{
  let seed=918271;const draw=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*max);};
  const counts={win:0,lose:0,push:0},runs=60000,upcards=Array(52).fill(0);
  for(let n=0;n<runs;n++){
    const g=dealBlackjack(draw);upcards[g.dealer[0]]++;
    while(g.outcome==='active'){
      const {total,soft}=handValue(g.player),up=Math.min(g.dealer[0]%13+1,10),dealer=up===1?11:up;
      const stand=soft ? total>=19 || total===18&&[2,7,8].includes(dealer) : total>=17 || total>=13&&dealer<=6 || total===12&&dealer>=4&&dealer<=6;
      playBlackjack(g,stand?'stand':'hit');
    }
    counts[g.outcome]++;
  }
  const rates=Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,value/runs]));
  t.diagnostic(`60,000 seeded fair hands: win ${(rates.win*100).toFixed(2)}%, loss ${(rates.lose*100).toFixed(2)}%, expected caught ${(rates.lose*POLICE_CATCH_PERCENT).toFixed(2)}%, push ${(rates.push*100).toFixed(2)}%. Simulation, not live telemetry.`);
  assert.ok(rates.win>.40&&rates.win<.46,JSON.stringify(rates));assert.ok(rates.lose>.46&&rates.lose<.52);assert.ok(rates.push>.06&&rates.push<.12);
  assert.ok(upcards.every(count=>Math.abs(count-runs/52)<runs/52*.15));
  for(const value of [1,50,100,1000,1000000])for(const guard of [true,false])for(const location of [.65,1,1.8]){
    const quote=theftQuote(value,guard,location);assert.ok(!('chancePercent' in quote));assert.equal(quote.policeCatchPercent,20);assert.ok(Math.abs(rates.lose*quote.fine*POLICE_CATCH_PERCENT/100/(rates.lose*quote.fine)-.2)<1e-10);
  }
  const ordinary=theftQuote(100,false,1),guarded=theftQuote(100,true,1);
  assert.ok(rates.win*100-rates.lose*ordinary.fine*POLICE_CATCH_PERCENT/100>0);
  assert.ok(guarded.fine>ordinary.fine);
  assert.equal(jailDuration(1),5*60000);assert.equal(jailDuration(2),15*60000);assert.equal(jailDuration(3),45*60000);assert.equal(jailDuration(100),24*3600000);
});
