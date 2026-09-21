import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts, STARTING_TOKENS } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { loadPaletteCatalog, bundleReferencePricing } from '../src/palette-definitions.mjs';
import { saveNewsEvent } from '../src/news.mjs';
import { notificationsForUser } from '../src/notifications.mjs';
import {
  bidOnPaletteAuction, createPaletteAuction, ensurePaletteAuctionSchema, getPaletteAuction,
  getPaletteAuctionRewards, listPaletteAuctions, levelForXp, paletteBidIncrement, settlePaletteAuction
} from '../src/palette-auctions.mjs';

const hour = 3600_000;
const day = Date.parse('2026-09-12T12:00:00Z');
const password = 'palette-auctions-password';
const themes = [
  ['Elektronik', 'Laptop Lenovo', 40], ['Werkzeuge', 'Bohrhammer Makita', 20],
  ['Getränke', 'Riesling Wein', 8], ['Fahrzeuge', 'BMW PKW', 500],
  ['Schmuck & Uhren', 'Gold Armbanduhr', 90], ['Sammlerstücke', 'Lego Modell', 15]
];
const stock = themes.flatMap(([category, title, price], index) =>
  Array.from({ length: 12 }, (_, n) => ({ id: index * 100 + n + 1000, title: `${title} ${index * 100 + n + 1000}`,
    category, currentBid: price * (n + 1), image: `/assets/${category}.jpg` })));

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-primary-'));
  upsertAuctions(dir, stock);
  withDatabase(dir, db => ensurePaletteAuctionSchema(db, day));
  let now = day;
  const service = new Accounts(dir, { flags: { resales: false }, now: () => now });
  await service.bootstrap('admin', password);
  const admin = service.user(await service.login({ username: 'admin', password }));
  const register = async username => service.user(await service.register({ username, password, code: service.codes(admin, 1)[0] }));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, service, admin, register, advance: ms => { now += ms; return now; }, at: () => now };
}

// A deterministic draw source: every roll lands on the first option, so all
// three rewards are the pool's first common item — replacement proven.
const alwaysFirst = () => 0;
const baseEdition = (dir, paletteId = 'fundkiste', now = day) => {
  const entry = loadPaletteCatalog(dir, { now }).palettes.find(palette => palette.id === paletteId);
  assert.equal(entry.kind, 'base');
  assert.ok(entry.available, `${paletteId} edition must be usable for fixtures`);
  return entry;
};
const rows = (dir, sql, ...params) => withDatabase(dir, db => db.prepare(sql).all(...params));
const count = (dir, sql, ...params) => withDatabase(dir, db => db.prepare(sql).get(...params).count);
const tokensOf = (service, user) => service.profile(user).tokens;
// Conservation: all user balances plus unsettled primary escrow.
const conservedTotal = dir => withDatabase(dir, db => ({
  users: db.prepare('SELECT COALESCE(SUM(tokens), 0) AS sum FROM users').get().sum,
  escrow: db.prepare('SELECT COALESCE(SUM(current_bid), 0) AS sum FROM primary_palette_auctions WHERE settled_at IS NULL').get().sum }));

test('minimum raises tier with the reserve: J€ 5 under 100, capped at J€ 25', () => {
  assert.equal(paletteBidIncrement(1), 5);
  assert.equal(paletteBidIncrement(99), 5);
  assert.equal(paletteBidIncrement(100), 10);
  assert.equal(paletteBidIncrement(249), 10);
  assert.equal(paletteBidIncrement(250), 15);
  assert.equal(paletteBidIncrement(499), 15);
  assert.equal(paletteBidIncrement(500), 20);
  assert.equal(paletteBidIncrement(999), 20);
  assert.equal(paletteBidIncrement(1000), 25);
  assert.equal(paletteBidIncrement(1_000_000), 25);
});

test('level thresholds follow 100·(level−1)² up to the cap', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(399), 2);
  assert.equal(levelForXp(400), 3);
  assert.equal(levelForXp(900), 4);
  assert.equal(levelForXp(36100), 20);
  assert.equal(levelForXp(999_999), 20); // capped
});

test('creation freezes a one-hour sealed lot with recomputed bundle reserve and hidden draws', async t => {
  const { dir, at } = await fixture(t);
  const edition = baseEdition(dir);
  const lot = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'primary-lot-00000001' },
    { now: at(), random: alwaysFirst });
  assert.equal(lot.status, 'active');
  assert.equal(lot.editionId, edition.editionId);
  assert.equal(lot.rewardCount, 3);
  assert.equal(lot.currentBid, null);
  assert.equal(lot.bidCount, 0);
  assert.equal(lot.endsAt - lot.startedAt, hour); // exactly one hour
  assert.equal(lot.startedAt, at());
  // The reserve is the corrected THREE-item bundle pricing at creation time
  // (neutral market here), recomputed from the frozen pool — not a stored value.
  const [row] = rows(dir, 'SELECT * FROM palette_editions WHERE id = ?', edition.editionId);
  const payload = JSON.parse(row.payload_json);
  const expected = bundleReferencePricing(payload.items, () => 100, 3);
  assert.equal(lot.reserve, expected.referenceReserve);
  assert.ok(lot.reserve > 0 && Number.isSafeInteger(lot.reserve));
  assert.equal(lot.items.length, payload.items.length); // the candidate pool is public
  // Three hidden rewards with distinct reserved inventory ids; no inventory
  // rows exist before settlement.
  const rewards = rows(dir, 'SELECT position, inventory_id, item_json FROM primary_palette_rewards ORDER BY position');
  assert.equal(rewards.length, 3);
  assert.deepEqual(rewards.map(reward => reward.position), [0, 1, 2]);
  assert.equal(new Set(rewards.map(reward => reward.inventory_id)).size, 3);
  // With replacement: alwaysFirst draws the identical pool item three times.
  const snapshots = rewards.map(reward => JSON.parse(reward.item_json));
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[1], snapshots[2]);
  assert.ok(payload.items.some(item => JSON.stringify(item) === JSON.stringify(snapshots[0])));
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM inventory'), 0);
});

test('creation replays by requestId across restart without repricing or rerolling', async t => {
  const { dir, at } = await fixture(t);
  const edition = baseEdition(dir);
  const first = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'primary-lot-00000002' },
    { now: at(), random: alwaysFirst });
  assert.equal(first.story.fictional, true);
  assert.equal(typeof first.story.parody, 'boolean');
  assert.ok(first.story.title && first.story.titleDe && first.story.body && first.story.bodyDe);
  const rewardsBefore = rows(dir, 'SELECT inventory_id, item_json FROM primary_palette_rewards ORDER BY position');
  closeDataStore(dir);
  // Replay long after expiry, with a market that has moved in between.
  saveNewsEvent(dir, { id: 'market-move', title: 'T', body: 'B', status: 'published',
    marketEffects: [{ category: 'electronics', direction: 'up', magnitude: 20 }] }, { now: at() + 30 * hour });
  const replay = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'primary-lot-00000002' },
    { now: at() + 30 * hour, random: alwaysFirst });
  assert.deepEqual(replay, first);
  assert.deepEqual(rows(dir, 'SELECT inventory_id, item_json FROM primary_palette_rewards ORDER BY position'), rewardsBefore);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM primary_palette_auctions'), 1);
  // Same requestId with a different edition is a conflict.
  const other = baseEdition(dir, 'tools');
  assert.throws(() => createPaletteAuction(dir, { editionId: other.editionId, requestId: 'primary-lot-00000002' },
    { now: at(), random: alwaysFirst }), { status: 409, message: 'request_conflict' });
  for (const requestId of ['short', 'x'.repeat(81), 'has spaces here!!', 42, null]) {
    assert.throws(() => createPaletteAuction(dir, { editionId: edition.editionId, requestId },
      { now: at(), random: alwaysFirst }), /invalid_request/);
  }
});

test('creation rejects missing, unavailable, scheduled, expiring and expired editions', async t => {
  const { dir, at, advance } = await fixture(t);
  assert.throws(() => createPaletteAuction(dir, { editionId: 'base:fundkiste:1999-01-01', requestId: 'primary-lot-00000003' },
    { now: at(), random: alwaysFirst }), { status: 404, message: 'palette_edition_not_found' });
  // A fabricated "available" edition whose uniform values fail the live
  // spread check: creation recomputes instead of trusting the payload.
  withDatabase(dir, db => {
    db.prepare(`INSERT INTO palette_editions (id, palette_id, event_id, rotation_date, starts_at, ends_at, payload_json)
      VALUES (?, ?, NULL, ?, ?, ?, ?)`).run('base:fake:2026-09-12', 'fake', '2026-09-12',
      Date.parse('2026-09-12T00:00:00Z'), Date.parse('2026-09-13T00:00:00Z'), JSON.stringify({
        paletteId: 'fake', definitionVersion: 1, kind: 'base', name: 'F', nameDe: 'F', badge: 'F',
        story: { title: 'S', body: 'B', fictional: true }, allowedMarketCategories: null, legacyTheme: 'mixed',
        rewardCount: 3, requiredLevel: 1, available: true, availabilityReason: null,
        valuationAt: day, pricingVersion: 2, weights: [5000, 3500, 1200, 290, 10],
        pricing: { e0: 150, et: 150, referenceReserve: 177, minMarketValue: 50, maxMarketValue: 50, spreadOk: true },
        items: ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => ({ auctionId: 9000 + index, title: `Flat ${name}`,
          image: null, price: 50, familySize: 1, category: 'Sonstiges', rarity: index < 2 ? 'common'
            : index < 3 ? 'uncommon' : index < 4 ? 'rare' : index < 5 ? 'epic' : 'legendary',
          sellValue: 50, marketCategory: 'other' }))
      }));
  });
  assert.throws(() => createPaletteAuction(dir, { editionId: 'base:fake:2026-09-12', requestId: 'primary-lot-00000004' },
    { now: at(), random: alwaysFirst }), { status: 409, message: 'insufficient_value_spread' });
  // A scheduled event edition (window opens two hours from now).
  saveNewsEvent(dir, { id: 'scheduled-bust', title: 'T', body: 'B', status: 'published',
    paletteIds: ['electronics-smuggling'],
    paletteWindows: [{ paletteId: 'electronics-smuggling', startOffsetHours: 2, durationHours: 10 }],
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 2 }] }, { now: at() });
  const scheduledEdition = 'event:scheduled-bust:electronics-smuggling';
  assert.throws(() => createPaletteAuction(dir, { editionId: scheduledEdition, requestId: 'primary-lot-00000005' },
    { now: at(), random: alwaysFirst }), { status: 409, message: 'palette_edition_inactive' });
  // Inside the window, but starting so late that a full hour no longer fits.
  advance(11 * hour + 30 * 60000); // window ends in 30 minutes
  assert.throws(() => createPaletteAuction(dir, { editionId: scheduledEdition, requestId: 'primary-lot-00000006' },
    { now: at(), random: alwaysFirst }), { status: 409, message: 'palette_window_closes_early' });
  // A long-expired edition.
  assert.throws(() => createPaletteAuction(dir, { editionId: scheduledEdition, requestId: 'primary-lot-00000007' },
    { now: day + 30 * 24 * hour, random: alwaysFirst }), { status: 409, message: 'palette_edition_inactive' });
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM primary_palette_auctions'), 0);
});

test('bidding escrows like resale: first bid, outbid refund, raise difference, rejected bids change nothing', async t => {
  const { dir, service, admin, register } = await fixture(t);
  const bidder = await register('Bidder'), rival = await register('Rival');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id IN (?, ?)').run(bidder.id, rival.id));
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000010' },
    { now: day, random: alwaysFirst });
  const reserve = lot.reserve;
  const wallet = 100000;
  for (const amount of [0, -5, 1.5, '100', null]) {
    assert.throws(() => bidOnPaletteAuction(dir, bidder, lot.id, amount, { now: day }), /invalid_bid/);
  }
  assert.throws(() => bidOnPaletteAuction(dir, bidder, 'missing', 100, { now: day }), { status: 404 });
  assert.throws(() => bidOnPaletteAuction(dir, bidder, lot.id, reserve - 1, { now: day }), /bid_too_low/);
  // First bid debits the full amount.
  bidOnPaletteAuction(dir, bidder, lot.id, reserve, { now: day });
  assert.equal(tokensOf(service, bidder), wallet - reserve);
  // The escrowed reserve is not spendable elsewhere.
  assert.throws(() => bidOnPaletteAuction(dir, bidder, lot.id, wallet + 1, { now: day }), /insufficient_tokens/);
  // Raising is value-tiered: below the tiered minimum even the leader is rejected.
  const inc = paletteBidIncrement(reserve);
  assert.throws(() => bidOnPaletteAuction(dir, bidder, lot.id, reserve + inc - 1, { now: day }), /bid_too_low/);
  bidOnPaletteAuction(dir, bidder, lot.id, reserve + inc, { now: day + 500 });
  assert.equal(tokensOf(service, bidder), wallet - reserve - inc);
  // Raising as the leader charges only the difference.
  bidOnPaletteAuction(dir, bidder, lot.id, reserve + 2 * inc, { now: day + 1000 });
  assert.equal(tokensOf(service, bidder), wallet - reserve - 2 * inc);
  assert.throws(() => bidOnPaletteAuction(dir, bidder, lot.id, reserve + 2 * inc, { now: day + 2000 }), /bid_too_low/);
  // A different bidder pays in full and refunds the prior holder exactly.
  bidOnPaletteAuction(dir, rival, lot.id, reserve + 4 * inc, { now: day + 3000 });
  assert.equal(tokensOf(service, bidder), wallet);
  assert.equal(tokensOf(service, rival), wallet - reserve - 4 * inc);
  const outbidNotice = notificationsForUser(dir, bidder.id, { now: day + 3000 });
  assert.ok(outbidNotice.fresh.some(entry => entry.type === 'outbid' && entry.href === '/auctions'));
  const rejected = tokensOf(service, rival);
  assert.throws(() => bidOnPaletteAuction(dir, rival, lot.id, wallet + 1, { now: day + 4000 }), /insufficient_tokens/);
  assert.equal(tokensOf(service, rival), rejected);
  const after = getPaletteAuction(dir, lot.id, { now: day + 4000 });
  assert.equal(after.currentBid, reserve + 4 * inc);
  assert.equal(after.bidCount, 4);
  assert.deepEqual(after.bids.map(bid => [bid.amount, bid.bidderId, bid.bidderUsername]), [
    [reserve, bidder.id, 'Bidder'], [reserve + inc, bidder.id, 'Bidder'],
    [reserve + 2 * inc, bidder.id, 'Bidder'], [reserve + 4 * inc, rival.id, 'Rival']
  ]);
  // Exact deadline behavior: the last instant still accepts a valid bid, at
  // the deadline the lot rejects everything.
  bidOnPaletteAuction(dir, bidder, lot.id, reserve + 5 * inc, { now: day + hour - 1 });
  assert.throws(() => bidOnPaletteAuction(dir, bidder, lot.id, reserve + 6 * inc, { now: day + hour }), { status: 409, message: 'palette_auction_ended' });
});

test('bids enforce the frozen requiredLevel from persisted users.xp', async t => {
  const { dir, service, admin, register } = await fixture(t);
  const buyer = await register('Buyer');
  // An event edition with requiredLevel 3 (threshold 400 XP).
  saveNewsEvent(dir, { id: 'levelled-bust', title: 'T', body: 'B', status: 'published',
    paletteIds: ['electronics-smuggling'],
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 2 }] }, { now: day });
  const editionId = 'event:levelled-bust:electronics-smuggling';
  const lot = createPaletteAuction(dir, { editionId, requestId: 'primary-lot-00000020' }, { now: day, random: alwaysFirst });
  assert.equal(lot.requiredLevel, 3);
  service.db(db => db.prepare('UPDATE users SET tokens = 100000, xp = 399 WHERE id = ?').run(buyer.id));
  assert.throws(() => bidOnPaletteAuction(dir, buyer, lot.id, lot.reserve, { now: day }), { status: 403, message: 'level_required' });
  // XP is read from the database, not from the supplied user object.
  const forged = { ...buyer, xp: 999999 };
  assert.throws(() => bidOnPaletteAuction(dir, forged, lot.id, lot.reserve, { now: day }), /level_required/);
  service.db(db => db.prepare('UPDATE users SET xp = 400 WHERE id = ?').run(buyer.id));
  bidOnPaletteAuction(dir, buyer, lot.id, lot.reserve, { now: day });
  assert.equal(tokensOf(service, buyer), 100000 - lot.reserve);
});

test('legacy users gain the missing users.xp column with zero XP and intact balances', async t => {
  const { dir, service, admin, register } = await fixture(t);
  const buyer = await register('Buyer');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(buyer.id));
  const balance = tokensOf(service, buyer);
  closeDataStore(dir);
  // Rewind to a pre-foundation schema: no xp column at all.
  withDatabase(dir, db => db.exec('ALTER TABLE users DROP COLUMN xp'));
  const reopened = new Accounts(dir, { flags: { resales: false }, now: () => day });
  const columns = reopened.db(db => db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  assert.ok(columns.includes('xp'));
  assert.equal(reopened.db(db => db.prepare('SELECT xp FROM users WHERE id = ?').get(buyer.id).xp), 0);
  assert.equal(reopened.profile(buyer).tokens, balance);
  // Level-1 lots stay biddable with zero XP.
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000030' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, buyer, lot.id, lot.reserve, { now: day });
});

test('banned users cannot bid or retrieve rewards', async t => {
  const { dir, service, admin, register, advance } = await fixture(t);
  const buyer = await register('Buyer');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(buyer.id));
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000040' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, buyer, lot.id, lot.reserve, { now: day });
  service.db(db => db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(buyer.id));
  assert.throws(() => bidOnPaletteAuction(dir, buyer, lot.id, lot.reserve + 10, { now: day }), { status: 403, message: 'account_banned' });
  advance(hour);
  assert.throws(() => getPaletteAuctionRewards(dir, buyer, lot.id, { now: day + hour }), { status: 403, message: 'account_banned' });
});

test('settlement with no bids ends the lot without inventory or token movement', async t => {
  const { dir, service, at } = await fixture(t);
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000050' },
    { now: at(), random: alwaysFirst });
  assert.throws(() => settlePaletteAuction(dir, lot.id, { now: at() + hour - 1 }), { status: 409, message: 'auction_still_active' });
  const before = conservedTotal(dir);
  const settled = settlePaletteAuction(dir, lot.id, { now: at() + hour });
  assert.equal(settled.status, 'ended');
  assert.equal(settled.winnerId, null);
  assert.ok(settled.settledAt);
  assert.equal(settled.currentBid, null);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM inventory'), 0);
  assert.equal(conservedTotal(dir).users, before.users); // no tokens moved
  // A ghost account is refused authentication before anything about the lot
  // is revealed (real non-winners are covered by the retrieval test).
  assert.throws(() => getPaletteAuctionRewards(dir, { id: 'nobody' }, lot.id, { now: at() + hour }), { status: 401 });
});

test('winning settlement creates exactly three provenance-stamped inventory rows and sinks the bid', async t => {
  const { dir, service, admin, register, advance } = await fixture(t);
  const winner = await register('Winner'), loser = await register('Loser');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(winner.id));
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(loser.id));
  const edition = baseEdition(dir);
  const lot = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'primary-lot-00000060' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, loser, lot.id, lot.reserve, { now: day });
  bidOnPaletteAuction(dir, winner, lot.id, lot.reserve + 25, { now: day + 1000 });
  const before = conservedTotal(dir);
  assert.equal(before.escrow, lot.reserve + 25);
  advance(hour);
  const settled = getPaletteAuction(dir, lot.id, { now: day + hour }); // public read settles
  assert.equal(settled.status, 'ended');
  assert.equal(settled.winnerId, winner.id);
  assert.ok(settled.settledAt >= settled.endsAt);
  // Exactly three inventory rows for the winner, with full provenance.
  const inventoryRows = rows(dir, 'SELECT id, user_id, item FROM inventory ORDER BY id');
  assert.equal(inventoryRows.length, 3);
  assert.ok(inventoryRows.every(row => row.user_id === winner.id));
  for (const row of inventoryRows) {
    const item = JSON.parse(row.item);
    assert.equal(item.paletteAuctionId, lot.id);
    assert.equal(item.paletteEditionId, edition.editionId);
    assert.equal(item.bundleCostTokens, lot.reserve + 25); // entire winning bid
    assert.ok([0, 1, 2].includes(item.rewardPosition));
    assert.ok(Number.isFinite(item.price) && item.rarity && Number.isSafeInteger(item.sellValue) && item.marketCategory);
    assert.ok(!('caseId' in item) && !('caseCost' in item)); // no fabricated legacy fields
  }
  // The escrowed winning payment is consumed: the conserved sum drops by
  // exactly the winning bid; the winner is NOT charged again.
  const after = conservedTotal(dir);
  assert.equal(after.escrow, 0);
  assert.equal(before.users + before.escrow - (after.users + after.escrow), lot.reserve + 25);
  assert.equal(tokensOf(service, winner), 100000 - lot.reserve - 25);
  assert.equal(tokensOf(service, loser), 100000); // refunded at outbid, never charged again
  const winnerNotices = notificationsForUser(dir, winner.id, { now: day + hour });
  assert.ok(winnerNotices.fresh.some(entry => entry.type === 'won' && entry.bodyEn.includes('ready to reveal')));
  // Idempotent settlement, also across a restart.
  const settledAgain = settlePaletteAuction(dir, lot.id, { now: day + 2 * hour });
  assert.equal(settledAgain.settledAt, settled.settledAt);
  closeDataStore(dir);
  assert.deepEqual(settlePaletteAuction(dir, lot.id, { now: day + 3 * hour }), settledAgain);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM inventory'), 3);
  assert.equal(conservedTotal(dir).users, after.users);
});

test('a forced second inventory insert failure rolls back all rewards and settlement', async t => {
  const { dir, service, register, advance } = await fixture(t);
  const winner = await register('Winner');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(winner.id));
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000070' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, winner, lot.id, lot.reserve, { now: day });
  // Reserve the second reward's inventory id with a conflicting row.
  const [second] = rows(dir, 'SELECT inventory_id FROM primary_palette_rewards WHERE position = 1');
  withDatabase(dir, db => db.prepare(`INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)`)
    .run(second.inventory_id, winner.id, JSON.stringify({ title: 'squatter', price: 1 }), day));
  advance(hour);
  assert.throws(() => settlePaletteAuction(dir, lot.id, { now: day + hour }), Error);
  // Everything rolled back: no rewards minted, lot still active-unsettled,
  // only the squatter row remains.
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM inventory'), 1);
  const [row] = rows(dir, 'SELECT status, settled_at, winner_id FROM primary_palette_auctions WHERE id = ?', lot.id);
  assert.equal(row.status, 'active');
  assert.equal(row.settled_at, null);
  assert.equal(row.winner_id, null);
  // Removing the conflict lets the explicit settlement complete.
  withDatabase(dir, db => db.prepare('DELETE FROM inventory WHERE id = ?').run(second.inventory_id));
  const settled = settlePaletteAuction(dir, lot.id, { now: day + hour });
  assert.equal(settled.winnerId, winner.id);
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM inventory'), 3);
});

test('public serializers never expose selected rewards, reserved ids or hidden values', async t => {
  const { dir, service, register, advance } = await fixture(t);
  const winner = await register('Winner');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(winner.id));
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000080' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, winner, lot.id, lot.reserve, { now: day });
  const reservedIds = rows(dir, 'SELECT inventory_id FROM primary_palette_rewards').map(row => row.inventory_id);
  const drawn = JSON.parse(rows(dir, 'SELECT item_json FROM primary_palette_rewards WHERE position = 0')[0].item_json);
  advance(hour);
  const detail = getPaletteAuction(dir, lot.id, { now: day + hour });
  const listed = listPaletteAuctions(dir, { now: day + 5 * hour });
  assert.deepEqual(listed, []); // expired lots drop out of the default listing
  // Create a second, still-active lot to exercise the list serializer.
  const live = createPaletteAuction(dir, { editionId: baseEdition(dir, 'tools').editionId, requestId: 'primary-lot-00000081' },
    { now: day + 5 * hour, random: alwaysFirst });
  const listedNow = listPaletteAuctions(dir, { now: day + 5 * hour });
  assert.deepEqual(listedNow.map(entry => entry.id), [live.id]);
  for (const serialized of [JSON.stringify(detail), JSON.stringify(listedNow)]) {
    for (const reservedId of reservedIds) assert.ok(!serialized.includes(reservedId));
    assert.doesNotMatch(serialized, /"rewards"|"item_json"|"inventoryId"|"selectedValue|"random/);
  }
  // The candidate pool is public, but the drawn selection is indistinguishable
  // from it (the drawn item is just one pool entry).
  assert.ok(detail.items.length >= 5);
  assert.ok(detail.items.some(item => item.title === drawn.title));
  // Explicit allowlist: no stray fields beyond the public contract.
  assert.deepEqual(Object.keys(detail).sort(), ['allowedMarketCategories', 'badge', 'bidCount', 'bidIncrement', 'bids', 'closedAt',
    'currentBid', 'editionId', 'endsAt', 'id', 'items', 'kind', 'name', 'nameDe', 'paletteId',
    'requiredLevel', 'reserve', 'rewardCount', 'settledAt', 'startedAt', 'status', 'story', 'type', 'winnerId']);
});

test('reward retrieval is winner-only, generic for others, and stable across resale', async t => {
  const { dir, service, admin, register, advance } = await fixture(t);
  const winner = await register('Winner'), loser = await register('Loser');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(winner.id));
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(loser.id));
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000090' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, loser, lot.id, lot.reserve, { now: day });
  bidOnPaletteAuction(dir, winner, lot.id, lot.reserve + paletteBidIncrement(lot.reserve), { now: day + 1000 });
  // Before the deadline: unavailable, and without any reward details.
  assert.throws(() => getPaletteAuctionRewards(dir, winner, lot.id, { now: day + 2000 }), { status: 409, message: 'rewards_unavailable' });
  advance(hour);
  // Losers and admins get the same generic not-found; missing users too.
  assert.throws(() => getPaletteAuctionRewards(dir, loser, lot.id, { now: day + hour }), { status: 404, message: 'palette_rewards_not_found' });
  assert.throws(() => getPaletteAuctionRewards(dir, admin, lot.id, { now: day + hour }), { status: 404, message: 'palette_rewards_not_found' });
  assert.throws(() => getPaletteAuctionRewards(dir, { id: 'ghost' }, lot.id, { now: day + hour }), { status: 401 });
  // The winner sees the original three snapshots; retrieval settles on demand.
  const reveal = getPaletteAuctionRewards(dir, winner, lot.id, { now: day + hour });
  assert.equal(reveal.winnerId, winner.id);
  assert.equal(reveal.bundleCostTokens, lot.reserve + paletteBidIncrement(lot.reserve));
  assert.deepEqual(reveal.rewards.map(reward => reward.position), [0, 1, 2]);
  for (const reward of reveal.rewards) {
    assert.ok(reward.item.paletteAuctionId === lot.id && Number.isSafeInteger(reward.item.bundleCostTokens));
  }
  const winnerBalance = tokensOf(service, winner);
  const repeat = getPaletteAuctionRewards(dir, winner, lot.id, { now: day + 2 * hour });
  assert.deepEqual(repeat, reveal); // same original snapshots
  assert.equal(tokensOf(service, winner), winnerBalance); // no second debit
  assert.equal(count(dir, 'SELECT COUNT(*) AS count FROM inventory'), 3); // no minting on retrieval
  // Transfer one reward to another user (as a resale settlement would): the
  // historical reveal for the recorded winner is unchanged.
  const [first] = rows(dir, 'SELECT inventory_id FROM primary_palette_rewards WHERE position = 0');
  withDatabase(dir, db => db.prepare('UPDATE inventory SET user_id = ?, sold_at = ? WHERE id = ?')
    .run(loser.id, day + 3 * hour, first.inventory_id));
  assert.deepEqual(getPaletteAuctionRewards(dir, winner, lot.id, { now: day + 3 * hour }), reveal);
  // The winner's live inventory reflects the transfer, not the reveal.
  assert.equal(service.inventory(winner).length, 2);
});

test('escrow conservation across a full lifecycle with multiple lots', async t => {
  const { dir, service, register, advance } = await fixture(t);
  const a = await register('Alice'), b = await register('Bob');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id IN (?, ?)').run(a.id, b.id));
  const lotA = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000100' },
    { now: day, random: alwaysFirst });
  const lotB = createPaletteAuction(dir, { editionId: baseEdition(dir, 'tools').editionId, requestId: 'primary-lot-00000101' },
    { now: day + 60000, random: alwaysFirst });
  const start = conservedTotal(dir);
  assert.equal(start.escrow, 0);
  bidOnPaletteAuction(dir, a, lotA.id, lotA.reserve + paletteBidIncrement(lotA.reserve), { now: day + 1000 });
  bidOnPaletteAuction(dir, b, lotA.id, lotA.reserve + 2 * paletteBidIncrement(lotA.reserve), { now: day + 2000 });
  bidOnPaletteAuction(dir, a, lotB.id, lotB.reserve, { now: day + 3000 });
  let current = conservedTotal(dir);
  assert.equal(current.users + current.escrow, start.users);
  assert.equal(current.escrow, lotA.reserve + 2 * paletteBidIncrement(lotA.reserve) + lotB.reserve);
  advance(2 * hour);
  settlePaletteAuction(dir, lotA.id, { now: day + 2 * hour });
  current = conservedTotal(dir);
  assert.equal(current.escrow, lotB.reserve); // only unsettled escrow outstanding
  assert.equal(start.users - (current.users + current.escrow), lotA.reserve + 2 * paletteBidIncrement(lotA.reserve)); // sunk exactly the winning bid
  settlePaletteAuction(dir, lotB.id, { now: day + 2 * hour });
  current = conservedTotal(dir);
  assert.equal(current.escrow, 0);
  assert.equal(start.users - current.users, lotA.reserve + 2 * paletteBidIncrement(lotA.reserve) + lotB.reserve);
});

test('legacy case opening and resale remain unchanged alongside primary auctions', async t => {
  const { dir, service, admin, register, advance } = await fixture(t);
  const player = await register('Player');
  service.db(db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(player.id));
  const cases = await import('../src/cases.mjs');
  const legacy = cases.loadCaseCatalog(dir, day);
  const item = service.openCase(player, legacy, 'fundkiste', 'primary-compat-0001');
  assert.ok(item.caseId === 'fundkiste' && Number.isSafeInteger(item.caseCost));
  const lot = createPaletteAuction(dir, { editionId: baseEdition(dir).editionId, requestId: 'primary-lot-00000110' },
    { now: day, random: alwaysFirst });
  bidOnPaletteAuction(dir, player, lot.id, lot.reserve, { now: day });
  advance(hour);
  settlePaletteAuction(dir, lot.id, { now: day + hour });
  // The legacy-opened item and the three palette rewards coexist; the legacy
  // item keeps its case provenance, rewards keep palette provenance.
  const inventoryItems = service.inventory(player);
  assert.equal(inventoryItems.length, 4);
  assert.ok(inventoryItems.some(row => row.id === item.id));
  assert.equal(service.inventory(player).filter(row => row.id === item.id).length, 1);
  // Instant-selling the legacy item still works and only that item pays out.
  const balance = tokensOf(service, player);
  service.sell(player, item.id);
  assert.equal(tokensOf(service, player), balance + item.sellValue);
});
