import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore } from '../src/database.mjs';
import { tickMarketDrift } from '../src/market.mjs';

test('public market history accepts all quick filters, keeps legacy limits and rejects invalid ranges', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'jg-market-api-'));
  t.after(async () => { closeDataStore(dataDir); await rm(dataDir, { recursive: true, force: true }); });
  tickMarketDrift(dataDir, { now: Date.now() - 31 * 86400_000 });
  tickMarketDrift(dataDir);
  let result;
  const api = createEconomyApi({ dataDir, flags: { market: true }, json: (_, status, body) => { result = { status, body }; } });
  const get = query => {
    assert.equal(api({ method: 'GET' }, null, new URL(`/api/market/electronics/history?${query}`, 'http://localhost')), true);
    return result;
  };
  for (const range of ['1h', '1d', '1w', '1m']) {
    const { status, body } = get(`range=${range}`);
    assert.equal(status, 200); assert.equal(body.range, range);
    assert.ok(body.history.length >= 60 && body.history.length <= 722);
    assert.equal(body.history[0].capturedAt, body.updatedAt);
  }
  assert.equal(get('range=bad').status, 400);
  assert.equal(get('range=toString').status, 400);
  assert.equal(get('limit=3').body.history.length, 3);
  const disabled = createEconomyApi({ dataDir, flags: { market: false }, json: () => assert.fail('disabled market responded') });
  assert.equal(disabled({ method: 'GET' }, null, new URL('/api/market/electronics/history?range=1h', 'http://localhost')), false);
});

test('a market-only runtime starts minute quotes even when every other economy feature is disabled', async t => {
  const { startEconomyRuntime } = await import('../src/economy-runtime.mjs');
  const { marketState } = await import('../src/market.mjs');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'jg-market-runtime-'));
  t.after(async () => { closeDataStore(dataDir); await rm(dataDir, { recursive: true, force: true }); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const now = Date.parse('2026-10-08T12:00:00Z');
  const stop = startEconomyRuntime(dataDir, { flags: { market: true }, now: () => now,
    onError: result => assert.fail(JSON.stringify(result)) });
  t.mock.timers.tick(1000);
  assert.ok(marketState(dataDir, { now }).categories.some(c => c.currentIndex !== 100));
  stop();
});
