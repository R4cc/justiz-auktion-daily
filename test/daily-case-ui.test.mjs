import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function renderDailyCaseDialog()'), source.indexOf('function renderResults()'));
const serialized = value => JSON.parse(JSON.stringify(value));
function setup(api) {
  const requests = [], messages = [], reveals = [];
  let results = 0;
  const dialog = { open: false, innerHTML: '', showModal() { this.open = true; }, close() { this.open = false; },
    querySelector() { return { focus() {} }; } };
  const context = vm.createContext({
    dailyCaseDialog: dialog, account: { id: 'player' }, accountVisit: 0,
    accountDailyRun: { id: 'run', dailyCase: { status: 'ready', tier: 'epic' } },
    gameMode: 'daily', state: { view: 'results', answers: [{ score: 700 }, { score: 800 }] },
    accountApi: async (...args) => { requests.push(serialized(args)); return api ? api(...args) : { user: { id: 'player' }, item: { id: 'sealed', kind: 'case' } }; },
    updateAccount() {}, renderResults() { results++; }, showToast: message => messages.push(message),
    t: en => en, number: String, rarityLabel: id => id, auctionEscape: String,
    recordReveal: item => reveals.push(item)
  });
  vm.runInContext('let dailyCasePromptedRun = null, dailyCaseBusy = false, dailyCaseClaim = null;' + functions, context);
  vm.runInContext('showDailyCaseItem = recordReveal; promptDailyCase();', context);
  return { context, dialog, requests, messages, reveals, get results() { return results; },
    claim: choice => vm.runInContext(`claimDailyCase('${choice}')`, context) };
}

test('Daily case offers only Open Now and Add to inventory; keeping returns to results', async () => {
  const run = setup();
  assert.equal(run.dialog.open, true);
  assert.equal((run.dialog.innerHTML.match(/<button/g) || []).length, 2);
  assert.match(run.dialog.innerHTML, /Open Now/);
  assert.match(run.dialog.innerHTML, /Add to inventory/);
  assert.match(run.dialog.innerHTML, /epic/);
  await run.claim('keep');
  assert.deepEqual(run.requests, [['games/daily-case/claim', { id: 'run' }]]);
  assert.equal(run.context.accountDailyRun.dailyCase.status, 'claimed');
  assert.equal(run.dialog.open, false);
  assert.equal(run.context.state.view, 'results');
  assert.equal(run.results, 1);
  assert.equal(run.reveals.length, 0);
  assert.match(run.messages[0], /added to inventory/i);
});

test('Open Now claims the case and opens the returned inventory ID', async () => {
  const run = setup(route => ({ user: { id: 'player' }, item: route === 'inventory/case/open' ? { id: 'find', title: 'Reward' } : { id: 'sealed' } }));
  await run.claim('open');
  assert.deepEqual(run.requests, [['games/daily-case/claim', { id: 'run' }], ['inventory/case/open', { id: 'sealed' }]]);
  assert.equal(run.dialog.open, false);
  assert.equal(run.results, 1);
  assert.equal(run.reveals[0].id, 'find');
});

for (const choice of ['open', 'keep']) {
  test(`failed opening can ${choice === 'open' ? 'retry' : 'keep the sealed case'} without claiming another case`, async () => {
    let failures = 1;
    const run = setup(route => {
      if (route === 'inventory/case/open' && failures--) throw new Error('Temporary failure');
      return { user: { id: 'player' }, item: { id: 'sealed' } };
    });
    await run.claim('open');
    assert.equal(run.dialog.open, true);
    assert.match(run.messages[0], /Temporary failure/);
    assert.doesNotMatch(run.dialog.innerHTML, /disabled/);
    await run.claim(choice);
    assert.equal(run.dialog.open, false);
    assert.equal(run.requests.filter(([route]) => route === 'games/daily-case/claim').length, 1);
    assert.equal(run.reveals.length, choice === 'open' ? 1 : 0);
  });
}

test('double clicks and navigation do not open a stale reward popup', async () => {
  let resolve;
  const run = setup(() => new Promise(done => { resolve = done; }));
  const pending = run.claim('open');
  await run.claim('open');
  assert.equal(run.requests.length, 1);
  run.context.accountVisit++;
  resolve({ user: { id: 'player' }, item: { id: 'sealed' } });
  await pending;
  assert.equal(run.requests.length, 1);
  assert.equal(run.reveals.length, 0);
  assert.equal(run.results, 0);
});

test('account changes suppress a pending claim response', async () => {
  let resolve;
  const run = setup(() => new Promise(done => { resolve = done; }));
  const pending = run.claim('open');
  run.context.account = { id: 'other-player' };
  resolve({ user: { id: 'player' }, item: { id: 'sealed' } });
  await pending;
  assert.equal(run.context.accountDailyRun.dailyCase.status, 'ready');
  assert.equal(run.reveals.length, 0);
});
