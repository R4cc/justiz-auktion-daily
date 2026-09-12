import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { censorCurrencyValues, gameNumber, scoreGuess, selectDailySet, selectRandomSet } from '../src/core.mjs';
import { enqueueRollingDiscovery, extractListingUrls, parseAuctionPage, parseAuctionStart, processRollingTask } from '../src/collector.mjs';
import { formatPublicStats } from '../src/public-stats.mjs';
import {
  DATABASE_FILENAME,
  closeDataStore,
  initializeDataStore,
  readArchive,
  readDailyGames,
  readDailyUsedIds,
  readQueue,
  readRandomUsage,
  recordRandomGame,
  saveDailyGame,
  upsertAuctions
} from '../src/database.mjs';

test('scoring uses a forgiving nonlinear curve', () => {
  assert.equal(scoreGuess(100, 100), 1000);
  assert.ok(scoreGuess(110, 100) >= 940);
  assert.ok(scoreGuess(150, 100) >= 540);
  assert.ok(scoreGuess(200, 100) >= 270);
  assert.equal(scoreGuess(50, 100), scoreGuess(150, 100));
  assert.ok(scoreGuess(20, 10) > scoreGuess(200, 100));
  assert.ok(scoreGuess(500, 50) < 20);
  assert.ok(scoreGuess(105, 100) > scoreGuess(125, 100));
  assert.equal(scoreGuess(-1, 100), 0);
  assert.equal(scoreGuess(100, 0), 0);
});

test('game numbers advance at midnight UTC', () => {
  assert.equal(gameNumber('2026-01-01'), 1);
  assert.equal(gameNumber('2026-01-02'), 2);
});

test('auction descriptions censor currency and labeled price values', () => {
  const description = [
    'Neupreis 1.299,00 EUR.',
    'Das Startgebot: 20 wurde festgelegt.',
    'Zubehör kostet € 4,50 oder 12,-- Euro.',
    'Schätzwert in Höhe von ca. 800.',
    'Der Warenwert lag bei 1,299.00 USD.',
    'Versichert für 5 Tsd. &euro;.',
    'Maße: 42 cm × 25 cm.'
  ].join(' ');
  const censored = censorCurrencyValues(description);
  assert.equal((censored.match(/\[Preis ausgeblendet\]/g) || []).length, 7);
  assert.doesNotMatch(censored, /1\.299|Startgebot:\s*20|€\s*4,50|12,--\s*Euro|Schätzwert[^[]*800|1,299|USD|5 Tsd|&euro;/);
  assert.match(censored, /42 cm × 25 cm/);
});

test('daily selection is deterministic, varied, and avoids recently used items', () => {
  const auctions = Array.from({ length: 18 }, (_, index) => ({
    id: 100000 + index,
    title: `Auction item ${index}`,
    description: 'A sufficiently detailed public auction description for selection quality.',
    category: ['Vehicles', 'Tools', 'Jewelry', 'Electronics', 'Furniture', 'Fashion'][index % 6],
    image: `/images/${index}.jpg`,
    currentBid: 20 * (index + 1),
    startBid: 5,
    bidCount: index + 1,
    endAt: `2026-10-${String(1 + (index % 6)).padStart(2, '0')}T${String(10 + (index % 5)).padStart(2, '0')}:00:00.000Z`,
    url: `https://example.test/item-${index}`
  }));
  const previous = {
    '2026-01-01': { auctions: [auctions[17]] },
    '2026-09-08': { auctions: auctions.slice(0, 5) }
  };
  const first = selectDailySet(auctions, '2026-09-09', previous);
  const second = selectDailySet(auctions, '2026-09-09', previous);
  assert.deepEqual(first.auctions.map(item => item.id), second.auctions.map(item => item.id));
  assert.equal(new Set(first.auctions.map(item => item.id)).size, 5);
  assert.equal(first.auctions.some(item => item.id < 100005), false);
  assert.equal(first.auctions.some(item => item.id === 100017), false);
  assert.ok(new Set(first.auctions.map(item => item.category)).size >= 4);
  assert.ok(new Set(first.auctions.map(item => item.endAt)).size >= 4);
  const following = selectDailySet(auctions, '2026-09-10', { ...previous, '2026-09-09': first });
  assert.equal(following.auctions.some(item => first.auctions.some(previousItem => previousItem.id === item.id)), false);
  assert.notDeepEqual(
    first.auctions.map(item => item.id),
    following.auctions.map(item => item.id)
  );
  const ledgerFiltered = selectDailySet(
    auctions,
    '2026-09-11',
    {},
    5,
    new Set(auctions.slice(0, 10).map(item => item.id))
  );
  assert.ok(ledgerFiltered.auctions.every(item => item.id >= 100010));
});

test('random selection exhausts the least-used pool before repeating', () => {
  const auctions = Array.from({ length: 15 }, (_, index) => ({
    id: 200000 + index,
    title: `Archived auction ${index}`,
    description: 'A saved auction that remains playable after its original listing ended.',
    category: ['Vehicles', 'Tools', 'Jewelry', 'Electronics', 'Furniture'][index % 5],
    image: `/images/archive-${index}.jpg`,
    images: [`/images/archive-${index}.jpg`],
    sourceImages: [
      `https://www.justiz-auktion.de/uplimg/${index}-cover.jpg`,
      `https://www.justiz-auktion.de/uplimg/${index}-detail.jpg`,
      `https://www.justiz-auktion.de/uplimg/${index}-detail.jpg`
    ],
    currentBid: 10 + index,
    finalPrice: 50 + index,
    startBid: 5,
    endAt: '2025-01-01T12:00:00.000Z',
    url: `https://example.test/archive-${index}`
  }));
  const game = selectRandomSet([...auctions, auctions[0]], 5, () => 0);
  assert.equal(game.mode, 'random');
  assert.equal(game.auctions.length, 5);
  assert.equal(new Set(game.auctions.map(item => item.id)).size, 5);
  assert.ok(game.auctions.every(item => item.correctPrice === 50 + (item.id - 200000)));
  for (const item of game.auctions) {
    const index = item.id - 200000;
    assert.deepEqual(item.images, [
      `/images/archive-${index}.jpg`,
      `https://www.justiz-auktion.de/uplimg/${index}-detail.jpg`
    ]);
  }

  const usage = new Map();
  const seen = new Set();
  for (let round = 0; round < 3; round += 1) {
    const selection = selectRandomSet(auctions, 5, () => 0, usage);
    assert.equal(selection.auctions.some(item => seen.has(item.id)), false);
    for (const item of selection.auctions) {
      seen.add(item.id);
      usage.set(item.id, { useCount: 1 });
    }
  }
  assert.equal(seen.size, 15);
  assert.equal(selectRandomSet(auctions, 5, () => 0, usage).auctions.length, 5);
});

test('SQLite store migrates JSON data and persists selection history', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'justizguessr-sqlite-'));
  const auction = {
    id: 300001,
    title: 'Migrated camera',
    description: 'A complete auction description.',
    category: 'Elektronik',
    image: '/auction-images/300001.jpg',
    currentBid: 75,
    finalPrice: 90,
    endAt: '2026-09-10T12:00:00.000Z'
  };
  try {
    await writeFile(path.join(dataDir, 'auctions.json'), JSON.stringify({ updatedAt: '2026-09-10T13:00:00.000Z', auctions: [auction] }));
    await writeFile(path.join(dataDir, 'fetch-queue.json'), JSON.stringify({ version: 4, updatedAt: '2026-09-10T13:00:00.000Z', tasks: [{ kind: 'detail', url: 'https://example.test/300001' }] }));
    await writeFile(path.join(dataDir, 'daily-games.json'), JSON.stringify({ games: {
      '2026-09-10': { date: '2026-09-10', gameNumber: 253, generatedAt: '2026-09-10T00:00:00.000Z', selectionVersion: 3, auctions: [{ ...auction, correctPrice: 90 }] }
    } }));

    initializeDataStore(dataDir);
    assert.equal(readArchive(dataDir).auctions[0].title, 'Migrated camera');
    assert.equal(readQueue(dataDir, {}).tasks.length, 1);
    assert.equal(readDailyGames(dataDir).games['2026-09-10'].auctions[0].id, 300001);
    assert.equal(readDailyUsedIds(dataDir).has(300001), true);
    assert.equal((await stat(path.join(dataDir, DATABASE_FILENAME))).isFile(), true);

    const randomGame = selectRandomSet([auction], 1, () => 0, readRandomUsage(dataDir));
    recordRandomGame(dataDir, randomGame);
    assert.equal(readRandomUsage(dataDir).get(300001).useCount, 1);

    assert.throws(() => saveDailyGame(dataDir, {
      date: '2026-09-11',
      gameNumber: 254,
      generatedAt: '2026-09-11T00:00:00.000Z',
      selectionVersion: 3,
      auctions: [{ ...auction, correctPrice: 90 }]
    }), /UNIQUE constraint failed/);
  } finally {
    closeDataStore(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('collector discovers and parses public auction records', () => {
  const search = '<a href="/Some-Good-Item-210635">Details</a><a href="/auktion_gebote-210635">bids</a><a href="https://evil.example/Fake-Item-999999">bad</a>';
  assert.deepEqual(extractListingUrls(search), ['https://www.justiz-auktion.de/Some-Good-Item-210635']);
  const html = `
    <title>Some Good Item (#210635) | Justiz-Auktion</title>
    <h2>Some Good Item</h2>
    <p>Auktion ID 210635</p>
    <p>Startgebot: 20,00 €</p><p>Aktuelles Gebot: 110,00 €</p>
    <p>Anzahl Gebote 14</p><p>Endet am: 10.09.2026 13:00:00</p>
    <h3>Artikelbeschreibung</h3><p>Zustand: Neuwertig</p><p>Ein gut beschriebenes Werkzeug.</p><h3>Details</h3>
    <img src="/uplimg/example_pic1w.jpg">
  `;
  const item = parseAuctionPage(html, 'https://www.justiz-auktion.de/Some-Good-Item-210635');
  assert.equal(item.id, 210635);
  assert.equal(item.startBid, 20);
  assert.equal(item.currentBid, 110);
  assert.equal(item.bidCount, 14);
  assert.equal(item.category, 'Werkzeuge');
  assert.equal(item.sourceImages[0], 'https://www.justiz-auktion.de/uplimg/example_pic1w.jpg');
  assert.equal(parseAuctionStart('<td>Starttermin</td><td>27.08.2026 - 13:00</td>'), '2026-08-27T11:00:00.000Z');

  const notebook = parseAuctionPage(`
    <title>Fujitsu Notebook (#213049) | Justiz-Auktion</title>
    <p>Auktion ID 213049</p><p>Startgebot: 3,00 €</p><p>Aktuelles Gebot: 21,00 €</p>
    <p>Endet am: 22.09.2026 13:41:21</p><h3>Artikelbeschreibung</h3>
    <p>Zustand: Gebraucht</p><p>Geschäftszeiten bis 16:00 Uhr. Das Gerät wird ungeprüft verkauft.</p><h3>Details</h3>
    <img src="/uplimg/notebook_pic1w.jpg">
  `, 'https://www.justiz-auktion.de/Fujitsu-Notebook-213049');
  assert.equal(notebook.category, 'Elektronik');
});

test('rolling collector persists its queue and performs only one request per step', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'justizguessr-rolling-'));
  try {
    await writeFile(path.join(dataDir, 'auctions.json'), '{"auctions":[]}\n');
    await enqueueRollingDiscovery({ dataDir, pages: 2, now: 1_000 });
    const requested = [];
    const fetchImpl = async url => {
      requested.push(url);
      return new Response('<a href="/Werkzeugkoffer-210635">Details</a>', { status: 200, headers: { 'content-type': 'text/html' } });
    };

    const first = await processRollingTask({ dataDir, fetchImpl, now: 2_000, logger: { info() {}, warn() {} } });
    assert.equal(first.status, 'ok');
    assert.equal(first.kind, 'listing');
    assert.equal(requested.length, 1);

    const queue = readQueue(dataDir, {});
    assert.equal(queue.lastRequestAt, '1970-01-01T00:00:02.000Z');
    assert.equal(queue.tasks.filter(task => task.kind === 'listing').length, 1);
    assert.equal(queue.tasks.filter(task => task.kind === 'detail').length, 1);

    const second = await processRollingTask({ dataDir, fetchImpl, now: 3_000, logger: { info() {}, warn() {} } });
    assert.equal(second.kind, 'listing');
    assert.equal(requested.length, 2);
    const completedQueue = readQueue(dataDir, {});
    assert.equal(completedQueue.tasks.filter(task => task.kind === 'listing').length, 0);
    assert.equal(completedQueue.tasks.filter(task => task.kind === 'detail').length, 1);
    assert.equal(completedQueue.discovery.complete, true);
  } finally {
    closeDataStore(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('rolling collector honors Retry-After without issuing a second request', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'justizguessr-backoff-'));
  try {
    await writeFile(path.join(dataDir, 'auctions.json'), '{"auctions":[]}\n');
    await enqueueRollingDiscovery({ dataDir, pages: 1, now: 10_000 });
    let requests = 0;
    const result = await processRollingTask({
      dataDir,
      now: 10_000,
      logger: { info() {}, warn() {} },
      fetchImpl: async () => {
        requests += 1;
        return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } });
      }
    });
    assert.equal(result.status, 'error');
    assert.equal(requests, 1);
    const queue = readQueue(dataDir, {});
    assert.equal(queue.tasks[0].attempts, 1);
    assert.equal(queue.tasks[0].notBefore, 130_000);
  } finally {
    closeDataStore(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('rolling collector preserves the request interval across restarts', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'justizguessr-interval-'));
  try {
    await writeFile(path.join(dataDir, 'auctions.json'), '{"auctions":[]}\n');
    await enqueueRollingDiscovery({ dataDir, pages: 2, now: 1_000 });
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return new Response('', { status: 200 });
    };
    await processRollingTask({ dataDir, fetchImpl, now: 2_000, minimumIntervalMs: 120_000, logger: { info() {}, warn() {} } });
    const waiting = await processRollingTask({ dataDir, fetchImpl, now: 100_000, minimumIntervalMs: 120_000, logger: { info() {}, warn() {} } });
    assert.equal(waiting.status, 'waiting');
    assert.equal(requests, 1);
  } finally {
    closeDataStore(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('public stats expose aggregates without auction details or internal errors', () => {
  const output = formatPublicStats({
    now: Date.parse('2026-09-09T12:00:00Z'),
    archive: {
      updatedAt: '2026-09-09T11:00:00Z',
      auctions: [
        { title: 'Private-looking title', url: 'https://example.test/secret', endAt: '2026-09-10T12:00:00Z', image: '/auction-images/1.jpg' },
        { endAt: '2026-09-08T12:00:00Z', finalPrice: 42 }
      ]
    },
    queue: { lastRequestAt: '2026-09-09T11:59:00Z', tasks: [{ kind: 'detail', url: 'https://example.test/hidden', attempts: 1, notBefore: 0 }] },
    daily: { games: { '2026-09-09': {} } },
    random: { games: 12, uniqueAuctions: 54 },
    fetchState: { status: 'error', error: 'credential=/data/secret' }
  });
  assert.match(output, /auctions_fetched: 2/);
  assert.match(output, /queue_pending: 1/);
  assert.match(output, /random_games_saved: 12/);
  assert.match(output, /random_auctions_used: 54/);
  assert.match(output, /fetch_status: error/);
  assert.doesNotMatch(output, /Private-looking|example\.test|credential|\/data/);
});
