import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { auctionSelectionCategory, isCarAuction } from '../src/auction-selection.mjs';
import { classifiedBusinessType } from '../src/item-categories.mjs';
import { businessTypeForItem } from '../src/stock-compatibility.mjs';
import { marketCategoryForItem } from '../src/market.mjs';
import { matchesTheme } from '../src/cases.mjs';
import { Accounts } from '../src/accounts.mjs';
import { buyBusiness, stockBusiness, businessDashboard, advanceShop } from '../src/businesses.mjs';
import { closeDataStore } from '../src/database.mjs';

const titles = ['BMW Reifen', 'Ford Dachfahrradträger', 'Audi Scheinwerfer', 'Ducati Kraftrad',
  'BMW Motorrad', 'E-Scooter', 'Anhänger', 'BMW Motor', 'LKW', 'Honda Civic', 'Suzuki Swift', 'Dacia Duster', 'Unbekanntes Los'];
const now = Date.parse('2026-10-20T12:00:00Z');

test('all vehicle-category finds can stock car lots even when old metadata rejected them', () => {
  for (const title of titles) {
    for (const metadata of [{}, { marketCategory: 'vehicles', businessCategory: null }, { marketCategory: 'other' }]) {
      const item = { title, category: 'Fahrzeuge', price: 100, ...metadata };
      const before = structuredClone(item);
      assert.equal(auctionSelectionCategory(item), 'Fahrzeuge', title);
      assert.equal(classifiedBusinessType(item), 'cars', title);
      assert.equal(businessTypeForItem(item), 'cars', title);
      assert.equal(isCarAuction(item), false, title);
      assert.equal(matchesTheme(item, 'cars'), false, title);
      assert.deepEqual(item, before);
      assert.equal(marketCategoryForItem(item), metadata.marketCategory || 'vehicles');
    }
  }
  for (const item of [{ title: 'BMW Motorrad', kind: 'case' }, { title: 'BMW Reifen', kind: 'review-pack' },
    { title: 'Tom Ford Sonnenbrille' }, { title: 'Modellauto BMW' }]) {
    assert.notEqual(businessTypeForItem({ category: 'Fahrzeuge', ...item }), 'cars', item.title);
  }
});

test('existing vehicle finds appear in restock choices, stock a car lot, and sell to NPCs', async t => {
  const dir = await mkdtemp('/tmp/jg-vehicle-stock-');
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  const accounts = new Accounts(dir, { now: () => now }), user = { id: 'owner' };
  accounts.db(db => {
    db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES('owner','owner','disabled',100000,2500,?)").run(now);
    for (const [i, title] of titles.slice(0, 6).entries()) db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)')
      .run(`vehicle-${i}`, user.id, JSON.stringify({ title, category: 'Fahrzeuge', marketCategory: 'vehicles', businessCategory: null, categoryVersion: 'item_categories_v1', price: 100 }), now);
  });
  const shop = buyBusiness(dir, user, 'cars', 'medium', { now }).shop;
  // A fixed shop ID makes the NPC simulation deterministic across runs.
  accounts.db(db => db.prepare("UPDATE businesses SET id='vehicle-car-lot',plot_id=NULL WHERE id=?").run(shop.id));
  shop.id = 'vehicle-car-lot';
  const available = businessDashboard(dir, user, { now }).inventory;
  assert.equal(available.filter(item => item.type === 'cars').length, 6);
  const before = accounts.db(db => db.prepare('SELECT id,item FROM inventory ORDER BY id').all());
  const stocked = stockBusiness(dir, user, shop.id, available.map(item => item.id), { now });
  assert.equal(stocked.stock.length, 6);
  assert.equal(businessDashboard(dir, user, { now }).inventory.length, 0);
  accounts.db(db => {
    db.prepare("UPDATE businesses SET profit_margin=0,traffic_popularity=1 WHERE id=?").run(shop.id);
    advanceShop(db, db.prepare("SELECT * FROM businesses WHERE id='vehicle-car-lot'").get(), now + 7 * 24 * 3600000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM business_sales').get().n, 6);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE sold_at IS NOT NULL').get().n, 6);
    assert.ok(db.prepare("SELECT cash_balance FROM businesses WHERE id='vehicle-car-lot'").get().cash_balance > 0);
    assert.deepEqual(db.prepare('SELECT id,item FROM inventory ORDER BY id').all(), before);
  });
});
