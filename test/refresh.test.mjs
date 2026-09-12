import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processRollingTask, collectAuctions } from '../src/collector.mjs';
import { closeDataStore, readArchive, upsertAuctions } from '../src/database.mjs';

const url = 'https://www.justiz-auktion.de/Camera-300001';
const end = Date.parse('2026-12-30T12:00:00Z');
const logger = { info() {}, warn() {} };
const html = (bid, time = '13:00:00') => `<title>Camera (#300001)</title><h2>Camera</h2>
  <p>Auktion ID 300001</p><p>Startgebot: 5,00 €</p><p>Aktuelles Gebot: ${bid},00 €</p>
  <p>Endet am: 30.12.2026 ${time}</p>`;
async function temporary(work) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'justiz-refresh-'));
  try { await work(dataDir); } finally { closeDataStore(dataDir); await rm(dataDir, { recursive: true, force: true }); }
}
function seed(dataDir, extra = {}) {
  upsertAuctions(dataDir, [{ id: 300001, url, title: 'Camera', currentBid: 10,
    finalPrice: null, startAt: '2026-12-01T00:00:00Z', endAt: new Date(end).toISOString(),
    capturedAt: new Date(end - 10 * 60_000).toISOString(), ...extra }]);
}

test('archive refresh runs without discovery, observes bids and extensions, and confirms final price', async () => temporary(async dataDir => {
  seed(dataDir);
  let calls = 0;
  let page = html(20, '13:10:00');
  const run = now => processRollingTask({ dataDir, now, logger, fetchImpl: async target => {
    assert.equal(target, url); calls++; return new Response(page);
  } });
  await run(end - 6 * 60_000);
  assert.equal(calls, 0);
  await run(end - 5 * 60_000);
  assert.equal(readArchive(dataDir).auctions[0].currentBid, 20);
  assert.equal(readArchive(dataDir).auctions[0].finalPrice, null);
  page = html(30, '13:10:00');
  await run(end + 10 * 60_000 + 1000);
  assert.equal(readArchive(dataDir).auctions[0].finalPrice, 30);
  await run(end + 24 * 60 * 60_000);
  assert.equal(calls, 2);
}));

test('legacy final prices captured before the end are rechecked', async () => temporary(async dataDir => {
  seed(dataDir, { finalPrice: 10 });
  await processRollingTask({ dataDir, now: end + 1000, logger, fetchImpl: async () => new Response(html(70)) });
  assert.equal(readArchive(dataDir).auctions[0].finalPrice, 70);
}));

test('batch collection never finalizes a stale bid when the detail request fails', async () => temporary(async dataDir => {
  seed(dataDir, { endAt: '2020-01-01T00:00:00Z', capturedAt: '2019-12-31T00:00:00Z' });
  let detailCalls = 0;
  await collectAuctions({ dataDir, pages: 1, logger, fetchImpl: async target => {
    if (target === url) { detailCalls++; return new Response('', { status: 404 }); }
    return new Response('');
  } });
  assert.equal(detailCalls, 1);
  assert.equal(readArchive(dataDir).auctions[0].finalPrice, null);
}));
