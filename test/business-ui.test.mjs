import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/business-ui.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('  function groupedRestockItems('),
  source.indexOf('  function updateRestockSelection('));
const context = vm.createContext({});
vm.runInContext(`${helpers}\nthis.groupedRestockItems = groupedRestockItems; this.autoRestockCounts = autoRestockCounts;`, context);

test('restock modal groups copies and auto fill maximizes title variety within capacity', () => {
  const items = [
    { id: 'a1', title: 'Apple', price: 10 }, { id: 'a2', title: 'Apple', price: 10 },
    { id: 'b1', title: 'Banana', price: 12 }, { id: 'b2', title: 'Banana', price: 12 },
    { id: 'c1', title: 'Cherry', price: 15 }, { id: 'c2', title: 'Cherry', price: 15 }
  ];
  const groups = context.groupedRestockItems(items);
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(group => [group.title, group.items.length]))),
    [['Apple', 2], ['Banana', 2], ['Cherry', 2]]);
  const selected = context.autoRestockCounts(groups, ['Apple'], 4);
  assert.equal(selected.reduce((sum, count) => sum + count, 0), 4);
  assert.ok(selected[1] >= 1 && selected[2] >= 1);
  assert.deepEqual(JSON.parse(JSON.stringify(context.autoRestockCounts(groups, [], 1))), [1, 0, 0]);
  assert.equal(context.autoRestockCounts(groups, [], 10).reduce((sum, count) => sum + count, 0), 6);
});

test('stock manager keeps add and remove controls together with capacity checks', () => {
  assert.match(source, /data-business="open-restock" data-shop=/);
  assert.match(source, /id="business-restock-form"/);
  assert.match(source, /type="number" name="quantity"/);
  assert.match(source, /data-business="auto-restock"/);
  assert.match(source, /business-stock-manager/);
  assert.match(source, /business-available-title/);
  assert.match(source, /business-shelves-title/);
  assert.match(source, /data-business="unstock" data-shop=/);
  assert.match(source, /selected > space/);
  assert.doesNotMatch(source, /shop\.stock\.length >= shop\.capacity\) return/);
  assert.doesNotMatch(source, /business-stock-form|business-bid-form|business-tabs/);
});

test('each store shows the requested metrics, margin control and stock manager at capacity', () => {
  const cardSource = source.slice(source.indexOf('  function shopCard('), source.indexOf('  function shopsView('));
  const context = vm.createContext({ dashboard: { inventory: [] }, esc: String, t: en => en,
    number: String, justizEuro: value => `J€ ${value}`, typeName: () => 'Toy store', sizeName: () => 'Small shop',
    typeIcon: () => '', sizeIcon: () => '' });
  vm.runInContext(`${cardSource}\nthis.shopCard = shopCard;`, context);
  const markup = context.shopCard({ id: 'shop-1', type: 'toys', size: 'tiny', capacity: 1,
    profitMargin: 45, buyChancePercent: 22.8, visitors: 11, popularity: 1,
    variety: 1, value: 120, sales: 2, salesToday: 1, revenue: 300, revenueToday: 174,
    stock: [{ id: 'unit-1', item: { title: 'Puzzle' }, referencePrice: 120, askingPrice: 174 }] });
  for (const label of ['Visitors', 'Popularity', 'Total sales', 'Sales today', 'Total revenue', 'Revenue today', 'Margin', 'Stock'])
    assert.match(markup, new RegExp(`<dt>${label}</dt>`));
  assert.match(markup, /<dd>1 \/ 1<\/dd>/);
  assert.match(markup, /data-business-margin-form data-shop="shop-1"/);
  assert.match(markup, /name="profitMargin"[^>]*value="45"/);
  assert.match(markup, /Estimated buying rate per visitor/);
  assert.match(markup, /data-business="open-restock" data-shop="shop-1"/);
  assert.doesNotMatch(markup, /data-business="open-restock"[^>]*disabled/);
  assert.match(source, /accountApi\('businesses\/margin'/);
});
