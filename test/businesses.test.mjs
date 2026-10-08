import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { businessDashboard, businessSaleChance, buyBusiness, ensureBusinessSchema, setBusinessMargin,
  stockBusiness, supplyStockAuctions, tickBusinesses, unstockBusiness } from '../src/businesses.mjs';
import { getResale, listItem, listResales, listingsBidOnByUser, placeBid, settleDueListings } from '../src/resale.mjs';
import { setMarketIndex } from '../src/market.mjs';
import { tickNpcBuyers } from '../src/npc-buyers.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { featureFlags } from '../src/features.mjs';

const start = Date.parse('2026-09-26T12:00:00Z');
const hour = 3_600_000;
const auctionStock = [
  ['Getränke', 'Wachau Riesling 2022', 24],
  ['Sammlerstücke', 'Modular building set Lego', 32],
  ['Elektronik', 'Wireless headphones computer', 95],
  ['Fahrzeuge', 'Compact city car', 1900],
  ['Getränke', 'Burgenland Red Wine 2021', 46],
  ['Sammlerstücke', 'Wooden puzzle set', 19],
  ['Elektronik', '10-inch tablet', 190],
  ['Fahrzeuge', 'Used estate car', 3600]
].map(([category, title, currentBid], index) => ({ id: 7000 + index, title, category,
  currentBid, finalPrice: currentBid, image: `/archive/${7000 + index}.jpg` }));

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-business-'));
  upsertAuctions(dir, auctionStock);
  const accounts = new Accounts(dir, { now: () => start });
  accounts.db(db => {
    for (const [id, tokens, admin] of [['owner', 1000, 1], ['rival', 10000, 0]]) {
      db.prepare(`INSERT INTO users (id, username, password_hash, tokens, created_at, admin)
        VALUES (?, ?, 'disabled', ?, ?, ?)`).run(id, id, tokens, start, admin);
    }
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, owner: { id: 'owner', admin: true }, rival: { id: 'rival' },
    balance: id => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id = ?').get(id).tokens),
    count: (table, condition = '1 = 1') => accounts.db(db => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).get().count) };
}

test('stock batches use marketplace escrow, bid history, and inventory transfer', async t => {
  const f = await fixture(t);
  supplyStockAuctions(f.dir, { now: start });
  const lots = listResales(f.dir, { now: start });
  assert.equal(lots.length, 8);
  assert.equal(new Set(lots.map(lot => lot.endsAt)).size, 8);
  assert.ok(lots.every(lot => lot.endsAt - lot.startedAt === 2 * hour));
  assert.deepEqual(new Set(lots.map(lot => lot.item.businessCategory)), new Set(['wine', 'toys', 'electronics', 'cars']));
  assert.ok(lots.every(lot => auctionStock.some(auction => auction.id === lot.item.auctionId
    && auction.title === lot.item.title && auction.image === lot.item.image
    && auction.finalPrice === lot.item.price)));
  const wine = lots.find(lot => lot.item.title === 'Wachau Riesling 2022');
  assert.equal(wine.quantity, 24);
  assert.equal(wine.startPrice, 490);
  assert.equal(wine.sellerUsername, 'Stock Supply');
  const suppliedUnits = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  assert.equal(f.count('inventory'), suppliedUnits);
  const physicalItems = f.accounts.db(db => db.prepare("SELECT item FROM inventory WHERE user_id = 'npc-stock-supply'").all());
  assert.ok(physicalItems.every(row => {
    const item = JSON.parse(row.item);
    return auctionStock.some(auction => auction.id === item.auctionId
      && auction.title === item.title && auction.finalPrice === item.price);
  }));
  placeBid(f.dir, f.owner, wine.id, 490, { now: start + 1000 });
  assert.equal(f.balance('owner'), 510);
  placeBid(f.dir, f.rival, wine.id, 495, { now: start + 2000 });
  assert.equal(f.balance('owner'), 1000);
  placeBid(f.dir, f.owner, wine.id, 510, { now: start + 3000 });
  assert.equal(f.balance('owner'), 490);
  assert.throws(() => placeBid(f.dir, f.rival, wine.id, 496, { now: start + 4000 }), /bid_too_low/);
  assert.equal(getResale(f.dir, wine.id, { now: start + 5000 }).bids.length, 3);
  assert.equal(listingsBidOnByUser(f.dir, f.owner.id, { now: start + 5000 })[0].leading, true);
  settleDueListings(f.dir, { now: start + 2 * hour });
  assert.equal(f.count('inventory'), suppliedUnits);
  assert.equal(f.count('inventory', "user_id = 'owner'"), 24);
  settleDueListings(f.dir, { now: start + 2 * hour + 1000 });
  assert.equal(f.balance('owner'), 1000 - getResale(f.dir, wine.id, { now: start + 2 * hour }).currentBid);
  assert.equal(getResale(f.dir, wine.id, { now: start + 2 * hour }).winnerId, 'owner');
  assert.equal(f.count('account_notifications', "source_key LIKE 'resale:won:%'"), 1);
  assert.throws(() => placeBid(f.dir, f.rival, wine.id, 1000, { now: start + 2 * hour }), /auction_ended/);
});

test('stock supply rotates one batch every 15 minutes and fills the board after downtime', async t => {
  const f = await fixture(t);
  const first = listResales(f.dir, { now: start });
  assert.equal(first.length, 0);
  supplyStockAuctions(f.dir, { now: start });
  const initial = listResales(f.dir, { now: start });
  supplyStockAuctions(f.dir, { now: start + 15 * 60_000 });
  const next = listResales(f.dir, { now: start + 15 * 60_000 });
  assert.equal(next.length, 8);
  assert.equal(next.filter(lot => !initial.some(previous => previous.id === lot.id)).length, 1);
  assert.equal(next.filter(lot => !initial.some(previous => previous.id === lot.id))[0].item.businessCategory, 'toys');
  supplyStockAuctions(f.dir, { now: start + 2 * hour });
  const nextCycle = listResales(f.dir, { now: start + 2 * hour });
  assert.equal(nextCycle.length, 8);
  assert.equal(new Set(nextCycle.map(lot => lot.endsAt)).size, 8);
  const sparse = await fixture(t);
  supplyStockAuctions(sparse.dir, { now: start + 61 * 60_000 });
  assert.equal(listResales(sparse.dir, { now: start + 61 * 60_000 }).length, 8);
});

test('stock supply never invents products when the auction archive is empty', async t => {
  const f = await fixture(t);
  f.accounts.db(db => db.prepare('DELETE FROM auctions').run());
  assert.equal(supplyStockAuctions(f.dir, { now: start }).supplied, 0);
  assert.equal(listResales(f.dir, { now: start }).length, 0);
  assert.equal(f.count('inventory'), 0);
});

test('old unbid fictional stock retires while escrowed legacy stock remains', async t => {
  const f = await fixture(t);
  f.accounts.db(db => {
    for (const [id, stockId, bid, bidder] of [['old-free', 'riesling', null, null], ['old-bid', 'blocks', 432, 'owner']]) {
      db.prepare(`INSERT INTO wholesale_auctions
        (id, stock_id, starts_at, ends_at, reserve, current_bid, bidder_id)
        VALUES (?, ?, ?, ?, 432, ?, ?)`).run(id, stockId, start, start + 2 * hour, bid, bidder);
    }
    db.prepare("UPDATE users SET tokens = tokens - 432 WHERE id = 'owner'").run();
  });
  supplyStockAuctions(f.dir, { now: start });
  assert.equal(f.count('resale_auctions', "id = 'old-free'"), 0);
  assert.equal(f.count('resale_auctions', "id = 'old-bid'"), 1);
  assert.equal(f.balance('owner'), 568);
});

test('upgrade staggers a live stock listing without shortening its bid window', async t => {
  const f = await fixture(t);
  const at = start + 61 * 60_000;
  const oldId = `${Math.floor(start / (2 * hour))}:blocks`;
  f.accounts.db(db => {
    db.prepare(`INSERT INTO wholesale_auctions
      (id, stock_id, starts_at, ends_at, reserve, current_bid, bidder_id)
      VALUES (?, 'blocks', ?, ?, 432, 432, 'owner')`).run(oldId, start, start + 2 * hour);
    db.prepare(`INSERT INTO wholesale_bids (auction_id, bidder_id, amount, created_at)
      VALUES (?, 'owner', 432, ?)`).run(oldId, start + 1000);
    db.prepare("UPDATE users SET tokens = tokens - 432 WHERE id = 'owner'").run();
  });
  supplyStockAuctions(f.dir, { now: at });
  const blocks = getResale(f.dir, oldId, { now: at });
  f.accounts.db(db => db.prepare('UPDATE resale_auctions SET started_at = ?, ends_at = ? WHERE id = ?')
    .run(start, start + 2 * hour, blocks.id));
  supplyStockAuctions(f.dir, { now: at + 2000 });
  const updated = getResale(f.dir, blocks.id, { now: at + 2000 });
  assert.equal(updated.endsAt, start + 2 * hour + 15 * 60_000);
  assert.equal(updated.currentBidderId, 'owner');
  assert.equal(f.balance('owner'), 1000 - blocks.startPrice);
});

test('existing stock bids migrate to marketplace without charging escrow twice', async t => {
  const f = await fixture(t);
  const id = `${Math.floor(start / (2 * hour))}:riesling`;
  f.accounts.db(db => {
    db.prepare(`INSERT INTO wholesale_auctions
      (id, stock_id, starts_at, ends_at, reserve, current_bid, bidder_id)
      VALUES (?, 'riesling', ?, ?, 432, 432, 'owner')`).run(id, start, start + 2 * hour);
    db.prepare(`INSERT INTO wholesale_bids (auction_id, bidder_id, amount, created_at)
      VALUES (?, 'owner', 432, ?)`).run(id, start + 1000);
    db.prepare("UPDATE users SET tokens = tokens - 432 WHERE id = 'owner'").run();
  });
  supplyStockAuctions(f.dir, { now: start + 2000 });
  assert.equal(f.balance('owner'), 568);
  assert.equal(getResale(f.dir, id, { now: start + 2000 }).bids.length, 1);
  supplyStockAuctions(f.dir, { now: start + 3000 });
  assert.equal(getResale(f.dir, id, { now: start + 3000 }).bids.length, 1);
  placeBid(f.dir, f.rival, id, 437, { now: start + 4000 });
  assert.equal(f.balance('owner'), 1000);
  settleDueListings(f.dir, { now: start + 2 * hour });
  assert.equal(f.count('inventory', "user_id = 'rival'"), 24);
});

test('unbid stock batches are retired after settlement instead of accumulating NPC inventory', async t => {
  const f = await fixture(t);
  supplyStockAuctions(f.dir, { now: start });
  const initialUnits = f.count('inventory');
  tickNpcBuyers(f.dir, { now: start + hour });
  assert.equal(f.count('resale_npc_interest'), 0);
  const oldId = listResales(f.dir, { now: start })[0].id;
  settleDueListings(f.dir, { now: start + 2 * hour });
  assert.equal(f.count('inventory'), initialUnits);
  supplyStockAuctions(f.dir, { now: start + 26 * hour + 60_000 });
  assert.equal(f.count('inventory'), listResales(f.dir, { now: start + 26 * hour + 60_000 }).reduce((sum, lot) => sum + lot.quantity, 0));
  assert.equal(f.count('resale_auctions', `id = '${oldId}'`), 0);
});

test('store stock is exclusive, category-checked, and earns once after offline time', async t => {
  const f = await fixture(t);
  f.accounts.db(db => db.prepare("UPDATE users SET tokens = 2000 WHERE id = 'owner'").run());
  supplyStockAuctions(f.dir, { now: start });
  const wineLot = listResales(f.dir, { now: start }).find(lot => lot.item.title === 'Wachau Riesling 2022');
  placeBid(f.dir, f.owner, wineLot.id, wineLot.startPrice, { now: start });
  settleDueListings(f.dir, { now: start + 2 * hour });
  const boughtAt = start + 2 * hour;
  const purchase = buyBusiness(f.dir, f.owner, 'wine', 'popup', { now: boughtAt });
  const shop = purchase.shop;
  assert.equal(purchase.cost, 1000);
  assert.equal(f.balance('owner'), 510);
  assert.throws(() => buyBusiness(f.dir, f.owner, 'wine', 'tiny', { now: boughtAt }), /insufficient_tokens/);
  const ids = f.accounts.db(db => db.prepare("SELECT id FROM inventory WHERE user_id = 'owner' ORDER BY id LIMIT 4").all().map(row => row.id));
  assert.throws(() => stockBusiness(f.dir, f.rival, shop.id, ids, { now: boughtAt }), /business_not_found/);
  assert.throws(() => stockBusiness(f.dir, f.owner, shop.id, [...ids, ids[0]], { now: boughtAt }), /invalid_stock/);
  stockBusiness(f.dir, f.owner, shop.id, ids, { now: boughtAt });
  assert.equal(businessDashboard(f.dir, f.owner, { now: boughtAt }).shops[0].stock.length, 4);
  assert.equal(f.accounts.inventory(f.owner).length, 20);
  assert.throws(() => listItem(f.dir, f.owner, { inventoryId: ids[0], startPrice: 10,
    endsAt: new Date(boughtAt + 24 * hour).toISOString() }, { now: boughtAt }), /item_stocked/);
  setMarketIndex(f.dir, 'wine', 130, { now: boughtAt });
  const later = boughtAt + 7 * 24 * hour;
  const after = businessDashboard(f.dir, f.owner, { now: later }).shops[0];
  assert.equal(after.stock.length, 0);
  assert.equal(after.sales, 4);
  assert.ok(after.visitors > 0);
  assert.equal(after.revenue, 4 * 37);
  assert.equal(f.balance('owner'), 510 + after.revenue);
  closeDataStore(f.dir);
  assert.equal(businessDashboard(f.dir, f.owner, { now: later }).shops[0].revenue, after.revenue);
  assert.equal(f.balance('owner'), 510 + after.revenue);
  assert.equal(f.count('inventory', 'sold_at IS NOT NULL'), 4);
  assert.equal(f.count('business_stock', 'sold_price = 37'), 4);
});

test('individual wines use the same category rule as bulk stock regardless of title wording', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, f.rival, 'wine', 'popup', { now: start }).shop;
  const items = [
    { title: '1 Flasche Bordeaux 2018', category: 'Getränke' },
    { title: 'Barolo 2019', marketCategory: 'wine' },
    { title: 'Champagner Brut', category: 'Getränke' },
    { title: 'Sauvignon Blanc 2021', category: 'wine' },
    { title: 'Château Margaux 2015', category: 'Getränke' },
    { title: 'Ornellaia 2020' },
    { title: 'Tignanello 2021', category: 'Sonstiges' },
    { title: 'Estate reserve 2017', category: 'Sonstiges', description: 'Eine Flasche, Jahrgang 2017, Alkoholgehalt 13 %.' }
  ].map((item, n) => ({ ...item, id: `individual-wine-${n}`, price: 20, rarity: 'common' }));
  const rejected = [
    { id: 'wine-perfume', title: 'Château fragrance', category: 'Kosmetik' },
    { id: 'sealed-wine-case', kind: 'case', title: 'Wine Case', caseTier: 'common', price: 20 },
    { id: 'other-collectible', title: 'Gold Armbanduhr', category: 'Schmuck & Uhren' }
  ];
  f.accounts.db(db => {
    for (const item of [...items, ...rejected]) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(item.id, f.rival.id, JSON.stringify(item), start);
  });
  const available = businessDashboard(f.dir, f.rival, { now: start }).inventory;
  assert.deepEqual(new Set(available.filter(item => item.type === 'wine').map(item => item.id)), new Set(items.map(item => item.id)));
  for (const item of rejected) {
    assert.ok(!available.some(entry => entry.id === item.id));
    assert.throws(() => stockBusiness(f.dir, f.rival, shop.id, [item.id], { now: start }), /wrong_shop_type/);
  }
  stockBusiness(f.dir, f.rival, shop.id, items.map(item => item.id), { now: start });
  assert.equal(businessDashboard(f.dir, f.rival, { now: start }).shops[0].stock.length, items.length);
  // Individual finds enter the existing customer simulation and sell exactly once.
  const later = start + 7 * 24 * hour;
  tickBusinesses(f.dir, { now: later });
  const sold = businessDashboard(f.dir, f.rival, { now: later }).shops[0];
  assert.equal(sold.sales, items.length); assert.equal(sold.stock.length, 0);
  const balance = f.balance('rival');
  tickBusinesses(f.dir, { now: later });
  assert.equal(f.balance('rival'), balance);
});

test('profit margin changes buying rate and shelf prices against the current category index, not visitors', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, f.rival, 'toys', 'popup', { now: start }).shop;
  assert.equal(shop.profitMargin, 20);
  assert.equal(businessSaleChance(.28, 20), .28);
  assert.ok(businessSaleChance(.28, 0) > businessSaleChance(.28, 30));
  assert.ok(businessSaleChance(.28, 30) > businessSaleChance(.28, 60));
  assert.ok(businessSaleChance(.28, 60) > businessSaleChance(.28, 100));
  // Expected profit per visitor has a middle sweet spot instead of rewarding
  // either a free markup or the highest possible price.
  assert.ok(30 * businessSaleChance(.28, 30) > 60 * businessSaleChance(.28, 60));
  assert.ok(60 * businessSaleChance(.28, 60) > 100 * businessSaleChance(.28, 100));
  f.accounts.db(db => db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
    .run('priced-toy', 'rival', JSON.stringify({ title: 'Wooden puzzle set', price: 100,
      businessCategory: 'toys', marketCategory: 'collectibles' }), start));
  stockBusiness(f.dir, f.rival, shop.id, ['priced-toy'], { now: start });
  setMarketIndex(f.dir, 'collectibles', 150, { now: start });
  const baseline = businessDashboard(f.dir, f.rival, { now: start }).shops[0];
  assert.equal(baseline.stock[0].referencePrice, 150);
  assert.equal(baseline.stock[0].askingPrice, 180);
  const high = setBusinessMargin(f.dir, f.rival, shop.id, 60, { now: start });
  assert.equal(high.stock[0].referencePrice, 150);
  assert.equal(high.stock[0].askingPrice, 240);
  assert.equal(high.popularity, baseline.popularity);
  assert.equal(high.visitors, baseline.visitors);
  assert.ok(high.buyChancePercent < baseline.buyChancePercent);
  const low = setBusinessMargin(f.dir, f.rival, shop.id, 0, { now: start });
  assert.equal(low.stock[0].askingPrice, 150);
  assert.ok(low.buyChancePercent > baseline.buyChancePercent);
  assert.throws(() => setBusinessMargin(f.dir, f.owner, shop.id, 50, { now: start }), /business_not_found/);
  for (const invalid of [-1, 101, 2.5, '50', null])
    assert.throws(() => setBusinessMargin(f.dir, f.rival, shop.id, invalid, { now: start }), /invalid_profit_margin/);
  closeDataStore(f.dir);
  assert.equal(businessDashboard(f.dir, f.rival, { now: start }).shops[0].profitMargin, 0);
});

test('margin changes keep earlier sales at the old price and existing stores migrate to 30%', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, f.rival, 'toys', 'tiny', { now: start }).shop;
  f.accounts.db(db => {
    db.exec('ALTER TABLE businesses DROP COLUMN profit_margin');
    ensureBusinessSchema(db);
    for (let n = 0; n < 25; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`margin-toy-${n}`, 'rival', JSON.stringify({ title: `Puzzle ${n}`, price: 100,
        businessCategory: 'toys', marketCategory: 'collectibles' }), start);
  });
  assert.equal(businessDashboard(f.dir, f.rival, { now: start }).shops[0].profitMargin, 30);
  stockBusiness(f.dir, f.rival, shop.id, Array.from({ length: 25 }, (_, n) => `margin-toy-${n}`), { now: start });
  const changed = setBusinessMargin(f.dir, f.rival, shop.id, 100, { now: start + 12 * hour });
  assert.equal(changed.profitMargin, 100);
  assert.ok(changed.sales > 0);
  const oldSales = f.accounts.db(db => db.prepare('SELECT sold_price FROM business_stock WHERE sold_at IS NOT NULL').all());
  assert.ok(oldSales.every(row => row.sold_price === 130));
  const remaining = changed.stock;
  assert.ok(remaining.length > 0);
  assert.ok(remaining.every(entry => entry.askingPrice === 200));
});

test('profit margin changes sales without changing visitors, even when stock sells out', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, f.rival, 'toys', 'tiny', { now: start }).shop;
  f.accounts.db(db => {
    for (let n = 0; n < 25; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`traffic-toy-${n}`, 'rival', JSON.stringify({ title: `Puzzle ${n}`, price: 100,
        businessCategory: 'toys', marketCategory: 'collectibles' }), start);
  });
  stockBusiness(f.dir, f.rival, shop.id, Array.from({ length: 25 }, (_, n) => `traffic-toy-${n}`), { now: start });
  setBusinessMargin(f.dir, f.rival, shop.id, 0, { now: start });
  const low = businessDashboard(f.dir, f.rival, { now: start + 7 * 24 * hour }).shops[0];
  assert.equal(low.stock.length, 0);
  f.accounts.db(db => {
    db.prepare('UPDATE businesses SET visitors = 0, sales = 0, revenue = 0, last_tick_at = ?, profit_margin = 100 WHERE id = ?')
      .run(start, shop.id);
    db.prepare('UPDATE business_stock SET sold_at = NULL, sold_price = NULL WHERE business_id = ?').run(shop.id);
    db.prepare('DELETE FROM business_sales WHERE business_id = ?').run(shop.id);
    db.prepare("UPDATE inventory SET sold_at = NULL WHERE user_id = 'rival' AND id LIKE 'traffic-toy-%'").run();
  });
  const high = businessDashboard(f.dir, f.rival, { now: start + 7 * 24 * hour }).shops[0];
  assert.equal(high.visitors, low.visitors);
  assert.ok(high.sales < low.sales);
});

test('business dashboard reports sales and revenue for the current UTC day', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, f.rival, 'toys', 'popup', { now: start }).shop;
  f.accounts.db(db => {
    for (const id of ['yesterday-toy', 'today-toy']) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'rival', JSON.stringify({ title: 'Wooden puzzle set', price: 100, businessCategory: 'toys' }), start);
  });
  stockBusiness(f.dir, f.rival, shop.id, ['yesterday-toy', 'today-toy'], { now: start });
  f.accounts.db(db => {
    db.prepare('UPDATE business_stock SET sold_at = ?, sold_price = NULL WHERE inventory_id = ?')
      .run(start + 11 * hour, 'yesterday-toy');
    db.prepare('UPDATE business_stock SET sold_at = ?, sold_price = 190 WHERE inventory_id = ?')
      .run(start + 12 * hour, 'today-toy');
    db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ?').run(start + 11 * hour, 'yesterday-toy');
    db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ?').run(start + 12 * hour, 'today-toy');
    db.prepare('UPDATE businesses SET sales = 2, revenue = 320, last_tick_at = ? WHERE id = ?')
      .run(start + 23 * hour, shop.id);
    db.prepare('INSERT INTO business_sales VALUES (?, ?, ?, ?, ?)').run('npc:yesterday-toy', shop.id, 'yesterday-toy', 120, start + 11 * hour);
    db.prepare('INSERT INTO business_sales VALUES (?, ?, ?, ?, ?)').run('npc:today-toy', shop.id, 'today-toy', 190, start + 12 * hour);
  });
  const yesterday = businessDashboard(f.dir, f.rival, { now: start + 11 * hour }).shops[0];
  assert.equal(yesterday.salesToday, 1);
  assert.equal(yesterday.revenueToday, 120);
  const today = businessDashboard(f.dir, f.rival, { now: start + 23 * hour }).shops[0];
  assert.equal(today.sales, 2);
  assert.equal(today.revenue, 320);
  assert.equal(today.salesToday, 1);
  assert.equal(today.revenueToday, 190);
  const nextDay = businessDashboard(f.dir, f.rival, { now: start + 36 * hour }).shops[0];
  assert.equal(nextDay.salesToday, 0);
  assert.equal(nextDay.revenueToday, 0);
});

test('older stocked stores gain a stable visitor rate during schema upgrade', async t => {
  const f = await fixture(t);
  const shop = buyBusiness(f.dir, f.rival, 'toys', 'popup', { now: start }).shop;
  f.accounts.db(db => db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-toy', 'rival', JSON.stringify({ title: 'Wooden puzzle set', price: 100,
      businessCategory: 'toys', marketCategory: 'collectibles' }), start));
  stockBusiness(f.dir, f.rival, shop.id, ['legacy-toy'], { now: start });
  f.accounts.db(db => {
    db.exec('ALTER TABLE businesses DROP COLUMN traffic_popularity');
    db.exec('ALTER TABLE businesses DROP COLUMN profit_margin');
    ensureBusinessSchema(db);
  });
  const upgraded = businessDashboard(f.dir, f.rival, { now: start }).shops[0];
  assert.equal(upgraded.profitMargin, 30);
  assert.ok(upgraded.popularity > 0);
  assert.equal(unstockBusiness(f.dir, f.rival, shop.id, 'legacy-toy', { now: start }).popularity, 0);
});

test('shop categories and capacities reject unsuitable or excess stock atomically', async t => {
  const f = await fixture(t);
  const toy = buyBusiness(f.dir, f.rival, 'toys', 'popup', { now: start }).shop;
  assert.equal(toy.capacity, 10);
  f.accounts.db(db => {
    for (let n = 0; n < 11; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`toy-${n}`, 'rival', JSON.stringify({ title: 'Wooden puzzle set', price: 20, businessCategory: 'toys' }), start);
    db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run('wine-1', 'rival', JSON.stringify({ title: 'Red wine', price: 20, businessCategory: 'wine' }), start);
    for (let n = 0; n < 2; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`car-${n}`, 'rival', JSON.stringify({ title: 'Compact city car', price: 1900, businessCategory: 'cars' }), start);
  });
  assert.throws(() => stockBusiness(f.dir, f.rival, toy.id, ['toy-0', 'wine-1'], { now: start }), /wrong_shop_type/);
  assert.equal(f.count('business_stock'), 0);
  assert.throws(() => stockBusiness(f.dir, f.rival, toy.id, Array.from({ length: 11 }, (_, n) => `toy-${n}`), { now: start }), /business_full/);
  assert.equal(f.count('business_stock'), 0);
  stockBusiness(f.dir, f.rival, toy.id, ['toy-0', 'toy-1'], { now: start });
  assert.throws(() => stockBusiness(f.dir, f.rival, toy.id, ['toy-0'], { now: start }), /item_locked/);
  assert.equal(f.count('business_stock'), 2);
  unstockBusiness(f.dir, f.rival, toy.id, 'toy-0', { now: start });
  assert.equal(f.count('business_stock'), 1);
  assert.ok(f.accounts.inventory(f.rival).some(item => item.id === 'toy-0'));
  assert.throws(() => unstockBusiness(f.dir, f.owner, toy.id, 'toy-1', { now: start }), /business_not_found/);
  const carPurchase = buyBusiness(f.dir, f.rival, 'cars', 'popup', { now: start });
  const car = carPurchase.shop;
  assert.equal(carPurchase.cost, Math.round(2500 * car.location.priceMultiplier));
  assert.equal(car.capacity, 1);
  assert.throws(() => stockBusiness(f.dir, f.rival, car.id, ['car-0', 'car-1'], { now: start }), /business_full/);
  stockBusiness(f.dir, f.rival, car.id, ['car-0'], { now: start });
  const smallPurchase = buyBusiness(f.dir, f.rival, 'wine', 'tiny', { now: start });
  const small = smallPurchase.shop;
  assert.equal(smallPurchase.cost, 4000);
  assert.equal(small.capacity, 25);
  const dashboard = businessDashboard(f.dir, f.rival, { now: start });
  assert.deepEqual(dashboard.sizes.map(size => size.carCapacity), [1, 3, 8, 20]);
  assert.deepEqual(dashboard.sizes.map(size => size.cost), [1000, 4000, 15000, 50000]);
  assert.equal(dashboard.sizes[3].cost * dashboard.types.find(type => type.id === 'cars').costFactor, 125000);
  f.accounts.resetEconomy(f.owner, 'RESET ECONOMY');
  assert.equal(f.count('businesses'), 0);
  assert.equal(f.count('business_stock'), 0);
  assert.equal(f.count('inventory'), 0);
});

test('business HTTP routes require sessions and stock lots appear through marketplace APIs', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-business-http-'));
  upsertAuctions(dir, auctionStock);
  const password = 'business-http-password';
  const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password };
  const flags = featureFlags(env);
  const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const economy = createEconomyApi({ dataDir: dir, json, flags });
  const accounts = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: [] }), json, env, flags });
  new Accounts(dir).db(db => db.prepare("UPDATE users SET tokens = 2000 WHERE username = 'admin'").run());
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (await economy(request, response, url)) return;
    if (await accounts(request, response, url)) return;
    json(response, 404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve));
    closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, payload, cookie = '', csrf = true) => fetch(`${base}/api/account/${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'x-requested-with': 'JUSTIZGUESSR' } : {}), cookie },
    body: JSON.stringify(payload) });
  const lots = await (await fetch(`${base}/api/resales`)).json();
  assert.equal(lots.listings.filter(lot => lot.sellerId === 'npc-stock-supply').length, 8);
  assert.equal((await fetch(`${base}/api/wholesale`)).status, 404);
  assert.equal((await fetch(`${base}/api/account/businesses`)).status, 401);
  const login = await post('login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await post('businesses/buy', { type: 'wine', size: 'popup' }, cookie, false)).status, 403);
  assert.equal((await post('businesses/buy', { type: 'wine', size: 'popup' }, cookie)).status, 200);
  const shops = await (await fetch(`${base}/api/account/businesses`, { headers: { cookie } })).json();
  assert.equal(shops.shops.length, 1);
  assert.equal((await post('businesses/margin', { shopId: shops.shops[0].id, profitMargin: 50 }, cookie, false)).status, 403);
  assert.equal((await post('businesses/margin', { shopId: shops.shops[0].id, profitMargin: 101 }, cookie)).status, 400);
  const margin = await (await post('businesses/margin', { shopId: shops.shops[0].id, profitMargin: 50 }, cookie)).json();
  assert.equal(margin.shop.profitMargin, 50);
  assert.ok(margin.shop.buyChancePercent < shops.shops[0].buyChancePercent);
  // HTTP supply uses the live clock, so either archived wine can be in rotation.
  const wine = lots.listings.find(lot => lot.item.businessCategory === 'wine');
  assert.ok(wine && auctionStock.some(auction => auction.id === wine.item.auctionId));
  const bid = await post('resale/bid', { id: wine.id, amount: wine.startPrice }, cookie);
  assert.equal(bid.status, 200);
  const bidResult = await bid.json();
  assert.equal(bidResult.user.tokens, 2000 - 1000 - wine.startPrice);
  assert.equal(bidResult.user.activeBids, 1);
  const hidden = createEconomyApi({ dataDir: dir, json, flags: { ...flags, businesses: false } });
  assert.equal(hidden({ method: 'GET' }, null, new URL('/api/wholesale', base)), false);
});
