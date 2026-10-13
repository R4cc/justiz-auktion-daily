import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const sharing = source.slice(source.indexOf('function shareText()'), source.indexOf('function launchConfetti()'));
const render = source.slice(source.indexOf('function renderResults()'), source.indexOf('function resultRow('));
const answers = [{ score: 1000, error: 0 }, { score: 900, error: 1 }, { score: 700, error: 4 }, { score: 500, error: 10 }, { score: 0, error: null }];
function context(mode = 'daily', language = 'en') {
  const copied = [], toasts = [];
  const ctx = vm.createContext({
    app: { innerHTML: '' }, window: { location: { origin: 'https://daily.example.org', pathname: '/inventory', search: '?focus=private', hash: '#private' }, scrollTo() {} },
    URL, clearInterval() {}, countdownTimer: null, stopGuessTimer() {},
    state: { answers }, gameMode: mode, gameNumber: () => 286, number: String,
    stats: () => ({ streak: 12 }), dayLabel: n => `${n} days`, uiLocale: () => language === 'en' ? 'en-US' : 'de-DE',
    t: (en, de) => language === 'en' ? en : de, accuracy: () => ({ emoji: '🟩' }),
    AUCTIONS: answers.map(() => ({})), resultRow: () => '<div class="result-row"></div>',
    promptDailyCase() {}, infoTip: String,
    navigator: { clipboard: { writeText: async text => copied.push(text) } }, showToast: text => toasts.push(text)
  });
  vm.runInContext(sharing + render, ctx);
  return { ctx, copied, toasts };
}

for (const mode of ['daily', 'random']) for (const language of ['en', 'de']) {
  test(`${mode} results have exactly copy and archive actions (${language})`, () => {
    const run = context(mode, language);
    vm.runInContext('renderResults()', run.ctx);
    const actions = run.ctx.app.innerHTML.split('<div class="results-actions">')[1].split('<div class="data-note">')[0];
    assert.deepEqual([...actions.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]), ['copy', 'random']);
    assert.equal((actions.match(/<button/g) || []).length, 2);
    assert.match(actions, language === 'en' ? /Copy Results/ : /Ergebnis kopieren/);
    assert.match(actions, language === 'en' ? /Play the archive/ : /Archiv spielen/);
  });
  test(`${mode} copied results retain scores and use the public Daily URL without streak (${language})`, async () => {
    const run = context(mode, language);
    await vm.runInContext('copyResult()', run.ctx);
    const text = run.copied[0];
    assert.equal(text.split('\n').at(-1), 'https://daily.example.org/');
    assert.doesNotMatch(text, /streak|12 days|inventory|private/i);
    assert.equal((text.match(/🟩/g) || []).length, 5);
    assert.match(text, /3[,.]100 \/ 5000/);
    assert.match(text, mode === 'daily' ? /JUSTIZGUESSR #286/ : /JUSTIZGUESSR ·/);
  });
}

test('clipboard fallback copies the same public link', async () => {
  const run = context();
  let field;
  run.ctx.navigator.clipboard.writeText = async () => { throw new Error('Unavailable'); };
  run.ctx.document = { createElement: () => field = { style: {}, setAttribute() {}, select() {}, remove() {} },
    body: { append() {} }, execCommand: command => command === 'copy' };
  await vm.runInContext('copyResult()', run.ctx);
  assert.match(field.value, /https:\/\/daily.example.org\/$/);
  assert.doesNotMatch(field.value, /streak/i);
  assert.match(run.toasts[0], /copied/);
});
