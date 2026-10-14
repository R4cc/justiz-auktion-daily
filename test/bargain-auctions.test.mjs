import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { bargainAuctionWindows, supplyBargainAuctions, BARGAIN_SUPPLIER_ID, BARGAIN_DURATION_MS } from '../src/bargain-auctions.mjs';
import { estimatedValueTokens, marketIndexes, setMarketIndex } from '../src/market.mjs';
import { getResale, listResales, placeBid, settleAuction } from '../src/resale.mjs';
import { tickNpcBuyers } from '../src/npc-buyers.mjs';
import { tickEconomy } from '../src/economy-runtime.mjs';

const day = 86_400_000, start = Date.parse('2026-10-14T00:00:00Z');
const stock = [
  { id: 1, title: 'Makita Bohrmaschine', category: 'Werkzeuge', finalPrice: 201, currentBid: 40, image: '/favicon.png' },
  { id: 2, title: 'Gold Armbanduhr', category: 'Schmuck & Uhren', currentBid: 900, image: '/favicon.png' },
  { id: 3, title: 'Laptop Lenovo', category: 'Elektronik', currentBid: 400, image: '/favicon.png' }
];
async function fixture(t, archive = stock) {
  const dir = await mkdtemp('/tmp/jg-bargain-');
  const accounts = new Accounts(dir, { now: () => start, flags: { resales: true } });
  accounts.db(db => {
    for (const id of ['buyer', 'rival']) db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',100000,?)").run(id, id, start);
  });
  upsertAuctions(dir, archive);
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, at: bargainAuctionWindows(start)[0].startsAt };
}

test('six varied one-hour drops per day, no early/expired drops or duplicate inventory after restart', async t => {
  const f = await fixture(t), sources = new Set(), offsets = new Set();
  for (let d = 0; d < 7; d++) {
    const windows = bargainAuctionWindows(start + d * day);
    assert.equal(windows.length, 6);
    for (const [slot, window] of windows.entries()) {
      assert.equal(window.endsAt - window.startsAt, BARGAIN_DURATION_MS);
      assert.ok(window.startsAt >= start + d * day + slot * 4 * BARGAIN_DURATION_MS);
      assert.ok(window.endsAt <= start + d * day + (slot + 1) * 4 * BARGAIN_DURATION_MS);
      offsets.add(window.startsAt % (4 * BARGAIN_DURATION_MS));
      assert.equal(supplyBargainAuctions(f.dir, { now: window.startsAt - 1 }).supplied, 0);
      const result = supplyBargainAuctions(f.dir, { now: window.startsAt });
      assert.equal(result.supplied, 1);
      const lot = getResale(f.dir, result.auctions[0], { now: window.startsAt });
      sources.add(lot.item.auctionId);
      assert.equal(lot.sellerType, 'npc'); assert.equal(lot.quantity, 1);
      assert.equal(lot.startedAt, window.startsAt); assert.equal(lot.endsAt, window.endsAt);
      assert.ok(listResales(f.dir, { now: window.startsAt }).some(row => row.id === lot.id));
      closeDataStore(f.dir);
      assert.equal(supplyBargainAuctions(f.dir, { now: window.startsAt + 1 }).supplied, 0);
      assert.equal(supplyBargainAuctions(f.dir, { now: window.endsAt }).supplied, 0);
    }
  }
  assert.ok(sources.size > 1); assert.ok(offsets.size > 6);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), 42);
  // A long outage creates only the current still-open event.
  const late = bargainAuctionWindows(start + 100 * day)[3];
  assert.equal(supplyBargainAuctions(f.dir, { now: late.startsAt + 60_000 }).supplied, 1);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), 43);
});

test('reserve is half the live market quote at creation; original value and frozen reserve survive market moves', async t => {
  const f = await fixture(t, [stock[0]]), at = f.at + 60_000;
  setMarketIndex(f.dir, 'tools', 150, { now: at });
  const { auctions } = supplyBargainAuctions(f.dir, { now: at });
  const lot = getResale(f.dir, auctions[0], { now: at });
  const item = f.accounts.db(db => JSON.parse(db.prepare('SELECT item FROM inventory WHERE id=?').get(lot.inventoryId).item));
  const quote = f.accounts.db(db => estimatedValueTokens(item, marketIndexes(db, at)));
  assert.equal(lot.startPrice, Math.round(quote * .5));
  assert.equal(item.price, 201); assert.equal(item.sellValue, 201);
  assert.equal(item.marketCategory, 'tools'); assert.equal(lot.endsAt, f.at + BARGAIN_DURATION_MS);
  setMarketIndex(f.dir, 'tools', 50, { now: at + 1 });
  assert.equal(supplyBargainAuctions(f.dir, { now: at + 1 }).supplied, 0);
  const moved = getResale(f.dir, lot.id, { now: at + 1 });
  assert.equal(moved.startPrice, lot.startPrice); assert.ok(moved.estimatedValueTokens < quote);
});

test('player bids share ordinary escrow, refunds and exactly-once settlement; automatic NPCs leave bargains available', async t => {
  const f = await fixture(t), { auctions } = supplyBargainAuctions(f.dir, { now: f.at });
  const lot = getResale(f.dir, auctions[0], { now: f.at });
  for (const offset of [0, 60_000, 120_000]) tickNpcBuyers(f.dir, { now: f.at + offset, unit: () => 0 });
  assert.equal(getResale(f.dir, lot.id, { now: f.at + 120_000 }).bidCount, 0);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM resale_npc_interest WHERE auction_id=?').get(lot.id).n), 0);
  const balance = id => f.accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(id).tokens);
  placeBid(f.dir, { id: 'buyer' }, lot.id, lot.startPrice, { now: f.at + 120_001 });
  assert.equal(balance('buyer'), 100000 - lot.startPrice);
  placeBid(f.dir, { id: 'rival' }, lot.id, lot.startPrice + lot.bidIncrement, { now: f.at + 120_002 });
  assert.equal(balance('buyer'), 100000);
  for (let retry = 0; retry < 2; retry++) settleAuction(f.dir, lot.id, { now: lot.endsAt + 1 });
  assert.equal(balance('rival'), 100000 - lot.startPrice - lot.bidIncrement);
  assert.equal(balance(BARGAIN_SUPPLIER_ID), lot.startPrice + lot.bidIncrement);
  const row = f.accounts.db(db => db.prepare('SELECT user_id,item FROM inventory WHERE id=?').get(lot.inventoryId));
  assert.equal(row.user_id, 'rival'); assert.equal(JSON.parse(row.item).auctionId, lot.item.auctionId);
});

test('missing/ineligible archive skips supply, and a failed insert rolls back item creation for a safe retry', async t => {
  const f = await fixture(t, []);
  assert.equal(supplyBargainAuctions(f.dir, { now: f.at }).supplied, 0);
  upsertAuctions(f.dir, [
    { ...stock[0], id: 7, title: '' }, { ...stock[0], id: 8, image: null },
    { ...stock[0], id: 9, finalPrice: 0 }, { ...stock[0], id: 10, finalPrice: 1e20 }
  ]);
  assert.equal(supplyBargainAuctions(f.dir, { now: f.at }).supplied, 0);
  upsertAuctions(f.dir, stock);
  f.accounts.db(db => db.exec("CREATE TRIGGER block_bargain BEFORE INSERT ON resale_auctions BEGIN SELECT RAISE(ABORT,'blocked listing'); END"));
  assert.throws(() => supplyBargainAuctions(f.dir, { now: f.at }), /blocked listing/);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), 0);
  f.accounts.db(db => db.exec('DROP TRIGGER block_bargain'));
  assert.equal(supplyBargainAuctions(f.dir, { now: f.at }).supplied, 1);
});

test('economy runtime supplies bargains only when resale auctions are enabled', async t => {
  const f = await fixture(t);
  assert.deepEqual(tickEconomy(f.dir, { now: f.at, flags: {} }), { failures: [] });
  const result = tickEconomy(f.dir, { now: f.at, flags: { resales: true } });
  assert.deepEqual(result.failures, []); assert.equal(result.bargainSupply.supplied, 1);
  assert.equal(tickEconomy(f.dir, { now: f.at + 1, flags: { resales: true } }).bargainSupply.supplied, 0);
});
