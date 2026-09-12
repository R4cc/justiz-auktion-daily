import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { higherLowerDeck } from '../src/higher-lower.mjs';

const lots = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Product ${i + 100}`,
  category: ['Werkzeug', 'Elektronik', 'Fahrrad', 'Kosmetik', 'Getränke'][i % 5],
  image: `assets/${i}.jpg`, finalPrice: i + 10, endAt: '2020-01-01T00:00:00Z', capturedAt: '2020-01-02T00:00:00Z' }));
test('Higher or Lower uses confirmed finals, excludes duplicate families, and preserves variety in every block', () => {
  const deck = higherLowerDeck([...lots, { ...lots[0], id: 999 },
    { ...lots[1], id: 998, finalPrice: null }, { ...lots[2], id: 997, capturedAt: '2019-01-01' }], () => .4).auctions;
  assert.equal(deck.length, 20);
  assert.equal(new Set(deck.map(item => item.title)).size, 20);
  assert.ok(deck.every(item => item.actualBid > 0 && !('finalPrice' in item)));
  for (let i = 0; i < deck.length; i += 5) {
    const block = deck.slice(i, i + 5);
    assert.ok(new Set(block.map(item => item.category)).size >= 4);
    assert.ok(block.filter(item => item.category === 'Getränke').length <= 1);
  }
  assert.throws(() => higherLowerDeck(lots.map(item => ({ ...item, capturedAt: '2019-01-01' }))), { code: 'insufficient_variety' });
});

test('client streak handles ties, prevents repeated guesses, stops on a miss and completes the deck', async () => {
  const storage = new Map();
  const context = vm.createContext({ window: { scrollTo() {} }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(await readFile(new URL('../dist/higher-lower.js', import.meta.url), 'utf8'), context);
  vm.runInContext(`let state = { view: 'higher-lower' }; renderHigherLower = () => {};
    higherLowerRun = { auctions: [10, 20, 20, 5].map(actualBid => ({ actualBid })), index: 1, streak: 0, revealed: false, images: [0, 0] };`, context);
  const evaluate = code => vm.runInContext(code, context);
  evaluate("guessHigherLower('higher'); guessHigherLower('higher');");
  assert.equal(evaluate('higherLowerRun.streak'), 1);
  evaluate("nextHigherLower(); guessHigherLower('lower');");
  assert.equal(evaluate('higherLowerRun.streak'), 2);
  evaluate("nextHigherLower(); guessHigherLower('higher'); nextHigherLower();");
  assert.equal(evaluate('higherLowerRun.correct'), false);
  assert.equal(evaluate('higherLowerRun.index'), 3);
  assert.equal(evaluate('hlBest()'), 2);
  evaluate("higherLowerRun.revealed = false; guessHigherLower('lower'); nextHigherLower();");
  assert.equal(evaluate('higherLowerRun.index'), 3);
  assert.equal(evaluate('hlBest()'), 3);
});
