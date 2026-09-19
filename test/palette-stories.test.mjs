import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE_STORY_POOL, PALETTE_STORY_THEMES, paletteStoryForAuction, paletteStoryTheme
} from '../src/palette-stories.mjs';

const cameoNames = [
  'Richard Lugner', 'Money Boy', 'Andreas Gabalier', 'Sebastian Kurz', 'HC Strache',
  'Herbert Kickl', 'Alexander Van der Bellen', 'Karl Nehammer', 'René Benko', 'Friedrich Merz'
];

test('story pool contains 100 bilingual cases with exactly ten percent Austrian parodies', () => {
  assert.equal(PALETTE_STORY_POOL.length, 100);
  assert.equal(new Set(PALETTE_STORY_POOL.map(story => story.id)).size, 100);
  assert.equal(PALETTE_STORY_POOL.filter(story => story.parody).length, 10);
  for (const theme of PALETTE_STORY_THEMES) {
    const stories = PALETTE_STORY_POOL.filter(story => story.theme === theme);
    assert.equal(stories.length, 10, theme);
    assert.equal(stories.filter(story => story.parody).length, 1, theme);
  }
  for (const story of PALETTE_STORY_POOL) {
    assert.equal(story.fictional, true);
    for (const field of ['title', 'titleDe', 'body', 'bodyDe', 'shortDescription', 'shortDescriptionDe']) {
      assert.equal(typeof story[field], 'string');
      assert.ok(story[field].trim(), `${story.id}.${field}`);
    }
  }
});

test('Austrian parody pool includes the requested cases without using bidder cameo names', () => {
  const titles = new Set(PALETTE_STORY_POOL.map(story => story.title));
  for (const title of [
    'Ibiza Estate Clearance', 'The Ballhausplatz Office Liquidation',
    'Chatprotokoll-Leak: 47 iPhones Seized', 'Balkanroute Electronics Palette',
    'Signa Office Clearance'
  ]) assert.ok(titles.has(title), title);

  const copy = JSON.stringify(PALETTE_STORY_POOL).toLocaleLowerCase('de-AT');
  for (const name of cameoNames) assert.ok(!copy.includes(name.toLocaleLowerCase('de-AT')), name);
});

test('auction story selection is deterministic, themed and exposes no internal pool fields', () => {
  const payload = { paletteId: 'electronics-smuggling', definitionVersion: 1 };
  const first = paletteStoryForAuction(payload, 'primary-story-00000001');
  assert.deepEqual(paletteStoryForAuction(payload, 'primary-story-00000001'), first);
  assert.equal(paletteStoryTheme(payload), 'electronics');
  assert.ok(PALETTE_STORY_POOL.some(story => story.theme === 'electronics'
    && story.title === first.title && story.body === first.body));
  assert.deepEqual(Object.keys(first).sort(), [
    'body', 'bodyDe', 'fictional', 'parody', 'shortDescription', 'shortDescriptionDe', 'title', 'titleDe'
  ]);
});

test('all supported palette ids map to the intended story category', () => {
  assert.deepEqual([
    'fundkiste', 'schatzkiste', 'cars', 'wine', 'electronics', 'tools', 'jewellery', 'collectibles',
    'electronics-smuggling', 'dealer-seizure', 'wine-tax-seizure'
  ].map(paletteId => paletteStoryTheme({ paletteId })), [
    'mixed', 'premium', 'vehicles', 'wine', 'electronics', 'tools', 'jewellery', 'collectibles',
    'electronics', 'premium', 'wine'
  ]);
});
