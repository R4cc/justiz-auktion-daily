import test from 'node:test';
import assert from 'node:assert/strict';
import { featureFlags } from '../src/features.mjs';
import { readFile } from 'node:fs/promises';

test('playable economy defaults on while news stays dormant', () => {
  const expected = { news: false, market: true, resales: true, palettes: true, paletteAuctions: true, businesses: true };
  assert.deepEqual(featureFlags({}), expected);
  assert.deepEqual(featureFlags({ FEATURE_MARKET: '  ' }), expected);
  assert.deepEqual(featureFlags({ FEATURE_NEWS: 'true' }), expected);
  for (const value of ['false', '0', 'off', 'no', 'FALSE']) {
    assert.deepEqual(featureFlags({ FEATURE_NEWS: value, FEATURE_RESALES: value }), { ...expected, news: false, resales: false });
  }
  assert.deepEqual(featureFlags({ FEATURE_PALETTE_AUCTIONS: 'false' }), { ...expected, paletteAuctions: false });
  assert.deepEqual(featureFlags({ FEATURE_BUSINESSES: 'false' }), { ...expected, businesses: false });
});

test('Compose keeps news off and the playable economy on', async () => {
  const compose = await readFile(new URL('../compose.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(compose, /FEATURE_NEWS/);
  for (const name of ['MARKET', 'RESALES', 'PALETTES', 'PALETTE_AUCTIONS', 'BUSINESSES']) {
    assert.ok(compose.includes('${FEATURE_' + name + ':-true}'));
  }
});
