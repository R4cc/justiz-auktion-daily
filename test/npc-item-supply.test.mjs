import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { supplyNpcItemAuctions, ITEM_SUPPLIER_ID, ITEM_DROP_PERIOD_MS, ITEM_AUCTION_DURATION_MS } from '../src/npc-item-supply.mjs';
import { getResale, listResales, placeBid, settleAuction, settleDueListings } from '../src/resale.mjs';
import { tickNpcBuyers } from '../src/npc-buyers.mjs';
import { estimatedValueTokens, marketIndexes, setMarketIndex } from '../src/market.mjs';
import { bargainAuctionWindows, supplyBargainAuctions } from '../src/bargain-auctions.mjs';

const now = Date.parse('2026-10-14T00:00:00Z');
const stock = [{ id: 1, title: 'Makita Bohrmaschine', category: 'Werkzeuge', finalPrice: 1000, image: '/favicon.png' },
  { id: 2, title: 'Laptop Lenovo', category: 'Elektronik', finalPrice: 500, image: '/favicon.png' }];
async function fixture(t, archive = stock) {
  const dir = await mkdtemp('/tmp/jg-npc-items-'), accounts = new Accounts(dir, { now: () => now, flags: { resales: true } });
  accounts.db(db => db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('buyer','Buyer','disabled',100000,?)").run(now));
  upsertAuctions(dir, archive);
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts };
}

test('regular NPC supply keeps four staggered two-hour listings with variable live-market reserves and safe restart catch-up', async t => {
  const f = await fixture(t), ratios = [], sources = new Set();
  setMarketIndex(f.dir, 'tools', 140, { now }); setMarketIndex(f.dir, 'electronics', 80, { now });
  assert.equal(supplyNpcItemAuctions(f.dir, { now }).supplied, 4);
  for (let slot = 0; slot < 48; slot++) {
    const at = now + slot * ITEM_DROP_PERIOD_MS;
    settleDueListings(f.dir, { now: at });
    const result = supplyNpcItemAuctions(f.dir, { now: at });
    assert.equal(result.supplied, slot === 0 ? 0 : 1);
    closeDataStore(f.dir);
    assert.equal(supplyNpcItemAuctions(f.dir, { now: at + 1 }).supplied, 0);
    const live = listResales(f.dir, { sellerId: ITEM_SUPPLIER_ID, now: at });
    assert.equal(live.length, 4); assert.equal(new Set(live.map(lot => lot.endsAt)).size, 4);
    const latest = live[0]; sources.add(latest.item.auctionId);
    const item = f.accounts.db(db => JSON.parse(db.prepare('SELECT item FROM inventory WHERE id=?').get(latest.inventoryId).item));
    const quote = f.accounts.db(db => estimatedValueTokens(item, marketIndexes(db, at)));
    const ratio = latest.startPrice / quote; ratios.push(ratio);
    assert.ok(ratio >= .649 && ratio <= 1.351);
    assert.equal(latest.quantity, 1); assert.equal(latest.sellerType, 'npc');
    assert.equal(latest.endsAt - latest.startedAt, ITEM_AUCTION_DURATION_MS);
    assert.equal(item.price, stock.find(source => source.id === item.auctionId).finalPrice);
    assert.equal(item.sellValue, item.price);
  }
  assert.ok(ratios.some(ratio => ratio < .9)); assert.ok(ratios.some(ratio => ratio > 1.1));
  assert.ok(new Set(ratios).size > 20); assert.equal(sources.size, 2);
  const inventoryCount = f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n);
  assert.equal(supplyNpcItemAuctions(f.dir, { now: now + 100 * 86_400_000 }).supplied, 4);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), inventoryCount + 4);
});

test('regular listings share player escrow and settlement and coexist with unchanged half-price events', async t => {
  const f = await fixture(t), at = bargainAuctionWindows(now)[0].startsAt;
  supplyNpcItemAuctions(f.dir, { now: at });
  const bargain = supplyBargainAuctions(f.dir, { now: at }); assert.equal(bargain.supplied, 1);
  const deal = getResale(f.dir, bargain.auctions[0], { now: at });
  assert.equal(deal.startPrice, Math.round(deal.estimatedValueTokens * .5));
  const lot = listResales(f.dir, { sellerId: ITEM_SUPPLIER_ID, now: at })[0];
  placeBid(f.dir, { id: 'buyer' }, lot.id, lot.startPrice, { now: at });
  assert.equal(f.accounts.profile({ id: 'buyer' }).tokens, 100000 - lot.startPrice);
  settleAuction(f.dir, lot.id, { now: lot.endsAt + 1 }); settleAuction(f.dir, lot.id, { now: lot.endsAt + 1 });
  const item = f.accounts.inventory({ id: 'buyer' }).find(item => item.id === lot.inventoryId);
  assert.equal(item.auctionId, lot.item.auctionId);
  assert.equal(f.accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(ITEM_SUPPLIER_ID).tokens), lot.startPrice);
});

test('ordinary NPC buyers consider regular supply, while bargains remain reserved for player bidding', async t => {
  const f = await fixture(t), at = bargainAuctionWindows(now)[0].startsAt;
  supplyNpcItemAuctions(f.dir, { now: at }); const bargain = supplyBargainAuctions(f.dir, { now: at }).auctions[0];
  tickNpcBuyers(f.dir, { now: at, unit: () => 0 });
  const interests = f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM resale_npc_interest').get().n);
  assert.ok(interests > 0);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM resale_npc_interest WHERE auction_id=?').get(bargain).n), 0);
});

test('empty archive creates no fictional items, and failed listing inserts roll back the whole supply batch', async t => {
  const f = await fixture(t, []);
  assert.equal(supplyNpcItemAuctions(f.dir, { now }).supplied, 0);
  upsertAuctions(f.dir, stock);
  f.accounts.db(db => db.exec("CREATE TRIGGER block_npc_items BEFORE INSERT ON resale_auctions BEGIN SELECT RAISE(ABORT,'blocked supply'); END"));
  assert.throws(() => supplyNpcItemAuctions(f.dir, { now }), /blocked supply/);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n), 0);
  f.accounts.db(db => db.exec('DROP TRIGGER block_npc_items'));
  assert.equal(supplyNpcItemAuctions(f.dir, { now }).supplied, 4);
});
