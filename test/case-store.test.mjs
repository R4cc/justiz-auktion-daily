import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { loadCaseStoreCatalog, quoteCaseStore, STORE_CASES } from '../src/case-store.mjs';
import { prepareMysteryCase, prepareSealedCase, insertSealedCase } from '../src/sealed-cases.mjs';
import { drawItem, RARITIES } from '../src/cases.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { estimatedValueTokens, marketIndexes, setMarketIndex } from '../src/market.mjs';
import { expectedItemValue, ECONOMY_BALANCE } from '../src/economy-balance.mjs';
import { getResale, listItem, placeBid, settleAuction } from '../src/resale.mjs';

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

test('all five named cases stay available with empty or thin archives, with private sealed rewards', async t => {
  for (const auctions of [[], stock.slice(0, 2), stock]) {
    const f = await fixture(t, auctions), catalog = f.catalog(), quote = f.quote();
    assert.deepEqual(quote.cases.map(box => box.id), STORE_CASES.map(tier => tier.id));
    assert.doesNotMatch(JSON.stringify(quote), /"(?:reward|weights|odds|chance)":/);
    for (const [index, offer] of quote.cases.entries()) {
      assert.ok(Number.isSafeInteger(offer.cost) && offer.cost > 0);
      assert.ok(offer.items.length);
      const balance = f.balance();
      const item = f.accounts.buyCase(f.buyer, catalog, offer.id, `store-purchase-${index}-0001`, quote.revision);
      assert.equal(f.balance(), balance - offer.cost);
      assert.equal(item.kind, 'case'); assert.equal(item.caseType, offer.id); assert.ok(!('caseTier' in item));
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
  STORE_CASES.forEach((tier, i) => assert.equal(neutral.cases[i].cost,
    Math.ceil(expectedItemValue(mixed.items, tier.weights) / ECONOMY_BALANCE.paidCaseReturn)));
  setMarketIndex(f.dir, 'electronics', 150, { now: day });
  const hot = f.quote();
  assert.notEqual(hot.revision, neutral.revision);
  const indexes = f.accounts.db(db => marketIndexes(db, day));
  STORE_CASES.forEach((tier, i) => assert.equal(hot.cases[i].cost,
    Math.ceil(expectedItemValue(mixed.items, tier.weights, item => estimatedValueTokens(item, indexes)) / ECONOMY_BALANCE.paidCaseReturn)));
  const balance = f.balance();
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'lost-property', 'stale-store-quote-0001', neutral.revision), /catalog_changed/);
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
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'seizure', request, quote.revision), /request_conflict/);
  f.accounts.openSealedCase(f.buyer, item.id);
  f.setNow(day + 86400000);
  const next = f.catalog(); assert.notEqual(next.rotationDate, catalog.rotationDate);
  assert.deepEqual(f.accounts.buyCase(f.buyer, next, offer.id, request, quote.revision), item);
  assert.equal(f.count('inventory'), 2); assert.equal(f.count('case_purchases'), 1);
  assert.throws(() => f.accounts.buyCase(f.buyer, next, offer.id, 'next-edition-buy-0001', quote.revision), /catalog_changed/);
  assert.throws(() => f.accounts.buyCase(f.buyer, next, 'unknown', 'invalid-case-tier-0001', f.quote().revision), /invalid_case/);
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
  const item = f.accounts.buyCase(f.buyer, f.catalog(), 'seizure', 'resale-store-case-0001', quote.revision);
  assert.throws(() => f.accounts.openSealedCase(f.other, item.id), /case_not_found/);
  const lot = listItem(f.dir, f.buyer, { inventoryId: item.id, startPrice: 1,
    endsAt: new Date(day + 3600000).toISOString() }, { now: day });
  const listed = getResale(f.dir, lot.id, { now: day });
  assert.equal(listed.item.caseType, 'seizure'); assert.equal(listed.item.caseBadge, 'ST');
  assert.ok(!('reward' in listed.item) && !('caseTier' in listed.item));
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
  assert.throws(() => f.accounts.buyCase(f.buyer, f.catalog(), 'lost-property', 'rollback-store-buy-0001', quote.revision), /receipt_unavailable/);
  assert.equal(f.balance(), before);
  for (const table of ['inventory', 'sealed_cases', 'case_purchases']) assert.equal(f.count(table), 0);
});

test('higher-priced named cases improve every rarity threshold and can still pull common items', async t => {
  const f = await fixture(t), catalog = f.catalog(), quote = f.quote();
  const items = catalog.cases.find(box => box.id === 'fundkiste').items;
  for (const [index, definition] of STORE_CASES.entries()) {
    const offer = quote.cases[index];
    assert.deepEqual(new Set(offer.items.map(item => item.rarity)), new Set(RARITIES.map(rarity => rarity.id)));
    assert.equal(definition.weights.reduce((sum, weight) => sum + weight, 0), 10000);
    assert.ok(definition.weights.every(weight => weight > 0));
    assert.ok(Math.abs(offer.dropChances.reduce((sum, chance) => sum + chance.percent, 0) - 100) < 1e-9);
    const counts = Object.fromEntries(RARITIES.map(rarity => [rarity.id, 0]));
    for (let ticket = 0; ticket < 10000; ticket++) {
      let calls = 0;
      const winner = drawItem(catalog, { items, weights: definition.weights }, () => calls++ ? 0 : ticket);
      counts[winner.rarity]++;
    }
    RARITIES.forEach((rarity, n) => {
      assert.equal(counts[rarity.id], definition.weights[n]);
      assert.equal(offer.dropChances[n].percent, counts[rarity.id] / 100);
      // Exercise the actual sealed preparation at each bucket's first ticket.
      const ticket = definition.weights.slice(0, n).reduce((sum, weight) => sum + weight, 0);
      let calls = 0;
      assert.equal(prepareMysteryCase(catalog, definition, { now: day, random: () => calls++ ? 0 : ticket }).reward.rarity, rarity.id);
    });
    if (index) {
      assert.ok(offer.cost > quote.cases[index - 1].cost);
      for (let minimum = 1; minimum < 5; minimum++) {
        const tail = weights => weights.slice(minimum).reduce((sum, weight) => sum + weight, 0);
        assert.ok(tail(definition.weights) > tail(STORE_CASES[index - 1].weights));
      }
    }
  }
  const equalValue = { ...catalog, cases: catalog.cases.map(box => ({ ...box, items: box.items.map(item => ({ ...item, price: 1, sellValue: 1 })) })) };
  assert.deepEqual(quoteCaseStore(equalValue).cases.map(box => box.cost), [2, 3, 4, 5, 6]);
});

test('previously purchased tier cases keep their stored rewards and retry receipts after the store redesign', async t => {
  const f = await fixture(t), catalog = f.catalog(), prepared = prepareSealedCase(catalog, 'legendary', { now: day, random: () => 0 });
  f.accounts.db(db => {
    insertSealedCase(db, f.buyer.id, prepared, day);
    db.prepare('INSERT INTO case_purchases VALUES (?, ?, ?, ?)')
      .run(f.buyer.id, 'old-tier-purchase-0001', 'legendary', JSON.stringify(prepared.item));
  });
  const before = f.balance();
  assert.deepEqual(f.accounts.buyCase(f.buyer, catalog, 'legendary', 'old-tier-purchase-0001', 'old-revision'), { ...prepared.item, marketCategory: null });
  const reward = f.accounts.openSealedCase(f.buyer, prepared.item.id);
  assert.equal(reward.id, prepared.reward.id); assert.equal(reward.rarity, 'legendary');
  assert.equal(f.balance(), before);
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'legendary', 'old-client-purchase-0001', 'old-revision'), /catalog_changed/);
});
