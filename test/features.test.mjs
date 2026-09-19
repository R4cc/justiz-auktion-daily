import test from 'node:test';
import assert from 'node:assert/strict';
import { featureFlags } from '../src/features.mjs';
import { readFile } from 'node:fs/promises';

test('all five economy features default on, including empty Compose values', () => {
  const expected = { news: true, market: true, resales: true, palettes: true, paletteAuctions: true };
  assert.deepEqual(featureFlags({}), expected);
  assert.deepEqual(featureFlags({ FEATURE_NEWS: '', FEATURE_MARKET: '  ' }), expected);
  for (const value of ['false', '0', 'off', 'no', 'FALSE']) {
    assert.deepEqual(featureFlags({ FEATURE_NEWS: value, FEATURE_RESALES: value }), { ...expected, news: false, resales: false });
  }
  assert.deepEqual(featureFlags({ FEATURE_PALETTE_AUCTIONS: 'false' }), { ...expected, paletteAuctions: false });
});

test('Compose preserves enabled defaults and explicit environment overrides', async () => {
  const compose = await readFile(new URL('../compose.yml', import.meta.url), 'utf8');
  for (const name of ['NEWS', 'MARKET', 'RESALES', 'PALETTES', 'PALETTE_AUCTIONS']) {
    assert.ok(compose.includes('${FEATURE_' + name + ':-true}'));
  }
});
