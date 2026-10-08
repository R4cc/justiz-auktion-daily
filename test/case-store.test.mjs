import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { CASE_TIERS } from '../src/sealed-cases.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { estimatedValueTokens, marketIndexes, setMarketIndex } from '../src/market.mjs';
import { expectedItemValue, ECONOMY_BALANCE } from '../src/economy-balance.mjs';
import { listItem, placeBid, settleAuction } from '../src/resale.mjs';

const day = Date.parse('2026-10-08T12:00:00Z');
const stock = Array.from({ length: 24 }, (_, i) => ({ id: 1000 + i, title: `Laptop model ${1000 + i}`,
  category: 'Elektronik', currentBid: (i + 1) * 100, image: '/favicon.png' }));

async function fixture(t, auctions = stock) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-case-store-'));
  let now = day;
  const accounts = new Accounts(dir, { now: () => now });
  upsertAuctions(dir, auctions);
  accounts.db(db => {
    for (const id of ['buyer', 'other']) db.prepare(`INSERT INTO users (id, username, password_hash, tokens, created_at)
      VALUES (?, ?, 'disabled', 10000000, ?)`).run(id, id, day);
  });
  const buyer = { id: 'buyer', admin: true }, other = { id: 'other' };
  const catalog = () => loadCaseStoreCatalog(dir, now);
  const quote = () => accounts.db(db => quoteCaseStore(catalog(), marketIndexes(db, now)));
  const balance = () => accounts.profile(buyer).tokens;
  const count = table => accounts.db(db => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, buyer, other, catalog, quote, balance, count, setNow: value => { now = value; } };
}

test('all five case tiers stay available with empty or thin archives, with private sealed rewards', async t => {
  for (const auctions of [[], stock.slice(0, 2), stock]) {
    const f = await fixture(t, auctions), catalog = f.catalog(), quote = f.quote();
    assert.deepEqual(quote.cases.map(box => box.id), CASE_TIERS.map(tier => tier.id));
    assert.doesNotMatch(JSON.stringify(quote), /"(?:reward|weights|odds|chance)":/);
    for (const [index, offer] of quote.cases.entries()) {
      assert.ok(Number.isSafeInteger(offer.cost) && offer.cost > 0);
      assert.ok(offer.items.length);
      const balance = f.balance();
      const item = f.accounts.buyCase(f.buyer, catalog, offer.id, `store-purchase-${index}-0001`, quote.revision);
      assert.equal(f.balance(), balance - offer.cost);
      assert.equal(item.kind, 'case'); assert.equal(item.caseTier, offer.id);
      assert.equal(item.caseCost, offer.cost); assert.equal(item.edition, quote.rotationDate);
      assert.ok(!('reward' in item) && !('auctionId' in item));
      const reward = f.accounts.openSealedCase(f.buyer, item.id);
      assert.ok(offer.items.some(candidate => candidate.auctionId === reward.auctionId && candidate.rarity === reward.rarity));
      assert.equal(reward.caseCost, offer.cost);
      assert.deepEqual(f.accounts.openSealedCase(f.buyer, item.id), reward);
    }
    assert.equal(f.count('case_purchases'), 5);
    assert.equal(f.accounts.inventory(f.buyer).length, 5);
  }
});

test('store prices use tier-weighted expected values and reject changed market quotes before charging', async t => {
  const f = await fixture(t), catalog = f.catalog(), neutral = f.quote();
  const mixed = catalog.cases.find(box => box.id === 'fundkiste');
  CASE_TIERS.forEach((tier, i) => assert.equal(neutral.cases[i].cost,
    Math.ceil(expectedItemValue(mixed.items, tier.weights) / ECONOMY_BALANCE.paidCaseReturn)));
  setMarketIndex(f.dir, 'electronics', 150, { now: day });
  const hot = f.quote();
  assert.notEqual(hot.revision, neutral.revision);
  const indexes = f.accounts.db(db => marketIndexes(db, day));
  CASE_TIERS.forEach((tier, i) => assert.equal(hot.cases[i].cost,
    Math.ceil(expectedItemValue(mixed.items, tier.weights, item => estimatedValueTokens(item, indexes)) / ECONOMY_BALANCE.paidCaseReturn)));
  const balance = f.balance();
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'common', 'stale-store-quote-0001', neutral.revision), /catalog_changed/);
  assert.equal(f.balance(), balance); assert.equal(f.count('case_purchases'), 0);
  setMarketIndex(f.dir, 'electronics', 50, { now: day });
  assert.deepEqual(f.quote().cases.map(box => box.cost), neutral.cases.map(box => box.cost));
});

test('purchases are atomic and retry safe across restarts, opening, price changes and editions', async t => {
  const f = await fixture(t), catalog = f.catalog(), quote = f.quote();
  const offer = quote.cases[0], request = 'retry-case-store-00001', balance = f.balance();
  const item = f.accounts.buyCase(f.buyer, catalog, offer.id, request, quote.revision);
  closeDataStore(f.dir);
  assert.deepEqual(f.accounts.buyCase(f.buyer, catalog, offer.id, request, quote.revision), item);
  assert.equal(f.balance(), balance - offer.cost);
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'rare', request, quote.revision), /request_conflict/);
  f.accounts.openSealedCase(f.buyer, item.id);
  f.setNow(day + 86400000);
  const next = f.catalog(); assert.notEqual(next.rotationDate, catalog.rotationDate);
  assert.deepEqual(f.accounts.buyCase(f.buyer, next, offer.id, request, quote.revision), item);
  assert.equal(f.count('inventory'), 2); assert.equal(f.count('case_purchases'), 1);
  assert.throws(() => f.accounts.buyCase(f.buyer, next, offer.id, 'next-edition-buy-0001', quote.revision), /catalog_changed/);
  assert.throws(() => f.accounts.buyCase(f.buyer, next, 'unknown', 'invalid-case-tier-0001', f.quote().revision), /invalid_case_tier/);
  assert.throws(() => f.accounts.buyCase(f.buyer, next, offer.id, 'bad', f.quote().revision), /invalid_request/);
  assert.throws(() => f.accounts.buyCase(f.buyer, next, offer.id, 'missing-revision-0001'), /catalog_changed/);
  f.accounts.db(db => db.prepare('UPDATE users SET tokens = 0 WHERE id = ?').run(f.buyer.id));
  assert.throws(() => f.accounts.buyCase(f.buyer, next, offer.id, 'zero-balance-buy-0001', f.quote().revision), /insufficient_tokens/);
  assert.equal(f.balance(), 0); assert.equal(f.count('inventory'), 2); assert.equal(f.count('case_purchases'), 1);
  f.accounts.resetEconomy(f.buyer, 'RESET ECONOMY');
  assert.equal(f.count('case_purchases'), 0); assert.equal(f.count('sealed_cases'), 0);
});

test('store cases use the existing resale locks and transfer the sealed reward to the winning owner', async t => {
  const f = await fixture(t), quote = f.quote();
  const item = f.accounts.buyCase(f.buyer, f.catalog(), 'rare', 'resale-store-case-0001', quote.revision);
  assert.throws(() => f.accounts.openSealedCase(f.other, item.id), /case_not_found/);
  const lot = listItem(f.dir, f.buyer, { inventoryId: item.id, startPrice: 1,
    endsAt: new Date(day + 3600000).toISOString() }, { now: day });
  assert.throws(() => f.accounts.openSealedCase(f.buyer, item.id), /item_listed/);
  placeBid(f.dir, f.other, lot.id, 1, { now: day });
  settleAuction(f.dir, lot.id, { now: day + 3600001 });
  assert.throws(() => f.accounts.openSealedCase(f.buyer, item.id), /case_not_found/);
  assert.ok(f.accounts.openSealedCase(f.other, item.id).auctionId);
});

test('receipt persistence failure rolls back the charge, case and private reward together', async t => {
  const f = await fixture(t), quote = f.quote(), before = f.balance();
  f.accounts.db(db => db.exec(`CREATE TRIGGER fail_store_receipt BEFORE INSERT ON case_purchases
    BEGIN SELECT RAISE(ABORT, 'receipt_unavailable'); END`));
  assert.throws(() => f.accounts.buyCase(f.buyer, f.catalog(), 'common', 'rollback-store-buy-0001', quote.revision), /receipt_unavailable/);
  assert.equal(f.balance(), before);
  for (const table of ['inventory', 'sealed_cases', 'case_purchases']) assert.equal(f.count(table), 0);
});
