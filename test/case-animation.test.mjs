import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const pullSource = source.slice(source.indexOf('async function pullCase('), source.indexOf("document.addEventListener('click'", source.indexOf('async function pullCase(')));
const tierSource = source.slice(source.indexOf('function tierCard('), source.indexOf('function revealCaseItem('));
const flush = () => new Promise(resolve => setImmediate(resolve));

function opening(reduced) {
  const timers = [], frames = [];
  let revealed = 0, elapsed = 0, markup = '';
  const reel = {
    isConnected: true, classList: { add() {} }, children: [],
    set innerHTML(value) {
      markup = value; frames.push(value);
      this.children = [...value.matchAll(/class="case-tier /g)].map(() => ({
        classList: { add() {} }, getBoundingClientRect: () => ({ width: 170 })
      }));
    },
    get innerHTML() { return markup; },
    animate(frames, options) {
      return { finished: new Promise(resolve => timers.push({ resolve, ms: options.duration })) };
    }
  };
  const item = { id: 'pull', rarity: 'legendary', title: 'SECRET WINNER', image: '/secret.jpg', caseId: 'test' };
  const status = { innerHTML: '' };
  const context = vm.createContext({
    account: { id: 'user' }, accountCatalog: { cases: [{ id: 'test', items: [{ rarity: 'common', title: 'SECRET DECOY', image: '/decoy.jpg' }] }], revision: 'edition' },
    accountSelectedCase: 'test', accountVisit: 1, accountResult: null, caseOpening: null,
    accountApi: async () => ({ user: { id: 'user' }, item }),
    updateAccount() {}, renderAccountPage() {},
    accountContent: { querySelector: selector => ({ '.case-reel': reel, '.case-window': { clientWidth: 500 }, '.case-result': status })[selector] },
    localStorage: { getItem() {}, setItem() {}, removeItem() {} }, crypto: { randomUUID: () => 'request' },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (resolve, ms) => timers.push({ resolve, ms }),
    t: en => en, accountEscape: String, rarityLabel: String,
    resultMarkup: () => 'REVEALED', revealCaseItem: () => { revealed++; }
  });
  vm.runInContext(tierSource + pullSource, context);
  return { context, reel, frames, status, start: () => vm.runInContext('pullCase(1)', context),
    get revealed() { return revealed; }, get elapsed() { return elapsed; },
    async tick() { const timer = timers.shift(); assert.ok(timer); elapsed += timer.ms; timer.resolve(); await flush(); }
  };
}

for (const reduced of [false, true]) {
  test(`case reveal hides items and waits for the full sequence (${reduced ? 'reduced motion' : 'normal motion'})`, async () => {
    const run = opening(reduced), done = run.start();
    await flush();
    assert.equal(run.context.accountResult, null);
    for (let step = 0; step < (reduced ? 8 : 1); step++) {
      assert.equal(run.revealed, 0);
      await run.tick();
    }
    assert.equal(run.elapsed, 5200);
    assert.equal(run.revealed, 0);
    assert.match(run.status.innerHTML, /legendary/);
    assert.ok(run.frames.every(frame => !/SECRET|<img|secret.jpg|decoy.jpg/.test(frame)));
    if (reduced) assert.equal(run.reel.children.length, 1);
    await run.tick(); await done;
    assert.equal(run.elapsed, 5950);
    assert.equal(run.revealed, 1);
    assert.equal(run.context.accountResult.title, 'SECRET WINNER');
    assert.equal(run.context.caseOpening, null);
  });
  test(`navigation suppresses stale case popup (${reduced ? 'reduced' : 'normal'})`, async () => {
    const run = opening(reduced), done = run.start();
    await flush();
    run.context.accountVisit = 2;
    await run.tick(); await done;
    assert.equal(run.revealed, 0);
    assert.equal(run.context.caseOpening, null);
  });
}
