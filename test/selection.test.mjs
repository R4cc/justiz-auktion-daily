import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auctionSelectionCategory, buildAuctionFamilies } from '../src/auction-selection.mjs';
import { selectDailySet, selectRandomSet } from '../src/core.mjs';
import { ensureDailyGame } from '../src/collector.mjs';
import { closeDataStore, saveDailyGame } from '../src/database.mjs';
import { formatPublicStats } from '../src/public-stats.mjs';

function auction(id, title, category = 'Sonstiges', extra = {}) {
  return { id, title, category, image: `/auction-images/${id}.jpg`, sourceImages: [`https://www.justiz-auktion.de/uplimg/${id}.jpg`],
    description: 'Gebrauchter Artikel mit Gebrauchsspuren. Versand oder Abholung möglich.',
    currentBid: 100, startBid: 10, endAt: '2026-12-31T12:00:00Z', ...extra };
}
const books = [
  auction(1, 'StGB 70. Auflage 2023 (Fischer)'),
  auction(2, '1 Buch: Fischer Strafgesetzbuch, 2023, 70. Aufl. – Los 12', 'Sonstiges', { description: 'Ein gebrauchtes Buch. Leichte Markierungen.' }),
  auction(3, 'Fischer StGB (70. Auflage), Ausgabe 2023', 'Bücher', { sourceImages: ['https://www.justiz-auktion.de/uplimg/different-angle.jpg'] })
];
const varied = [auction(10, 'Hilti Akku B22'), auction(11, 'Giant Mountainbike 26 Zoll'), auction(12, 'Philips Fernseher 60 Zoll'), auction(13, 'Boss Eau de Parfum'), auction(14, 'Eichenholz Esstisch', 'Furniture'), auction(15, 'Winterjacke')];
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function assertVaried(game) {
  const categories = game.auctions.map(auctionSelectionCategory);
  assert.equal(game.auctions.length, 5);
  assert.ok(new Set(categories).size >= 4);
  assert.ok(categories.filter(category => category === 'Getränke').length <= 1);
  for (const category of new Set(categories)) assert.ok(categories.filter(value => value === category).length <= 2);
  assert.equal(buildAuctionFamilies(game.auctions).length, 5);
}

test('near duplicates group despite reordered names, different descriptions and different image URLs', () => {
  assert.equal(buildAuctionFamilies(books).length, 1);
  const tools = [auction(4, '1 Bohrhammer Makita HR2470'), auction(5, 'Makita HR 2470 Bohrhammer mit Koffer')];
  assert.equal(buildAuctionFamilies(tools).length, 1);
  const typo = [auction(6, 'Makita Akku Bohrhammer HR2470'), auction(7, 'Makita Akku Bohrhamer HR2470')];
  assert.equal(buildAuctionFamilies(typo).length, 1);
});

test('different model numbers and generic shared descriptions do not collapse unrelated lots', () => {
  const models = [auction(1, 'Apple iPhone 13 128 GB'), auction(2, 'Apple iPhone 14 128 GB'), auction(3, 'Makita HR2470 Bohrhammer'), auction(4, 'Makita HR2630 Bohrhammer')];
  assert.equal(buildAuctionFamilies(models).length, 4);
  assert.equal(buildAuctionFamilies(varied).length, varied.length);
});

test('shared original cover still identifies duplicates even when titles differ completely', () => {
  assert.equal(buildAuctionFamilies([auction(1, 'Kamera'), auction(2, 'Fotoausrüstung', 'Sonstiges', { sourceImages: ['https://www.justiz-auktion.de/uplimg/1.jpg'] })]).length, 1);
});

test('classifies older misc wine and book records, without mistaking colors or service hours for products', () => {
  for (const title of ['Avignonesi Desiderio Merlot', 'Château Margaux Bordeaux 2018', '6 Flaschen Riesling', 'Champagner Moët', 'Single Malt Whisky']) {
    assert.equal(auctionSelectionCategory(auction(1, title)), 'Getränke');
  }
  assert.equal(auctionSelectionCategory(books[0]), 'Bücher & Medien');
  assert.equal(auctionSelectionCategory(auction(1, 'Weinrote Winterjacke')), 'Mode');
  assert.equal(auctionSelectionCategory(auction(1, 'Fujitsu Notebook', 'Sonstiges', { description: 'Öffnungszeiten bis 16:00 Uhr.' })), 'Elektronik');
});

test('wine-heavy archive cannot dominate daily or free play, even after other categories have been used', () => {
  const wine = Array.from({ length: 180 }, (_, i) => auction(1000 + i, `Chateau Merlot Jahrgang ${1800 + i}`));
  const pool = [...wine, ...books, ...varied];
  const usage = new Map(varied.map(item => [item.id, { useCount: 99 }]));
  for (let seed = 1; seed <= 20; seed++) {
    assertVaried(selectRandomSet(pool, 5, rng(seed), usage));
    const game = selectDailySet(pool, `2026-10-${String(seed).padStart(2, '0')}`);
    assertVaried(game);
    assert.ok(game.auctions.filter(item => item.category === 'Bücher & Medien').length <= 1);
  }
});

test('daily selection is order independent and blocks new IDs belonging to already played families', () => {
  const pool = [...books, ...varied, auction(20, 'Riesling 2020')];
  const history = { '2026-09-10': { auctions: [books[0]] } };
  const first = selectDailySet(pool, '2026-09-12', history);
  const reversed = selectDailySet([...pool].reverse(), '2026-09-12', history);
  assert.deepEqual(first.auctions.map(item => item.id), reversed.auctions.map(item => item.id));
  assert.ok(first.auctions.every(item => !books.some(book => book.id === item.id)));
  const ledgerOnly = selectDailySet(pool, '2026-09-12', {}, 5, new Set([books[0].id]));
  assert.ok(ledgerOnly.auctions.every(item => !books.some(book => book.id === item.id)));
});

test('archived lots fill missing categories instead of relaxing variety for active wine auctions', () => {
  const pool = [auction(100, 'Riesling 2021'), auction(101, 'Merlot 2020'), ...varied.map(item => ({ ...item, endAt: '2025-01-01T00:00:00Z', finalPrice: 40 }))];
  const game = selectDailySet(pool, '2026-09-12');
  assertVaried(game);
  assert.ok(game.auctions.filter(item => item.correctPrice === 40).length >= 4);
});

test('both modes reject insufficient category diversity and duplicate-only pools', () => {
  const wine = Array.from({ length: 20 }, (_, i) => auction(100 + i, `Riesling Jahrgang ${2000 + i}`));
  for (const pool of [wine, [...books, ...books], [...books, varied[0], varied[1]]]) {
    assert.throws(() => selectDailySet(pool, '2026-09-12'), /Not enough varied auctions/);
    assert.throws(() => selectRandomSet(pool), /Not enough varied auctions/);
  }
});

test('free-play family usage cannot be reset by a fresh duplicate auction ID', () => {
  const fresh = auction(9, 'Fischer Strafgesetzbuch StGB 70. Auflage 2023');
  const otherBook = auction(30, 'Buch Harry Potter und der Feuerkelch');
  const game = selectRandomSet([books[0], fresh, otherBook, ...varied.slice(0, 4)], 5, () => .5, new Map([[books[0].id, { useCount: 20 }]]));
  assertVaried(game);
  assert.ok(game.auctions.some(item => item.id === otherBook.id));
  assert.ok(game.auctions.every(item => item.id !== fresh.id && item.id !== books[0].id));
});

test('seed game satisfies variety policy and existing daily snapshots stay frozen', async () => {
  const seed = JSON.parse(await readFile(new URL('../seed/auctions.json', import.meta.url), 'utf8')).auctions;
  assertVaried(selectDailySet(seed, '2026-09-12'));
  const dir = await mkdtemp(path.join(tmpdir(), 'justizguessr-frozen-selection-'));
  try {
    const old = { date: '2026-09-12', gameNumber: 255, generatedAt: '2026-09-12T00:00:00Z', selectionVersion: 3, auctions: seed.map(item => ({ ...item, correctPrice: item.currentBid })) };
    saveDailyGame(dir, old);
    assert.deepEqual(await ensureDailyGame({ dataDir: dir, dateKey: old.date }), old);
  } finally { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); }
});

test('public stats count fuzzy product families using aggregates only', () => {
  const stats = formatPublicStats({ archive: { auctions: books } });
  assert.match(stats, /auctions_unique_product_families: 1/);
  assert.doesNotMatch(stats, /Fischer|StGB|uplimg/);
});

test('producer-only wines use alcohol metadata and different producers do not merge through boilerplate', () => {
  const metadata = 'Zustand: Gebraucht. Zur Versteigerung angeboten wird: 1 Flasche. Füllmenge, Jahrgang und Alkoholgehalt entnehmen Sie den Fotos. Der Verkauf erfolgt ohne Gewähr für Trinkbarkeit.';
  assert.equal(auctionSelectionCategory(auction(1, 'Il Pino di Biserno', 'Sonstiges', { description: metadata })), 'Getränke');
  const differentProducers = ['Chateau Lynch-Bages Pauillac Grand Cru Classe', 'Chateau Pontet-Canet Pauillac Grand Cru Classe', 'Ruffino Riserva Ducale Chianti Classico', 'Lornano Chianti Classico Riserva'].map((title, index) => auction(index + 1, title, 'Sonstiges', { description: metadata }));
  assert.equal(buildAuctionFamilies(differentProducers).length, 4);
});

test('encoded punctuation and quantity changes cannot disguise duplicate product names', () => {
  const group = [auction(1, '1 Makita HR2470 &lpar;Bohrhammer&rpar;'), auction(2, '2 Stück Bohrhammer Makita HR 2470')];
  assert.equal(buildAuctionFamilies(group).length, 1);
});

test('a generic title cannot bridge distinct numbered models into one duplicate family', () => {
  const lots = [auction(1, 'Samsung Galaxy'), auction(2, 'Samsung Galaxy S21'), auction(3, 'Samsung Galaxy S22')];
  const groups = buildAuctionFamilies(lots);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => !(group.some(item => item.id === 2) && group.some(item => item.id === 3))));
  assert.deepEqual(groups.map(group => group.map(item => item.id)), buildAuctionFamilies([...lots].reverse()).map(group => group.map(item => item.id)));
});
