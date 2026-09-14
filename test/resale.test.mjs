import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts, STARTING_TOKENS } from '../src/accounts.mjs';
import { caseCatalog } from '../src/cases.mjs';
import { closeDataStore } from '../src/database.mjs';
import { cancelListing, getResale, listItem, listingsByUser, listResales, placeBid } from '../src/resale.mjs';

const day = Date.parse('2026-09-12T12:00:00Z');
const password = 'resale-foundation-password';
const lots = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `Product ${i + 100}`,
  category: 'Werkzeug', image: `/assets/${i}.jpg`, currentBid: 100 + i }));
const catalog = caseCatalog(lots);
const endsIn = hours => new Date(day + hours * 3600000).toISOString();

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-resale-'));
  let now = day;
  const service = new Accounts(dir, { now: () => now });
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

test('listing references the owned inventory row without copying or minting it', async t => {
  const { dir, service, admin, listing, item } = await listedFixture(t);
  assert.equal(listing.status, 'active');
  assert.equal(listing.sellerId, admin.id);
  assert.equal(listing.startPrice, 50);
  assert.equal(listing.currentBid, null);
  assert.equal(listing.winnerId, null);
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

test('bids escalate transactionally and reject sellers, lowballs and overbudget bidders', async t => {
  const { dir, service, admin, register, listing } = await listedFixture(t);
  const bidder = await register('Bidder');
  const poor = await register('Poor');
  service.db(db => db.prepare('UPDATE users SET tokens = 5 WHERE id = ?').run(poor.id));
  for (const amount of [0, -5, 1.5, '100', null]) {
    assert.throws(() => placeBid(dir, bidder, listing.id, amount, { now: day }), /invalid_bid/);
  }
  assert.throws(() => placeBid(dir, bidder, 'missing-auction', 100, { now: day }), { status: 404 });
  assert.throws(() => placeBid(dir, admin, listing.id, 100, { now: day }), /own_auction/);
  assert.throws(() => placeBid(dir, bidder, listing.id, 49, { now: day }), /bid_too_low/);
  assert.equal(placeBid(dir, bidder, listing.id, 50, { now: day }).currentBid, 50);
  assert.throws(() => placeBid(dir, bidder, listing.id, 50, { now: day }), /bid_too_low/);
  assert.throws(() => placeBid(dir, poor, listing.id, 60, { now: day }), /insufficient_tokens/);
  const raised = placeBid(dir, bidder, listing.id, 51, { now: day + 1000 });
  assert.equal(raised.currentBid, 51);
  assert.deepEqual(raised.bids.map(bid => [bid.amount, bid.bidderUsername]), [[51, 'Bidder'], [50, 'Bidder']]);
  assert.equal(service.profile(bidder).tokens, STARTING_TOKENS);
});

test('cancel releases the item before bids; ended auctions close lazily with a winner', async t => {
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
  const withBid = placeBid(dir, bidder, relisted.id, 10, { now: day + 2000 });
  assert.throws(() => cancelListing(dir, admin, relisted.id, { now: day + 2000 }), /auction_has_bids/);
  // Lazy close on any read: highest bidder wins, nothing is paid or moved yet.
  const closed = getResale(dir, relisted.id, { now: day + 3600_000 });
  assert.equal(closed.status, 'ended');
  assert.equal(closed.winnerId, bidder.id);
  assert.ok(closed.closedAt);
  assert.equal(service.inventory(admin).map(row => row.id).includes(second.id), true);
  assert.equal(service.profile(bidder).tokens, STARTING_TOKENS);
  assert.deepEqual(listResales(dir, { now: day + 3600_000 }), []);
  // A won auction blocks relisting until settlement decides the item's fate.
  assert.throws(() => listItem(dir, admin, { inventoryId: second.id, startPrice: 10, endsAt: endsIn(1) }, { now: advance(1000) }), /item_listed/);
  assert.throws(() => placeBid(dir, bidder, relisted.id, 11, { now: day + 3600_000 }), /auction_ended/);
});
