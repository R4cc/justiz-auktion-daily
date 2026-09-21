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
  await api.myPaletteAuctions(10, 20); await api.myListings(); await api.myResaleBids(); await api.myArchivedResaleBids();
  await api.paletteAuctionRewards('a/b'); await api.resaleBid('listing', 123);
  await api.listItem({ inventoryId: 'item', startPrice: 20, endsAt: 'end' }); await api.cancelListing('listing');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['palette-auctions?limit=10&offset=20', null], ['resale/listings', null], ['resale/bids', null],
    ['resale/bids/archived', null],
    ['palette-auctions/a%2Fb/rewards', null], ['resale/bid', { id: 'listing', amount: 123 }],
    ['resale/listings', { inventoryId: 'item', startPrice: 20, endsAt: 'end' }], ['resale/cancel', { id: 'listing' }]
  ]);
  assert.equal(reads[0], '/api/features');
});

test('resale inventory and legacy reward markup never render instant-sell buttons; flags off retain them', () => {
  const item = { id: 'item', title: 'Tool', price: 100, sellValue: 100, estimatedValueTokens: 120, rarity: 'common', image: '/tool.jpg' };
  const context = vm.createContext({ economyFlags: { resales: true }, accountResult: item,
    t: en => en, number: String, justizEuro: value => `J€ ${value}`, euro: value => `EUR ${value}`, accountEscape: String, rarityLabel: String });
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

test('inventory cards show the market value with a delta badge when the market is priced', () => {
  const item = { id: 'item', title: 'Tool', price: 100, sellValue: 100, estimatedValueTokens: 125, marketCategory: 'electronics', marketIndex: 125, rarity: 'common', image: '/tool.jpg' };
  const context = vm.createContext({ economyFlags: { resales: true }, accountResult: item,
    t: en => en, number: String, justizEuro: value => `J€ ${value}`, euro: value => `EUR ${value}`, accountEscape: String, rarityLabel: String });
  vm.runInContext(extract(accountSource, 'function itemCard(', 'function groupedInventory('), context);
  const markup = vm.runInContext(`itemCard(${JSON.stringify(item)})`, context);
  assert.match(markup, /Market value J€ 125/);
  assert.match(markup, /market-delta is-up/);
  assert.match(markup, /↑ \+25%/);
  assert.doesNotMatch(markup, /Auction value/);
  const cold = vm.runInContext(`itemCard(${JSON.stringify({ ...item, marketIndex: 77.7 })})`, context);
  assert.match(cold, /Market value J€ 77.7/);
  assert.match(cold, /market-delta is-down/);
  assert.match(cold, /↓ −22%/);
  const unpriced = vm.runInContext(`itemCard(${JSON.stringify({ ...item, marketIndex: null, estimatedValueTokens: null })})`, context);
  assert.match(unpriced, /Auction value/);
  assert.doesNotMatch(unpriced, /market-delta/);
});

test('economy overview prominently shows J€, active bids and inventory value', () => {
  const context = vm.createContext({ account: { tokens: 1319, activeBids: 3, inventoryMarketValue: 2840 },
    t: en => en, number: String, justizEuro: value => `J€ ${value}` });
  vm.runInContext(extract(accountSource, 'function economyOverviewMarkup(', 'function loginNotice('), context);
  const markup = vm.runInContext('economyOverviewMarkup()', context);
  assert.match(markup, /economy-overview-primary/);
  assert.match(markup, /AVAILABLE J€/);
  assert.match(markup, /J€ 1319/);
  assert.match(markup, /ACTIVE BIDS[\s\S]*>3</);
  assert.match(markup, /INVENTORY VALUE[\s\S]*J€ 2840/);
  assert.match(accountSource, /renderInventory\(\)[\s\S]*economyOverviewMarkup\(\)/);
  assert.equal((uiSource.match(/economyOverviewMarkup\(\)/g) || []).length, 2);
});

test('lot cards mark leading bids green and overbid red on the public board', () => {
  const context = vm.createContext({ economyFlags: { paletteAuctions: true }, account: null, tab: 'public',
    data: { mine: [] }, t: en => en, esc: String, name: lot => lot.name, status: () => 'Active',
    justizEuro: value => `J€ ${value}`, bidFacts: () => '', paletteArtwork: () => '<div class="palette-artwork"></div>',
    categoryName: () => 'Other' });
  vm.runInContext(extract(uiSource, '  function lotCard(', '  function render('), context);
  vm.runInContext(`data = { mine: [{ id: 'l1', leading: true }, { id: 'l2', leading: false }] }`, context);
  const lead = vm.runInContext(`lotCard({ id: 'l1', name: 'Lead', status: 'active', leading: true }, true)`, context);
  assert.match(lead, /economy-lot is-leading/);
  assert.match(lead, /You lead/);
  const outbid = vm.runInContext(`lotCard({ id: 'l2', name: 'Outbid', status: 'active', leading: false }, true)`, context);
  assert.match(outbid, /economy-lot is-outbid/);
  assert.match(outbid, /Outbid/);
  const unplayed = vm.runInContext(`lotCard({ id: 'l3', name: 'Unplayed', status: 'active' }, true)`, context);
  assert.doesNotMatch(unplayed, /is-leading|is-outbid|economy-outcome/);
});

test('auction card actions share the same bottom row', async () => {
  const styles = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.economy-lot\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.match(styles, /\.economy-lot-body\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*flex-direction:\s*column;/);
  assert.match(styles, /\.economy-lot-body\s*>\s*button\s*\{[^}]*margin-top:\s*auto;/);
});

test('marketplace exposes four glanceable auction status sections and batch quantity controls', () => {
  for (const label of ['My live auctions', "Other players' live auctions", 'My current bids', 'My completed auctions', 'Archived auctions']) {
    assert.match(uiSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(uiSource, /auction-state-badge/);
  assert.match(uiSource, /name="quantity"[\s\S]*max="\$\{quantity\}"[\s\S]*value="\$\{quantity\}"/);
  assert.match(uiSource, /myResaleBids/);
});

test('merged My bids keeps bidder-state borders without a separate primary tab', () => {
  const context = vm.createContext({ economyFlags: { paletteAuctions: true }, account: null, tab: 'mine',
    data: { mine: [{ id: 'l1', leading: true }] }, t: en => en, esc: String, name: lot => lot.name,
    status: () => 'Active', justizEuro: value => `J€ ${value}`, bidFacts: () => '',
    paletteArtwork: () => '<div class="palette-artwork"></div>', categoryName: () => 'Other' });
  vm.runInContext(extract(uiSource, '  function lotCard(', '  function render('), context);
  const lead = vm.runInContext(`lotCard({ id: 'l1', name: 'Lead', status: 'active', leading: true, highestBid: 12 }, true)`, context);
  assert.match(lead, /economy-lot is-leading/);
});

test('primary auction board separates My bids above all other live auctions', () => {
  const future = Date.now() + 3600_000;
  const won = { id: 'won', status: 'ended', won: true, revealAvailable: true, highestBid: 30, name: 'Won', paletteId: 'fundkiste', reserve: 10, currentBid: 30, bidCount: 2, requiredLevel: 1, endsAt: future };
  const leadMine = { id: 'lead', status: 'active', leading: true, revealAvailable: false, highestBid: 12, name: 'Lead', paletteId: 'fundkiste', reserve: 10, currentBid: 12, bidCount: 1, requiredLevel: 1, endsAt: future };
  const outbidMine = { id: 'outbid', status: 'active', leading: false, revealAvailable: false, highestBid: 5, name: 'Outbid', paletteId: 'fundkiste', reserve: 10, currentBid: 9, bidCount: 2, requiredLevel: 1, endsAt: future };
  const lost = { id: 'lost', status: 'ended', won: false, revealAvailable: false, highestBid: 5, name: 'Lost', paletteId: 'fundkiste', reserve: 10, currentBid: 9, bidCount: 2, requiredLevel: 1, endsAt: future - 7200_000 };
  const revealed = { id: 'revealed', status: 'ended', won: true, revealAvailable: false, highestBid: 31, name: 'Revealed', paletteId: 'fundkiste', reserve: 10, currentBid: 31, bidCount: 2, requiredLevel: 1, endsAt: future - 7200_000 };
  const publicLot = id => ({ id, status: 'active', name: id, paletteId: 'fundkiste', reserve: 10, currentBid: null, bidCount: 0, requiredLevel: 1 });
  const context = vm.createContext({ economyFlags: { paletteAuctions: true }, account: { tokens: 277, progression: { level: 2 } }, accountContent: { innerHTML: '' },
    currentAccountPage: '/auctions', tab: 'public', routes: { '/auctions': 'paletteAuctions' }, location: { search: '' },
    data: { lots: [publicLot('plain'), publicLot('lead'), publicLot('outbid'), publicLot('other')],
      mine: [won, leadMine, outbidMine, lost, revealed] },
    archiveOpen: false,
    t: en => en, number: String, esc: String, justizEuro: value => `J€ ${value}`, paletteName: String,
    pageHeading: heading => `<h>${heading}</h>`, economyOverviewMarkup: () => '<section class="economy-overview"></section>',
    tabs: () => '', empty: text => `[${text}]`, loginNotice: () => '',
    URLSearchParams, infoTip: text => `<span class="info-tip">${text}</span>`,
    lotCard: lot => `<article data-id="${lot.id}" data-reveal="${!!lot.revealAvailable}"></article>` });
  vm.runInContext(extract(uiSource, '  function marketplaceSection(', '  function bidForm('), context);
  vm.runInContext('render()', context);
  const html = context.accountContent.innerHTML;
  const order = [...html.matchAll(/<article data-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ['won', 'lead', 'outbid', 'plain', 'other']);
  assert.match(html, /my-bids-board/);
  assert.match(html, /My bids/);
  assert.match(html, /AUCTION FLOOR/);
  assert.equal([...html.matchAll(/data-id="lead"/g)].length, 1);
  assert.match(html, /data-reveal="true"/);
  // Won lots stay on the board until their reveal; lost and revealed lots
  // wait behind the archived-auctions disclosure.
  assert.match(html, /Archived auctions \(2\)/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /data-id="lost"/);
  assert.doesNotMatch(html, /data-id="revealed"/);
  context.archiveOpen = true;
  vm.runInContext('render()', context);
  const expanded = context.accountContent.innerHTML;
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /data-id="lost"/);
  assert.match(expanded, /data-id="revealed"/);
  assert.equal([...expanded.matchAll(/data-id="lead"/g)].length, 1);
});

test('marketplace moves finished bids behind the Archived auctions disclosure', () => {
  const wonBid = { id: 'won-bid', status: 'ended', won: true, leading: false, highestBid: 20,
    currentBid: 20, winnerId: 'player', bidCount: 3, quantity: 1, item: { title: 'Radio', marketCategory: 'electronics' } };
  const lostBid = { id: 'lost-bid', status: 'ended', won: false, leading: false, highestBid: 5,
    currentBid: 9, winnerId: 'rival', bidCount: 2, quantity: 1, item: { title: 'Lamp', marketCategory: 'household' } };
  const context = vm.createContext({ economyFlags: { resales: true },
    account: { id: 'player', tokens: 500, progression: { level: 2 } }, accountContent: { innerHTML: '' },
    currentAccountPage: '/marketplace', tab: 'public', routes: { '/marketplace': 'resales' }, location: { search: '' },
    data: { lots: [], mine: [], bids: [], archivedBids: [wonBid, lostBid] }, archiveOpen: false,
    t: en => en, number: String, esc: String, justizEuro: value => `J€ ${value}`, paletteName: String,
    pageHeading: heading => `<h>${heading}</h>`, economyOverviewMarkup: () => '<section class="economy-overview"></section>',
    tabs: () => '', empty: text => `[${text}]`, loginNotice: () => '',
    URLSearchParams, infoTip: text => `<span class="info-tip">${text}</span>`,
    lotCard: lot => `<article data-id="${lot.id}" data-won="${!!lot.won}"></article>` });
  vm.runInContext(extract(uiSource, '  function marketplaceSection(', '  function bidForm('), context);
  vm.runInContext('render()', context);
  const html = context.accountContent.innerHTML;
  assert.match(html, /My current bids/);
  assert.match(html, /Archived auctions \(2\)/);
  assert.doesNotMatch(html, /data-id="won-bid"|data-id="lost-bid"/);
  context.archiveOpen = true;
  vm.runInContext('render()', context);
  const expanded = context.accountContent.innerHTML;
  assert.match(expanded, /marketplace-section--bid-done/);
  assert.match(expanded, /data-id="won-bid"/);
  assert.match(expanded, /data-id="lost-bid"/);
  assert.match(expanded, /My completed auctions/);
});

test('archived bid cards mark wins green and losses red once the auction ended', () => {
  const context = vm.createContext({ economyFlags: { paletteAuctions: true },
    account: { id: 'player', tokens: 100, progression: { level: 2 } }, tab: 'public', data: { mine: [] },
    t: en => en, esc: String, name: lot => lot.name, status: () => 'Ended',
    justizEuro: value => `J€ ${value}`, bidFacts: () => '',
    paletteArtwork: () => '<div class="palette-artwork"></div>', categoryName: () => 'Other' });
  vm.runInContext(extract(uiSource, '  function lotCard(', '  function render('), context);
  const item = { title: 'Radio', image: null, marketCategory: 'electronics' };
  const won = vm.runInContext(`lotCard(${JSON.stringify({ id: 'w', status: 'ended', won: true, leading: false,
    highestBid: 20, currentBid: 20, winnerId: 'player', bidCount: 2, quantity: 1, estimatedValueTokens: 30,
    sellerUsername: 'Sam', item })}, false, 'bid-done')`, context);
  assert.match(won, /economy-lot is-leading/);
  assert.match(won, /WON/);
  assert.match(won, /You won/);
  assert.match(won, /Final sale/);
  const lost = vm.runInContext(`lotCard(${JSON.stringify({ id: 'l', status: 'ended', won: false, leading: false,
    highestBid: 5, currentBid: 9, winnerId: 'rival', bidCount: 2, quantity: 1, estimatedValueTokens: 30,
    sellerUsername: 'Sam', item })}, false, 'bid-done')`, context);
  assert.match(lost, /economy-lot is-outbid/);
  assert.match(lost, /LOST/);
  assert.match(lost, /You lost/);
  assert.match(lost, /J€ 5/);
});

test('auction bid history is chronological and marks the signed-in player as chat bubbles', () => {
  const context = vm.createContext({ account: { id: 'mine' }, t: en => en, esc: String,
    justizEuro: value => `J€ ${value}`, date: String });
  vm.runInContext(extract(uiSource, '  const bidHistory =', '  const story ='), context);
  const markup = vm.runInContext(`bidHistory([
    {id:'2', bidderId:'other', bidderUsername:'Rival', amount:120, createdAt:20},
    {id:'1', bidderId:'mine', bidderUsername:'Player', amount:100, createdAt:10}
  ])`, context);
  assert.ok(markup.indexOf('J€ 100') < markup.indexOf('J€ 120'));
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

test('information tips are labelled, keyboard focusable and escape their copy', () => {
  const context = vm.createContext({ language: 'en' });
  vm.runInContext(extract(i18nSource, 'function t(', 'function paletteName('), context);
  const markup = vm.runInContext(`infoTip('Balance < reserve & fees', 'Bid details')`, context);
  assert.match(markup, /<button type="button" aria-label="Bid details" aria-describedby="info-tip-1">\?/);
  assert.match(markup, /id="info-tip-1" role="tooltip"/);
  assert.match(markup, /Balance &lt; reserve &amp; fees/);
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
    t: en => en, esc: String, justizEuro: value => `J€ ${value}`, name: value => value.name,
    infoTip: text => `<span class="info-tip">${text}</span>`,
    story: () => ({ title: 'The story', body: 'A mysterious customs lot.', shortDescription: 'Customs warehouse bust', parody: true }), categoryName: String,
    rarityLabel: String, euro: String, accountError: String, status: () => 'Active',
    bidFacts: () => '<div>J€ 120</div>', bidHistory: () => '<li>bid bubble</li>',
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

test('palette summary tallies finds, subtracts the winning bid and declares profit or loss', async () => {
  let markup = '';
  const rewards = [{ item: { title: 'Sneakers', price: 50 } }, { item: { title: 'Esprimo', price: 277 } }, { item: { title: 'Toothbrush', price: 15 } }];
  const context = vm.createContext({
    openDialog: value => { markup = value; },
    itemCard: item => `<div class="card">${item.title}</div>`,
    t: en => en, esc: String, number: value => String(value), justizEuro: value => `J€ ${value}`, euro: value => `€${value}`,
    infoTip: text => `<span class="info-tip">${text}</span>`
  });
  vm.runInContext(extract(uiSource, '  function revealSummary(', '  async function loadHistory('), context);
  vm.runInContext(`revealSummary(${JSON.stringify({ rewards, bundleCostTokens: 797 })})`, context);
  assert.match(markup, /<b>\+J€ 50<\/b>/);
  assert.match(markup, /<b>\+J€ 277<\/b>/);
  assert.match(markup, /<b>\+J€ 15<\/b>/);
  assert.match(markup, /Total finds value/);
  assert.match(markup, /<b>J€ 342<\/b>/);
  assert.match(markup, /−J€ 797/);
  assert.match(markup, /palette-ledger-verdict is-loss/);
  assert.match(markup, />Loss</);
  assert.match(markup, /−J€ 455/);
  vm.runInContext(`revealSummary(${JSON.stringify({ rewards, bundleCostTokens: 100 })})`, context);
  assert.match(markup, /palette-ledger-verdict is-profit/);
  assert.match(markup, />Profit</);
  assert.match(markup, /\+J€ 242/);
});

test('progression terminal state and active economy routes remain in syntax verification', async () => {
  const context = vm.createContext({ t: en => en, number: String, justizEuro: value => `J€ ${value}`, infoTip: text => `<span>${text}</span>` });
  vm.runInContext(uiSource.slice(0, uiSource.indexOf('window.economyUi')), context);
  const terminal = vm.runInContext('progressionMarkup({level:20,xp:36100,nextLevelXp:null,progress:1})', context);
  assert.match(terminal, /Level 20 reached/); assert.doesNotMatch(terminal, /NaN/);
  const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const route of ['/auctions', '/marketplace', '/market']) assert.ok(index.includes(`href="${route}"`));
  assert.ok(!index.includes('href="/news"'));
  assert.match(index, /class="nav-group"[\s\S]*href="\/"[\s\S]*href="\/inventory"[\s\S]*class="nav-group nav-group-account"[\s\S]*href="\/leaderboard"[\s\S]*id="header-auth"[\s\S]*href="\/admin"/);
  assert.match(index, /class="sidebar-toggle"[\s\S]*aria-controls="site-menu"[\s\S]*aria-expanded="false"/);
  assert.match(index, /id="notification-button"[\s\S]*class="notification-badge"[\s\S]*id="notification-panel"[\s\S]*id="notification-toasts"/);
  assert.match(index, /JUSTIZGUESSR is a fictional game/);
  assert.match(index, /No real money is used/);
});

test('market chart renders a single observation visibly and exposes readable history', () => {
  const context = vm.createContext({ t: en => en, esc: String, number: String, uiLocale: () => 'en-GB', date: String, empty: String });
  vm.runInContext(extract(uiSource, '  function chart(', "  document.addEventListener('click'"), context);
  const markup = vm.runInContext(`chart([{capturedAt:'2026-09-19T12:00:00Z',indexValue:107}])`, context);
  assert.match(markup, /<circle/); assert.match(markup, /<table>/); assert.match(markup, /107/); assert.doesNotMatch(markup, /NaN/);
});
