import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auctionGallery } from '../src/auction-images.mjs';
import { collectAuctions, parseAuctionPage, processRollingTask } from '../src/collector.mjs';
import { closeDataStore, readArchive, readQueue, upsertAuctions, writeQueue } from '../src/database.mjs';
import { selectDailySet, selectRandomSet } from '../src/core.mjs';

const base = 'https://www.justiz-auktion.de';
const url = `${base}/Test-Camera-300001`;
const sources = [1, 2, 3].map(n => `${base}/uplimg/camera_pic${n}w.jpg`);
const logger = { info() {}, warn() {} };
function html(order = [1, 2, 3]) {
  return `<title>Test Camera (#300001) | Justiz-Auktion</title><h2>Test Camera</h2>
    <p>Auktion ID 300001</p><p>Startgebot: 5,00 €</p><p>Aktuelles Gebot: 100,00 €</p>
    <p>Endet am: 30.12.2026 13:00:00</p><h3>Artikelbeschreibung</h3>
    <p>Zustand: Gebraucht</p><p>A detailed camera description with enough information for selection.</p><h3>Details</h3>
    ${order.map(n => `<img src="uplimg/camera&lowbar;pic${n}w&period;jpg"><a href="/uplimg/camera_pic${n}w.jpg"><img src="/uplimg/tn/tn100_camera_pic${n}w.jpg"></a>`).join('')}
    <img src="https://evil.example/uplimg/unrelated.jpg">`;
}
function imageResponse(n) {
  return new Response(Buffer.alloc(1200, n), { headers: { 'content-type': 'image/jpeg' } });
}
async function temporary(work) {
  const dir = await mkdtemp(path.join(tmpdir(), 'justizguessr-images-'));
  try { await work(dir); } finally { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); }
}

// This fixture mirrors the source site's entity-encoded swiper slides and repeated thumbnails.
test('image parser keeps every full-size slide, in order, without thumbnails or duplicates', () => {
  assert.deepEqual(parseAuctionPage(html(), url).sourceImages, sources);
});

test('rolling collection downloads all images independently, survives retries and restarts, and backfills old covers', async () => temporary(async dataDir => {
  const item = { ...parseAuctionPage(html(), url), image: '/auction-images/300001.jpg', images: ['/auction-images/300001.jpg'] };
  upsertAuctions(dataDir, [item]);
  const requests = [];
  let failed = false;
  const fetchImpl = async source => {
    requests.push(source);
    if (source === sources[1] && !failed) { failed = true; return new Response('', { status: 503 }); }
    return imageResponse(sources.indexOf(source) + 1);
  };
  const first = await processRollingTask({ dataDir, fetchImpl, now: 1000, logger });
  assert.equal(first.status, 'error');
  assert.equal(requests.length, 1);
  assert.deepEqual(readQueue(dataDir, {}).tasks.map(t => t.url).sort(), sources.slice(1).sort());
  closeDataStore(dataDir);
  const second = await processRollingTask({ dataDir, fetchImpl, now: 1000 + first.waitMs, logger });
  assert.equal(second.status, 'ok');
  assert.equal(requests.length, 2);
  let saved = readArchive(dataDir).auctions[0];
  assert.equal(saved.images[0], item.image);
  assert.equal(saved.images[1], sources[1]); // Failed source stays in its slot, with remote fallback.
  assert.match(saved.images[2], /^\/auction-images\/300001-[a-f0-9]+\.jpg$/);
  const retry = readQueue(dataDir, {}).tasks[0];
  await processRollingTask({ dataDir, fetchImpl, now: Math.max(retry.notBefore, 1000000), logger });
  saved = readArchive(dataDir).auctions[0];
  assert.equal(readQueue(dataDir, {}).tasks.length, 0);
  assert.equal(requests.length, 3);
  assert.equal(new Set(saved.images).size, 3);
  assert.ok(saved.images.every(image => image.startsWith('/auction-images/')));
  for (const index of [1, 2]) {
    assert.deepEqual(await readFile(path.join(dataDir, 'images', path.basename(saved.images[index]))), Buffer.alloc(1200, index + 1));
  }
  assert.deepEqual(selectRandomSet([saved], 1).auctions[0].images, saved.images);
  assert.deepEqual(selectDailySet([saved], '2026-09-12', {}, 1).auctions[0].images, saved.images);
  assert.equal((await processRollingTask({ dataDir, fetchImpl, now: 2000000, logger })).status, 'idle');
  assert.equal(requests.length, 3);
}));

test('detail refresh preserves cached images by source identity when order changes and adds new slides', async () => temporary(async dataDir => {
  const item = parseAuctionPage(html(), url);
  const imageCache = { [sources[0]]: '/auction-images/first.jpg', [sources[1]]: '/auction-images/second.jpg' };
  upsertAuctions(dataDir, [{ ...item, imageCache, image: imageCache[sources[0]], images: Object.values(imageCache), startAt: '2026-09-01T00:00:00Z' }]);
  writeQueue(dataDir, { imageCacheVersion: 1, tasks: [{ kind: 'detail', url, auctionId: item.id }] });
  await processRollingTask({ dataDir, now: 1000, logger, fetchImpl: async () => new Response(html([2, 1, 3])) });
  const saved = readArchive(dataDir).auctions[0];
  assert.deepEqual(saved.images, [imageCache[sources[1]], imageCache[sources[0]], sources[2]]);
  assert.deepEqual(readQueue(dataDir, {}).tasks.filter(t => t.kind === 'image').map(t => t.url), [sources[2]]);
}));

test('batch collection caches every slide, retries only failures, and reuses cached galleries', async () => temporary(async dataDir => {
  const requests = [];
  let failMiddle = true;
  const fetchImpl = async source => {
    if (source.includes('/uplimg/')) {
      requests.push(source);
      if (source === sources[1] && failMiddle) return new Response('', { status: 404 });
      return imageResponse(sources.indexOf(source) + 1);
    }
    if (source.includes('auktion_drucken')) return new Response('<td>Starttermin</td><td>01.09.2026 - 13:00</td>');
    if (source === url) return new Response(html());
    return new Response('<a href="/Test-Camera-300001">Details</a>');
  };
  await collectAuctions({ dataDir, fetchImpl, pages: 1, logger });
  let saved = readArchive(dataDir).auctions[0];
  assert.deepEqual(requests, sources);
  assert.equal(saved.images.length, 3);
  assert.equal(saved.images[1], sources[1]);
  const firstImage = saved.images[0];
  failMiddle = false;
  await collectAuctions({ dataDir, fetchImpl, pages: 1, logger });
  saved = readArchive(dataDir).auctions[0];
  assert.deepEqual(requests, [...sources, sources[1]]);
  assert.equal(saved.image, firstImage);
  assert.ok(saved.images.every(image => image.startsWith('/auction-images/')));
  assert.equal(new Set(saved.images).size, 3);
  await collectAuctions({ dataDir, fetchImpl, pages: 1, logger });
  assert.equal(requests.length, 4);
}));

test('image queue keeps separate auction owners for a shared source URL', async () => temporary(async dataDir => {
  writeQueue(dataDir, { imageCacheVersion: 1, tasks: [300001, 300002].map(auctionId => ({ kind: 'image', auctionId, url: sources[0] })) });
  assert.deepEqual(readQueue(dataDir, {}).tasks.map(t => t.auctionId), [300001, 300002]);
}));

test('gallery replaces cached sources rather than appending duplicate remote slides', () => {
  const item = { image: '/auction-images/one.jpg', images: ['/auction-images/one.jpg', '/auction-images/two.jpg'], sourceImages: sources.slice(0, 2), imageCache: { [sources[0]]: '/auction-images/one.jpg', [sources[1]]: '/auction-images/two.jpg' } };
  assert.deepEqual(auctionGallery(item), item.images);
});
