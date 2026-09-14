import test from 'node:test';
import assert from 'node:assert/strict';
import { caseCatalog } from '../src/cases.mjs';
import { paletteFromCase, publicPaletteCatalog } from '../src/palettes.mjs';

const day = Date.parse('2026-09-12T12:00:00Z');
const lots = Array.from({ length: 24 }, (_, n) => ({ id: n + 1000, title: `Laptop Lenovo ${n + 1000}`,
  category: 'Elektronik', currentBid: (n + 1) * 10, image: '/assets/electronics.jpg' }));

test('palette catalog mirrors the case catalog under palette terminology', () => {
  const catalog = caseCatalog(lots, day);
  const paletteCatalog = publicPaletteCatalog(catalog);
  assert.deepEqual(Object.keys(paletteCatalog), ['revision', 'rotationDate', 'rotatesAt', 'rarities', 'rewards', 'palettes']);
  assert.equal(paletteCatalog.revision, catalog.revision);
  assert.deepEqual(paletteCatalog.palettes.map(palette => palette.id), catalog.cases.map(box => box.id));
  const electronics = paletteCatalog.palettes.find(palette => palette.id === 'electronics');
  assert.equal(electronics.type, 'electronics');
  assert.equal(electronics.marketCategory, 'electronics');
  assert.equal(electronics.cost, catalog.cases.find(box => box.id === 'electronics').cost);
  assert.ok(electronics.items.length);
  assert.ok(electronics.items.every(item => item.marketCategory === 'electronics'));
  assert.equal(paletteCatalog.palettes.find(palette => palette.id === 'fundkiste').marketCategory, null);
  // Availability is spelled out for future palette listings.
  assert.ok(paletteCatalog.palettes.every(palette =>
    palette.availability === (palette.available ? 'available' : 'restocking')));
  assert.doesNotMatch(JSON.stringify(paletteCatalog), /"(?:weights|odds|chance)":/);
  // The view never mutates the underlying catalog.
  assert.deepEqual(catalog.cases.find(box => box.id === 'electronics').items[0],
    caseCatalog(lots, day).cases.find(box => box.id === 'electronics').items[0]);
});

test('palette views stay in sync with individual case shapes', () => {
  const box = { id: 'wine', name: 'Wine Case', nameDe: 'Wein-Kiste', category: 'wine', badge: 'VIN',
    cost: 25, available: false, items: [] };
  const palette = paletteFromCase(box);
  assert.deepEqual(palette, { id: 'wine', name: 'Wine Case', nameDe: 'Wein-Kiste', type: 'wine',
    marketCategory: 'wine', badge: 'VIN', cost: 25, available: false, availability: 'restocking', items: [] });
});
