import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts, STARTING_TOKENS } from '../src/accounts.mjs';
import { caseCatalog } from '../src/cases.mjs';
import { closeDataStore } from '../src/database.mjs';
import {
  cancelListing, getResale, listItem, listingsByUser, listResales,
  placeBid, settleAuction, settleDueListings
} from '../src/resale.mjs';

const day = Date.parse('2026-09-12T12:00:00Z');
const hour = 3600_000;
const password = 'resale-foundation-password';
const lots = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `Product ${i + 100}`,
  category: 'Werkzeug', image: `/assets/${i}.jpg`, currentBid: 100 + i }));
const catalog = caseCatalog(lots);
const endsIn = hours => new Date(day + hours * hour).toISOString();
const endsAfter = (base, hours) => new Date(base + hours * hour).toISOString();

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-resale-'));
  let now = day;
  const service = new Accounts(dir, { flags: { resales: false }, now: () => now });
  await service.bootstrap('admin', password);
  const admin = service.user(await service.login({ username: 'admin', password }));
  const register = async username => service.user(await service.register({ username, password, code: service.codes(admin, 1)[0] }));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, service, admin, register, advance: ms => { now += ms; return now; } };
}

async function listedFixture(t) {
  const fixture_ = await fixture(t);
  const item = fixture_.service.openCase(fixture_.admin, catalog, 'fundkiste', 'resale-listing-0001');
  const listing = listItem(fixture_.dir, fixture_.admin,
    { inventoryId: item.id, startPrice: 50, endsAt: endsIn(24) }, { now: day });
  return { ...fixture_, item, listing };
}

// An auction that expired with a winning bid but has not been settled yet.
// Mutation paths (listing/bidding/cancelling) lazily close due auctions
// without settling them, so this state is reachable exactly like in
// production — no SQL tricks needed. The closing trigger is a second listing
// of a synthetic item whose identity cannot collide with the item under test.
async function wonUnsettledFixture(t, { amount = 60 } = {}) {
  const fixture_ = await listedFixture(t);
  const bidder = await fixture_.register('Bidder');
  placeBid(fixture_.dir, bidder, fixture_.listing.id, amount, { now: day + 1000 });
  const closeTime = day + 25 * hour;
  fixture_.service.db(db => {
    const stored = db.prepare('SELECT item, created_at FROM inventory WHERE id = ?').get(fixture_.item.id);
    const unique = { ...JSON.parse(stored.item), title: 'Settlement Distractor' };
    db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run('settlement-distractor', fixture_.admin.id, JSON.stringify(unique), stored.created_at);
  });
  listItem(fixture_.dir, fixture_.admin,
    { inventoryId: 'settlement-distractor', startPrice: 10, endsAt: endsAfter(closeTime, 48) }, { now: closeTime });
  return { ...fixture_, bidder, amount, closeTime };
}

const tokensOf = (service, user) => service.profile(user).tokens;
const totalTokens = service => service.db(db => db.prepare('SELECT SUM(tokens) AS sum FROM users').get().sum);
// node:sqlite returns null-prototype rows; normalize so deepEqual works.
const inventoryRow = (service, id) => {
  const row = service.db(db => db.prepare('SELECT user_id, sold_at FROM inventory WHERE id = ?').get(id));
  return row ? { user_id: row.user_id, sold_at: row.sold_at } : row;
};
const rowCount = (service, table, where, ...params) =>
  service.db(db => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params).count);

test('listing references the owned inventory row without copying or minting it', async t => {
  const { dir, service, admin, listing, item } = await listedFixture(t);
  assert.equal(listing.status, 'active');
  assert.equal(listing.sellerId, admin.id);
  assert.equal(listing.startPrice, 50);
  assert.equal(listing.currentBid, null);
  assert.equal(listing.winnerId, null);
  assert.equal(listing.settledAt, null);
  assert.deepEqual(listing.item, { title: item.title, image: item.image, price: item.price,
    rarity: item.rarity, marketCategory: item.marketCategory });
  // Exactly one inventory row exists, still owned by the seller.
  const rows = service.db(db => db.prepare('SELECT COUNT(*) AS count FROM inventory WHERE id = ?').get(item.id));
  assert.equal(rows.count, 1);
  const owner = service.db(db => db.prepare('SELECT user_id, sold_at FROM inventory WHERE id = ?').get(item.id));
  assert.equal(owner.user_id, admin.id);
  assert.equal(owner.sold_at, null);
  assert.deepEqual(listResales(dir, { now: day }).map(row => row.id), [listing.id]);
});

test('selling, relisting and foreign listings are blocked while an auction is live', async t => {
  const { dir, service, admin, register, item, listing } = await listedFixture(t);
  const other = await register('Other');
  assert.throws(() => service.sell(admin, item.id), /item_listed/);
  assert.throws(() => service.sellAll(admin, item.id), /item_listed/);
  // Someone else's inventory row is invisible to the listing call.
  assert.throws(() => listItem(dir, other, { inventoryId: item.id, startPrice: 50, endsAt: endsIn(1) }, { now: day }), { status: 404 });
  // The unique active listing per item blocks a second listing, even in a race.
  assert.throws(() => listItem(dir, admin, { inventoryId: item.id, startPrice: 60, endsAt: endsIn(2) }, { now: day }), /item_listed/);
  assert.equal(listResales(dir, { now: day }).length, 1);
  assert.deepEqual(listingsByUser(dir, admin.id, { now: day }).map(row => row.id), [listing.id]);
  assert.deepEqual(listingsByUser(dir, other.id, { now: day }), []);
});

test('sold items cannot be listed and invalid listings are rejected wholesale', async t => {
  const { dir, service, admin } = await fixture(t);
  const item = service.openCase(admin, catalog, 'fundkiste', 'resale-sold-0001');
  service.sell(admin, item.id);
  assert.throws(() => listItem(dir, admin, { inventoryId: item.id, startPrice: 50, endsAt: endsIn(1) }, { now: day }), /item_sold/);
  assert.throws(() => listItem(dir, admin, { inventoryId: 'missing', startPrice: 50, endsAt: endsIn(1) }, { now: day }), { status: 404 });
  for (const input of [{ startPrice: 0 }, { startPrice: 1.5 }, { startPrice: '50' }, { startPrice: null }]) {
    assert.throws(() => listItem(dir, admin, { inventoryId: item.id, endsAt: endsIn(1), ...input }, { now: day }), /invalid_listing/);
  }
  for (const endsAt of [undefined, '', 'nope', new Date(day + 30_000).toISOString(), new Date(day + 40 * 86400000).toISOString()]) {
    assert.throws(() => listItem(dir, admin, { inventoryId: item.id, startPrice: 50, endsAt }, { now: day }), /invalid_listing/);
  }
  assert.deepEqual(listResales(dir, { now: day }), []);
});

test('bids escrow exact amounts, refund on outbid, charge only the difference on raises, and rejected bids change nothing', async t => {
  const { dir, service, admin, register } = await fixture(t);
  const first = service.openCase(admin, catalog, 'fundkiste', 'escrow-item-000001');
  const second = service.openCase(admin, catalog, 'fundkiste', 'escrow-item-000002');
  const a = listItem(dir, admin, { inventoryId: first.id, startPrice: 50, endsAt: endsIn(24) }, { now: day });
  const b = listItem(dir, admin, { inventoryId: second.id, startPrice: 50, endsAt: endsIn(24) }, { now: day });
  const bidder = await register('Bidder'), rival = await register('Rival');
  const totalBefore = totalTokens(service);
  const bidderStart = tokensOf(service, bidder), rivalStart = tokensOf(service, rival);
  // Nonsense amounts and the seller's own bid never reach the escrow logic.
  for (const amount of [0, -5, 1.5, '100', null]) {
    assert.throws(() => placeBid(dir, bidder, a.id, amount, { now: day }), /invalid_bid/);
  }
  assert.throws(() => placeBid(dir, bidder, 'missing-auction', 100, { now: day }), { status: 404 });
  assert.throws(() => placeBid(dir, admin, a.id, 100, { now: day }), /own_auction/);
  assert.throws(() => placeBid(dir, bidder, a.id, 49, { now: day }), /bid_too_low/);
  // First bid deducts exactly 500 tokens.
  placeBid(dir, bidder, a.id, 500, { now: day });
  assert.equal(tokensOf(service, bidder), bidderStart - 500);
  // The escrowed 500 cannot be spent elsewhere.
  assert.throws(() => placeBid(dir, bidder, b.id, 600, { now: day }), /insufficient_tokens/);
  assert.equal(getResale(dir, b.id, { now: day }).currentBid, null);
  assert.equal(getResale(dir, b.id, { now: day }).bidCount, 0);
  // Raising the same bid charges only the 200-token difference.
  placeBid(dir, bidder, a.id, 700, { now: day + 1000 });
  assert.equal(tokensOf(service, bidder), bidderStart - 700);
  assert.throws(() => placeBid(dir, bidder, a.id, 700, { now: day + 1500 }), /bid_too_low/);
  // A different bidder's outbid refunds the previous escrow to the token.
  placeBid(dir, rival, a.id, 900, { now: day + 2000 });
  assert.equal(tokensOf(service, bidder), bidderStart);
  assert.equal(tokensOf(service, rival), rivalStart - 900);
  const escalated = getResale(dir, a.id, { now: day + 3000 });
  assert.equal(escalated.currentBid, 900);
  assert.deepEqual(escalated.bids.map(bid => [bid.amount, bid.bidderUsername]),
    [[900, 'Rival'], [700, 'Bidder'], [500, 'Bidder']]);
  // While the auction is live, exactly the current bid is out of circulation.
  assert.equal(totalTokens(service), totalBefore - 900);
  // A rejected bid leaves balances, current bid and history untouched.
  const poor = await register('Poor');
  service.db(db => db.prepare('UPDATE users SET tokens = 5 WHERE id = ?').run(poor.id));
  assert.throws(() => placeBid(dir, poor, a.id, 901, { now: day + 4000 }), /insufficient_tokens/);
  assert.equal(tokensOf(service, poor), 5);
  assert.equal(tokensOf(service, rival), rivalStart - 900);
  const unchanged = getResale(dir, a.id, { now: day + 5000 });
  assert.equal(unchanged.currentBid, 900);
  assert.equal(unchanged.bidCount, 3);
  const top = unchanged.bids[0];
  assert.equal(top.amount, 900);
  assert.equal(top.bidderId, rival.id);
  assert.equal(top.bidderUsername, 'Rival');
  assert.equal(top.createdAt, day + 2000);
});

test('won auctions settle lazily: item transfers, seller is paid, winner is never charged again', async t => {
  const { dir, service, admin, register, item, listing, advance } = await listedFixture(t);
  const bidder = await register('Bidder');
  assert.throws(() => cancelListing(dir, bidder, listing.id, { now: day }), { status: 404 });
  const cancelled = cancelListing(dir, admin, listing.id, { now: day + 1000 });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(listResales(dir, { now: day + 1000 }), []);
  // The released item can be sold again, and a cancelled auction can be relisted.
  service.sell(admin, item.id);
  const second = service.openCase(admin, catalog, 'fundkiste', 'resale-listing-0002');
  const relisted = listItem(dir, admin, { inventoryId: second.id, startPrice: 10, endsAt: endsIn(1) }, { now: day + 2000 });
  placeBid(dir, bidder, relisted.id, 10, { now: day + 2000 });
  assert.throws(() => cancelListing(dir, admin, relisted.id, { now: day + 2000 }), /auction_has_bids/);
  // Lazy close + settle on any read: the escrow becomes the seller's payout.
  const sellerBefore = tokensOf(service, admin), bidderBefore = tokensOf(service, bidder);
  const closed = getResale(dir, relisted.id, { now: day + 2 * hour });
  assert.equal(closed.status, 'ended');
  assert.equal(closed.winnerId, bidder.id);
  assert.ok(closed.closedAt);
  assert.ok(closed.settledAt >= closed.closedAt);
  assert.equal(tokensOf(service, bidder), bidderBefore); // paid at bid time, not at settlement
  assert.equal(tokensOf(service, admin), sellerBefore + 10);
  // The same inventory row moved — nothing was copied, minted or marked sold.
  assert.equal(rowCount(service, 'inventory', 'id = ?', second.id), 1);
  assert.deepEqual(inventoryRow(service, second.id), { user_id: bidder.id, sold_at: null });
  assert.equal(service.inventory(admin).map(row => row.id).includes(second.id), false);
  assert.equal(service.inventory(bidder).map(row => row.id).includes(second.id), true);
  assert.deepEqual(listResales(dir, { now: day + 2 * hour }), []);
  // The settled winner may relist the item; the old seller may not.
  const winnerNow = advance(1000);
  assert.throws(() => listItem(dir, admin, { inventoryId: second.id, startPrice: 10, endsAt: endsAfter(winnerNow, 1) }, { now: winnerNow }), { status: 404 });
  const byWinner = listItem(dir, bidder, { inventoryId: second.id, startPrice: 20, endsAt: endsAfter(winnerNow, 1) }, { now: winnerNow });
  assert.equal(byWinner.status, 'active');
  // History stays intact: the original auction still shows its winner and bids.
  const history = getResale(dir, relisted.id, { now: winnerNow + 1000 });
  assert.equal(history.status, 'ended');
  assert.equal(history.winnerId, bidder.id);
  assert.equal(history.bidCount, 1);
  assert.ok(history.settledAt);
  assert.throws(() => placeBid(dir, bidder, relisted.id, 11, { now: winnerNow }), /auction_ended/);
});

test('expiring without bids settles bookkeeping only: the seller keeps the item and no tokens move', async t => {
  const { dir, service, admin, item, listing } = await listedFixture(t);
  const tokensBefore = tokensOf(service, admin), totalBefore = totalTokens(service);
  const closed = getResale(dir, listing.id, { now: day + 25 * hour });
  assert.equal(closed.status, 'ended');
  assert.equal(closed.winnerId, null);
  assert.equal(closed.bidCount, 0);
  assert.ok(closed.settledAt);
  assert.equal(tokensOf(service, admin), tokensBefore);
  assert.equal(totalTokens(service), totalBefore);
  // No escrow ever existed, so the item is immediately usable again.
  assert.deepEqual(inventoryRow(service, item.id), { user_id: admin.id, sold_at: null });
  const relisted = listItem(dir, admin, { inventoryId: item.id, startPrice: 5, endsAt: endsIn(27) }, { now: day + 26 * hour });
  assert.equal(relisted.status, 'active');
  assert.throws(() => service.sell(admin, item.id), /item_listed/);
  cancelListing(dir, admin, relisted.id, { now: day + 26 * hour + 1000 });
  service.sell(admin, item.id);
});

test('settlement is idempotent: repeat calls never pay, transfer or settle twice', async t => {
  const { dir, service, admin, bidder, item, listing, amount, closeTime } = await wonUnsettledFixture(t);
  // The mutation path closed the auction; settlement has not run.
  const state = service.db(db => db.prepare('SELECT status, winner_id, settled_at FROM resale_auctions WHERE id = ?').get(listing.id));
  assert.equal(state.status, 'ended');
  assert.equal(state.winner_id, bidder.id);
  assert.equal(state.settled_at, null);
  const sellerBefore = tokensOf(service, admin), winnerBefore = tokensOf(service, bidder);
  const first = settleAuction(dir, listing.id, { now: closeTime });
  assert.equal(first.status, 'ended');
  assert.ok(first.settledAt);
  assert.equal(tokensOf(service, admin), sellerBefore + amount);
  assert.deepEqual(inventoryRow(service, item.id), { user_id: bidder.id, sold_at: null });
  // Calling again — directly and through the sweep — changes nothing.
  const second = settleAuction(dir, listing.id, { now: closeTime + hour });
  assert.equal(second.settledAt, first.settledAt);
  assert.equal(tokensOf(service, admin), sellerBefore + amount);
  assert.equal(tokensOf(service, bidder), winnerBefore);
  assert.equal(rowCount(service, 'inventory', 'id = ?', item.id), 1);
  assert.deepEqual(inventoryRow(service, item.id), { user_id: bidder.id, sold_at: null });
  assert.equal(rowCount(service, 'resale_bids', 'auction_id = ?', listing.id), 1);
  assert.deepEqual(settleDueListings(dir, { now: closeTime + 2 * hour }), { settled: 0, failed: [] });
  assert.equal(tokensOf(service, admin), sellerBefore + amount);
  assert.equal(tokensOf(service, bidder), winnerBefore);
});

test('ended-but-unsettled winners block instant sale, sell-all and relisting until settlement', async t => {
  const { dir, service, admin, bidder, item, listing, closeTime } = await wonUnsettledFixture(t);
  // An identical unsold copy makes the sell-all group refuse the whole batch.
  service.db(db => {
    const stored = db.prepare('SELECT item, created_at FROM inventory WHERE id = ?').get(item.id);
    db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run('identical-copy', admin.id, stored.item, stored.created_at);
  });
  const copyValue = service.db(db => JSON.parse(
    db.prepare('SELECT item FROM inventory WHERE id = ?').get('identical-copy').item).sellValue);
  assert.throws(() => service.sell(admin, item.id), /item_listed/);
  assert.throws(() => service.sellAll(admin, 'identical-copy'), /item_listed/);
  assert.throws(() => listItem(dir, admin, { inventoryId: item.id, startPrice: 10, endsAt: endsAfter(closeTime, 1) }, { now: closeTime }), /item_listed/);
  assert.equal(inventoryRow(service, item.id).user_id, admin.id);
  settleAuction(dir, listing.id, { now: closeTime });
  // Ownership has moved; the settled row no longer blocks anyone's disposal.
  assert.throws(() => service.sell(admin, item.id), { status: 404 });
  assert.deepEqual(service.sellAll(admin, 'identical-copy'), { sold: ['identical-copy'], value: copyValue });
  assert.ok(service.sell(bidder, item.id).sold);
});

test('settleAuction rejects live auctions, ignores cancelled ones and unknown ids', async t => {
  const { dir, service, admin, item, listing } = await listedFixture(t);
  const before = tokensOf(service, admin);
  assert.throws(() => settleAuction(dir, listing.id, { now: day }), /auction_still_active/);
  assert.throws(() => settleAuction(dir, 'missing', { now: day }), { status: 404 });
  cancelListing(dir, admin, listing.id, { now: day });
  const cancelled = settleAuction(dir, listing.id, { now: day + 1000 });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.settledAt, null);
  assert.equal(tokensOf(service, admin), before);
  assert.deepEqual(inventoryRow(service, item.id), { user_id: admin.id, sold_at: null });
  assert.deepEqual(settleDueListings(dir, { now: day + 1000 }), { settled: 0, failed: [] });
});

test('settleDueListings settles every due auction independently and reports corrupted ones without destroying tokens', async t => {
  const { dir, service, admin, register } = await fixture(t);
  const winner = await register('Winner');
  const sold = service.openCase(admin, catalog, 'fundkiste', 'sweep-item-000001');
  const unsold = service.openCase(admin, catalog, 'fundkiste', 'sweep-item-000002');
  const withBid = listItem(dir, admin, { inventoryId: sold.id, startPrice: 10, endsAt: endsIn(1) }, { now: day });
  const bidFree = listItem(dir, admin, { inventoryId: unsold.id, startPrice: 10, endsAt: endsIn(1) }, { now: day });
  placeBid(dir, winner, withBid.id, 25, { now: day });
  // Close both lazily through a mutation path, then corrupt the won escrow.
  const sweepTime = day + 2 * hour;
  const distractor = service.openCase(admin, catalog, 'fundkiste', 'sweep-item-000003');
  listItem(dir, admin, { inventoryId: distractor.id, startPrice: 1, endsAt: endsAfter(sweepTime, 48) }, { now: sweepTime });
  service.db(db => db.prepare('UPDATE resale_auctions SET current_bidder_id = ? WHERE id = ?').run(admin.id, withBid.id));
  const winnerBefore = tokensOf(service, winner), totalBefore = totalTokens(service);
  const result = settleDueListings(dir, { now: sweepTime });
  assert.deepEqual(result, { settled: 1, failed: [withBid.id] });
  // The healthy auction settled completely.
  const settledRow = getResale(dir, bidFree.id, { now: sweepTime });
  assert.equal(settledRow.status, 'ended');
  assert.ok(settledRow.settledAt);
  assert.deepEqual(inventoryRow(service, unsold.id), { user_id: admin.id, sold_at: null });
  // The corrupted one stays ended-but-unsettled and locked; no tokens moved.
  const corrupted = service.db(db => db.prepare('SELECT status, settled_at FROM resale_auctions WHERE id = ?').get(withBid.id));
  assert.equal(corrupted.status, 'ended');
  assert.equal(corrupted.settled_at, null);
  assert.equal(inventoryRow(service, sold.id).user_id, admin.id);
  assert.equal(tokensOf(service, winner), winnerBefore);
  assert.equal(totalTokens(service), totalBefore); // the winner's escrow is held, not destroyed
  assert.throws(() => listItem(dir, admin, { inventoryId: sold.id, startPrice: 10, endsAt: endsAfter(sweepTime, 1) }, { now: sweepTime }), /item_listed/);
  assert.throws(() => settleAuction(dir, withBid.id, { now: sweepTime }), /escrow_inconsistent/);
});

test('foundation-era auctions with advisory bids are cancelled once, without moving tokens', async t => {
  const { dir, service, admin, register, item, listing } = await listedFixture(t);
  const bidder = await register('Bidder');
  const totalBefore = totalTokens(service);
  // Rewind the schema to the foundation version: no settled_at column, and a
  // high bid that never escrowed anything (foundation bids were advisory only).
  service.db(db => {
    db.exec('ALTER TABLE resale_auctions DROP COLUMN settled_at');
    db.prepare('INSERT INTO resale_bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(listing.id, bidder.id, 60, day);
    db.prepare('UPDATE resale_auctions SET current_bid = 60, current_bidder_id = ? WHERE id = ?').run(bidder.id, listing.id);
  });
  // The next schema touch performs the one-time cleanup.
  const migrated = settleDueListings(dir, { now: day });
  assert.deepEqual(migrated, { settled: 0, failed: [] });
  const after = getResale(dir, listing.id, { now: day });
  assert.equal(after.status, 'cancelled');
  assert.equal(after.winnerId, null);
  assert.equal(after.settledAt, null);
  assert.equal(after.bidCount, 1); // bid history is preserved
  assert.equal(totalTokens(service), totalBefore); // nothing was escrowed, so nothing is refunded
  // The released item can be relisted, and new bids escrow properly.
  const relisted = listItem(dir, admin, { inventoryId: item.id, startPrice: 10, endsAt: endsIn(1) }, { now: day + 1000 });
  placeBid(dir, bidder, relisted.id, 10, { now: day + 1000 });
  assert.equal(tokensOf(service, bidder), STARTING_TOKENS - 10);
});

test('bids and settlement conserve tokens across a full lifecycle and survive restart', async t => {
  const fixture_ = await fixture(t);
  const { dir, service, admin, register } = fixture_;
  const bidder = await register('Bidder');
  const item = service.openCase(admin, catalog, 'fundkiste', 'lifecycle-000001');
  const listing = listItem(dir, admin, { inventoryId: item.id, startPrice: 100, endsAt: endsIn(2) }, { now: day });
  const totalBefore = totalTokens(service);
  placeBid(dir, bidder, listing.id, 120, { now: day });
  assert.equal(totalTokens(service), totalBefore - 120); // held by the auction, not destroyed
  settleAuction(dir, listing.id, { now: day + 3 * hour });
  assert.equal(totalTokens(service), totalBefore); // released to the seller
  const settledAt = service.db(db => db.prepare('SELECT settled_at FROM resale_auctions WHERE id = ?').get(listing.id).settled_at);
  // Everything survives a restart, and settlement cannot run a second time.
  closeDataStore(dir);
  const reopened = new Accounts(dir, { flags: { resales: false }, now: () => day + 4 * hour });
  assert.deepEqual(settleDueListings(dir, { now: day + 4 * hour }), { settled: 0, failed: [] });
  assert.equal(reopened.profile(admin).tokens, tokensOf(service, admin));
  assert.equal(reopened.profile(bidder).tokens, tokensOf(service, bidder));
  assert.deepEqual(inventoryRow(reopened, item.id), { user_id: bidder.id, sold_at: null });
  assert.equal(reopened.db(db => db.prepare('SELECT settled_at FROM resale_auctions WHERE id = ?').get(listing.id).settled_at), settledAt);
});
