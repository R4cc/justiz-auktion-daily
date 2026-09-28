import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function renderDailyCaseDialog()'), source.indexOf('function renderResults()'));

test('Daily completion prompts to add a sealed case, then returns to the final score', async () => {
  const requests = [], messages = [];
  let results = 0;
  const dialog = { open: false, innerHTML: '', showModal() { this.open = true; }, close() { this.open = false; },
    querySelector() { return { focus() {} }; } };
  const context = vm.createContext({
    dailyCaseDialog: dialog, account: { id: 'player' },
    accountDailyRun: { id: 'run', dailyCase: { status: 'ready', tier: 'epic' } },
    gameMode: 'daily', state: { view: 'results', answers: [{ score: 700 }, { score: 800 }] },
    accountApi: async (...args) => { requests.push(args); return { user: { id: 'player' }, item: { id: 'sealed', kind: 'case' } }; },
    updateAccount() {}, renderResults() { results++; }, showToast: message => messages.push(message),
    t: en => en, number: String, rarityLabel: id => id, auctionEscape: String
  });
  vm.runInContext('let dailyCasePromptedRun = null, dailyCaseBusy = false;' + functions, context);
  vm.runInContext('promptDailyCase()', context);
  assert.equal(dialog.open, true);
  assert.match(dialog.innerHTML, /Add to inventory/);
  assert.match(dialog.innerHTML, /epic/);
  assert.doesNotMatch(dialog.innerHTML, /one item from/i);
  await vm.runInContext('claimDailyCase()', context);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [['games/daily-case/claim', { id: 'run' }]]);
  assert.equal(context.accountDailyRun.dailyCase.status, 'claimed');
  assert.equal(dialog.open, false);
  assert.equal(results, 1);
  assert.match(messages[0], /added to inventory/i);
});
