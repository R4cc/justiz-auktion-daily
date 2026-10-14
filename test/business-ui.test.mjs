import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/business-ui.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('  function groupedRestockItems('),
  source.indexOf('  function quickRestockMarkup('));
const context = vm.createContext({});
vm.runInContext(`${helpers}\nthis.groupedRestockItems = groupedRestockItems; this.autoRestockCounts = autoRestockCounts;`, context);

test('stock transfers group copies and auto fill maximizes title variety within capacity', () => {
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

test('shared task surfaces stage stock and save all settings atomically', () => {
  assert.match(source,/data-shop-settings/);
  assert.match(source,/data-shop-stock/);
  assert.match(source,/removeIds:d.remove/);
  assert.match(source,/businesses\/stock\/transfer/);
  assert.match(source,/businesses\/settings/);
  assert.match(source,/expected:d.expected/);
  assert.doesNotMatch(source,/duration: 6500|businesses\/unstock|businesses\/margin|data-store-profile/);
  assert.match(source,/quickJobs.has\(shop.id\)/);
  assert.match(source,/localStorage.setItem\(key,id\)/);
});
