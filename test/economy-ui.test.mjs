import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const accountSource = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../dist/economy-ui.js', import.meta.url), 'utf8');
const dataSource = await readFile(new URL('../dist/economy.js', import.meta.url), 'utf8');
const extract = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test('economy helpers use authenticated history/list/bid/cancel contracts and safe encoded IDs', async () => {
  const calls = [], reads = [];
  const context = vm.createContext({ window: { accountApi: async (...args) => { calls.push(args); return {}; } },
    fetch: async url => { reads.push(url); return { ok: true, json: async () => ({ features: { resales: true } }) }; } });
  vm.runInContext(dataSource, context);
  const api = context.window.justizEconomy;
  await api.myPaletteAuctions(10, 20); await api.myListings();
  await api.paletteAuctionRewards('a/b'); await api.resaleBid('listing', 123);
  await api.listItem({ inventoryId: 'item', startPrice: 20, endsAt: 'end' }); await api.cancelListing('listing');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['palette-auctions?limit=10&offset=20', null], ['resale/listings', null],
    ['palette-auctions/a%2Fb/rewards', null], ['resale/bid', { id: 'listing', amount: 123 }],
    ['resale/listings', { inventoryId: 'item', startPrice: 20, endsAt: 'end' }], ['resale/cancel', { id: 'listing' }]
  ]);
  assert.equal(reads[0], '/api/features');
});

test('resale inventory and legacy reward markup never render instant-sell buttons; flags off retain them', () => {
  const item = { id: 'item', title: 'Tool', price: 100, sellValue: 100, estimatedValueTokens: 120, rarity: 'common', image: '/tool.jpg' };
  const context = vm.createContext({ economyFlags: { resales: true }, accountResult: item,
    t: en => en, number: String, euro: value => `EUR ${value}`, accountEscape: String, rarityLabel: String });
  vm.runInContext(extract(accountSource, 'function itemCard(', 'function groupedInventory(')
    + extract(accountSource, 'function resultMarkup(', 'function tierCard('), context);
  const markup = vm.runInContext(`itemCard(${JSON.stringify(item)}) + resultMarkup()`, context);
  assert.match(markup, /List for auction/); assert.match(markup, /Estimated market value/);
  assert.doesNotMatch(markup, /data-account="sell/);
  context.economyFlags = {};
  assert.match(vm.runInContext(`itemCard(${JSON.stringify(item)}) + resultMarkup()`, context), /data-account="sell/);
  context.economyFlags = { resales: true };
  const listed = vm.runInContext(`itemCard(${JSON.stringify({ ...item, listed: true })})`, context);
  assert.match(listed, /disabled/); assert.match(listed, /Already listed/);
});

test('palette reveal animates exactly one fixed server reward per continuation, then shows summary', async () => {
  const rewards = ['first', 'second', 'third'].map(title => ({ item: { title, rarity: 'common', price: 100 } }));
  const animations = [], statuses = [], summaries = [];
  const context = vm.createContext({
    reveal: { rewards, pool: [{ title: 'decoy', rarity: 'common' }] }, revealPosition: 0, dialogSequence: 0, accountVisit: 1,
    dialog: { open: true, querySelector: selector => selector === '.palette-result' ? {
      set innerHTML(value) { statuses.push(value); }
    } : { focus() {} } },
    openDialog() {}, spinCaseReel: async (_reel, _viewport, item, _pool, valid) => { assert.equal(valid(), true); animations.push(item.title); },
    revealSummary: fixed => summaries.push(fixed), t: en => en, esc: String, rarityLabel: String, euro: String
  });
  vm.runInContext(extract(uiSource, '  async function revealNext(', '  function revealSummary('), context);
  await vm.runInContext('revealNext()', context);
  assert.deepEqual(animations, ['first']); assert.doesNotMatch(statuses[0], /second|third/);
  await vm.runInContext('revealNext()', context); assert.deepEqual(animations, ['first', 'second']);
  await vm.runInContext('revealNext()', context); assert.deepEqual(animations, ['first', 'second', 'third']);
  await vm.runInContext('revealNext()', context); assert.equal(summaries.length, 1); assert.equal(animations.length, 3);
});

test('closing or navigating during palette animation suppresses the pending item', async () => {
  let finish, writes = 0;
  const context = vm.createContext({ reveal: { rewards: [{ item: { title: 'secret' } }], pool: [] }, revealPosition: 0,
    dialogSequence: 0, accountVisit: 1, dialog: { open: true, querySelector: () => ({ set innerHTML(_) { writes++; } }) },
    openDialog() {}, spinCaseReel: () => new Promise(resolve => { finish = resolve; }), t: en => en, esc: String });
  vm.runInContext(extract(uiSource, '  async function revealNext(', '  function revealSummary('), context);
  const pending = vm.runInContext('revealNext()', context);
  context.dialogSequence++; context.dialog.open = false; finish(); await pending;
  assert.equal(writes, 0); assert.equal(context.revealPosition, 0);
});

test('progression terminal state and all new routes remain in syntax verification', async () => {
  const context = vm.createContext({ t: en => en, number: String });
  vm.runInContext(uiSource.slice(0, uiSource.indexOf('window.economyUi')), context);
  const terminal = vm.runInContext('progressionMarkup({level:20,xp:36100,nextLevelXp:null,progress:1})', context);
  assert.match(terminal, /Level 20 reached/); assert.doesNotMatch(terminal, /NaN/);
  const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const route of ['/auctions', '/marketplace', '/market', '/news']) assert.ok(index.includes(`href="${route}"`));
});
