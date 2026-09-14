import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts, STARTING_TOKENS } from '../src/accounts.mjs';
import { caseRewards, loadCaseCatalog, RARITIES, tokenValue } from '../src/cases.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { saveNewsEvent, getNewsEvent } from '../src/news.mjs';
import { loadPaletteCatalog, ensurePaletteEditionSchema, bundleReferencePricing } from '../src/palette-definitions.mjs';
import { CASE_WEIGHTS } from '../src/cases.mjs';

const hour = 3600_000;
const day = Date.parse('2026-09-12T12:00:00Z');
const password = 'palette-editions-password';

// Themed fixture archive: enough per-category stock for usable editions plus
// deliberate trap lots (vehicle parts, spirits, model cars, cola) that the
// legacy semantic restrictions must keep out.
const themedStock = (id, title, category, price, count, offset = 0) =>
  Array.from({ length: count }, (_, n) => ({ id: id + n, title: `${title} ${id + n}`,
    category, currentBid: price * (n + 1) || price, image: `/assets/${category}.jpg` }));
const stock = [
  ...themedStock(1000, 'Laptop Lenovo', 'Elektronik', 40, 24),
  ...themedStock(2000, 'Bohrhammer Makita', 'Werkzeuge', 20, 24),
  ...themedStock(3000, 'Riesling Wein', 'Getränke', 8, 24),
  ...themedStock(4000, 'BMW PKW', 'Fahrzeuge', 500, 24),
  ...themedStock(5000, 'Gold Armbanduhr', 'Schmuck & Uhren', 90, 24),
  ...themedStock(6000, 'Lego Modell', 'Sammlerstücke', 15, 24)
];
const traps = [
  { id: 9001, title: 'BMW Reifen 9001', category: 'Fahrzeuge', currentBid: 100, image: '/assets/trap.jpg' },
  { id: 9002, title: 'BMW Motor 9002', category: 'Fahrzeuge', currentBid: 100, image: '/assets/trap.jpg' },
  { id: 9003, title: 'BMW Motorrad 9003', category: 'Fahrzeuge', currentBid: 100, image: '/assets/trap.jpg' },
  { id: 9004, title: 'Whisky 9004', category: 'Getränke', currentBid: 100, image: '/assets/trap.jpg' },
  { id: 9005, title: 'Cola 9005', category: 'Getränke', currentBid: 100, image: '/assets/trap.jpg' },
  { id: 9006, title: 'Modellauto BMW 9006', category: 'Sammlerstücke', currentBid: 100, image: '/assets/trap.jpg' }
];

async function fixture(t, lots = [...stock, ...traps]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-palette-'));
  upsertAuctions(dir, lots);
  // Ensure the edition schema up front so raw SQL inspections work even when
  // no publication has run yet (and transitively news_events for fixtures).
  withDatabase(dir, db => ensurePaletteEditionSchema(db, day));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

async function serviceFixture(t, dir, now = day) {
  const service = new Accounts(dir, { now: () => now });
  await service.bootstrap('admin', password);
  const admin = service.user(await service.login({ username: 'admin', password }));
  return { service, admin };
}

const publish = (dir, id, input, at) => saveNewsEvent(dir,
  { id, title: `Story ${id}`, body: 'Body text.', status: 'published', ...input }, { now: at });
const editionRows = (dir, where = '1=1', ...params) => withDatabase(dir, db =>
  db.prepare(`SELECT * FROM palette_editions WHERE ${where} ORDER BY id`).all(...params));
const catalogEntry = (dir, paletteId, now = day) =>
  loadPaletteCatalog(dir, { now }).palettes.filter(palette => palette.id === paletteId);

test('palette definitions cover the eight legacy cases plus three gated event palettes', async t => {
  const dir = await fixture(t);
  const catalog = loadPaletteCatalog(dir, { now: day });
  const baseIds = ['fundkiste', 'schatzkiste', 'cars', 'wine', 'electronics', 'tools', 'jewellery', 'collectibles'];
  assert.deepEqual(catalog.palettes.filter(palette => palette.kind === 'base').map(palette => palette.id).sort(),
    [...baseIds].sort());
  // Stories are fictional seized collections, never accusations of real owners.
  for (const palette of catalog.palettes) {
    assert.equal(palette.story.fictional, true);
    assert.ok(palette.story.title.length > 3 && palette.story.body.length > 20);
    assert.equal(palette.rewardCount, 3);
    assert.equal(palette.purchasable, false);
    assert.equal(palette.acquisitionMode, 'auction');
  }
  assert.deepEqual(catalog.palettes.filter(palette => palette.kind === 'base').map(palette => palette.requiredLevel),
    Array(8).fill(1));
  // Event editions only exist after publication; definitions are data, not rows.
  assert.deepEqual(catalog.palettes.filter(palette => palette.kind === 'event'), []);
  const event = await import('../src/palette-definitions.mjs');
  const levels = Object.fromEntries(event.PALETTE_DEFINITIONS.map(definition => [definition.id, definition.requiredLevel]));
  assert.deepEqual({ electronicsSmuggling: levels['electronics-smuggling'], dealer: levels['dealer-seizure'],
    wine: levels['wine-tax-seizure'] }, { electronicsSmuggling: 3, dealer: 5, wine: 8 });
  assert.deepEqual(event.paletteDefinition('dealer-seizure').allowedMarketCategories,
    ['vehicles', 'electronics', 'watches_jewelry', 'luxury_goods']);
  assert.equal(event.paletteDefinition('fundkiste').legacyTheme, 'mixed');
  assert.equal(event.paletteDefinition('fundkiste').allowedMarketCategories, null);
  assert.equal(event.paletteDefinition('nope'), null);
});

test('event pools use category membership with legacy car/wine semantics and family deduplication', async t => {
  const dir = await fixture(t);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['dealer-seizure'] }, day);
  const [dealer] = catalogEntry(dir, 'dealer-seizure');
  assert.equal(dealer.availability, 'available');
  const categories = new Set(dealer.items.map(item => item.marketCategory));
  assert.deepEqual([...categories].sort(), ['electronics', 'vehicles', 'watches_jewelry']);
  // Vehicle parts, motorcycles and spirits never leak in; only whole cars do.
  assert.ok(dealer.items.every(item => !/reifen|motor |motorrad|whisky|modellauto/i.test(item.title)));
  assert.ok(dealer.items.every(item => item.auctionId < 9000));
  // Deduplicated families appear once: distinct ids, no duplicate titles.
  assert.equal(new Set(dealer.items.map(item => item.auctionId)).size, dealer.items.length);
  // The wine-tax palette keeps spirits and cola out of its wine share.
  publish(dir, 'tax', { marketEffects: [{ category: 'wine', direction: 'down', magnitude: 2 }],
    paletteIds: ['wine-tax-seizure'] }, day + 1000);
  const [wine] = catalogEntry(dir, 'wine-tax-seizure', day + 1000);
  assert.equal(wine.availability, 'available');
  assert.ok(wine.items.every(item => !/whisky|cola/i.test(item.title)));
  assert.ok(wine.items.every(item => ['wine', 'collectibles'].includes(item.marketCategory)));
});

test('frozen editions carry three-reward metadata, all five tiers, weights and the reference formula', async t => {
  const dir = await fixture(t);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  const [entry] = catalogEntry(dir, 'electronics-smuggling');
  assert.equal(entry.rewardCount, 3);
  assert.equal(entry.requiredLevel, 3);
  assert.deepEqual(new Set(entry.items.map(item => item.rarity)), new Set(RARITIES.map(rarity => rarity.id)));
  assert.ok(entry.items.length >= 5 && entry.items.length <= 24);
  const [stored] = editionRows(dir, "id LIKE 'event:bust:%'");
  const payload = JSON.parse(stored.payload_json);
  assert.deepEqual(payload.weights, CASE_WEIGHTS);
  assert.equal(payload.valuationAt, day);
  assert.equal(payload.definitionVersion, 1);
  // Recompute the reference formula from the frozen pool (index was 100 + a
  // decaying +2 electronics effect at valuation time). Expectations are
  // BUNDLE expectations: rewardCount (3) times the single-draw sum, while
  // min/max stay per-item.
  const marketIndex = 102; // +2 effect, zero elapsed decay at valuation
  const rewardCount = payload.rewardCount;
  assert.equal(rewardCount, 3);
  const totalWeight = CASE_WEIGHTS.reduce((a, b) => a + b, 0);
  const tierCounts = new Map();
  for (const item of payload.items) tierCounts.set(item.rarity, (tierCounts.get(item.rarity) || 0) + 1);
  let singleE0 = 0, singleEt = 0, min = Infinity, max = -Infinity;
  for (const item of payload.items) {
    const p = CASE_WEIGHTS[RARITIES.findIndex(rarity => rarity.id === item.rarity)] / totalWeight / tierCounts.get(item.rarity);
    const base = tokenValue(item.price);
    singleE0 += p * base;
    singleEt += p * (base * marketIndex / 100);
    min = Math.min(min, base * marketIndex / 100);
    max = Math.max(max, base * marketIndex / 100);
  }
  const e0 = rewardCount * singleE0, et = rewardCount * singleEt;
  const reserve = Math.ceil(Math.max(.75 * e0 + .25 * et, et) / .85);
  assert.ok(Math.abs(payload.pricing.e0 - e0) < 1e-9);
  assert.ok(Math.abs(payload.pricing.et - et) < 1e-9);
  assert.ok(Math.abs(payload.pricing.minMarketValue - min) < 1e-9);
  assert.ok(Math.abs(payload.pricing.maxMarketValue - max) < 1e-9);
  assert.equal(payload.pricing.referenceReserve, reserve);
  assert.equal(payload.pricingVersion, 2);
  assert.equal(entry.referenceReserve, reserve);
  assert.equal(entry.cost, reserve);
  // Every tier is populated, so within-tier probability is uniform by construction.
  for (const rarity of RARITIES) {
    assert.ok(payload.items.some(item => item.rarity === rarity.id));
  }
});

test('usable editions guarantee both loss and upside at the reference reserve', async t => {
  const dir = await fixture(t);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  for (const stored of editionRows(dir, "id LIKE 'event:bust:%'")) {
    const payload = JSON.parse(stored.payload_json);
    assert.ok(payload.available);
    assert.equal(payload.availabilityReason, null);
    assert.ok(payload.rewardCount * payload.pricing.minMarketValue < payload.pricing.referenceReserve);
    assert.ok(payload.rewardCount * payload.pricing.maxMarketValue > payload.pricing.referenceReserve);
  }
});

test('insufficient stock and insufficient value spread persist unavailable editions without cancelling publication', async t => {
  const sparse = [...themedStock(1000, 'Laptop Lenovo', 'Elektronik', 40, 3)];
  const dir = await fixture(t, sparse);
  const published = publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  assert.equal(published.status, 'published');
  const [stored] = editionRows(dir, "id LIKE 'event:bust:%'");
  const payload = JSON.parse(stored.payload_json);
  assert.equal(payload.available, false);
  assert.equal(payload.availabilityReason, 'insufficient_stock');
  assert.deepEqual(payload.weights, [0, 0, 0, 0, 0]);
  assert.equal(getNewsEvent(dir, 'bust').status, 'published');
  // The market effects of the publication still landed.
  assert.equal(withDatabase(dir, db => db.prepare('SELECT COUNT(*) AS count FROM market_effects').get().count), 1);

  // Identical item values give no upside: the bundle reserve exceeds even a
  // bundle of maximum-value items, so the edition freezes as unusable.
  const uniform = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']
    .map((name, index) => ({ id: 1000 + index, title: `Laptop ${name}`, category: 'Elektronik',
      currentBid: 50, image: '/assets/electronics.jpg' }));
  const dir2 = await fixture(t, uniform);
  publish(dir2, 'flat', { marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 1 }],
    paletteIds: ['electronics-smuggling'] }, day);
  const [flat] = editionRows(dir2, "id LIKE 'event:flat:%'");
  const flatPayload = JSON.parse(flat.payload_json);
  assert.ok(flatPayload.items.length >= 5);
  assert.ok(flatPayload.items.every(item => item.price === 50));
  assert.equal(flatPayload.available, false);
  assert.equal(flatPayload.availabilityReason, 'insufficient_value_spread');
  assert.equal(flatPayload.pricing.spreadOk, false);
  assert.deepEqual(flatPayload.weights, [0, 0, 0, 0, 0]);
  // The math that makes it unusable: E0 = Et = 3·50 = 150, reserve 177, and
  // 3·max = 150 is NOT above 177.
  assert.ok(Math.abs(flatPayload.pricing.e0 - 150) < 1e-9);
  assert.equal(flatPayload.pricing.referenceReserve, 177);
});

test('editions are archive-order independent and immune to collector updates and restarts', async t => {
  const dir = await fixture(t);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  const before = editionRows(dir, "id LIKE 'event:bust:%'");
  const reversedCatalog = loadPaletteCatalog(dir, { now: day });
  assert.equal(reversedCatalog.palettes.length, 9);
  // Collector updates reroll nothing: stored payloads stay byte-identical.
  upsertAuctions(dir, [...stock, ...traps].map(lot => ({ ...lot, currentBid: lot.currentBid * 3 })));
  assert.deepEqual(editionRows(dir, "id LIKE 'event:bust:%'"), before);
  // Restart changes nothing either.
  closeDataStore(dir);
  assert.deepEqual(editionRows(dir, "id LIKE 'event:bust:%'"), before);
  // The base catalog of the *same* day is also frozen at its original values.
  const baseBefore = editionRows(dir, "id LIKE 'base:%'");
  upsertAuctions(dir, [...stock, ...traps].map(lot => ({ ...lot, currentBid: 1 })));
  assert.deepEqual(editionRows(dir, "id LIKE 'base:%'"), baseBefore);
});

test('definition edits would not reroll an already stored edition', async t => {
  const dir = await fixture(t);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  const before = editionRows(dir, "id LIKE 'event:bust:%'");
  // Simulate an old definition's edition: mutate the stored payload, then
  // reload — the loader regenerates only missing editions, never this one.
  withDatabase(dir, db => db.prepare(`UPDATE palette_editions SET payload_json = json_set(payload_json, '$.name', 'Ancient Name')
    WHERE id LIKE 'event:bust:%'`).run());
  const catalog = loadPaletteCatalog(dir, { now: day });
  assert.equal(catalog.palettes.find(palette => palette.editionId.startsWith('event:')).name, 'Ancient Name');
  assert.deepEqual(editionRows(dir, "id LIKE 'event:bust:%'").map(row => row.payload_json),
    withDatabase(dir, db => db.prepare(`SELECT payload_json FROM palette_editions WHERE id LIKE 'event:bust:%'`).all()
      .map(row => row.payload_json)));
  assert.notDeepEqual(editionRows(dir, "id LIKE 'event:bust:%'"), before);
});

// Row count that tolerates a rolled-back transaction: a publication failure
// undoes its own schema creation, so a missing table counts as zero records.
const recordCount = (dir, table) => withDatabase(dir, db =>
  db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
    ? db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count : 0);

test('publication atomically creates news, receipt, effects and editions; failure rolls all back', async t => {
  const dir = await fixture(t);
  withDatabase(dir, db => db.exec(`CREATE TRIGGER sabotage_editions BEFORE INSERT ON palette_editions
    BEGIN SELECT RAISE(ABORT, 'sabotaged'); END`));
  assert.throws(() => publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 3 }],
    paletteIds: ['electronics-smuggling'] }, day), /sabotaged/);
  assert.equal(getNewsEvent(dir, 'bust'), null);
  assert.equal(recordCount(dir, 'news_publications'), 0);
  assert.equal(recordCount(dir, 'market_effects'), 0);
  assert.equal(recordCount(dir, 'palette_editions'), 0);
  withDatabase(dir, db => db.exec('DROP TRIGGER sabotage_editions'));
  const published = publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 3 }],
    paletteIds: ['electronics-smuggling'] }, day);
  assert.equal(published.status, 'published');
  assert.equal(editionRows(dir, "id LIKE 'event:bust:%'").length, 1);
  assert.deepEqual(withDatabase(dir, db => db.prepare('SELECT kind FROM news_publications').all()).map(r => r.kind), ['applied']);
});

test('publication retries never reroll, reprice or extend editions; conflicting windows are rejected', async t => {
  const dir = await fixture(t);
  const published = publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 1, durationHours: 5 }] }, day);
  const before = editionRows(dir, "id LIKE 'event:bust:%'");
  assert.equal(JSON.parse(before[0].payload_json).pricing.referenceReserve, published.paletteWindows[0].durationHours > 0 ? JSON.parse(before[0].payload_json).pricing.referenceReserve : 0);
  // Identical retry: nothing changes.
  const retry = publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 1, durationHours: 5 }] }, day + 10 * hour);
  assert.equal(retry.publishedAt, published.publishedAt);
  assert.deepEqual(editionRows(dir, "id LIKE 'event:bust:%'"), before);
  // A retry without the explicit window would default to 0..72h — a different
  // economic payload, i.e. an attempted extension. Rejected, no reroll.
  assert.throws(() => publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day + 11 * hour), /news_already_published/);
  assert.deepEqual(editionRows(dir, "id LIKE 'event:bust:%'"), before);
  // A conflicting duration is rejected as well.
  assert.throws(() => publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 1, durationHours: 6 }] }, day + 12 * hour),
    /news_already_published/);
  assert.deepEqual(editionRows(dir, "id LIKE 'event:bust:%'"), before);
});

test('window validation: duplicates, unknown ids, base windows and range violations are rejected', async t => {
  const dir = await fixture(t);
  const busted = { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }] };
  assert.throws(() => publish(dir, 'dup', { ...busted, paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling' }, { paletteId: 'electronics-smuggling', durationHours: 5 }] }, day), /invalid_palette_windows/);
  assert.throws(() => publish(dir, 'unknown', { ...busted, paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'nope' }] }, day), /invalid_palette_windows/);
  assert.throws(() => publish(dir, 'base-window', { ...busted, paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'wine' }] }, day), /invalid_palette_windows/);
  assert.throws(() => publish(dir, 'unreferenced', { ...busted, paletteIds: [],
    paletteWindows: [{ paletteId: 'electronics-smuggling' }] }, day), /invalid_palette_windows/);
  for (const window of [{ startOffsetHours: -1 }, { startOffsetHours: 169 }, { durationHours: 0 }, { durationHours: 169 }]) {
    assert.throws(() => publish(dir, 'range', { ...busted, paletteIds: ['electronics-smuggling'],
      paletteWindows: [{ paletteId: 'electronics-smuggling', ...window }] }, day), /invalid_palette_windows/);
  }
  assert.equal(editionRows(dir).length, 0);
  // Boundary values are valid: 168h offset, 1h duration.
  publish(dir, 'edges', { ...busted, paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 168, durationHours: 1 }] }, day);
  const [row] = editionRows(dir, "id LIKE 'event:edges:%'");
  assert.equal(row.starts_at, day + 168 * hour);
  assert.equal(row.ends_at, day + 169 * hour);
});

test('multiple events referencing one definition coexist as separate editions', async t => {
  const dir = await fixture(t);
  publish(dir, 'first', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  publish(dir, 'second', { marketEffects: [{ category: 'wine', direction: 'down', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 4, durationHours: 10 }] }, day + hour);
  const entries = catalogEntry(dir, 'electronics-smuggling', day + 2 * hour);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => entry.editionId),
    ['event:first:electronics-smuggling', 'event:second:electronics-smuggling']);
  assert.deepEqual(new Set(entries.map(entry => entry.startsAt)), new Set([day, day + 5 * hour]));
  // Both stay in the catalog until their own window ends; the second expires first.
  assert.deepEqual(catalogEntry(dir, 'electronics-smuggling', day + 15 * hour).map(entry => entry.editionId),
    ['event:first:electronics-smuggling']);
  // Base editions were never overwritten by the event editions.
  assert.ok(loadPaletteCatalog(dir, { now: day + 2 * hour }).palettes.filter(palette => palette.kind === 'base').length === 8);
});

test('availability boundaries: scheduled, exact start, inside, exact end, expired', async t => {
  const dir = await fixture(t);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 2, durationHours: 5 }] }, day);
  const state = now => loadPaletteCatalog(dir, { now }).palettes.find(palette => palette.kind === 'event');
  const startsAt = day + 2 * hour, endsAt = day + 7 * hour;
  assert.equal(state(day + 2 * hour - 1).availability, 'scheduled');
  assert.equal(state(day + 2 * hour).availability, 'available');
  assert.equal(state(endsAt - 1).availability, 'available');
  // At the exact end instant the edition leaves the catalog (endsAt > now is
  // the inclusion rule), so 'expired' only exists for out-of-band evaluation.
  assert.equal(state(endsAt), undefined);
  assert.equal(state(endsAt + hour), undefined);
  // Scheduled editions are already listed, but not yet usable.
  const scheduled = state(day + hour);
  assert.equal(scheduled.availability, 'scheduled');
  assert.equal(scheduled.available, false);
  assert.equal(scheduled.cost, 0);
  assert.ok(scheduled.referenceReserve > 0);
});

test('archiving news revokes nothing: editions stay available until their window ends', async t => {
  const dir = await fixture(t);
  const published = publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'] }, day);
  saveNewsEvent(dir, { ...published, status: 'archived', publishedAt: published.publishedAt }, { now: day + 1000 });
  const [entry] = catalogEntry(dir, 'electronics-smuggling', day + 2000);
  assert.equal(entry.availability, 'available');
  assert.equal(getNewsEvent(dir, 'bust').status, 'archived');
  assert.equal(catalogEntry(dir, 'electronics-smuggling', day + 73 * hour).length, 0); // window over
});

test('legacy package-1 receipts stay inert: no retroactive activation, no edition rerolls', async t => {
  const dir = await fixture(t);
  // A foundation-era published event that already received its 'legacy'
  // receipt (fractional placeholder payload, palette reference included).
  withDatabase(dir, db => {
    const iso = new Date(day).toISOString();
    db.prepare(`INSERT INTO news_events (id, title, body, status, published_at, palette_ids,
      palette_windows, market_effects, metadata_json, created_at, updated_at)
      VALUES ('old-pub', 'Old', 'B', 'published', ?, '["electronics-smuggling"]', '[]',
      '[{"category":"electronics","direction":"up","magnitude":0.85}]', '{}', ?, ?)`).run(iso, iso, iso);
  });
  // Activation happens with the first new publication.
  publish(dir, 'fresh', { marketEffects: [{ category: 'tools', direction: 'up', magnitude: 3 }] }, day + 1000);
  const kinds = withDatabase(dir, db => db.prepare('SELECT event_id, kind FROM news_publications ORDER BY event_id').all());
  assert.deepEqual(kinds.map(row => [row.event_id, row.kind]), [['fresh', 'applied'], ['old-pub', 'legacy']]);
  assert.equal(editionRows(dir, "event_id = 'old-pub'").length, 0); // never activated retroactively
  // The old economics cannot be edited into new ones.
  assert.throws(() => saveNewsEvent(dir, { id: 'old-pub', title: 'Old', body: 'B', status: 'published', publishedAt: null,
    paletteIds: ['electronics-smuggling'],
    marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 0.85 }] }, { now: day + 2000 }), /news_already_published/);
  assert.equal(editionRows(dir, "event_id = 'old-pub'").length, 0);
});

test('the palette catalog cannot open cases or mint inventory; legacy rewards stay unchanged', async t => {
  const dir = await fixture(t);
  const { service, admin } = await serviceFixture(t, dir);
  const legacy = loadCaseCatalog(dir, day);
  const catalog = loadPaletteCatalog(dir, { now: day });
  // Rewards derive from the unchanged legacy case schedule, not the reserves.
  assert.deepEqual(catalog.rewards, caseRewards(legacy));
  assert.ok(catalog.rewards.daily > 0);
  // No palette entry is wired into the case-opening flow.
  assert.throws(() => service.openCase(admin, catalog, 'fundkiste', 'palette-open-0001'));
  assert.throws(() => service.openCase(admin, catalog, 'electronics-smuggling', 'palette-open-0002'));
  assert.throws(() => service.openCase(admin, { ...legacy, cases: catalog.palettes }, 'electronics-smuggling', 'palette-open-0003'));
  assert.equal(service.inventory(admin).length, 0);
  assert.equal(service.profile(admin).tokens, STARTING_TOKENS);
  // The legacy flow keeps working exactly as before.
  const item = service.openCase(admin, legacy, 'fundkiste', 'palette-open-0004');
  assert.deepEqual(service.inventory(admin).map(row => row.id), [item.id]);
  // Public serialization never leaks weights or selection seeds.
  assert.doesNotMatch(JSON.stringify(catalog), /"(?:weights|odds|chance|selectionIndex|dayIndex|seed)":/);
});

test('market movement is captured once at generation and flag-off valuation still uses market state', async t => {
  const dir = await fixture(t);
  // No feature flags anywhere: domain valuation reads persisted market state.
  publish(dir, 'boom', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 20 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 1, durationHours: 48 }] }, day);
  const [row] = editionRows(dir, "id LIKE 'event:boom:%'");
  const payload = JSON.parse(row.payload_json);
  const expected = Math.ceil(payload.pricing.e0 * 1.2 / .85); // full +20 at valuation time
  assert.equal(payload.pricing.referenceReserve, expected);
  assert.equal(payload.valuationAt, day);
  // The same edition later, with the effect decayed, keeps its frozen pricing.
  const catalog = loadPaletteCatalog(dir, { now: day + 36 * hour });
  const entry = catalog.palettes.find(palette => palette.kind === 'event');
  assert.equal(entry.referenceReserve, expected);
  // Base editions of that first-loaded day captured their valuation then.
  const baseEntry = catalog.palettes.find(palette => palette.kind === 'base' && palette.id === 'electronics');
  const [base] = editionRows(dir, 'id = ?', baseEntry.editionId);
  const basePayload = JSON.parse(base.payload_json);
  assert.equal(basePayload.valuationAt, day + 36 * hour);
  assert.ok(basePayload.pricing.referenceReserve > 0);
});

test('catalog revision follows included editions and their evaluated states', async t => {
  const dir = await fixture(t);
  const base = loadPaletteCatalog(dir, { now: day });
  assert.equal(loadPaletteCatalog(dir, { now: day }).revision, base.revision);
  publish(dir, 'bust', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 2 }],
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 1, durationHours: 3 }] }, day);
  // The scheduled event joins the catalog and changes the revision.
  const withEvent = loadPaletteCatalog(dir, { now: day });
  assert.notEqual(withEvent.revision, base.revision);
  assert.equal(loadPaletteCatalog(dir, { now: day }).revision, withEvent.revision);
  // scheduled -> available changes the evaluated state, hence the revision.
  assert.notEqual(loadPaletteCatalog(dir, { now: day + 2 * hour }).revision, withEvent.revision);
  assert.equal(loadPaletteCatalog(dir, { now: day + 2 * hour }).revision,
    loadPaletteCatalog(dir, { now: day + 3 * hour }).revision);
  // Expiry removes the edition: the revision returns to the base world's.
  assert.equal(loadPaletteCatalog(dir, { now: day + 5 * hour }).revision, base.revision);
});

// ---------------------------------------------------------------------------
// Bundle reference pricing: independent, hand-calculated regression tests.
// ---------------------------------------------------------------------------
test('bundle reference pricing matches hand-calculated expectations and reserves', () => {
  // One item per rarity; token values 10, 20, 50, 100, 1000; weights
  // 5000/3500/1200/290/10 over a total of 10000.
  const items = [
    { rarity: 'common', price: 10 }, { rarity: 'uncommon', price: 20 },
    { rarity: 'rare', price: 50 }, { rarity: 'epic', price: 100 },
    { rarity: 'legendary', price: 1000 }
  ];
  // Single-draw neutral expectation: .5*10 + .35*20 + .12*50 + .029*100 + .001*1000 = 21.9.
  const neutral = bundleReferencePricing(items, () => 100);
  assert.ok(Math.abs(neutral.e0 - 65.7) < 1e-9);   // 3 * 21.9
  assert.ok(Math.abs(neutral.et - 65.7) < 1e-9);
  assert.equal(neutral.referenceReserve, 78);       // ceil(65.7 / .85)
  assert.equal(neutral.spreadOk, true);             // 3*10 < 78 < 3*1000
  const down = bundleReferencePricing(items, () => 80);
  assert.ok(Math.abs(down.e0 - 65.7) < 1e-9);
  assert.ok(Math.abs(down.et - 52.56) < 1e-9);      // 65.7 * .8
  assert.equal(down.referenceReserve, 74);          // ceil((.75*65.7 + .25*52.56) / .85) = ceil(73.43)
  const up = bundleReferencePricing(items, () => 120);
  assert.ok(Math.abs(up.et - 78.84) < 1e-9);        // 65.7 * 1.2
  assert.equal(up.referenceReserve, 93);            // ceil(78.84 / .85) = ceil(92.75)
  // min/max stay PER-ITEM; the spread compares against the bundle multiple.
  assert.ok(Math.abs(up.minMarketValue - 12) < 1e-9);
  assert.ok(Math.abs(up.maxMarketValue - 1200) < 1e-9);
  assert.equal(up.spreadOk, true);
  // rewardCount is honored as a parameter, not a hardcoded literal.
  const six = bundleReferencePricing(items, () => 100, 6);
  assert.ok(Math.abs(six.e0 - 131.4) < 1e-9);
  assert.equal(six.referenceReserve, 155);          // ceil(131.4 / .85)
});

// ---------------------------------------------------------------------------
// Bundle-pricing migration for pre-correction (v1) stored editions.
// ---------------------------------------------------------------------------
const PRICING_MARKER = 'palette_bundle_pricing_v2';
const DAY_MS = 86_400_000;
// Five single-lot families, one per rarity, neutral token values 10..1000.
const tieredItems = [
  ['common', 10], ['uncommon', 20], ['rare', 50], ['epic', 100], ['legendary', 1000]
].map(([rarity, price], index) => ({ auctionId: 100 + index, title: `Item ${rarity}`,
  image: '/assets/electronics.jpg', price, familySize: 1, category: 'Elektronik',
  rarity, sellValue: price, marketCategory: 'electronics' }));
// What the buggy v1 writer stored: single-draw expectations (21.9/21.9), a
// single-draw reserve (26), and spread evaluated with mixed 3*min/max bounds
// against it — 3*10 = 30 < 26 is false, so the row froze unusable.
const v1Pricing = { e0: 21.9, et: 21.9, referenceReserve: 26, minMarketValue: 10, maxMarketValue: 1000, spreadOk: false };

function v1Edition({ id, paletteId, items, pricing, available, availabilityReason, weights }) {
  const date = '2026-09-12';
  return {
    id, palette_id: paletteId, event_id: null, rotation_date: date,
    starts_at: Date.parse(`${date}T00:00:00Z`), ends_at: Date.parse(`${date}T00:00:00Z`) + DAY_MS,
    payload: {
      paletteId, definitionVersion: 1, kind: 'base', name: 'Palette', nameDe: 'Palette', badge: 'X',
      story: { title: 'Frozen story', body: 'Frozen body.', fictional: true },
      allowedMarketCategories: ['electronics'], legacyTheme: 'electronics',
      rewardCount: 3, requiredLevel: 1, items, weights, available, availabilityReason,
      valuationAt: day, pricing
    }
  };
}

// Seed a pre-migration database: tables exist, the marker is absent, and the
// given edition rows carry v1 (unversioned) payloads.
function seedLegacyEditions(dir, editions) {
  withDatabase(dir, db => {
    db.prepare('DELETE FROM app_state WHERE key = ?').run(PRICING_MARKER);
    const insert = db.prepare(`INSERT OR REPLACE INTO palette_editions
      (id, palette_id, event_id, rotation_date, starts_at, ends_at, payload_json)
      VALUES (?, ?, NULL, ?, ?, ?, ?)`);
    for (const edition of editions) {
      insert.run(edition.id, edition.palette_id, edition.rotation_date,
        edition.starts_at, edition.ends_at, JSON.stringify(edition.payload));
    }
  });
}
const markerOf = dir => withDatabase(dir, db => {
  const row = db.prepare('SELECT value_json FROM app_state WHERE key = ?').get(PRICING_MARKER);
  return row ? JSON.parse(row.value_json) : null;
});
const payloadOf = (dir, id) => JSON.parse(editionRows(dir, 'id = ?', id)[0].payload_json);

test('migration corrects v1 expectations exactly once and can re-enable a failed spread', async t => {
  const dir = await fixture(t);
  seedLegacyEditions(dir, [v1Edition({ id: 'base:electronics:2026-09-12', paletteId: 'electronics',
    items: tieredItems, pricing: { ...v1Pricing }, available: false,
    availabilityReason: 'insufficient_value_spread', weights: [0, 0, 0, 0, 0] })]);
  const at = day + 6 * hour; // stays inside the seeded edition's UTC day
  const catalog = loadPaletteCatalog(dir, { now: at });
  const entry = catalog.palettes.find(palette => palette.editionId === 'base:electronics:2026-09-12');
  // Corrected bundle math: 3*min = 30 < 78 < 3*max = 3000 — the frozen row
  // that v1 underpriced into unavailability becomes usable.
  assert.equal(entry.availability, 'available');
  assert.equal(entry.available, true);
  assert.equal(entry.cost, 78);
  assert.equal(entry.referenceReserve, 78);
  const payload = payloadOf(dir, 'base:electronics:2026-09-12');
  assert.equal(payload.pricingVersion, 2);
  assert.ok(Math.abs(payload.pricing.e0 - 65.7) < 1e-9);
  assert.ok(Math.abs(payload.pricing.et - 65.7) < 1e-9);
  assert.equal(payload.pricing.referenceReserve, 78);
  assert.equal(payload.pricing.spreadOk, true);
  assert.deepEqual(payload.weights, CASE_WEIGHTS);
  assert.equal(payload.available, true);
  assert.equal(payload.availabilityReason, null);
  // Everything else is identical: pool, timestamps, story, identity.
  assert.deepEqual(payload.items, tieredItems);
  assert.equal(payload.valuationAt, day);
  assert.equal(payload.definitionVersion, 1);
  assert.equal(payload.rewardCount, 3);
  assert.deepEqual(payload.story, { title: 'Frozen story', body: 'Frozen body.', fictional: true });
  const [row] = editionRows(dir, 'id = ?', 'base:electronics:2026-09-12');
  assert.equal(row.starts_at, Date.parse('2026-09-12T00:00:00Z'));
  assert.equal(row.ends_at, Date.parse('2026-09-12T00:00:00Z') + DAY_MS);
  // The marker was written last, with the corrected/retained counts.
  assert.deepEqual(markerOf(dir), { corrected: 1, retained: 0, migratedAt: new Date(at).toISOString() });
  // Reopening and rereading cannot multiply the expectations again.
  closeDataStore(dir);
  loadPaletteCatalog(dir, { now: day + 7 * hour });
  const again = payloadOf(dir, 'base:electronics:2026-09-12');
  assert.ok(Math.abs(again.pricing.e0 - 65.7) < 1e-9);
  assert.ok(Math.abs(again.pricing.et - 65.7) < 1e-9);
  assert.equal(again.pricing.referenceReserve, 78);
  assert.equal(again.pricingVersion, 2);
  assert.deepEqual(markerOf(dir), { corrected: 1, retained: 0, migratedAt: new Date(at).toISOString() });
});

test('migration retains null-pricing insufficient-stock rows as unavailable', async t => {
  const dir = await fixture(t);
  seedLegacyEditions(dir, [v1Edition({ id: 'base:wine:2026-09-12', paletteId: 'wine',
    items: tieredItems.slice(0, 3), pricing: null, available: false,
    availabilityReason: 'insufficient_stock', weights: [0, 0, 0, 0, 0] })]);
  const catalog = loadPaletteCatalog(dir, { now: day + 6 * hour });
  const entry = catalog.palettes.find(palette => palette.editionId === 'base:wine:2026-09-12');
  assert.equal(entry.availability, 'restocking');
  assert.equal(entry.available, false);
  assert.equal(entry.cost, 0);
  assert.equal(entry.referenceReserve, null);
  const payload = payloadOf(dir, 'base:wine:2026-09-12');
  assert.equal(payload.pricing, null);
  assert.equal(payload.available, false);
  assert.equal(payload.availabilityReason, 'insufficient_stock');
  assert.deepEqual(payload.weights, [0, 0, 0, 0, 0]);
  assert.equal(payload.pricingVersion, 2);
  assert.deepEqual(payload.items, tieredItems.slice(0, 3));
  assert.deepEqual(markerOf(dir), { corrected: 0, retained: 1, migratedAt: new Date(day + 6 * hour).toISOString() });
});

test('corrected historical pricing ignores later market and archive changes', async t => {
  const dir = await fixture(t);
  seedLegacyEditions(dir, [v1Edition({ id: 'base:electronics:2026-09-12', paletteId: 'electronics',
    items: tieredItems, pricing: { ...v1Pricing }, available: false,
    availabilityReason: 'insufficient_value_spread', weights: [0, 0, 0, 0, 0] })]);
  loadPaletteCatalog(dir, { now: day }); // migration runs here
  // After the correction, both the market and the archive change hard.
  publish(dir, 'boom', { marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 20 }] }, day + 2 * hour);
  upsertAuctions(dir, [...stock, ...traps].map(lot => ({ ...lot, currentBid: lot.currentBid * 25 })));
  const entry = loadPaletteCatalog(dir, { now: day + 3 * hour })
    .palettes.find(palette => palette.editionId === 'base:electronics:2026-09-12');
  assert.equal(entry.referenceReserve, 78);
  assert.equal(entry.cost, 78);
  const payload = payloadOf(dir, 'base:electronics:2026-09-12');
  assert.ok(Math.abs(payload.pricing.e0 - 65.7) < 1e-9);
  assert.ok(Math.abs(payload.pricing.et - 65.7) < 1e-9);
  assert.equal(payload.valuationAt, day);
  assert.deepEqual(payload.items, tieredItems);
});

test('a mid-migration failure rolls back every row and the marker', async t => {
  const dir = await fixture(t);
  seedLegacyEditions(dir, [
    v1Edition({ id: 'base:electronics:2026-09-12', paletteId: 'electronics', items: tieredItems,
      pricing: { ...v1Pricing }, available: false, availabilityReason: 'insufficient_value_spread', weights: [0, 0, 0, 0, 0] }),
    v1Edition({ id: 'base:wine:2026-09-12', paletteId: 'wine', items: tieredItems.slice(0, 3),
      pricing: null, available: false, availabilityReason: 'insufficient_stock', weights: [0, 0, 0, 0, 0] })
  ]);
  // Abort on the second corrected row (rows are processed in id order).
  withDatabase(dir, db => db.exec(`CREATE TRIGGER sabotage_pricing BEFORE UPDATE ON palette_editions
    WHEN NEW.id = 'base:wine:2026-09-12' BEGIN SELECT RAISE(ABORT, 'sabotaged'); END`));
  assert.throws(() => loadPaletteCatalog(dir, { now: day }), /sabotaged/);
  // Both rows are still untouched v1 state and the marker was not written.
  const electronics = payloadOf(dir, 'base:electronics:2026-09-12');
  assert.equal(electronics.pricingVersion, undefined);
  assert.ok(Math.abs(electronics.pricing.e0 - 21.9) < 1e-9);
  assert.equal(electronics.available, false);
  assert.equal(markerOf(dir), null);
  // Without the sabotage the same migration completes for both rows.
  withDatabase(dir, db => db.exec('DROP TRIGGER sabotage_pricing'));
  loadPaletteCatalog(dir, { now: day + hour });
  assert.ok(Math.abs(payloadOf(dir, 'base:electronics:2026-09-12').pricing.e0 - 65.7) < 1e-9);
  assert.equal(payloadOf(dir, 'base:wine:2026-09-12').pricingVersion, 2);
  assert.deepEqual(markerOf(dir), { corrected: 1, retained: 1, migratedAt: new Date(day + hour).toISOString() });
});

test('repeated catalog reads reuse stored base editions without touching the archive', async t => {
  const dir = await fixture(t);
  const first = loadPaletteCatalog(dir, { now: day });
  assert.equal(first.palettes.filter(palette => palette.kind === 'base').length, 8);
  // With the archive gone entirely, a regenerating loader would fail; a
  // reusing loader returns the frozen editions byte-for-byte.
  withDatabase(dir, db => db.exec('DROP TABLE auctions'));
  const second = loadPaletteCatalog(dir, { now: day });
  assert.deepEqual(second, first);
});
