import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const accountSource = await readFile(new URL('../dist/account.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../dist/economy-ui.js', import.meta.url), 'utf8');
const dataSource = await readFile(new URL('../dist/economy.js', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../dist/i18n.js', import.meta.url), 'utf8');
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

test('auction bid history is chronological and marks the signed-in player as chat bubbles', () => {
  const context = vm.createContext({ account: { id: 'mine' }, t: en => en, esc: String,
    tokens: value => `${value} tokens`, date: String });
  vm.runInContext(extract(uiSource, '  const bidHistory =', '  const story ='), context);
  const markup = vm.runInContext(`bidHistory([
    {id:'2', bidderId:'other', bidderUsername:'Rival', amount:120, createdAt:20},
    {id:'1', bidderId:'mine', bidderUsername:'Player', amount:100, createdAt:10}
  ])`, context);
  assert.ok(markup.indexOf('100 tokens') < markup.indexOf('120 tokens'));
  assert.match(markup, /auction-chat-message is-mine/);
  assert.match(markup, />You</);
  assert.match(markup, />Rival</);
});

test('legacy story copy moves fiction notices into the single site disclaimer', () => {
  const context = vm.createContext({});
  vm.runInContext(extract(i18nSource, 'function immersiveCopy(', 'function uiLocale('), context);
  assert.equal(vm.runInContext(`immersiveCopy('Fiction: In fictional Grayfield, an invented warehouse opens.')`, context),
    'In Grayfield, a warehouse opens.');
  assert.equal(vm.runInContext(`immersiveCopy('Fiction: the lot comes from an imagined seizure.')`, context),
    'The lot comes from a seizure.');
  assert.equal(vm.runInContext(`immersiveCopy('Im fiktiven Grayfield öffnet eine erfundene Werkstatt.')`, context),
    'In Grayfield öffnet eine Werkstatt.');
});

test('auction detail uses media, story and bid-room columns with the bid form below the log', async () => {
  let markup = '';
  const lot = { id: 'lot', name: 'Palette', story: { parody: true }, items: [{ title: 'Camera', image: '/camera.jpg', rarity: 'rare' }],
    currentBid: 120, currentBidderId: 'mine', bidCount: 2, reserve: 100, requiredLevel: 1,
    allowedMarketCategories: ['electronics'], status: 'active', endsAt: Date.now() + 60_000,
    bids: [{ id: 'b', bidderId: 'mine', bidderUsername: 'Player', amount: 120, createdAt: 1 }] };
  const context = vm.createContext({
    account: { id: 'mine', tokens: 500, progression: { level: 2 } }, data: { mine: [] }, dialogSequence: 0,
    accountVisit: 1, detailId: null, api: { paletteAuction: async () => ({ auction: lot }) },
    t: en => en, esc: String, tokens: value => `${value} tokens`, name: value => value.name,
    story: () => ({ title: 'The story', body: 'A mysterious customs lot.', shortDescription: 'Customs warehouse bust', parody: true }), categoryName: String,
    rarityLabel: String, euro: String, accountError: String, status: () => 'Active',
    bidFacts: () => '<div>120 tokens</div>', bidHistory: () => '<li>bid bubble</li>',
    openDialog: value => { markup = value; }, dialog: { querySelector: () => ({ scrollTop: 0, scrollHeight: 100 }) }
  });
  vm.runInContext(extract(uiSource, '  function bidForm(', '  function listingDialog('), context);
  await vm.runInContext(`showLot('lot', true)`, context);
  assert.ok(markup.indexOf('auction-room-media') < markup.indexOf('auction-room-story'));
  assert.ok(markup.indexOf('auction-room-story') < markup.indexOf('auction-room-bidding'));
  assert.ok(markup.indexOf('data-live-history') < markup.indexOf('auction-bid-dock'));
  assert.match(markup, /Raise bid/);
  assert.doesNotMatch(markup, /camera\.jpg|Camera|Possible contents/);
  assert.match(markup, /palette-artwork/);
  assert.match(markup, /Sealed until your winning reveal/);
  assert.match(markup, /A mysterious customs lot/);
  assert.doesNotMatch(markup, /Customs warehouse bust/);
  assert.doesNotMatch(markup, /PARODY CASE/);
  assert.doesNotMatch(markup, /auction-story-badges/);
});

test('mystery cards never read candidate items and resale media keeps its item photo', () => {
  const context = vm.createContext({ t: en => en, esc: String, account: null, data: {}, tab: 'public',
    name: lot => lot.name, story: () => ({ shortDescription: 'Customs case', body: 'Sealed evidence.' }),
    categoryName: String, bidFacts: () => '', status: () => 'Active' });
  vm.runInContext(extract(uiSource, '  function paletteArtwork(', '  function auctionContents(')
    + extract(uiSource, '  function lotCard(', '  function render('), context);
  const lot = { paletteId: 'electronics', name: 'Mystery palette', currentBid: null, reserve: 100,
    requiredLevel: 1, status: 'active', id: 'lot' };
  Object.defineProperty(lot, 'items', { get() { throw new Error('Candidate items must not be read'); } });
  context.lot = lot;
  const markup = vm.runInContext('lotCard(lot, true) + auctionMedia(lot, true)', context);
  assert.match(markup, /palette-artwork/);
  assert.match(markup, /palette-seal/);
  assert.match(markup, /<h2>Mystery palette<\/h2>/);
  assert.doesNotMatch(markup, /<img|Possible contents|possible finds/);
  assert.doesNotMatch(markup, /economy-incident|auction-case-label|auction-parody-label|PARODY CASE/);
  const resale = vm.runInContext(`auctionMedia({item:{title:'Camera',image:'/camera.jpg'}}, false)`, context);
  assert.match(resale, /camera\.jpg/);
  assert.match(resale, /Camera/);
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

test('progression terminal state and active economy routes remain in syntax verification', async () => {
  const context = vm.createContext({ t: en => en, number: String });
  vm.runInContext(uiSource.slice(0, uiSource.indexOf('window.economyUi')), context);
  const terminal = vm.runInContext('progressionMarkup({level:20,xp:36100,nextLevelXp:null,progress:1})', context);
  assert.match(terminal, /Level 20 reached/); assert.doesNotMatch(terminal, /NaN/);
  const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const route of ['/auctions', '/marketplace', '/market']) assert.ok(index.includes(`href="${route}"`));
  assert.ok(!index.includes('href="/news"'));
  assert.match(index, /JUSTIZGUESSR is a fictional game/);
  assert.match(index, /No real money is used/);
});

test('market chart renders a single observation visibly and exposes readable history', () => {
  const context = vm.createContext({ t: en => en, esc: String, number: String, uiLocale: () => 'en-GB', date: String, empty: String });
  vm.runInContext(extract(uiSource, '  function chart(', "  document.addEventListener('click'"), context);
  const markup = vm.runInContext(`chart([{capturedAt:'2026-09-19T12:00:00Z',indexValue:107}])`, context);
  assert.match(markup, /<circle/); assert.match(markup, /<table>/); assert.match(markup, /107/); assert.doesNotMatch(markup, /NaN/);
});
