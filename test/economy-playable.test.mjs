import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { featureFlags } from '../src/features.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { bidOnPaletteAuction, createPaletteAuction, getPaletteAuctionRewards, listPaletteAuctions,
  paletteAuctionsByUser, settleDuePaletteAuctions, PALETTE_ACTIVE_PER_EDITION } from '../src/palette-auctions.mjs';
import { cancelListing, getResale, listItem, placeBid, settleAuction } from '../src/resale.mjs';
import { NPC_BALANCE, NPC_BUYERS, NPC_COHORT_SIZE, npcValuation, seedNpcBuyers, tickNpcBuyers, tickPaletteBuyers } from '../src/npc-buyers.mjs';
import { marketState, tickMarketDrift } from '../src/market.mjs';
import { PALETTE_DROP_PERIOD_MS, supplyPaletteAuctions, tickEconomy, startEconomyRuntime } from '../src/economy-runtime.mjs';
import { getNewsEvent, saveNewsEvent } from '../src/news.mjs';
import { setMarketIndex } from '../src/market.mjs';
import { tickWorldNews, WORLD_NEWS_PERIOD_MS, WORLD_SCENARIOS } from '../src/world-news.mjs';
import { resaleXp } from '../src/xp.mjs';

const hour = 3600_000, day = Date.parse('2026-09-19T12:00:00Z');
const stock = [['Elektronik', 'Laptop Lenovo', 40], ['Werkzeuge', 'Bohrhammer Makita', 20],
  ['Getränke', 'Riesling Wein', 8], ['Fahrzeuge', 'BMW PKW', 500],
  ['Schmuck & Uhren', 'Gold Armbanduhr', 90], ['Sammlerstücke', 'Lego Modell', 15]]
  .flatMap(([category, title, price], index) => Array.from({ length: 12 }, (_, n) => ({
    id: index * 100 + n + 1000, title: `${title} ${index * 100 + n + 1000}`,
    category, currentBid: price * (n + 1), image: '/favicon.png' })));

async function fixture(t, flags = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-playable-'));
  let now = day;
  const accounts = new Accounts(dir, { now: () => now, flags });
  upsertAuctions(dir, stock);
  const sql = (query, ...args) => withDatabase(dir, db => db.prepare(query).all(...args));
  const mutate = (query, ...args) => withDatabase(dir, db => db.prepare(query).run(...args));
  for (const id of ['seller', 'buyer', 'other']) mutate(`INSERT INTO users (id, username, password_hash, tokens, created_at, admin)
    VALUES (?, ?, 'disabled', 100000, ?, ?)`, id, id, now, Number(id === 'seller'));
  const user = id => ({ id, admin: id === 'seller' });
  const item = (id, owner = 'seller', price = 100) => {
    mutate('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)', id, owner,
      JSON.stringify({ title: 'Test tool', price, sellValue: 77, rarity: 'common', marketCategory: 'tools', image: '/favicon.png' }), now);
    return id;
  };
  const listing = (id, duration = 5 * 60_000, startPrice = 1, owner = 'seller') =>
    listItem(dir, user(owner), { inventoryId: item(id, owner), startPrice, endsAt: new Date(now + duration).toISOString() }, { now });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, sql, mutate, user, item, listing, setNow: value => { now = value; } };
}
const count = (f, table) => f.sql(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const balance = (f, id) => f.sql('SELECT tokens FROM users WHERE id = ?', id)[0].tokens;
const xp = (f, id = 'seller') => f.accounts.profile(f.user(id)).progression.xp;

test('automatic supply fills the board with ten staggered lots and survives restart', async t => {
  const f = await fixture(t);
  saveNewsEvent(f.dir, { id: 'fixture-event', title: 'Fiction', body: 'Fiction', status: 'published', paletteIds: ['electronics-smuggling'] }, { now: day });
  supplyPaletteAuctions(f.dir, { now: day });
  const lots = listPaletteAuctions(f.dir, { now: day });
  assert.equal(lots.length, 10);
  const ends = lots.map(l => l.endsAt - day);
  assert.deepEqual([...ends].sort((a, b) => a - b), ends);
  assert.equal(new Set(ends).size, 10);
  assert.ok(Math.max(...ends) - Math.min(...ends) >= PALETTE_DROP_PERIOD_MS * 9);
  const ids = lots.map(l => l.id).sort();
  supplyPaletteAuctions(f.dir, { now: day + 30_000 }); closeDataStore(f.dir);
  supplyPaletteAuctions(f.dir, { now: day + 45_000 });
  assert.equal(count(f, 'primary_palette_auctions'), 10);
  assert.deepEqual(listPaletteAuctions(f.dir, { now: day + 45_000 }).map(l => l.id).sort(), ids);
  assert.equal(settleDuePaletteAuctions(f.dir, { now: day + hour }).settled, 9);
  assert.equal(settleDuePaletteAuctions(f.dir, { now: day + hour }).settled, 0);
  supplyPaletteAuctions(f.dir, { now: day + hour });
  assert.equal(listPaletteAuctions(f.dir, { now: day + hour }).length, 10);
  assert.equal(count(f, 'inventory'), 0);
});

test('economy reset removes primary and resale auction state but keeps the shared world catalog', async t => {
  const f = await fixture(t);
  supplyPaletteAuctions(f.dir, { now: day });
  const palette = listPaletteAuctions(f.dir, { now: day })[0];
  bidOnPaletteAuction(f.dir, f.user('buyer'), palette.id, palette.reserve, { now: day });
  f.listing('reset-resale-item');
  const editions = count(f, 'palette_editions');
  const paletteLots = count(f, 'primary_palette_auctions');

  const reset = f.accounts.resetEconomy(f.user('seller'), 'RESET ECONOMY');
  assert.equal(reset.paletteAuctionCount, paletteLots); assert.equal(reset.resaleCount, 1);
  assert.equal(count(f, 'primary_palette_auctions'), 0);
  assert.equal(count(f, 'primary_palette_rewards'), 0);
  assert.equal(count(f, 'primary_palette_bids'), 0);
  assert.equal(count(f, 'resale_auctions'), 0); assert.equal(count(f, 'inventory'), 0);
  assert.equal(count(f, 'palette_editions'), editions);
  assert.ok(f.sql('SELECT tokens, xp FROM users WHERE npc = 0').every(row => row.tokens === 1000 && row.xp === 0));
  supplyPaletteAuctions(f.dir, { now: day });
  assert.ok(count(f, 'primary_palette_auctions') > 0);
});

test('supply skips unavailable editions, caps concurrent lots per edition and honors edition windows', async t => {
  const f = await fixture(t);
  loadPaletteCatalog(f.dir, { now: day });
  f.mutate(`UPDATE palette_editions SET payload_json = json_set(payload_json, '$.available', 0) WHERE palette_id != 'fundkiste'`);
  supplyPaletteAuctions(f.dir, { now: day }); assert.equal(count(f, 'primary_palette_auctions'), PALETTE_ACTIVE_PER_EDITION);
  const editionId = f.sql(`SELECT id FROM palette_editions WHERE palette_id = 'fundkiste'`)[0].id;
  assert.throws(() => createPaletteAuction(f.dir, { editionId, requestId: 'window-overflow-test-01', endsAt: day + 13 * hour },
    { now: day }), /palette_window_closes_early/);
  assert.equal(count(f, 'palette_editions'), 8); // no replacement category fabricated
});

test('NPC buyers chase hot-market palettes and fall silent when the market cools', async t => {
  const f = await fixture(t);
  loadPaletteCatalog(f.dir, { now: day });
  f.mutate(`UPDATE palette_editions SET payload_json = json_set(payload_json, '$.available', 0) WHERE palette_id != 'electronics'`);
  const edition = loadPaletteCatalog(f.dir, { now: day }).palettes.find(p => p.editionId.startsWith('base:electronics:'));
  assert.ok(edition);
  // The reserve freezes at the neutral market the lot was created in; drift
  // then moves the market and the NPC ceilings float against the frozen lot.
  const lot = createPaletteAuction(f.dir, { editionId: edition.editionId, requestId: 'palette-npc-fixture-1', endsAt: day + 8 * hour }, { now: day });
  const unit = key => key.includes(':palette-showup') ? 0 : 0.5;
  let hotCalls = 0;
  tickMarketDrift(f.dir, { now: day, random: () => { hotCalls++; return hotCalls === 1 ? .999999 : hotCalls === 2 ? .9 : 0; } });
  assert.equal(marketState(f.dir, { now: day }).categories.find(c => c.category === 'electronics').currentIndex, 125);
  assert.ok(tickPaletteBuyers(f.dir, { now: day + 30_000, unit }).bids >= 1);
  const bid = f.sql('SELECT * FROM primary_palette_bids ORDER BY id DESC LIMIT 1')[0];
  assert.ok(bid.amount >= lot.reserve);
  assert.ok(bid.bidder_id.startsWith('npc-'));
  assert.equal(balance(f, bid.bidder_id), NPC_BALANCE - bid.amount);
  // Re-evaluating the same five-minute slot must not let the chosen NPC bid
  // against itself, even if the runtime runs every few seconds.
  const bidsInSlot = count(f, 'primary_palette_bids');
  assert.equal(tickPaletteBuyers(f.dir, { now: day + 60_000, unit }).bids, 0);
  assert.equal(count(f, 'primary_palette_bids'), bidsInSlot);
  assert.throws(() => bidOnPaletteAuction(f.dir, { id: bid.bidder_id }, lot.id, bid.amount + 1,
    { now: day + 90_000, npc: true }), /npc_self_outbid/);
  assert.equal(count(f, 'primary_palette_bids'), bidsInSlot);
  // A cold market drops every ceiling below the standing bid: silence.
  let coldCalls = 0;
  tickMarketDrift(f.dir, { now: day + 2 * hour, random: () => { coldCalls++; return coldCalls === 1 ? .999999 : coldCalls === 2 ? .1 : 0; } });
  const bidsBefore = count(f, 'primary_palette_bids');
  assert.equal(tickPaletteBuyers(f.dir, { now: day + 2 * hour + 60_000, unit }).bids, 0);
  assert.equal(count(f, 'primary_palette_bids'), bidsBefore);
  // A recovered market resumes bidding; the player-facing API still rejects NPCs.
  let warmCalls = 0;
  tickMarketDrift(f.dir, { now: day + 4 * hour, random: () => { warmCalls++; return warmCalls === 1 ? .999999 : warmCalls === 2 ? .9 : 0; } });
  assert.ok(tickPaletteBuyers(f.dir, { now: day + 4 * hour + 6 * 60_000, unit }).bids >= 1);
  assert.throws(() => bidOnPaletteAuction(f.dir, { id: bid.bidder_id }, lot.id, bid.amount + 1, { now: day + 4 * hour + 90_000 }), /forbidden/);
});

test('My bids discovers won and lost lots, settles due rewards once and keeps hidden data private', async t => {
  const f = await fixture(t);
  supplyPaletteAuctions(f.dir, { now: day });
  const lot = listPaletteAuctions(f.dir, { now: day })[0];
  bidOnPaletteAuction(f.dir, f.user('seller'), lot.id, lot.reserve, { now: day });
  bidOnPaletteAuction(f.dir, f.user('buyer'), lot.id, lot.reserve + 1, { now: day });
  assert.equal(f.accounts.profile(f.user('buyer')).activeBids, 1);
  const mine = paletteAuctionsByUser(f.dir, f.user('buyer'), { now: day });
  assert.equal(mine[0].leading, true); assert.equal(mine[0].highestBid, lot.reserve + 1);
  assert.equal(mine[0].revealAvailable, false);
  assert.equal(paletteAuctionsByUser(f.dir, f.user('other'), { now: day }).length, 0);
  const won = paletteAuctionsByUser(f.dir, f.user('buyer'), { now: day + hour });
  assert.equal(won[0].won, true); assert.equal(won[0].revealAvailable, true);
  assert.equal(won[0].settledAt, day + hour); assert.equal(count(f, 'inventory'), 3);
  const lost = paletteAuctionsByUser(f.dir, f.user('seller'), { now: day + hour });
  assert.equal(lost[0].won, false); assert.equal(lost[0].highestBid, lot.reserve);
  for (const r of f.sql('SELECT inventory_id FROM primary_palette_rewards')) assert.ok(!JSON.stringify(won).includes(r.inventory_id));
  assert.doesNotMatch(JSON.stringify(won), /"rewards"|item_json|weights/);
  assert.throws(() => getPaletteAuctionRewards(f.dir, f.user('seller'), lot.id, { now: day + hour }), /palette_rewards_not_found/);
  closeDataStore(f.dir);
  const result = getPaletteAuctionRewards(f.dir, f.user('buyer'), lot.id, { now: day + hour });
  assert.equal(result.rewards.length, 3); assert.equal(count(f, 'inventory'), 3);
  assert.equal(result.revealedAt, day + hour);
  assert.equal(xp(f, 'buyer'), 0); assert.equal(xp(f), 0);
  // The unbox is a one-time presentation: the first retrieval marks it seen,
  // the board stops advertising it and repeat calls stay reward-identical.
  const seen = paletteAuctionsByUser(f.dir, f.user('buyer'), { now: day + hour + 1000 });
  assert.equal(seen[0].won, true); assert.equal(seen[0].revealAvailable, false);
  assert.deepEqual(getPaletteAuctionRewards(f.dir, f.user('buyer'), lot.id, { now: day + hour + 2000 }).rewards, result.rewards);
  assert.equal(count(f, 'inventory'), 3);
});

test('Daily gives 150 XP on completion exactly once even when Higher-or-Lower took the token reward', async t => {
  const f = await fixture(t), user = f.user('seller');
  const auctions = stock.slice(0, 5).map(a => ({ ...a, actualBid: 100 }));
  const hl = f.accounts.startGame(user, 'higher-lower', () => auctions);
  for (let i = 0; i < 4; i++) f.accounts.answer(user, hl.id, i, 'higher');
  assert.equal(xp(f), 0);
  const daily = f.accounts.startGame(user, 'daily', () => auctions);
  for (let i = 0; i < 4; i++) f.accounts.answer(user, daily.id, i, 100);
  assert.equal(xp(f), 0);
  const done = f.accounts.answer(user, daily.id, 4, 100);
  assert.equal(done.earned, 0); assert.equal(xp(f), 150);
  assert.equal(f.accounts.profile(user).progression.level, 2);
  closeDataStore(f.dir);
  f.accounts.answer(user, daily.id, 4, 100); f.accounts.startGame(user, 'daily', () => auctions);
  assert.equal(xp(f), 150); assert.equal(count(f, 'xp_events'), 1);
  f.setNow(day + 24 * hour);
  const next = f.accounts.startGame(user, 'daily', () => auctions);
  for (let i = 0; i < 5; i++) f.accounts.answer(user, next.id, i, 100);
  assert.equal(xp(f), 300); assert.equal(count(f, 'xp_events'), 2);
});

test('XP receipt and Daily completion roll back together and old completed activity is not backfilled', async t => {
  const f = await fixture(t), user = f.user('seller');
  const run = f.accounts.startGame(user, 'daily', () => stock.slice(0, 5).map(a => ({ ...a, actualBid: 100 })));
  for (let i = 0; i < 4; i++) f.accounts.answer(user, run.id, i, 100);
  withDatabase(f.dir, db => db.exec(`CREATE TRIGGER stop_xp BEFORE UPDATE OF xp ON users BEGIN SELECT RAISE(ABORT, 'test fault'); END`));
  const tokens = balance(f, 'seller');
  assert.throws(() => f.accounts.answer(user, run.id, 4, 100), /test fault/);
  assert.equal(count(f, 'xp_events'), 0); assert.equal(balance(f, 'seller'), tokens);
  assert.equal(f.sql('SELECT complete FROM account_games WHERE id = ?', run.id)[0].complete, 0);
  withDatabase(f.dir, db => db.exec('DROP TRIGGER stop_xp'));
  f.accounts.answer(user, run.id, 4, 100);
  // Model a completed pre-migration game without a receipt.
  f.mutate('DELETE FROM xp_events'); f.mutate('UPDATE users SET xp = 0');
  f.accounts.answer(user, run.id, 4, 100); assert.equal(xp(f), 0);
});

test('resale XP uses final price, stays exactly once across restart and failure rolls back ownership', async t => {
  const f = await fixture(t), lot = f.listing('sale');
  placeBid(f.dir, f.user('buyer'), lot.id, 100, { now: day });
  placeBid(f.dir, f.user('other'), lot.id, 300, { now: day });
  assert.equal(xp(f), 0);
  withDatabase(f.dir, db => db.exec(`CREATE TRIGGER stop_xp BEFORE INSERT ON xp_events BEGIN SELECT RAISE(ABORT, 'test fault'); END`));
  assert.throws(() => settleAuction(f.dir, lot.id, { now: day + hour }), /test fault/);
  assert.equal(f.sql('SELECT user_id FROM inventory WHERE id = ?', 'sale')[0].user_id, 'seller');
  assert.equal(balance(f, 'seller'), 100000);
  withDatabase(f.dir, db => db.exec('DROP TRIGGER stop_xp'));
  settleAuction(f.dir, lot.id, { now: day + hour }); closeDataStore(f.dir);
  settleAuction(f.dir, lot.id, { now: day + hour });
  assert.equal(xp(f), 40); assert.equal(count(f, 'xp_events'), 1); assert.equal(balance(f, 'seller'), 100300);
});

test('sale XP clamps boundaries; cancelled, unsold and legacy sales earn no XP', async t => {
  assert.equal(resaleXp(1), 10); assert.equal(resaleXp(100), 20); assert.equal(resaleXp(300), 40);
  assert.equal(resaleXp(102300), 200); assert.equal(resaleXp(Number.MAX_SAFE_INTEGER), 200);
  const f = await fixture(t), cancel = f.listing('cancel'), unsold = f.listing('unsold');
  cancelListing(f.dir, f.user('seller'), cancel.id, { now: day });
  settleAuction(f.dir, cancel.id, { now: day + hour }); settleAuction(f.dir, unsold.id, { now: day + hour });
  f.accounts.sell(f.user('seller'), 'unsold');
  assert.equal(xp(f), 0); assert.equal(count(f, 'xp_events'), 0);
});

test('five active human listings maximum; cancellations and deadlines free slots, NPC listings rejected', async t => {
  const f = await fixture(t), lots = Array.from({ length: 5 }, (_, i) => f.listing(`item${i}`));
  const sixth = f.item('sixth');
  const list = () => listItem(f.dir, f.user('seller'), { inventoryId: sixth, startPrice: 1, endsAt: new Date(day + hour).toISOString() }, { now: day });
  assert.throws(list, /listing_limit/); cancelListing(f.dir, f.user('seller'), lots[0].id, { now: day }); list();
  f.setNow(day + hour); assert.doesNotThrow(() => f.listing('seventh'));
  seedNpcBuyers(f.dir, { now: day });
  assert.throws(() => f.listing('npc-item', 300000, 1, NPC_BUYERS[0].id), /forbidden/);
});

test('instant sell is blocked only with resales; live estimate never rewrites frozen inventory', async t => {
  const f = await fixture(t, { resales: true }); f.item('held');
  const original = f.sql('SELECT item FROM inventory WHERE id = ?', 'held')[0].item;
  assert.throws(() => f.accounts.sell(f.user('seller'), 'held'), /instant_sell_disabled/);
  assert.throws(() => f.accounts.sellAll(f.user('seller'), 'held'), /instant_sell_disabled/);
  setMarketIndex(f.dir, 'tools', 125, { now: day });
  assert.equal(f.accounts.inventory(f.user('seller'))[0].estimatedValueTokens, 125);
  const lot = listItem(f.dir, f.user('seller'), { inventoryId: 'held', startPrice: 1, endsAt: new Date(day + hour).toISOString() }, { now: day });
  assert.equal(lot.estimatedValueTokens, 125); assert.equal(f.accounts.inventory(f.user('seller'))[0].listed, true);
  assert.equal(f.sql('SELECT item FROM inventory WHERE id = ?', 'held')[0].item, original);
  cancelListing(f.dir, f.user('seller'), lot.id, { now: day });
  const legacy = new Accounts(f.dir, { flags: {}, now: () => day });
  assert.equal(legacy.sell(f.user('seller'), 'held').value, 100);
});

test('NPC accounts cannot authenticate, get sessions, be friended, receive grants or appear as players', async t => {
  const f = await fixture(t); seedNpcBuyers(f.dir, { now: day });
  const npc = NPC_BUYERS[0];
  // A valid human-shaped name and valid password still cannot bypass npc=1.
  await f.accounts.bootstrap('authadmin', 'fixture-password-123');
  f.mutate('UPDATE users SET username = ?, password_hash = (SELECT password_hash FROM users WHERE username = ?) WHERE id = ?', 'NpcLogin', 'authadmin', npc.id);
  await assert.rejects(f.accounts.login({ username: 'NpcLogin', password: 'fixture-password-123' }), /invalid_login/);
  assert.throws(() => withDatabase(f.dir, db => f.accounts.session(db, npc.id)), /invalid_login/);
  const token = 'a'.repeat(64);
  f.mutate('INSERT INTO account_sessions VALUES (?, ?, ?)', createHash('sha256').update(token).digest('hex'), npc.id, day + hour);
  assert.equal(f.accounts.user(token), null);
  assert.throws(() => f.accounts.requestFriend(f.user('seller'), 'NpcLogin'), /user_not_found/);
  assert.equal(f.accounts.adminOverview(f.user('seller')).playerCount, 4);
  assert.ok(f.accounts.leaderboard().leaders.every(p => !p.id.startsWith('npc-')));
  const before = balance(f, npc.id);
  assert.equal(f.accounts.grantTokens(f.user('seller'), 100, 'grant-fixture-000001').recipients, 4);
  assert.equal(balance(f, npc.id), before);
  assert.throws(() => f.accounts.grantUserTokens(f.user('seller'), npc.id, 100, 'grant-fixture-000002'), /user_not_found/);
  f.mutate('UPDATE users SET tokens = tokens - 123 WHERE id = ?', npc.id); closeDataStore(f.dir);
  seedNpcBuyers(f.dir, { now: day + hour }); assert.equal(balance(f, npc.id), NPC_BALANCE - 123);
  supplyPaletteAuctions(f.dir, { now: day });
  const lot = listPaletteAuctions(f.dir, { now: day })[0];
  assert.throws(() => bidOnPaletteAuction(f.dir, npc, lot.id, lot.reserve, { now: day }), /forbidden/);
});

test('market materially changes NPC interest and WTP with bounded deterministic variation', () => {
  const item = { price: 1000, marketCategory: 'electronics' }, npc = NPC_BUYERS[0];
  const low = npcValuation(item, { electronics: 70 }, npc, 'same'), high = npcValuation(item, { electronics: 130 }, npc, 'same');
  assert.ok(high.maxBid > low.maxBid * 1.8); assert.ok(high.probability > low.probability * 2);
  assert.deepEqual(high, npcValuation(item, { electronics: 130 }, npc, 'same'));
  for (const buyer of NPC_BUYERS) for (const unit of [() => 0, () => .999]) {
    const value = npcValuation(item, { electronics: 100 }, buyer, 'a', unit);
    assert.ok(value.maxBid >= 700 && value.maxBid <= 1250);
  }
});

test('NPC interest is frozen across ticks/restarts and no bid happens before its scheduled moment', async t => {
  const f = await fixture(t); f.listing('demand');
  assert.equal(tickNpcBuyers(f.dir, { now: day, unit: () => 0 }).bids, 0);
  const interest = f.sql('SELECT * FROM resale_npc_interest ORDER BY npc_id');
  assert.equal(interest.length, NPC_COHORT_SIZE); assert.equal(count(f, 'resale_bids'), 0);
  setMarketIndex(f.dir, 'tools', 130, { now: day }); closeDataStore(f.dir);
  tickNpcBuyers(f.dir, { now: day + 1000, unit: () => .99 });
  assert.deepEqual(f.sql('SELECT * FROM resale_npc_interest ORDER BY npc_id'), interest);
  assert.equal(tickNpcBuyers(f.dir, { now: day + 45_000 }).bids, 1);
  tickNpcBuyers(f.dir, { now: day + 45_000 }); // same moment must not bid again
  assert.equal(count(f, 'resale_bids'), 1);
});

test('NPC bids use human escrow/refunds, react to outbids, win ownership and pay seller XP', async t => {
  const f = await fixture(t), lot = f.listing('npc-win');
  tickNpcBuyers(f.dir, { now: day, unit: () => 0 });
  tickNpcBuyers(f.dir, { now: day + 45_000 });
  const first = getResale(f.dir, lot.id, { now: day + 45_000 });
  assert.ok(first.currentBidderId.startsWith('npc-')); assert.ok(first.bids[0].bidderUsername);
  assert.equal(balance(f, first.currentBidderId), NPC_BALANCE - first.currentBid);
  assert.throws(() => placeBid(f.dir, { id: first.currentBidderId }, lot.id, first.currentBid + 1,
    { now: day + 75_001 }), /npc_self_outbid/);
  assert.equal(getResale(f.dir, lot.id, { now: day + 75_001 }).bids.length, 1);
  const humanBid = first.currentBid + 1;
  placeBid(f.dir, f.user('buyer'), lot.id, humanBid, { now: day + 46_000 });
  assert.equal(balance(f, first.currentBidderId), NPC_BALANCE);
  tickNpcBuyers(f.dir, { now: day + 90_000 });
  const second = getResale(f.dir, lot.id, { now: day + 90_000 });
  assert.ok(second.currentBid > humanBid); assert.equal(balance(f, 'buyer'), 100000);
  const sold = settleAuction(f.dir, lot.id, { now: day + 300000 });
  assert.ok(sold.winnerId.startsWith('npc-'));
  assert.equal(f.sql('SELECT user_id FROM inventory WHERE id = ?', 'npc-win')[0].user_id, sold.winnerId);
  assert.equal(xp(f), resaleXp(sold.currentBid)); assert.equal(balance(f, 'seller'), 100000 + sold.currentBid);
  closeDataStore(f.dir); settleAuction(f.dir, lot.id, { now: day + hour });
  assert.equal(xp(f), 10); assert.equal(count(f, 'inventory'), 1);
});

test('human can outbid all frozen NPC valuations and win without duplicate refunds', async t => {
  const f = await fixture(t), lot = f.listing('human-win');
  tickNpcBuyers(f.dir, { now: day, unit: () => 0 }); tickNpcBuyers(f.dir, { now: day + 45000 });
  const npcId = getResale(f.dir, lot.id, { now: day + 45000 }).currentBidderId;
  placeBid(f.dir, f.user('buyer'), lot.id, 1000, { now: day + 46000 });
  for (const now of [day + 90000, day + 120000, day + 180000]) tickNpcBuyers(f.dir, { now });
  assert.equal(balance(f, npcId), NPC_BALANCE);
  const sold = settleAuction(f.dir, lot.id, { now: day + 300000 });
  assert.equal(sold.winnerId, 'buyer'); assert.equal(balance(f, 'buyer'), 99000);
  assert.equal(xp(f), resaleXp(1000)); assert.equal(count(f, 'resale_bids'), 2);
});

test('automatic news is exact once, current bucket only, with durable 48h event editions', async t => {
  const f = await fixture(t);
  const bucket = Math.floor(day / WORLD_NEWS_PERIOD_MS);
  const now = (bucket + (10 - bucket % 10) % 10) * WORLD_NEWS_PERIOD_MS;
  const result = tickWorldNews(f.dir, { now });
  const event = getNewsEvent(f.dir, result.id);
  assert.equal(event.metadata.scenarioId, WORLD_SCENARIOS[0].id);
  assert.equal(event.metadata.fictional, true); assert.equal(event.paletteWindows[0].durationHours, 48);
  const effects = f.sql('SELECT * FROM market_effects'); closeDataStore(f.dir);
  tickWorldNews(f.dir, { now: now + hour });
  assert.deepEqual(f.sql('SELECT * FROM market_effects'), effects);
  assert.equal(count(f, 'news_events'), 1); assert.equal(count(f, 'palette_editions'), 1);
  tickWorldNews(f.dir, { now: now + 100 * WORLD_NEWS_PERIOD_MS }); assert.equal(count(f, 'news_events'), 2);
});

test('automatic news tries alternate budgets and permanently skips a fully blocked bucket', async t => {
  const f = await fixture(t), bucket = Math.floor(day / WORLD_NEWS_PERIOD_MS);
  const first = WORLD_SCENARIOS[bucket % WORLD_SCENARIOS.length];
  const saturate = (category, id) => {
    for (let n = 0; n < 2; n++) saveNewsEvent(f.dir, { id: `${id}-${n}`, title: 'Fiction', body: 'Fiction', status: 'published',
      marketEffects: [{ category, direction: 'up', magnitude: 15 }] }, { now: day });
  };
  saturate(first.marketEffects[0].category, 'blocked');
  const result = tickWorldNews(f.dir, { now: day });
  assert.notEqual(getNewsEvent(f.dir, result.id).metadata.scenarioId, first.id);
  const g = await fixture(t);
  for (const category of new Set(WORLD_SCENARIOS.flatMap(s => s.marketEffects.map(e => e.category)))) {
    for (let n = 0; n < 2; n++) saveNewsEvent(g.dir, { id: `${category}-${n}`, title: 'Fiction', body: 'Fiction', status: 'published',
      marketEffects: [{ category, direction: 'up', magnitude: 15 }] }, { now: day });
  }
  const before = count(g, 'news_events');
  assert.equal(tickWorldNews(g.dir, { now: day }).status, 'skipped'); closeDataStore(g.dir);
  assert.equal(tickWorldNews(g.dir, { now: day + 11 * hour }).status, 'skipped');
  assert.equal(count(g, 'news_events'), before);
});

test('runtime flag isolation, off no-op, startup timer unref and stop clears work', async t => {
  const f = await fixture(t);
  assert.deepEqual(tickEconomy(f.dir, { now: day, flags: featureFlags({ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }) }), { failures: [] });
  assert.equal(count(f, 'users'), 3);
  const primary = tickEconomy(f.dir, { now: day, flags: { paletteAuctions: true } });
  assert.deepEqual(primary.failures, []); assert.ok(primary.supply.auctions.length); assert.equal(count(f, 'users'), 3);
  const resale = tickEconomy(f.dir, { now: day, flags: { resales: true } });
  assert.deepEqual(resale.failures, []); assert.equal(count(f, 'users'), 3 + NPC_BUYERS.length);
  assert.equal(count(f, 'news_events'), 0);
  const news = tickEconomy(f.dir, { now: day, flags: { news: true } });
  assert.deepEqual(news.failures, []); assert.equal(count(f, 'news_events'), 1);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Test scheduling with deterministic fake timers; no real sleeps.
  let clockReads = 0;
  const stop = startEconomyRuntime(f.dir, { flags: { news: true }, now: () => { clockReads++; return day; } });
  t.mock.timers.tick(1000); assert.equal(clockReads, 1);
  t.mock.timers.tick(30000); assert.equal(clockReads, 2);
  stop(); t.mock.timers.tick(60000); assert.equal(clockReads, 2);
});
