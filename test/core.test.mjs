import test from 'node:test';
import assert from 'node:assert/strict';
import { gameNumber, scoreGuess, selectDailySet } from '../src/core.mjs';
import { extractListingUrls, parseAuctionPage, parseAuctionStart } from '../src/collector.mjs';

test('percentage scoring rewards close guesses smoothly', () => {
  assert.equal(scoreGuess(100, 100), 1000);
  assert.ok(scoreGuess(10_000, 10_500) > 880);
  assert.ok(scoreGuess(500, 50) < 10);
  assert.equal(scoreGuess(-1, 100), 0);
});

test('game numbers advance at midnight UTC', () => {
  assert.equal(gameNumber('2026-01-01'), 1);
  assert.equal(gameNumber('2026-01-02'), 2);
});

test('daily selection is deterministic, varied, and avoids recently used items', () => {
  const auctions = Array.from({ length: 12 }, (_, index) => ({
    id: 100000 + index,
    title: `Auction item ${index}`,
    description: 'A sufficiently detailed public auction description for selection quality.',
    category: ['Vehicles', 'Tools', 'Jewelry', 'Electronics', 'Furniture', 'Fashion'][index % 6],
    image: `/images/${index}.jpg`,
    currentBid: 20 * (index + 1),
    startBid: 5,
    bidCount: index + 1,
    endAt: '2026-10-01T12:00:00.000Z',
    url: `https://example.test/item-${index}`
  }));
  const previous = { '2026-09-08': { auctions: auctions.slice(0, 5) } };
  const first = selectDailySet(auctions, '2026-09-09', previous);
  const second = selectDailySet(auctions, '2026-09-09', previous);
  assert.deepEqual(first.auctions.map(item => item.id), second.auctions.map(item => item.id));
  assert.equal(new Set(first.auctions.map(item => item.id)).size, 5);
  assert.equal(first.auctions.some(item => item.id < 100005), false);
  assert.ok(new Set(first.auctions.map(item => item.category)).size >= 4);
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
  assert.equal(item.sourceImages[0], 'https://www.justiz-auktion.de/uplimg/example_pic1w.jpg');
  assert.equal(parseAuctionStart('<td>Starttermin</td><td>27.08.2026 - 13:00</td>'), '2026-08-27T11:00:00.000Z');
});
