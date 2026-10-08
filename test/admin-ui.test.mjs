import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const fragment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function fixture(overrides = {}) {
  const content = { innerHTML: '' };
  const context = vm.createContext({
    accountContent: content, account: { id: 'admin', admin: true }, adminActiveTab: 'market', adminMarketFilter: '', adminUserFilter: '', accountBusy: false,
    accountAdmin: { playerCount: 2, users: [{ id: 'admin', username: 'Admin', tokens: 1000, admin: true }, { id: 'player', username: 'Player', tokens: 2000, banned: true }], grants: [], lastReset: null },
    accountAdminMarket: { categories: [{ id: 'wine', name: 'Wine', nameDe: 'Wein', currentIndex: 110, multiplier: 1.1 }, { id: 'toys', name: 'Toys', nameDe: 'Spielzeug', currentIndex: 100, multiplier: 1 }], presets: [-80, -5, 5, 10], history: [] },
    accountCodes: [{ id: 'code-1', label: '123456', used_at: null, revoked: false }, { id: 'code-2', label: '654321', used_at: 42, revoked: false }],
    freshCodes: [], freshPasswordReset: null, accountAuctions: { query: '', total: 0, page: 1, pages: 1, auctions: [] },
    t: en => en, number: String, justizEuro: value => `J€ ${value}`, euro: String, accountEscape: escape, uiLocale: () => 'en-GB', infoTip: () => '', pageHeading: title => `<h1>${title}</h1>`, ...overrides
  });
  vm.runInContext(fragment('function adminIcon(', 'async function loadAuctionBrowser(') + fragment('function adminMarketMarkup()', 'async function applyAdminMarketChange(') + fragment('function selectAdminTab(', 'function caseStockLabel('), context);
  return { context, content, render: () => { vm.runInContext('renderAdmin()', context); return content.innerHTML; } };
}

test('admin workspace gates private content and retains its selected tool after a data refresh', () => {
  const f = fixture();
  let markup = f.render();
  assert.equal((markup.match(/role="tab"/g) || []).length, 5);
  assert.equal((markup.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(markup, /id="admin-panel-market"[^>]*tabindex="0" >/);
  assert.match(markup, /id="admin-panel-players"[^>]*hidden/);
  f.context.adminActiveTab = 'access';
  markup = f.render();
  assert.match(markup, /id="admin-tab-access"[^>]*aria-selected="true"/);
  assert.match(markup, /id="admin-panel-access"[^>]*tabindex="0" >/);
  f.context.account = { admin: false };
  markup = f.render();
  assert.match(markup, /Log in with an admin account/);
  assert.doesNotMatch(markup, /data-admin-tab|registration_codes|code-1|data-account="market-adjust"/);
});

test('market search survives a category update and shows an empty result without removing controls', () => {
  const f = fixture({ adminMarketFilter: 'wein' });
  let markup = vm.runInContext('adminMarketMarkup()', f.context);
  assert.match(markup, /data-market-category="wine"[^>]* >/);
  assert.match(markup, /data-market-category="toys"[^>]*hidden/);
  assert.match(markup, /id="admin-market-search"[^>]*value="wein"/);
  assert.match(markup, /data-account="market-reset" data-category="toys" disabled/);
  assert.doesNotMatch(markup, /data-account="market-reset" data-category="wine" disabled/);
  f.context.adminMarketFilter = 'missing';
  markup = vm.runInContext('adminMarketMarkup()', f.context);
  assert.match(markup, /id="admin-market-empty"[^>]* >No categories/);
  f.context.accountBusy = true;
  markup = vm.runInContext('adminMarketMarkup()', f.context);
  assert.equal((markup.match(/data-account="market-adjust"[^>]* disabled/g) || []).length, 8);
});

test('admin controls escape external values and keep one-time codes and passwords reviewable', () => {
  const hostile = '</textarea><script>alert(1)</script>';
  const f = fixture({ freshCodes: [hostile], freshPasswordReset: { username: 'Player', temporaryPassword: hostile } });
  f.context.accountAdminMarket.categories[0].name = '<img src=x onerror=alert(1)>';
  f.context.accountCodes[0].id = '" onclick="alert(1)';
  const markup = f.render();
  assert.doesNotMatch(markup, /<script>|<img src=x|onclick="alert/);
  assert.match(markup, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.match(markup, /data-id="&quot; onclick=&quot;alert/);
});

test('tab activation changes visibility and the roving focus without replacing form values', () => {
  const controls = ['market', 'players', 'auctions', 'access', 'maintenance'].map(name => ({ dataset: { adminTab: name }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused = true; } }));
  const panels = controls.map(control => ({ dataset: { adminPanel: control.dataset.adminTab }, hidden: true }));
  const f = fixture({ accountContent: {
    innerHTML: 'existing forms',
    querySelector: selector => controls.find(control => selector === `[data-admin-tab="${control.dataset.adminTab}"]`),
    querySelectorAll: selector => selector === '[data-admin-tab]' ? controls : panels
  } });
  vm.runInContext("selectAdminTab('players', true)", f.context);
  assert.equal(f.context.adminActiveTab, 'players');
  assert.equal(controls[1].focused, true);
  assert.equal(controls[1].tabIndex, 0);
  assert.equal(controls.filter(control => control.attributes['aria-selected'] === 'true').length, 1);
  assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.adminPanel), ['players']);
  assert.equal(f.context.accountContent.innerHTML, 'existing forms');
  vm.runInContext("selectAdminTab('missing')", f.context);
  assert.equal(f.context.adminActiveTab, 'players');
});
