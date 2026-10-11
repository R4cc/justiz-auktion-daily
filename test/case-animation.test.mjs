import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const pullSource = source.slice(source.indexOf('async function spinCaseReel('), source.indexOf("document.addEventListener('click'", source.indexOf('async function pullCase(')));
const tierSource = source.slice(source.indexOf('function tierCard('), source.indexOf('function revealCaseItem('));
const flush = () => new Promise(resolve => setImmediate(resolve));

function opening(reduced) {
  const timers = [], frames = [], transforms = [];
  let revealed = 0, elapsed = 0, markup = '';
  const animations = [];
  const reel = {
    isConnected: true, classList: { add() {} }, children: [],
    style: { set transform(value) { transforms.push(value); } },
    set innerHTML(value) {
      markup = value; frames.push(value);
      this.children = [...value.matchAll(/class="case-tier /g)].map(() => ({
        classList: { add() {} }, getBoundingClientRect: () => ({ width: 170 })
      }));
    },
    get innerHTML() { return markup; },
    animate(frames, options) {
      let rejectAnimation;
      const animation = { frames, options,
        finished: new Promise((resolve, reject) => { rejectAnimation = reject; timers.push({ resolve, ms: options.duration }); }),
        cancel: () => rejectAnimation(Error('Animation cancelled')) };
      animations.push(animation);
      return animation;
    }
  };
  const item = { id: 'pull', rarity: 'legendary', title: 'SECRET WINNER', image: '/secret.jpg', caseId: 'test' };
  const status = { innerHTML: '' };
  const context = vm.createContext({
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    account: { id: 'user' }, accountCatalog: { cases: [{ id: 'test', items: [{ rarity: 'common', title: 'SECRET DECOY', image: '/decoy.jpg' }] }], revision: 'edition' },
    accountSelectedCase: 'test', accountVisit: 1, accountResult: null, caseOpening: null, caseStockRequest: 0,
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
  return { context, reel, frames, transforms, animations, status, start: () => vm.runInContext('pullCase(1)', context),
    get revealed() { return revealed; }, get elapsed() { return elapsed; },
    async tick() { const timer = timers.shift(); assert.ok(timer); elapsed += timer.ms; timer.resolve(); await flush(); return timer.ms; }
  };
}

for (const reduced of [false, true]) {
  test(`case reveal hides items and waits for the full sequence (${reduced ? 'reduced motion' : 'normal motion'})`, async () => {
    const run = opening(reduced), done = run.start();
    await flush();
    assert.equal(run.context.accountResult, null);
    const delays = [];
    for (let step = 0; step < 1; step++) {
      assert.equal(run.revealed, 0);
      delays.push(await run.tick());
    }
    assert.deepEqual(delays, [5050]);
    assert.equal(run.elapsed, 5050);
    assert.equal(run.revealed, 0);
    assert.match(run.status.innerHTML, /legendary/);
    assert.ok(run.frames.every(frame => !/SECRET|<img|secret.jpg|decoy.jpg/.test(frame)));
    assert.equal(run.reel.children.length, 42);
    // The requested full spin and exact landing also apply to reduced motion.
    const winner = 28 + Math.floor(0.5 * 12), at = -(winner * (170 + 12) + 170 * (0.25 + 0.5 * 0.5) - 500 / 2);
    assert.equal(run.animations.length, 1);
    assert.equal(run.animations[0].frames[1].transform, `translateX(${at}px)`);
    await run.tick(); await done;
    assert.equal(run.elapsed, 5800);
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
  test(`cancelling a hidden reel releases opening state without an error (${reduced ? 'reduced' : 'normal'})`, async () => {
    const run = opening(reduced), done = run.start();
    await flush(); run.context.accountVisit = 2; run.animations[0].cancel();
    await done;
    assert.equal(run.revealed, 0); assert.equal(run.context.caseOpening, null);
  });
}
