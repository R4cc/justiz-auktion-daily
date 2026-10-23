import { caseOutcomeDistribution } from '../src/case-outcomes.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { loadCaseStoreCatalog, quoteCaseStore, STORE_CASES, STORE_CATEGORIES, categoryCasePool } from '../src/case-store.mjs';
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

test('all eighteen category cases stay available with empty or thin archives, with private sealed rewards', async t => {
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
    assert.equal(f.count('case_purchases'), 18);
    assert.equal(f.accounts.inventory(f.buyer).length, 18);
  }
});

test('private category pools contain distinct items and match value-aware draws', async t => {
  const abundant = Array.from({ length: 80 }, (_, i) => ({
    id: 10000 + i, title: `Laptop model ${10000 + i}`, category: 'Elektronik',
    currentBid: (i + 1) * 100, image: '/favicon.png'
  }));
  const f = await fixture(t, abundant);
  for (const [index, offer] of f.quote().cases.entries()) {
    assert.ok(offer.items.length >= 5 && offer.items.length <= 50, offer.id);
    assert.equal(new Set(offer.items.map(item => item.auctionId)).size, offer.items.length);
    const outcomes=caseOutcomeDistribution(offer.items,STORE_CASES[index].weights,{basis:offer.valueBasis,legendaryProbability:offer.legendaryProbability});
    for(const chance of offer.dropChances)assert.ok(Math.abs(chance.percent-100*outcomes.filter(outcome=>outcome.item.rarity===chance.rarity).reduce((sum,outcome)=>sum+outcome.probability,0))<1e-9);
  }
});

test('store prices use tier-weighted expected values and reject changed market quotes before charging', async t => {
  const f = await fixture(t), catalog = f.catalog(), neutral = f.quote();
  for(const category of STORE_CATEGORIES){
    const tiers=neutral.cases.filter(box=>box.category===category.id);
    assert.ok(tiers[0].cost<tiers[1].cost&&tiers[1].cost<tiers[2].cost);
  }
  setMarketIndex(f.dir, 'electronics', 150, { now: day });
  const hot = f.quote();assert.notEqual(hot.revision,neutral.revision);
  for(const offer of hot.cases){
    const previous=neutral.cases.find(box=>box.id===offer.id);
    assert.ok(offer.category==='electronics'?offer.cost>previous.cost:offer.cost===previous.cost);
  }
  const balance = f.balance();
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'electronics-standard', 'stale-store-quote-0001', neutral.revision), /catalog_changed/);
  assert.equal(f.balance(), balance); assert.equal(f.count('case_purchases'), 0);
  setMarketIndex(f.dir, 'electronics', 50, { now: day });
  assert.ok(f.quote().cases.every((box,i)=>box.cost<=neutral.cases[i].cost));
});

test('purchases are atomic and retry safe across restarts, opening, price changes and editions', async t => {
  const f = await fixture(t), catalog = f.catalog(), quote = f.quote();
  const offer = quote.cases[0], request = 'retry-case-store-00001', balance = f.balance();
  const item = f.accounts.buyCase(f.buyer, catalog, offer.id, request, quote.revision);
  closeDataStore(f.dir);
  assert.deepEqual(f.accounts.buyCase(f.buyer, catalog, offer.id, request, quote.revision), item);
  assert.equal(f.balance(), balance - offer.cost);
  assert.throws(() => f.accounts.buyCase(f.buyer, catalog, 'cars-standard', request, quote.revision), /request_conflict/);
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
  const item = f.accounts.buyCase(f.buyer, f.catalog(), 'cars-standard', 'resale-store-case-0001', quote.revision);
  assert.throws(() => f.accounts.openSealedCase(f.other, item.id), /case_not_found/);
  const lot = listItem(f.dir, f.buyer, { inventoryId: item.id, startPrice: 1,
    endsAt: new Date(day + 3600000).toISOString() }, { now: day });
  const listed = getResale(f.dir, lot.id, { now: day });
  assert.equal(listed.item.caseType, 'cars-standard'); assert.equal(listed.item.caseBadge, 'CAR I');
  assert.ok(!('reward' in listed.item) && !('caseTier' in listed.item));
  assert.throws(() => f.accounts.openSealedCase(f.buyer, item.id), /item_listed/);
  placeBid(f.dir, f.other, lot.id, 1, { now: day });
  settleAuction(f.dir, lot.id, { now: day + 3600001 });
  assert.throws(() => f.accounts.openSealedCase(f.buyer, item.id), /case_not_found/);
  assert.ok(f.accounts.openSealedCase(f.other, item.id).auctionId);
});

test('a lucky sealed draw keeps its selected category and frozen value after trading and changing owner luck', async t => {
  const f = await fixture(t);
  const items = [
    { rarity: 'common', title: 'Laptop', price: 100, category: 'Elektronik' },
    { rarity: 'uncommon', title: 'Gold watch', price: 200, category: 'Schmuck & Uhren' },
    { rarity: 'rare', title: 'Riesling', price: 300, category: 'Getränke' },
    { rarity: 'epic', title: 'BMW PKW', price: 400, category: 'Fahrzeuge' },
    { rarity: 'legendary', title: 'Drill', price: 500, category: 'Werkzeuge' }
  ];
  const catalog = { cases: [{ id: 'fundkiste', available: true, items }] };
  const random = max => Math.floor(max * .745);
  const ordinary = prepareMysteryCase(catalog, STORE_CASES[0], { now: day, random });
  const lucky = prepareMysteryCase(catalog, STORE_CASES[0], { now: day, random, luckPercent: 7 });
  assert.equal(ordinary.reward.marketCategory, 'electronics');
  assert.equal(lucky.reward.marketCategory, 'watches_jewelry');
  assert.equal(lucky.reward.title, 'Gold watch');
  f.accounts.atomic(db => insertSealedCase(db, f.buyer.id, lucky, day));
  const auction = listItem(f.dir, f.buyer, { inventoryId: lucky.item.id, startPrice: 1,
    endsAt: new Date(day + 60000).toISOString() }, { now: day });
  placeBid(f.dir, f.other, auction.id, 1, { now: day + 1 });
  settleAuction(f.dir, auction.id, { now: day + 60001 });
  f.accounts.db(db => db.prepare('INSERT INTO user_skills(user_id,skill_id,rank,updated_at) VALUES (?,?,?,?)')
    .run(f.other.id, 'luck', 3, day + 60001));
  setMarketIndex(f.dir, 'electronics', 150, { now: day + 60001 });
  setMarketIndex(f.dir, 'watches_jewelry', 50, { now: day + 60001 });
  f.setNow(day + 60001);
  closeDataStore(f.dir);
  const opened = f.accounts.openSealedCase(f.other, lucky.item.id);
  assert.deepEqual(opened, { ...lucky.reward, sellValue: 200 });
  const indexes = f.accounts.db(db => marketIndexes(db, day + 60001));
  assert.equal(estimatedValueTokens(opened, indexes), 100);
  const inventory = f.accounts.inventory(f.other).find(item => item.id === opened.id);
  assert.equal(inventory.estimatedValueTokens, 100);
  assert.deepEqual(f.accounts.openSealedCase(f.other, lucky.item.id), opened);
});

test('receipt persistence failure rolls back the charge, case and private reward together', async t => {
  const f = await fixture(t), quote = f.quote(), before = f.balance();
  f.accounts.db(db => db.exec(`CREATE TRIGGER fail_store_receipt BEFORE INSERT ON case_purchases
    BEGIN SELECT RAISE(ABORT, 'receipt_unavailable'); END`));
  assert.throws(() => f.accounts.buyCase(f.buyer, f.catalog(), 'electronics-standard', 'rollback-store-buy-0001', quote.revision), /receipt_unavailable/);
  assert.equal(f.balance(), before);
  for (const table of ['inventory', 'sealed_cases', 'case_purchases']) assert.equal(f.count(table), 0);
});

test('named cases publish exact value-aware rarity odds while retaining their base price ladder', async t => {
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
      const outcomes=caseOutcomeDistribution(offer.items,definition.weights,{basis:offer.valueBasis,legendaryProbability:offer.legendaryProbability});
      assert.ok(Math.abs(offer.dropChances[n].percent-100*outcomes.filter(outcome=>outcome.item.rarity===rarity.id).reduce((sum,outcome)=>sum+outcome.probability,0))<1e-9);
      // Exercise the actual sealed preparation at each bucket's first ticket.
      const ticket = definition.weights.slice(0, n).reduce((sum, weight) => sum + weight, 0);
      let calls = 0;
      assert.equal(prepareMysteryCase(catalog, definition, { now: day, random: () => calls++ ? 0 : ticket }).reward.rarity, rarity.id);
    });
    if (index % 3) {
      assert.ok(offer.cost > quote.cases[index - 1].cost);
      for (let minimum = 1; minimum < 5; minimum++) {
        const tail = weights => weights.slice(minimum).reduce((sum, weight) => sum + weight, 0);
        assert.ok(tail(definition.weights) > tail(STORE_CASES[index - 1].weights));
      }
    }
  }
  const equalValue = { ...catalog, cases: catalog.cases.map(box => ({ ...box, items: box.items.map(item => ({ ...item, price: 1, sellValue: 1 })) })) };
  assert.ok(quoteCaseStore(equalValue).cases.every(box=>box.cost>0));
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
