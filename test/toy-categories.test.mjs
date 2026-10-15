import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { auctionSelectionCategory, isToyAuction } from '../src/auction-selection.mjs';
import { businessTypeForItem } from '../src/stock-compatibility.mjs';
import { marketCategoryForAuction, marketCategoryForItem } from '../src/market.mjs';
import { matchesTheme } from '../src/cases.mjs';
import { stockPaletteCatalog } from '../src/stock-palettes.mjs';
import { Accounts } from '../src/accounts.mjs';
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';

const titles = [
  'Brettspiele Konvolut', 'Gesellschaftsspiel', 'Kartenspiele', 'Würfelspiel',
  'Board games collection', 'Ravensburger Puzzle 1000 Teile', 'Holzbaukasten',
  'Klemmbausteine', 'Building blocks set', 'Puppenhaus mit Möbeln', 'Barbie Puppe',
  'Plüschtiere Konvolut', 'Steiff Teddybär', 'Stuffed animals', 'Playmobil Ritterburg',
  'LEGO Technic Ford', 'Duplo Bausteine', 'Schleich Pferde', 'Hot Wheels Autos',
  'Matchbox Modellautos', 'Märklin Modelleisenbahn', 'Roco Lokomotive',
  'Modellflugzeug', 'Model train set', 'BMW M3 1:18', 'Porsche 911 1/43',
  'RC Auto mit Fernbedienung', 'Ferngesteuertes Boot', 'Carrera Autorennbahn',
  'Funko Pop Figuren', 'Actionfiguren', 'Pokémon Sammelkarten', 'Yu-Gi-Oh! Karten',
  'Monopoly', 'Scrabble', 'Fischertechnik Baukasten', 'SIKU Traktor',
  'Kinderspielzeug', 'Holzspielzeug', 'Kinderpuzzle', 'Modellbausätze', 'Spielkarten', 'Trading cards'
];

test('German and English toy families share selection, market and shop classification', () => {
  for (const title of titles) {
    const item = { title, category: 'Sonstiges' };
    assert.equal(isToyAuction(item), true, title);
    assert.equal(auctionSelectionCategory(item), 'Sammlerstücke', title);
    assert.equal(marketCategoryForAuction(item), 'collectibles', title);
    assert.equal(matchesTheme(item, 'collectibles'), true, title);
    assert.equal(businessTypeForItem(item), 'toys', title);
    assert.equal(matchesTheme(item, 'cars'), false, title);
  }
});

test('toy lookalikes and incidental seller descriptions stay outside toy shops', () => {
  const items = [
    { title: 'BMW M3 Modell 2018', description: 'Im Kofferraum liegt Spielzeug.' },
    { title: 'Ford PKW' }, { title: 'Werkzeugkoffer Makita' },
    { title: 'PlayStation 5 Konsole' }, { title: 'Nintendo Switch' },
    { title: 'LEGO Star Wars PS5 Videospiel' }, { title: 'LEGO Buch' },
    { title: 'Barbie DVD' }, { title: 'Märklin Katalog' }, { title: 'LEGO Bauanleitung' },
    { title: 'Bronze Figur' }, { title: 'Porzellan Figur' }, { title: 'Briefmarken Sammlung' },
    { title: 'Gold Ring' }, { title: 'Pokemon Nintendo Switch Videospiel' },
    { title: 'Spielzeug', kind: 'case' }, { title: 'LEGO', kind: 'review-pack' },
    { title: 'Notebook', description: 'Für Kinder, Brettspiele und Spielzeug.' },
    { title: 'Konvolut', description: 'Abholung. Versand: Wir versenden auch Spielzeug.' }
  ];
  for (const item of items) assert.notEqual(businessTypeForItem(item), 'toys', item.title);
  assert.equal(auctionSelectionCategory(items[0]), 'Fahrzeuge');
  assert.equal(auctionSelectionCategory(items[3]), 'Elektronik');
});

test('generic lots use toy descriptions or explicit toy categories', () => {
  for (const item of [
    { title: 'Konvolut 12 Teile', description: 'Enthalten sind Puppen, Brettspiele und Puzzles.' },
    { title: 'Konvolut 2', category: 'Spielzeug' },
    { title: 'Konvolut 3', category: 'Toys' },
    { title: 'Konvolut 4', category: 'Spielwaren' }
  ]) {
    assert.equal(auctionSelectionCategory(item), 'Sammlerstücke');
    assert.equal(businessTypeForItem(item), 'toys');
  }
});

test('legacy toy inventory gains shop compatibility without changing frozen market values', () => {
  for (const marketCategory of ['other', 'vehicles', 'household', 'sport_leisure', 'collectibles']) {
    const item = { title: 'Puppenhaus mit Möbeln', category: 'Möbel & Wohnen', marketCategory };
    assert.equal(businessTypeForItem(item), 'toys');
    assert.equal(marketCategoryForItem(item), marketCategory);
  }
  assert.equal(businessTypeForItem({ title: 'Archive stock', businessCategory: 'toys' }), 'toys');
});

const now = Date.parse('2026-10-15T12:00:00Z');
async function fixture(t) {
  const dir = await mkdtemp('/tmp/jg-toy-categories-');
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test('new toy stock pools include newly recognized archive families and exclude unrelated collectibles', async t => {
  const dir = await fixture(t);
  const archive = ['Puppenhaus mit Möbeln', 'BMW M3 1:18', 'Märklin Lokomotive', 'Gesellschaftsspiele', 'Plüschtiere', 'Bronze Figur', 'LEGO Buch']
    .map((title, i) => ({ id: 99000 + i, title, category: 'Sonstiges', finalPrice: 10 + i * 20, image: `/archive/toy-${i}.jpg` }));
  upsertAuctions(dir, archive);
  const catalog = stockPaletteCatalog(dir, { now });
  const offer = catalog.offers.find(item => item.id === 'toys-budget');
  assert.ok(offer);
  assert.deepEqual(new Set(offer.items.map(item => item.auctionId)), new Set(archive.slice(0, 5).map(item => item.id)));
  assert.ok(offer.items.every(item => businessTypeForItem(item) === 'toys'));
  // Existing daily editions and paid/committed stock must not be rerolled.
  upsertAuctions(dir, [{ id: 99999, title: 'Playmobil Burg', finalPrice: 20, image: '/archive/new-toy.jpg' }]);
  assert.deepEqual(stockPaletteCatalog(dir, { now }).offers, catalog.offers);
});

test('expanded toys appear as restock choices and can enter an existing toy shop', async t => {
  const dir = await fixture(t), accounts = new Accounts(dir, { now: () => now });
  accounts.db(db => {
    db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('owner','owner','disabled',100000,400,?)").run(now);
    for (const [i, title] of titles.slice(0, 6).entries()) db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
      .run(`toy-${i}`, 'owner', JSON.stringify({ title, category: 'Sonstiges', marketCategory: 'other', price: 20 }), now);
  });
  const user = { id: 'owner' }, shop = buyBusiness(dir, user, 'toys', 'popup', { now }).shop;
  const available = businessDashboard(dir, user, { now }).inventory.filter(item => item.type === 'toys');
  assert.equal(available.length, 6);
  stockBusiness(dir, user, shop.id, available.map(item => item.id), { now });
  assert.equal(businessDashboard(dir, user, { now }).shops[0].stock.length, 6);
});
