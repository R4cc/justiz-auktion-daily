import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { ECONOMY_BALANCE, expectedItemValue, resaleBidIncrement } from '../src/economy-balance.mjs';
import { caseCatalog, priceCaseCatalog, CASE_WEIGHTS, dailyCaseWeights, dailyRewardCatalog } from '../src/cases.mjs';
import { CASE_TIERS, prepareSealedCase } from '../src/sealed-cases.mjs';
import { bundleReferencePricing, loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { bidOnPaletteAuction, createPaletteAuction, getPaletteAuction } from '../src/palette-auctions.mjs';
import { listItem, placeBid, settleAuction } from '../src/resale.mjs';
import { NPC_BUYERS, npcValuation, npcBidAmount, seedNpcBuyers } from '../src/npc-buyers.mjs';
import { businessSaleChance, buyBusiness, stockBusiness, businessDashboard, supplyStockAuctions } from '../src/businesses.mjs';
import { setMarketIndex } from '../src/market.mjs';

const now = Date.parse('2026-10-01T12:00:00Z');
const stock = ['common', 'uncommon', 'rare', 'epic', 'legendary'].map((rarity, n) => ({
  rarity, auctionId: n + 1, title: `Laptop ${1000 + n}`, price: [10, 20, 50, 100, 1000][n], marketCategory: 'electronics' }));
const archive = stock.map(item => ({ ...item, id: item.auctionId, category: 'Elektronik', finalPrice: item.price, image: '/assets/test.jpg' }));
const deck = Array.from({ length: 16 }, (_, n) => ({ id: n + 1, title: `Auction ${n + 1000}`, actualBid: (n + 1) * 10 }));
async function fixture(t, flags = { resales: true, market: true }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-balance-'));
  const accounts = new Accounts(dir, { now: () => now, flags });
  accounts.db(db => {
    for (const id of ['seller', 'buyer']) db.prepare(`INSERT INTO users (id, username, password_hash, tokens, created_at)
      VALUES (?, ?, 'disabled', 100000, ?)`).run(id, id, now);
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, user: id => ({ id }), balance: id => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id = ?').get(id).tokens) };
}
const complete = (f, mode, length, correct = true) => {
  let run = f.accounts.startGame(f.user('seller'), mode, () => deck.slice(0, length));
  for (let i = 0; !run.complete; i++) run = f.accounts.answer(f.user('seller'), run.id, i,
    mode === 'daily' ? deck[i].actualBid : correct && i < length - 2 ? 'higher' : 'lower');
  return run;
};

test('Higher or Lower pays only improvements; a failed attempt never blocks Daily', async t => {
  const f = await fixture(t);
  assert.equal(complete(f, 'higher-lower', 5, false).earned, 0);
  assert.equal(complete(f, 'daily', 5).earned, 350);
  const first = complete(f, 'higher-lower', 5); // 3 correct, then miss
  assert.equal(first.earned, 75);
  assert.equal(complete(f, 'higher-lower', 5).earned, 0);
  assert.equal(complete(f, 'higher-lower', 7).earned, 50); // best rises to 125
  assert.equal(complete(f, 'higher-lower', 16).earned, 125); // cap 250
  assert.equal(complete(f, 'higher-lower', 16).earned, 0);
  assert.equal(f.balance('seller'), 100600);
  assert.equal(f.accounts.profile(f.user('seller')).rewardsByMode['higher-lower'].earned, 250);
  closeDataStore(f.dir);
  const reopened = new Accounts(f.dir, { now: () => now });
  assert.equal(reopened.answer(f.user('seller'), first.id, 3, 'lower').earned, 75);
  assert.equal(f.balance('seller'), 100600);
});

test('legacy reward receipts migrate once and keep paid currency and frozen run rates', async t => {
  const f = await fixture(t);
  let run = f.accounts.startGame(f.user('seller'), 'higher-lower', () => deck.slice(0, 5),
    { daily: 200, higherLowerPerCorrect: 40, higherLowerMax: 400, minimumStreak: 3 });
  for (let n = 0; n < 4; n++) run = f.accounts.answer(f.user('seller'), run.id, n, 'higher');
  assert.equal(run.earned, 160);
  f.accounts.db(db => db.exec(`ALTER TABLE daily_rewards RENAME TO new_rewards;
    CREATE TABLE daily_rewards (user_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES account_games(id), earned INTEGER NOT NULL, PRIMARY KEY(user_id, date)) STRICT;
    INSERT INTO daily_rewards SELECT user_id, date, run_id, earned FROM new_rewards;
    DROP TABLE new_rewards;`));
  closeDataStore(f.dir);
  new Accounts(f.dir, { now: () => now });
  assert.equal(f.balance('seller'), 100160);
  assert.equal(complete(f, 'higher-lower', 7).earned, 0); // smaller than already paid legacy amount
  assert.equal(complete(f, 'daily', 5).earned, 350);
  closeDataStore(f.dir);
  new Accounts(f.dir, { now: () => now });
  assert.equal(f.balance('seller'), 100510);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM daily_rewards').get().n), 2);
});

test('case quotes remove hot-market arbitrage and reject stale offers without a debit', async t => {
  const f = await fixture(t);
  const base = caseCatalog(archive, now);
  const quoted = priceCaseCatalog(base);
  const expensive = priceCaseCatalog(base, { electronics: 150 });
  assert.ok(expensive.cases[0].cost > quoted.cases[0].cost);
  assert.equal(priceCaseCatalog(expensive, { electronics: 150 }).revision, expensive.revision);
  assert.equal(priceCaseCatalog(base, { electronics: 50 }).cases[0].cost, quoted.cases[0].cost);
  setMarketIndex(f.dir, 'electronics', 150, { now });
  assert.throws(() => f.accounts.openCase(f.user('seller'), quoted, 'fundkiste', 'stale-price-request'), /catalog_changed/);
  assert.equal(f.balance('seller'), 100000);
  const item = f.accounts.openCase(f.user('seller'), expensive, 'fundkiste', 'current-price-request');
  assert.equal(f.balance('seller'), 100000 - expensive.cases[0].cost);
  setMarketIndex(f.dir, 'electronics', 80, { now });
  assert.equal(f.accounts.openCase(f.user('seller'), quoted, 'fundkiste', 'current-price-request').id, item.id);
  assert.equal(f.balance('seller'), 100000 - expensive.cases[0].cost);
});

test('paid cases remain a sink through NPC resale and default business sales', () => {
  const expected = expectedItemValue(stock, CASE_WEIGHTS);
  const catalog = caseCatalog(archive, now);
  const price = catalog.cases[0].cost;
  assert.ok(expected / price <= .82);
  assert.ok(expected / price * (1 + ECONOMY_BALANCE.businessDefaultMargin / 100) < 1);
  for (const npc of NPC_BUYERS) {
    const value = npcValuation({ price: 1000, marketCategory: 'electronics' }, { electronics: 100 }, npc, 'balance', () => .999);
    assert.ok(value.maxBid <= (npc.collector && npc.categories.includes('electronics') ? 1050 : 960));
  }
  assert.ok(expected / price * ECONOMY_BALANCE.npcCollectorMaximum < 1);
});

test('sealed price is independent of the winner and compound free-case jackpot odds are bounded', () => {
  const catalog = { cases: [{ id: 'fundkiste', available: true, items: stock }] };
  for (const tier of CASE_TIERS) {
    const low = prepareSealedCase(catalog, tier.id, { random: () => 0, now });
    const high = prepareSealedCase(catalog, tier.id, { random: max => max - 1, now });
    assert.equal(low.item.price, high.item.price);
    assert.equal(low.item.price, Math.round(expectedItemValue(stock, tier.weights) * .8));
    if (tier.id !== 'legendary') assert.notEqual(low.reward.price, high.reward.price);
  }
  const jackpot = score => dailyCaseWeights(score).reduce((sum, weight, n) => sum + weight / 10000 * CASE_TIERS[n].weights[4] / 10000, 0);
  assert.ok(jackpot(5000) > jackpot(0) * 5);
  assert.ok(jackpot(5000) < .003);
});

test('resale increments apply to human and NPC proxy challenges and escrow settles exactly', async t => {
  const f = await fixture(t);
  f.accounts.db(db => db.prepare('INSERT INTO inventory VALUES (?, ?, ?, ?, NULL)')
    .run('item', 'seller', JSON.stringify({ title: 'Laptop', price: 1000, marketCategory: 'electronics', rarity: 'rare' }), now));
  const lot = listItem(f.dir, f.user('seller'), { inventoryId: 'item', startPrice: 1000,
    endsAt: new Date(now + 3600_000).toISOString() }, { now });
  assert.equal(lot.bidIncrement, 25);
  placeBid(f.dir, f.user('buyer'), lot.id, 1100, { now });
  seedNpcBuyers(f.dir, { now });
  assert.throws(() => placeBid(f.dir, NPC_BUYERS[0], lot.id, 1001, { now }), /bid_too_low/);
  assert.equal(npcBidAmount({ start_price: 1000, current_bid: 1000, max_bid: 1025, auction_id: lot.id },
    { id: 'cheap', cheapness: 1 }, now), 1025);
  placeBid(f.dir, NPC_BUYERS[0], lot.id, 1025, { now });
  const settled = settleAuction(f.dir, lot.id, { now: now + 3600_000 });
  assert.equal(settled.currentBid, 1050);
  assert.equal(f.balance('buyer'), 98950);
  assert.equal(f.balance('seller'), 101050);
  assert.equal(resaleBidIncrement(1_000_000), 5000);
  settleAuction(f.dir, lot.id, { now: now + 3600_000 });
  assert.equal(f.balance('seller'), 101050);
});

test('new wholesale reserves follow live market value and existing lots stay frozen', async t => {
  const f = await fixture(t);
  upsertAuctions(f.dir, [{ id: 101, title: 'Riesling Wein 1001', category: 'Getränke', finalPrice: 24, image: '/assets/test.jpg' }]);
  setMarketIndex(f.dir, 'wine', 150, { now });
  supplyStockAuctions(f.dir, { now });
  const before = f.accounts.db(db => db.prepare("SELECT start_price FROM resale_auctions WHERE seller_id = 'npc-stock-supply'").all());
  assert.ok(before.every(row => row.start_price === Math.round(36 * 24 * .85)));
  setMarketIndex(f.dir, 'wine', 50, { now });
  supplyStockAuctions(f.dir, { now });
  assert.deepEqual(f.accounts.db(db => db.prepare("SELECT start_price FROM resale_auctions WHERE seller_id = 'npc-stock-supply'").all()), before);
});

test('palette pricing preserves resale headroom across cold and hot markets', () => {
  for (const index of [50, 80, 100, 150]) {
    const value = bundleReferencePricing(stock, () => index);
    assert.equal(value.referenceReserve, Math.ceil(value.et * .70));
    assert.ok(value.referenceReserve < value.et * .8);
  }
});

test('business margin has a turnover cost and expensive items sell much more slowly', async t => {
  const f = await fixture(t);
  assert.ok(businessSaleChance(.28, 100) < businessSaleChance(.28, 20) / 10);
  const shop = buyBusiness(f.dir, f.user('seller'), 'electronics', 'tiny', { now }).shop;
  // Traffic and purchase rolls hash the shop ID. A UUID made this bounded
  // sample assertion fail randomly even though the sale probabilities held.
  f.accounts.db(db => db.prepare('UPDATE businesses SET id = ? WHERE id = ?').run('balance-turnover-shop', shop.id));
  shop.id = 'balance-turnover-shop';
  f.accounts.db(db => {
    for (let n = 0; n < 20; n++) db.prepare('INSERT INTO inventory VALUES (?, ?, ?, ?, NULL)')
      .run(`item-${n}`, 'seller', JSON.stringify({ title: 'Laptop', price: n < 10 ? 120 : 1_000_000,
        businessCategory: 'electronics', marketCategory: 'electronics' }), now);
  });
  stockBusiness(f.dir, f.user('seller'), shop.id, Array.from({ length: 20 }, (_, n) => `item-${n}`), { now });
  businessDashboard(f.dir, f.user('seller'), { now: now + 48 * 3600_000 });
  const sold = f.accounts.db(db => db.prepare('SELECT inventory_id FROM business_stock WHERE sold_at IS NOT NULL').all());
  assert.ok(sold.some(row => Number(row.inventory_id.slice(5)) < 10));
  assert.ok(sold.filter(row => Number(row.inventory_id.slice(5)) >= 10).length <= 1);
});


test('v3 pricing migration preserves live palette reserves, escrow and sealed draws', async t => {
  const f = await fixture(t);
  upsertAuctions(f.dir, archive);
  const catalog = loadPaletteCatalog(f.dir, { now });
  const edition = catalog.palettes.find(entry => entry.id === 'electronics');
  const lot = createPaletteAuction(f.dir, { editionId: edition.editionId, requestId: 'migration-live-lot' }, { now });
  bidOnPaletteAuction(f.dir, f.user('buyer'), lot.id, lot.reserve, { now });
  const frozenRewards = f.accounts.db(db => db.prepare('SELECT * FROM primary_palette_rewards WHERE auction_id = ?').all(lot.id));
  f.accounts.db(db => {
    const row = db.prepare('SELECT payload_json FROM palette_editions WHERE id = ?').get(edition.editionId);
    const payload = JSON.parse(row.payload_json);
    payload.pricingVersion = 3;
    payload.pricing.referenceReserve = Math.ceil(payload.pricing.et * .60);
    db.prepare('UPDATE palette_editions SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), edition.editionId);
    db.prepare("DELETE FROM app_state WHERE key = 'palette_bundle_pricing_v4'").run();
  });
  loadPaletteCatalog(f.dir, { now });
  const after = getPaletteAuction(f.dir, lot.id, { now });
  assert.equal(after.reserve, lot.reserve);
  assert.equal(after.currentBid, lot.reserve);
  assert.equal(f.balance('buyer'), 100000 - lot.reserve);
  assert.deepEqual(f.accounts.db(db => db.prepare('SELECT * FROM primary_palette_rewards WHERE auction_id = ?').all(lot.id)), frozenRewards);
  const payload = f.accounts.db(db => JSON.parse(db.prepare('SELECT payload_json FROM palette_editions WHERE id = ?').get(edition.editionId).payload_json));
  assert.equal(payload.pricingVersion, 4);
  assert.equal(payload.pricing.referenceReserve, Math.ceil(payload.pricing.et * .70));
});


test('free Daily case contents stay affordable in expensive or empty archives', () => {
  for (const source of [[], archive.map(item => ({ ...item, finalPrice: 1000.49 })), archive.map(item => ({ ...item, finalPrice: item.finalPrice * 100000 }))]) {
    const catalog = dailyRewardCatalog(caseCatalog(source, now), source, now);
    const mixed = catalog.cases.find(box => box.id === 'fundkiste');
    assert.equal(mixed.available, true);
    assert.ok(mixed.items.every(item => item.price <= 1000));
    for (const tier of CASE_TIERS) {
      const prepared = prepareSealedCase(catalog, tier.id, { now, random: max => max - 1 });
      assert.ok(prepared.reward.price <= 1000);
      assert.ok(prepared.item.price <= 800);
    }
  }
  const catalog = dailyRewardCatalog(caseCatalog(archive, now), [], now);
  assert.ok(catalog.cases[0].items.some(item => archive.some(auction => auction.id === item.auctionId)));
});


test('bulk NPC valuations use quantity times the shared per-unit market estimate', () => {
  const item = { price: .6, marketCategory: 'electronics' };
  const npc = { id: 'fractional', categories: ['electronics'], willingness: 1, aggressiveness: .5 };
  const value = npcValuation(item, { electronics: 150 }, npc, 'lot', () => .5, 24);
  // Each unit rounds to J€1, then the live index rounds to J€2: 48 total.
  assert.equal(value.maxBid, Math.round(48 * .84));
});
