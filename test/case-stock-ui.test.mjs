import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function caseStockLabel('), source.indexOf('async function buyStoreCase('));

test('case shop displays global availability and refill time and disables exhausted purchases', async () => {
  const button = { dataset: { id: 'lost-property' } }, label = { dataset: { caseStock: 'lost-property' } };
  const stock = { remaining: 0, limit: 10, restocksAt: Date.parse('2026-10-08T16:00:00Z') };
  const box = { id: 'lost-property', stock, cost: 50, name: 'Lost Property', nameDe: 'Fundbüro', badge: 'LP', dropChances: [], items: [] };
  let remoteStock = stock;
  const context = vm.createContext({ account: { tokens: 1000 }, accountBusy: false, accountVisit: 1, caseStockRequest: 0, currentAccountPage: '/shop', pageLoaded: true,
    accountStore: { cases: [box], rotationDate: '2026-10-08' }, accountCatalog: { cases: [] }, economyFlags: { paletteAuctions: true },
    accountContent: { innerHTML: '', querySelectorAll: selector => selector === '[data-case-stock]' ? [label] : [button], querySelector: () => null },
    t: en => en, uiLocale: () => 'en-GB', justizEuro: String, number: String, accountEscape: String, infoTip: String,
    pageHeading: String, rarityLabel: String, setInterval: () => {},
    accountApi: async () => ({ cases: [{ ...box, stock: remoteStock }] })
  });
  vm.runInContext(functions, context);
  vm.runInContext('renderShop(); updateCasePurchaseButtons()', context);
  assert.match(context.accountContent.innerHTML, /0 \/ 10 left globally · Refills at/);
  assert.match(context.accountContent.innerHTML, /data-account="buy-case"[^>]*disabled>Sold out/);
  assert.doesNotMatch(context.accountContent.innerHTML, /Always in stock/);
  assert.equal(button.disabled, true);
  remoteStock = { ...stock, remaining: 10, restocksAt: stock.restocksAt + 14400000 };
  await vm.runInContext('refreshCaseStock(1)', context);
  assert.equal(button.disabled, false); assert.equal(button.textContent, 'Buy case');
  assert.match(label.textContent, /10 \/ 10 left globally/);
  context.accountBusy = true;
  vm.runInContext('updateCasePurchaseButtons()', context);
  assert.equal(button.disabled, true);
  context.accountVisit = 2; remoteStock = stock;
  await vm.runInContext('refreshCaseStock(1)', context);
  assert.equal(context.accountStore.cases[0].stock.remaining, 10, 'an older page refresh cannot overwrite current state');
  context.accountVisit = 1; context.accountBusy = false;
  let finish;
  context.accountApi = () => new Promise(resolve => { finish = resolve; });
  const pending = vm.runInContext('refreshCaseStock(1)', context);
  context.caseStockRequest++;
  context.accountStore.cases[0].stock = stock;
  finish({ cases: [{ ...box, stock: { ...stock, remaining: 10 } }] });
  await pending;
  assert.equal(context.accountStore.cases[0].stock.remaining, 0, 'a refresh started before a purchase cannot restore stale stock');
});
