import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { loadCaseStoreCatalog, quoteCaseStore } from '../src/case-store.mjs';
import { CASE_STOCK_LIMIT, CASE_STOCK_WINDOW_MS, withCaseStock } from '../src/case-stock.mjs';
import { closeDataStore } from '../src/database.mjs';
import { marketIndexes } from '../src/market.mjs';

const start = Date.parse('2026-10-08T12:00:00Z');
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-case-stock-'));
  let now = start;
  const accounts = new Accounts(dir, { now: () => now });
  accounts.db(db => {
    for (const id of ['buyer', 'other']) db.prepare(`INSERT INTO users (id, username, password_hash, tokens, created_at)
      VALUES (?, ?, 'disabled', 10000000, ?)`).run(id, id, start);
  });
  const buyer = { id: 'buyer', admin: true }, other = { id: 'other' };
  const catalog = () => loadCaseStoreCatalog(dir, now);
  const quote = () => accounts.db(db => withCaseStock(db, quoteCaseStore(catalog(), marketIndexes(db, now)), now));
  const buy = (user, id, request) => accounts.buyCase(user, catalog(), id, request, quote().revision);
  const state = () => accounts.db(db => ({
    balance: db.prepare('SELECT tokens FROM users WHERE id = ?').get(buyer.id).tokens,
    inventory: db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n,
    receipts: db.prepare('SELECT COUNT(*) AS n FROM case_purchases').get().n,
    stock: db.prepare('SELECT * FROM case_stock ORDER BY case_id').all()
  }));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, buyer, other, catalog, quote, buy, state, setNow: value => { now = value; } };
}

test('direct case stock is global per type, persists on restart and ignores inventory openings', async t => {
  const f = await fixture(t), initial = f.quote();
  assert.ok(initial.cases.every(box => box.stock.remaining === CASE_STOCK_LIMIT));
  assert.equal(initial.cases[0].stock.restocksAt, start + CASE_STOCK_WINDOW_MS);
  let first;
  for (let i = 0; i < CASE_STOCK_LIMIT; i++) {
    const item = f.buy(i % 2 ? f.other : f.buyer, 'lost-property', `global-case-stock-${i}-0001`);
    first ||= item;
  }
  const exhausted = f.state();
  assert.equal(f.quote().cases[0].stock.remaining, 0);
  assert.equal(f.quote().revision, initial.revision, 'stock does not invalidate price quotes');
  assert.throws(() => f.buy(f.buyer, 'lost-property', 'global-case-stock-rejected'), /case_out_of_stock/);
  assert.deepEqual(f.state(), exhausted, 'sold-out purchase cannot charge or grant items');
  assert.deepEqual(f.buy(f.buyer, 'lost-property', 'global-case-stock-0-0001'), first);
  assert.deepEqual(f.state(), exhausted, 'a successful retry works at zero stock');
  f.accounts.openSealedCase(f.buyer, first.id);
  assert.equal(f.quote().cases[0].stock.remaining, 0);
  f.buy(f.buyer, 'vault', 'global-case-stock-vault-0001');
  assert.equal(f.quote().cases.find(box => box.id === 'vault').stock.remaining, 9);
  closeDataStore(f.dir);
  const restarted = new Accounts(f.dir, { now: () => start });
  assert.throws(() => restarted.buyCase(f.other, f.catalog(), 'lost-property', 'restarted-case-stock-0001', initial.revision), /case_out_of_stock/);
  assert.deepEqual(restarted.buyCase(f.buyer, f.catalog(), 'lost-property', 'global-case-stock-0-0001', initial.revision), first);
});

test('stock refills at the exact four-hour boundary without carrying unused units or counting old retries', async t => {
  const f = await fixture(t), first = f.buy(f.buyer, 'lost-property', 'boundary-case-stock-0001');
  f.setNow(start + CASE_STOCK_WINDOW_MS - 1);
  assert.equal(f.quote().cases[0].stock.remaining, 9);
  f.setNow(start + CASE_STOCK_WINDOW_MS);
  assert.equal(f.quote().cases[0].stock.remaining, 10);
  assert.equal(f.quote().cases[0].stock.restocksAt, start + 2 * CASE_STOCK_WINDOW_MS);
  assert.deepEqual(f.buy(f.buyer, 'lost-property', 'boundary-case-stock-0001'), first);
  assert.equal(f.quote().cases[0].stock.remaining, 10);
  f.buy(f.other, 'lost-property', 'boundary-case-stock-0002');
  assert.equal(f.quote().cases[0].stock.remaining, 9);
  assert.equal(f.state().stock.length, 1, 'only the current counter is stored');
  f.setNow(start + 2 * 86400000);
  assert.equal(f.quote().cases[0].stock.remaining, 10, 'edition rotation does not break restocks');
});

test('invalid, unaffordable and rolled-back purchases do not reserve stock', async t => {
  const f = await fixture(t), before = f.state();
  assert.throws(() => f.accounts.buyCase(f.buyer, f.catalog(), 'lost-property', 'invalid-stock-quote-0001', 'old'), /catalog_changed/);
  assert.throws(() => f.buy(f.buyer, 'unknown', 'invalid-stock-type-0001'), /invalid_case/);
  assert.deepEqual(f.state(), before);
  f.accounts.db(db => db.prepare('UPDATE users SET tokens = 0 WHERE id = ?').run(f.buyer.id));
  const broke = f.state();
  assert.throws(() => f.buy(f.buyer, 'lost-property', 'broke-case-stock-0001'), /insufficient_tokens/);
  assert.deepEqual(f.state(), broke);
  f.accounts.db(db => {
    db.prepare('UPDATE users SET tokens = 10000000 WHERE id = ?').run(f.buyer.id);
    db.exec(`CREATE TRIGGER fail_stock_receipt BEFORE INSERT ON case_purchases
      BEGIN SELECT RAISE(ABORT, 'receipt_unavailable'); END`);
  });
  assert.throws(() => f.buy(f.buyer, 'lost-property', 'rollback-case-stock-0001'), /receipt_unavailable/);
  assert.deepEqual(f.state(), before);
  f.accounts.db(db => db.exec('DROP TRIGGER fail_stock_receipt'));
  f.buy(f.buyer, 'lost-property', 'rollback-case-stock-0001');
  assert.equal(f.quote().cases[0].stock.remaining, 9);
  f.accounts.resetEconomy(f.buyer, 'RESET ECONOMY');
  assert.equal(f.quote().cases[0].stock.remaining, 10, 'an explicit economy reset clears stock');
});

test('legacy direct openings share the same category stock across users and keep retries idempotent', async t => {
  const f = await fixture(t), catalog = f.catalog(), box = catalog.cases.find(box => box.id === 'fundkiste');
  let first;
  for (let i = 0; i < CASE_STOCK_LIMIT; i++) {
    const item = f.accounts.openCase(i % 2 ? f.other : f.buyer, catalog, box.id, `legacy-stock-open-${i}-0001`);
    first ||= item;
  }
  const stock = () => f.accounts.db(db => withCaseStock(db, catalog, start).cases.find(box => box.id === 'fundkiste').stock);
  assert.equal(stock().remaining, 0);
  const before = f.state();
  assert.throws(() => f.accounts.openCase(f.other, catalog, box.id, 'legacy-stock-open-rejected'), /case_out_of_stock/);
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.accounts.openCase(f.buyer, catalog, box.id, 'legacy-stock-open-0-0001'), first);
  assert.equal(stock().remaining, 0);
});
