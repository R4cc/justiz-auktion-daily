import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CASE_RETURN_TARGET, caseCatalog, loadCaseCatalog, drawItem, publicCaseCatalog, RARITIES, tokenValue } from '../src/cases.mjs';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';

const day = Date.parse('2026-09-12T12:00:00Z'), tomorrow = day + 86400000;
const themes = [
  ['cars', 'BMW PKW', 'Fahrzeuge', 500], ['wine', 'Riesling Wein', 'Getränke', 10],
  ['electronics', 'Laptop', 'Elektronik', 50], ['tools', 'Bohrhammer Makita', 'Werkzeuge', 25],
  ['jewellery', 'Gold Armbanduhr', 'Schmuck & Uhren', 100], ['collectibles', 'Lego Modell', 'Sammlerstücke', 20]
];
const stock = themes.flatMap(([theme, title, category, price], index) => Array.from({ length: 24 }, (_, n) => ({
  id: index * 100 + n + 1000, title: `${title} ${index * 100 + n + 1000}`, category,
  currentBid: price * (n + 1), image: `/assets/${theme}.jpg`
})));

test('each themed case uses only its own category and excludes vehicle accessories and spirits', () => {
  const extras = [
    { id: 9001, title: 'BMW Reifen 9001', category: 'Fahrzeuge' },
    { id: 9002, title: 'Whisky 9002', category: 'Getränke' },
    { id: 9003, title: 'Modellauto BMW 9003', category: 'Sammlerstücke' },
    { id: 9004, title: 'BMW Motor 9004', category: 'Fahrzeuge' },
    { id: 9005, title: 'Cola 9005', category: 'Getränke' }
  ].map(item => ({ ...item, currentBid: 100, image: '/assets/extra.jpg' }));
  // Shared source photos must not let a family representative leak across categories.
  const sharedPhoto = stock.map((item, i) => i === 0 || i === 48 ? { ...item, sourceImages: ['https://example.test/shared-photo.jpg'] } : item);
  const catalog = caseCatalog([...sharedPhoto, ...extras], day);
  for (const [theme, , category] of themes) {
    const box = catalog.cases.find(box => box.id === theme);
    assert.ok(box.available);
    assert.ok(box.items.every(item => item.category === category));
    assert.ok(box.items.every(item => item.auctionId < 9000));
    assert.equal(new Set(box.items.map(item => item.rarity)).size, 5);
  }
});

test('sale values follow auction euros and case prices preserve the target return', () => {
  assert.equal(tokenValue(130), 130);
  assert.equal(tokenValue(60), 60);
  for (let offset = 0; offset < 7; offset++) {
    const catalog = caseCatalog(stock, day + offset * 86400000);
    for (const box of catalog.cases) {
      assert.ok(box.available);
      const total = box.weights.reduce((sum, n) => sum + n, 0);
      let expected = 0;
      RARITIES.forEach((rarity, tier) => {
        const pool = box.items.filter(item => item.rarity === rarity.id);
        assert.ok(pool.length);
        assert.ok(pool.every(item => item.sellValue === Math.max(1, Math.round(item.price)) && Number.isSafeInteger(item.sellValue)));
        expected += pool.reduce((sum, item) => sum + item.sellValue, 0) / pool.length * box.weights[tier] / total;
      });
      assert.equal(box.weights[4] / total, .001);
      assert.equal(box.cost, Math.max(1, Math.round(expected / CASE_RETURN_TARGET)));
    }
  }
  // Exercise actual draw boundaries rather than just inspecting configured weights.
  const catalog = caseCatalog(stock, day);
  for (const box of catalog.cases) {
    let jackpots = 0;
    for (let ticket = 0; ticket < 10000; ticket++) {
      let calls = 0;
      const item = drawItem(catalog, box, limit => {
        const result = calls++ ? limit - 1 : ticket;
        assert.ok(result >= 0 && result < limit);
        return result;
      });
      assert.ok(box.items.includes(item));
      assert.equal(item.sellValue, Math.max(1, Math.round(item.price)));
      if (item.rarity === 'legendary') jackpots++;
    }
    assert.equal(jackpots, 10);
  }
});

test('editions are order-independent, rotate stock and prices, and expensive stock affects pricing', () => {
  const first = caseCatalog(stock, day), next = caseCatalog(stock, tomorrow);
  assert.deepEqual(caseCatalog([...stock].reverse(), day), first);
  assert.equal(first.rotatesAt, '2026-09-13T00:00:00.000Z');
  assert.notEqual(first.revision, next.revision);
  for (const box of first.cases) {
    const changed = next.cases.find(item => item.id === box.id);
    assert.notDeepEqual(new Set(changed.items.map(item => item.auctionId)), new Set(box.items.map(item => item.auctionId)));
    const costs = new Set(Array.from({ length: 5 }, (_, n) => caseCatalog(stock, day + n * 86400000).cases.find(item => item.id === box.id).cost));
    assert.ok(costs.size > 1);
  }
  const cheaper = caseCatalog(stock.map(item => ({ ...item, currentBid: item.currentBid / 10 })), day);
  first.cases.forEach((box, i) => assert.ok(box.cost > cheaper.cases[i].cost));
  assert.doesNotMatch(JSON.stringify(publicCaseCatalog(first)), /"(?:weights|odds|chance|baseCost|referenceValue)":/);
});

test('thin or duplicate-only stock is unavailable instead of changing the economic balance', () => {
  for (let count = 0; count < 5; count++) {
    const catalog = caseCatalog(stock.slice(0, count), day);
    assert.ok(catalog.cases.every(box => !box.available && box.weights.every(weight => weight === 0)));
    assert.throws(() => drawItem(catalog, catalog.cases[0]), /empty_catalog/);
  }
  const duplicates = Array.from({ length: 12 }, (_, i) => ({ ...stock[0], id: i }));
  assert.ok(caseCatalog(duplicates, day).cases.every(box => !box.available));
  assert.ok(caseCatalog(stock.slice(0, 5), day).cases.find(box => box.id === 'cars').available);
});

test('daily editions survive archive updates and restarts; stale purchases fail and old pulls keep their values', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-case-editions-'));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  upsertAuctions(dir, stock);
  let now = day;
  const service = new Accounts(dir, { now: () => now });
  const password = 'case-edition-test-password';
  await service.bootstrap('admin', password);
  const user = service.user(await service.login({ username: 'admin', password }));
  const first = loadCaseCatalog(dir, now), cost = first.cases[0].cost;
  const item = service.openCase(user, first, 'fundkiste', 'edition-purchase-0001');
  assert.equal(item.caseCost, cost); assert.equal(item.edition, first.rotationDate);
  const balance = service.profile(user).tokens;
  upsertAuctions(dir, stock.map(auction => ({ ...auction, currentBid: auction.currentBid * 10 })));
  assert.deepEqual(loadCaseCatalog(dir, now), first);
  closeDataStore(dir);
  assert.deepEqual(loadCaseCatalog(dir, now), first);
  now = tomorrow;
  const next = loadCaseCatalog(dir, now);
  assert.notEqual(next.revision, first.revision);
  assert.throws(() => service.openCase(user, next, 'fundkiste', 'edition-purchase-0002', first.revision), /catalog_changed/);
  assert.equal(service.profile(user).tokens, balance);
  assert.deepEqual(service.openCase(user, next, 'fundkiste', 'edition-purchase-0001', first.revision), item);
  const stored = service.db(db => db.prepare('SELECT item FROM inventory WHERE id = ?').get(item.id));
  service.db(db => db.prepare('UPDATE inventory SET item = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(stored.item), sellValue: 999999 }), item.id));
  const kept = service.inventory(user)[0];
  assert.equal(kept.sellValue, Math.max(1, Math.round(item.price))); assert.equal(kept.price, item.price);
  service.sell(user, item.id); service.sell(user, item.id);
  assert.equal(service.profile(user).tokens, balance + item.sellValue);
  service.db(db => db.prepare('UPDATE users SET tokens = 0 WHERE id = ?').run(user.id));
  assert.throws(() => service.openCase(user, next, 'fundkiste', 'edition-purchase-0003'), /insufficient_tokens/);
  assert.equal(service.profile(user).tokens, 0); assert.equal(service.inventory(user).length, 0);
  assert.throws(() => service.openCase(user, caseCatalog([], now), 'cars', 'edition-purchase-0004'), /empty_catalog/);
});
