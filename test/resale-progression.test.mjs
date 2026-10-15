import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { listItem, placeBid, settleAuction } from '../src/resale.mjs';
import { resaleXp } from '../src/xp.mjs';

async function fixture(t) {
  const dir = await mkdtemp('/tmp/jg-resale-progression-');
  let now = Date.parse('2026-10-15T12:00:00Z');
  const accounts = new Accounts(dir, { now: () => now });
  const players = ['alice', 'bob', 'charlie'].map(id => ({ id }));
  accounts.db(db => {
    for (const { id } of players) db.prepare(`INSERT INTO users
      (id,username,password_hash,tokens,created_at) VALUES (?,?,'disabled',1000,?)`).run(id, id, now);
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  const add = (id, owner = players[0]) => accounts.db(db => db.prepare(
    'INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)')
    .run(id, owner.id, JSON.stringify({ title: 'Same physical find', price: 1, sellValue: 1, rarity: 'common' }), now));
  const sell = (seller, buyer, inventoryId, { quantity = 1, price = 1000 } = {}) => {
    const auction = listItem(dir, seller, { inventoryId, quantity, startPrice: price,
      endsAt: new Date(now + 60000).toISOString() }, { now });
    placeBid(dir, buyer, auction.id, price, { now: now + 1 });
    now += 60001;
    settleAuction(dir, auction.id, { now });
    return auction;
  };
  const xp = player => accounts.db(db => db.prepare('SELECT xp FROM users WHERE id=?').get(player.id).xp);
  return { dir, accounts, players, add, sell, xp, now: () => now };
}

test('high-price item cycling across three accounts and restarts grants XP only on its first sale', async t => {
  const f = await fixture(t);
  f.add('cycled');
  const firstXp = resaleXp(1000);
  for (let cycle = 0; cycle < 6; cycle++) {
    const seller = f.players[cycle % 3], buyer = f.players[(cycle + 1) % 3];
    const auction = f.sell(seller, buyer, 'cycled');
    // Replaying settlement and reopening the database must preserve the claim.
    settleAuction(f.dir, auction.id, { now: f.now() });
    closeDataStore(f.dir);
    new Accounts(f.dir, { now: f.now });
    assert.deepEqual(f.players.map(f.xp), [firstXp, 0, 0]);
  }
  const rows = f.accounts.db(db => db.prepare('SELECT tokens FROM users ORDER BY id').all());
  assert.deepEqual(rows.map(row => row.tokens), [1000, 1000, 1000]);
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM resale_xp_items').get().n), 1);
  assert.equal(f.accounts.db(db => db.prepare("SELECT COUNT(*) AS n FROM xp_events WHERE source_type='resale'").get().n), 1);
});

test('legacy batch XP receipts backfill every physical claim while fresh units retain their first-sale XP', async t => {
  const f = await fixture(t), [alice, bob, charlie] = f.players;
  for (const id of ['old-a', 'old-b']) f.add(id);
  const historical = f.sell(alice, bob, 'old-a', { quantity: 2, price: 200 });
  assert.equal(f.xp(alice), resaleXp(200));
  // Simulate reopening a pre-item-claim database with its durable XP receipt.
  f.accounts.db(db => db.exec('DROP TABLE resale_xp_items'));
  closeDataStore(f.dir);
  new Accounts(f.dir, { now: f.now });
  f.sell(bob, charlie, 'old-a', { quantity: 2, price: 200 });
  assert.equal(f.xp(bob), 0);
  const claims = f.accounts.db(db => db.prepare('SELECT inventory_id,auction_id FROM resale_xp_items ORDER BY inventory_id').all());
  assert.deepEqual(claims.map(row => ({ ...row })), [
    { inventory_id: 'old-a', auction_id: historical.id },
    { inventory_id: 'old-b', auction_id: historical.id }
  ]);
  f.add('fresh');
  f.sell(alice, bob, 'fresh', { price: 200 });
  assert.equal(f.xp(alice), 2 * resaleXp(200));
  assert.equal(f.accounts.db(db => db.prepare('SELECT COUNT(*) AS n FROM resale_xp_items').get().n), 3);
});
