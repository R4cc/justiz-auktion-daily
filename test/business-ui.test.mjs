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

test('restocking is a per-store modal with quantity inputs and capacity checks', () => {
  assert.match(source, /data-business="open-restock" data-shop=/);
  assert.match(source, /id="business-restock-form"/);
  assert.match(source, /type="number" name="quantity"/);
  assert.match(source, /data-business="auto-restock"/);
  assert.match(source, /selected > space/);
  assert.doesNotMatch(source, /business-stock-form|business-bid-form|business-tabs/);
});
