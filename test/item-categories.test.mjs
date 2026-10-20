import test from 'node:test';
import assert from 'node:assert/strict';
import examples from './fixtures/archive-category-examples.json' with { type: 'json' };
import { auctionSelectionCategory, isCarAuction, isWineAuction, normalizeSelectionText } from '../src/auction-selection.mjs';
import { marketCategoryForAuction } from '../src/market.mjs';
import { businessTypeForItem } from '../src/stock-compatibility.mjs';
import { SELECTION_MARKET_CATEGORIES } from '../src/item-categories.mjs';
import { matchesTheme } from '../src/cases.mjs';

test('hand-reviewed archive product families receive consistent categories and market sectors', () => {
  for (const example of examples) {
    assert.equal(auctionSelectionCategory(example), example.expected, `${example.id}: ${example.title}`);
    assert.equal(marketCategoryForAuction(example), SELECTION_MARKET_CATEGORIES[example.expected], example.title);
  }
});

test('product nouns beat incidental brands, colors, model words and legal boilerplate', () => {
  const rows = [
    ['Tom Ford Sonnenbrille', 'Mode'], ['Francis Ford Coppola Winery Cabernet', 'Getränke'],
    ['Silber Mercedes Benz E320', 'Fahrzeuge'], ['Land Rover Discovery Sport', 'Fahrzeuge'],
    ['Sportkopfhörer Grundig', 'Elektronik'], ['Dior Eau de Parfum mit Tasche', 'Kosmetik'],
    ['Bosch Kreuzlinien-Laser mit Tasche', 'Werkzeuge'], ['Herrenarmbanduhr Sport Evolution', 'Schmuck & Uhren'],
    ['Bild: Ansicht von Montalcino', 'Sammlerstücke'], ['Kaffeevollautomat', 'Haushalt & Garten'],
    ['Kaffeebohnen', 'Getränke'], ['Schweißgerät', 'Werkzeuge'], ['Gartengeräte', 'Haushalt & Garten'],
    ['Porzellan Figur', 'Sammlerstücke'], ['Fotobuch', 'Bücher & Medien'], ['Büchersammlung', 'Bücher & Medien'], ['Dachfahrradträger', 'Fahrzeuge'], ['Fahrradtasche', 'Fahrräder'],
    ['LED-Arbeitsleuchte', 'Haushalt & Garten'], ['AI-Brille Oakley Meta HSTN', 'Elektronik']
  ];
  for (const [title, expected] of rows) assert.equal(auctionSelectionCategory({ title, description: 'Ohne Gewähr. Es gelten die Vorschriften der ZPO. Versand: Bücher und Autos.' }), expected, title);
  assert.equal(auctionSelectionCategory({ title: 'Unbekanntes Los', description: 'Abholung. Unser Standort ist neben dem Autohaus und der Buchhandlung.' }), 'Sonstiges');
  assert.equal(auctionSelectionCategory({ title:'Unbekanntes Los', description:'Es gelten die Bestimmungen der ZPO.' }), 'Sonstiges');
  assert.equal(auctionSelectionCategory({ title: 'Fujitsu Lifebook', description: 'Versteigerung gemäß ZPO § 814.' }), 'Elektronik');
});

test('case themes distinguish cars from other vehicles while stores accept the vehicle category', () => {
  for (const title of ['Mazda 3', 'Cupra Formentor', 'Chevrolet Sport Coupe', 'MINI One', 'Land Rover Discovery']) {
    assert.equal(isCarAuction({ title }), true, title);
    assert.equal(matchesTheme({ title }, 'cars'), true, title);
    assert.equal(businessTypeForItem({ title }), 'cars', title);
  }
  for (const [title, type] of [['BMW Reifen', 'cars'], ['Ford Dachfahrradträger', 'cars'], ['Audi Scheinwerfer', 'cars'], ['Ducati Kraftrad', 'cars'], ['Ford Modellauto', 'toys'], ['Tom Ford Brille', null]]) {
    assert.equal(isCarAuction({ title }), false, title);
    assert.equal(businessTypeForItem({ title }), type, title);
  }
  for (const title of ['Kaffee', 'Whisky', 'Rum', 'Tee', 'Wodka']) {
    assert.equal(isWineAuction({ title }), false, title);
    assert.equal(matchesTheme({ title }, 'wine'), false, title);
  }
  const wine={ title:'Ferrari Trento Brut', description:'6 Flaschen, Jahrgang 2021, Alkoholgehalt 12%, Trinkbarkeit bis 2030' };
  assert.equal(isWineAuction(wine), true);
  assert.equal(isCarAuction(wine), false);
  assert.equal(businessTypeForItem(wine), 'wine');
});

test('fallback aliases keep uncommon items categorized without guessing from IDs', () => {
  for (const [source, expected] of [['tools','Werkzeuge'],['electronics','Elektronik'],['Sport & Freizeit','Sport & Freizeit'],['furniture','Möbel & Wohnen'],['fashion','Mode']]) {
    assert.equal(auctionSelectionCategory({ title:'Unbekanntes Los', category:source }), expected);
  }
  assert.equal(auctionSelectionCategory({ id:211623,title:'Unbekanntes Los' }), 'Sonstiges');
  assert.equal(normalizeSelectionText('H&#xFC;lle &lpar;Größe&rpar;'), 'hulle grosse');
  assert.equal(auctionSelectionCategory({ title:'Bohrschrauber f&#xFC;r Profis' }), 'Werkzeuge');
  assert.equal(auctionSelectionCategory({ title:'B&uuml;cher &lpar;Sammlung&rpar;', category:'Bücher & Medien' }), 'Bücher & Medien');
});
