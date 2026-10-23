import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const parsing = source.slice(source.indexOf('function guessValue('), source.indexOf('// Serialize writes'));
const timing = source.slice(source.indexOf('function stopGuessTimer()'), source.indexOf('let dailySubmitting'));
const play = source.slice(source.indexOf('let dailySubmitting'), source.indexOf('function finishGame()'));

function fixture() {
  let renders = 0, clock = 10000;
  const errors = [], calls = [];
  const input = { value: '' };
  const button = { disabled: false, isConnected: true };
  const fill = { style: {} }, bar = { querySelector: () => fill, classList: { toggle() {} }, setAttribute() {} };
  const ctx = vm.createContext({
    Date: { now: () => clock }, GUESS_TIME_LIMIT: 25000, guessTimer: null, guessDeadline: 0,
    gameMode: 'daily', higherLowerRequest: 1,
    state: { view: 'game', round: 0, answers: [] },
    accountDailyRun: { id: 'run', clientDeadlineAt: 30000, roundDeadlineAt: 30000 },
    AUCTIONS: [{ title: 'Hidden' }, {}, {}, {}, {}],
    document: { querySelector: selector => selector === '[data-guess-timer]' ? bar : selector === '#guess-form' ? {} : selector === '#price-input' ? input : button },
    setInterval: callback => { ctx.tick = callback; return 1; }, clearInterval() {},
    accountGameAnswer: async (run, position, answer) => {
      calls.push({ action: 'answer', position, answer });
      return { ...run, answers: [null], auctions: [{ actualBid: 100 }, {}, {}, {}, {}] };
    },
    accountGameRoundStart: async (run, position) => {
      calls.push({ action: 'start', position });
      return { ...run, clientDeadlineAt: 55000, auctions: [{ actualBid: 100 }, { title: 'Next' }, {}, {}, {}] };
    },
    scoreGuess: (guess, actual) => guess === null ? 0 : guess === actual ? 1000 : 100,
    currentError: (guess, actual) => Math.abs(guess - actual) / actual * 100,
    saveProgress() {}, renderRound() { renders++; }, showToast: message => errors.push(message),
    requestAnimationFrame() { throw new Error('Late guess must not celebrate'); }, launchConfetti() {},
    finishGame() {}, t: en => en
  });
  vm.runInContext(parsing + timing + play, ctx);
  return { ctx, calls, errors, fill, input, setTime: time => clock = time, renders: () => renders };
}

test('Daily timer uses the saved server deadline across repaint and submits null on expiry', async () => {
  const f = fixture();
  vm.runInContext('startGuessTimer()', f.ctx);
  assert.equal(f.ctx.guessDeadline, 30000);
  f.setTime(20000);
  vm.runInContext('startGuessTimer()', f.ctx);
  assert.equal(f.ctx.guessDeadline, 30000);
  assert.equal(f.fill.style.width, '40%');
  f.setTime(30000);
  await vm.runInContext('expireGuess()', f.ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, [{ action: 'answer', position: 0, answer: null }]);
});

test('a server-rejected late guess displays canonical zero points, then Next starts the new clock', async () => {
  const f = fixture();
  await vm.runInContext('applyGuess(100)', f.ctx);
  assert.equal(f.ctx.state.answers[0].guess, null);
  assert.equal(f.ctx.state.answers[0].score, 0);
  assert.equal(f.ctx.state.answers[0].error, null);
  assert.equal(f.ctx.AUCTIONS[0].actualBid, 100);
  assert.equal(f.calls.length, 1);
  await vm.runInContext('nextRound()', f.ctx);
  assert.equal(f.calls[1].action, 'start');
  assert.equal(f.calls[1].position, 1);
  assert.equal(f.ctx.state.round, 1);
  assert.equal(f.ctx.AUCTIONS[1].title, 'Next');
  assert.equal(f.ctx.accountDailyRun.clientDeadlineAt, 55000);
  assert.deepEqual(f.errors, []);
});

test('Next cannot advance twice or apply a response after navigation', async () => {
  const f = fixture();
  f.ctx.state.answers = [{ guess: null, score: 0 }];
  let complete;
  f.ctx.accountGameRoundStart = () => new Promise(resolve => { complete = resolve; });
  const pending = vm.runInContext('nextRound()', f.ctx);
  await vm.runInContext('nextRound()', f.ctx);
  assert.equal(f.ctx.state.round, 0);
  f.ctx.higherLowerRequest++;
  f.ctx.state.view = 'start';
  complete({ auctions: [{}, { title: 'Stale' }] });
  await pending;
  assert.equal(f.ctx.state.round, 0);
  assert.equal(f.renders(), 0);
});


test('timeout submits the numeric field without Enter, with decimal commas and zero supported', async () => {
  for (const [value, expected] of [['123,45',123.45],[' 1 234.50 ',1234.5],['0',0]]) {
    const f=fixture();f.input.value=value;
    f.ctx.accountGameAnswer=async(run,position,answer)=>{f.calls.push({position,answer});return {...run,answers:[answer],auctions:[{actualBid:100},{},{},{},{}]};};
    await vm.runInContext('expireGuess()',f.ctx);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.calls[0].answer,expected);
    assert.equal(f.ctx.state.answers[0].guess,expected);
    assert.ok(f.ctx.state.answers[0].score>0);
    assert.equal(f.calls.length,1);
  }
});

test('timeout leaves empty, invalid, negative or oversized fields missed and cannot submit twice', async () => {
  for(const value of ['', '  ', 'no bid', '-10', '1e99']){
    const f=fixture();f.input.value=value;
    await vm.runInContext('expireGuess()',f.ctx);await new Promise(resolve=>setImmediate(resolve));
    await vm.runInContext('expireGuess()',f.ctx);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].answer,null);
    assert.equal(f.ctx.state.answers[0].score,0);
  }
});
