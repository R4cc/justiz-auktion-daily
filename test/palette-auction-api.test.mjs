import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { paletteBidIncrement } from '../src/palette-auctions.mjs';
import { featureFlags } from '../src/features.mjs';
import { setMarketIndex } from '../src/market.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';

// HTTP contract tests for the primary palette auction exposure layer and the
// market history read API. The domain functions run on real time here (the
// routes do not inject clocks), so deadline-dependent reveal tests force the
// lot due by shifting its persisted ends_at — the same lazy-settlement path
// a real deadline takes.
const password = 'palette-auction-api-password';
const themes = [
  ['Elektronik', 'Laptop Lenovo', 40], ['Werkzeuge', 'Bohrhammer Makita', 20],
  ['Getränke', 'Riesling Wein', 8], ['Fahrzeuge', 'BMW PKW', 500],
  ['Schmuck & Uhren', 'Gold Armbanduhr', 90], ['Sammlerstücke', 'Lego Modell', 15]
];
const stock = themes.flatMap(([category, title, price], index) =>
  Array.from({ length: 12 }, (_, n) => ({ id: index * 100 + n + 1000, title: `${title} ${index * 100 + n + 1000}`,
    category, currentBid: price * (n + 1), image: `/assets/${category}.jpg` })));
const allFlags = {
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true',
  FEATURE_NEWS: '1', FEATURE_MARKET: 'yes', FEATURE_RESALES: 'true',
  FEATURE_PALETTES: 'on', FEATURE_PALETTE_AUCTIONS: '1'
};

async function fixture(t, env = allFlags) {
  env = { ...{ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }, ...env };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-palette-api-'));
  upsertAuctions(dir, stock);
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const testFlags = { ...featureFlags(env), news: env.FEATURE_NEWS === '1' };
  const economyApi = createEconomyApi({ dataDir: dir, json, flags: testFlags });
  const accountApi = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: stock.slice(0, 5) }), json, env, flags: testFlags });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await economyApi(req, res, url)) return;
    if (await accountApi(req, res, url)) return;
    json(res, 404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeIdleConnections?.();
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections?.();
    closeDataStore(dir);
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, value, cookie, csrf = 'JUSTIZGUESSR') => fetch(`${base}/api/account/${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'x-requested-with': csrf } : {}), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(value) });
  const login = async username => (await post('login', { username, password })).headers.get('set-cookie');
  const adminCookie = await login('admin');
  const register = async username => {
    const code = (await (await post('codes', { count: 1 }, adminCookie)).json()).codes[0];
    return { cookie: await (await post('register', { username, password, code })).headers.get('set-cookie'),
      user: (await (await post('login', { username, password })).json()).user };
  };
  const catalogResponse = await fetch(`${base}/api/palettes`);
  const catalog = catalogResponse.ok ? await catalogResponse.json() : null;
  const editionId = catalog?.palettes?.find(palette => palette.id === 'fundkiste')?.editionId
    ?? 'base:fundkiste:2026-09-17';
  const createLot = async (cookie, requestId, id = editionId, extra = {}) =>
    (await (await post('admin/palette-auctions', { editionId: id, requestId, ...extra }, cookie)).json()).auction;
  return { dir, base, post, adminCookie, register, editionId, createLot };
}

const forceDue = (dir, auctionId) => withDatabase(dir, db =>
  db.prepare('UPDATE primary_palette_auctions SET ends_at = ends_at - 3610_000 WHERE id = ?').run(auctionId));
const rows = (dir, sql, ...params) => withDatabase(dir, db => db.prepare(sql).all(...params));

test('feature flag isolation: disabled routes fall through, palettes alone never enable auctions', async t => {
  const handler = createEconomyApi({ dataDir: 'unused', json: () => {}, flags: featureFlags({ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }) });
  for (const path of ['/api/palette-auctions', '/api/palette-auctions/abc']) {
    assert.equal(handler({ method: 'GET' }, null, new URL(path, 'http://localhost')), false);
  }
  // FEATURE_PALETTES on its own exposes the catalog but never auction reads.
  const palettesOnly = createEconomyApi({ dataDir: 'unused', json: () => {}, flags: featureFlags({ ...{ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }, FEATURE_PALETTES: '1' }) });
  assert.equal(palettesOnly({ method: 'GET' }, null, new URL('/api/palettes', 'http://localhost')), true);
  assert.equal(palettesOnly({ method: 'GET' }, null, new URL('/api/palette-auctions', 'http://localhost')), false);
  assert.equal(palettesOnly({ method: 'GET' }, null, new URL('/api/palette-auctions/x', 'http://localhost')), false);

  const { base, post, adminCookie, register, editionId } = await fixture(t, {
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true', FEATURE_PALETTES: 'on'
  });
  const player = await register('Player');
  assert.equal((await fetch(`${base}/api/palette-auctions`)).status, 404);
  assert.equal((await fetch(`${base}/api/palette-auctions/some-id`)).status, 404);
  assert.equal((await post('palette-auctions/bid', { id: 'x', amount: 10 }, player.cookie)).status, 404);
  assert.equal((await fetch(`${base}/api/account/palette-auctions/x/rewards`, { headers: { cookie: player.cookie } })).status, 404);
  assert.equal((await post('admin/palette-auctions', { editionId, requestId: 'flag-off-lot-000001' }, adminCookie)).status, 404);
});

test('public list and detail expose only the allowlisted auction representation', async t => {
  const { dir, base, adminCookie, createLot } = await fixture(t);
  const first = await createLot(adminCookie, 'public-lot-00000001');
  const second = await createLot(adminCookie, 'public-lot-00000002');
  assert.equal(first.status, 'active');
  const list = await (await fetch(`${base}/api/palette-auctions`)).json();
  assert.deepEqual(new Set(list.auctions.map(auction => auction.id)), new Set([first.id, second.id]));
  const detail = await (await fetch(`${base}/api/palette-auctions/${first.id}`)).json();
  assert.equal(detail.auction.id, first.id);
  assert.deepEqual(detail.auction.bids, []);
  assert.ok(list.auctions.every(auction => !Object.hasOwn(auction, 'bids')));
  assert.deepEqual(Object.keys(detail.auction).sort(), ['allowedMarketCategories', 'badge', 'bidCount', 'bidIncrement', 'bids', 'closedAt',
    'currentBid', 'editionId', 'endsAt', 'id', 'items', 'kind', 'name', 'nameDe', 'paletteId',
    'requiredLevel', 'reserve', 'rewardCount', 'settledAt', 'startedAt', 'status', 'story', 'type', 'winnerId']);
  // Hidden draws never leak: reserved inventory UUIDs and reward payloads.
  const reservedIds = rows(dir, 'SELECT inventory_id FROM primary_palette_rewards WHERE auction_id = ?', first.id)
    .map(row => row.inventory_id);
  assert.equal(reservedIds.length, 3);
  for (const body of [JSON.stringify(list), JSON.stringify(detail)]) {
    for (const reservedId of reservedIds) assert.ok(!body.includes(reservedId));
    assert.doesNotMatch(body, /"rewards"|"inventoryId"|"item_json"|"random/);
  }
  // Query bounds follow the domain model: limit clamps to 1..200, offset is
  // a non-negative integer, invalid values fall back to the defaults.
  assert.equal((await (await fetch(`${base}/api/palette-auctions?limit=1`)).json()).auctions.length, 1);
  assert.equal((await (await fetch(`${base}/api/palette-auctions?limit=0`)).json()).auctions.length, 2);
  assert.equal((await (await fetch(`${base}/api/palette-auctions?limit=5000`)).json()).auctions.length, 2);
  assert.equal((await (await fetch(`${base}/api/palette-auctions?limit=1&offset=1`)).json()).auctions.length, 1);
  assert.equal((await (await fetch(`${base}/api/palette-auctions?limit=1&offset=9`)).json()).auctions.length, 0);
  // Unknown and malformed ids 404 safely (no 500 on bad percent-encoding).
  assert.equal((await fetch(`${base}/api/palette-auctions/missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/palette-auctions/%E0%A4%A`)).status, 404);
});

test('bidding over HTTP routes through the escrow domain with CSRF and level gates', async t => {
  const { dir, base, post, adminCookie, register, createLot } = await fixture(t);
  const lot = await createLot(adminCookie, 'bid-lot-000000001');
  const buyer = await register('Buyer');
  withDatabase(dir, db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(buyer.user.id));
  // Unauthenticated and CSRF-less calls never reach the domain.
  assert.equal((await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve })).status, 401);
  assert.equal((await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve }, buyer.cookie, null)).status, 403);
  // The domain's rules surface verbatim: lowball, then a real escrow debit.
  assert.equal((await (await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve - 1 }, buyer.cookie)).json()).error, 'bid_too_low');
  assert.equal((await (await post('palette-auctions/bid', { id: lot.id, amount: 'nope' }, buyer.cookie)).json()).error, 'invalid_bid');
  const increment = paletteBidIncrement(lot.reserve);
  const accepted = await (await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve + increment }, buyer.cookie)).json();
  assert.equal(accepted.auction.currentBid, lot.reserve + increment);
  assert.equal(accepted.auction.bidCount, 1);
  assert.equal(accepted.user.tokens, 100000 - lot.reserve - increment); // refreshed spendable balance
  // Raises below the value-tiered minimum are rejected without moving tokens.
  assert.equal((await (await post('palette-auctions/bid', { id: lot.id, amount: accepted.auction.currentBid + increment - 1 }, buyer.cookie)).json()).error, 'bid_too_low');
  assert.equal(accepted.user.tokens, 100000 - lot.reserve - increment);
  assert.equal((await (await post('palette-auctions/bid', { id: lot.id, amount: 99_999_999 }, buyer.cookie)).json()).error, 'insufficient_tokens');
  // Level gate reads persisted xp through the shared progression module.
  const news = await (await post('admin/news', { id: 'level-api-bust', title: 'T', body: 'B', status: 'published',
    paletteIds: ['electronics-smuggling'],
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 2 }] }, adminCookie)).json();
  assert.equal(news.event.status, 'published');
  const levelled = await createLot(adminCookie, 'bid-lot-000000002', 'event:level-api-bust:electronics-smuggling');
  assert.equal(levelled.requiredLevel, 3);
  withDatabase(dir, db => db.prepare('UPDATE users SET xp = 399 WHERE id = ?').run(buyer.user.id));
  assert.equal((await (await post('palette-auctions/bid', { id: levelled.id, amount: levelled.reserve }, buyer.cookie)).json()).error, 'level_required');
  withDatabase(dir, db => db.prepare('UPDATE users SET xp = 400 WHERE id = ?').run(buyer.user.id));
  const highEnough = await (await post('palette-auctions/bid', { id: levelled.id, amount: levelled.reserve }, buyer.cookie)).json();
  assert.equal(highEnough.user.progression.level, 3);
  assert.equal(highEnough.user.tokens, 100000 - lot.reserve - increment - levelled.reserve);
});

test('winner reveal over HTTP stays deadline-gated, winner-only and repeat-stable', async t => {
  const { dir, base, post, adminCookie, register, createLot } = await fixture(t);
  const lot = await createLot(adminCookie, 'reveal-lot-00000001');
  const winner = await register('Winner'), loser = await register('Loser');
  withDatabase(dir, db => db.prepare('UPDATE users SET tokens = 100000 WHERE id IN (?, ?)').run(winner.user.id, loser.user.id));
  await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve }, loser.cookie);
  await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve + paletteBidIncrement(lot.reserve) }, winner.cookie);
  const revealRoute = `palette-auctions/${encodeURIComponent(lot.id)}/rewards`;
  assert.equal((await fetch(`${base}/api/account/${revealRoute}`)).status, 401);
  // Before the deadline: unavailable for the leader, without reward details.
  assert.equal((await (await fetch(`${base}/api/account/${revealRoute}`, { headers: { cookie: winner.cookie } })).json()).error, 'rewards_unavailable');
  forceDue(dir, lot.id);
  // Loser and unrelated admin get the same generic not-found body.
  const loserResponse = await fetch(`${base}/api/account/${revealRoute}`, { headers: { cookie: loser.cookie } });
  const adminResponse = await fetch(`${base}/api/account/${revealRoute}`, { headers: { cookie: adminCookie } });
  assert.equal(loserResponse.status, 404);
  assert.equal(adminResponse.status, 404);
  const loserBody = await loserResponse.text();
  assert.equal(loserBody, await adminResponse.text());
  assert.deepEqual(JSON.parse(loserBody), { error: 'palette_rewards_not_found' });
  // The winner gets exactly the three frozen rewards; reveal settles on demand.
  const reveal = await (await fetch(`${base}/api/account/${revealRoute}`, { headers: { cookie: winner.cookie } })).json();
  assert.equal(reveal.reveal.winnerId, winner.user.id);
  assert.equal(reveal.reveal.bundleCostTokens, lot.reserve + paletteBidIncrement(lot.reserve));
  assert.deepEqual(reveal.reveal.rewards.map(reward => reward.position), [0, 1, 2]);
  const reserved = rows(dir, 'SELECT position, inventory_id, item_json FROM primary_palette_rewards WHERE auction_id = ? ORDER BY position', lot.id);
  assert.deepEqual(reveal.reveal.rewards.map(reward => reward.inventoryId), reserved.map(row => row.inventory_id));
  for (const reward of reveal.reveal.rewards) {
    assert.equal(reward.item.paletteAuctionId, lot.id);
    assert.equal(reward.item.bundleCostTokens, lot.reserve + paletteBidIncrement(lot.reserve));
  }
  assert.equal(rows(dir, 'SELECT id FROM inventory').length, 3); // settlement minted the rewards
  const repeat = await (await fetch(`${base}/api/account/${revealRoute}`, { headers: { cookie: winner.cookie } })).json();
  assert.deepEqual(repeat, reveal); // same snapshots, no state change
  assert.equal(rows(dir, 'SELECT id FROM inventory').length, 3); // retrieval never mints
});

test('admin creation route is admin-only, idempotent and injection-proof', async t => {
  const { dir, post, adminCookie, register, editionId, createLot } = await fixture(t);
  const player = await register('Player');
  assert.equal((await post('admin/palette-auctions', { editionId, requestId: 'admin-lot-00000001' }, player.cookie)).status, 403);
  assert.equal((await post('admin/palette-auctions', { editionId, requestId: 'admin-lot-00000001' })).status, 401);
  // Only editionId and requestId reach the domain: every other offered field
  // is dropped, and the domain still owns reserve, duration, level and draws.
  const injected = await createLot(adminCookie, 'admin-lot-00000001', editionId,
    { reserve: 1, durationMs: 1, requiredLevel: 99, rewards: [{ title: 'forged' }], winnerId: 'attacker', seed: 1, endsAt: 0 });
  assert.equal(injected.status, 'active');
  assert.equal(injected.requiredLevel, 1); // edition's frozen level, not 99
  assert.equal(injected.endsAt - injected.startedAt, 3600_000); // exactly one hour
  assert.ok(Number.isSafeInteger(injected.reserve) && injected.reserve > 0 && injected.reserve !== 1);
  const stored = rows(dir, 'SELECT position, inventory_id FROM primary_palette_rewards WHERE auction_id = ?', injected.id);
  assert.equal(stored.length, 3); // three sealed draws, nothing from the payload
  assert.equal(injected.winnerId, null);
  // Identical replays are idempotent; a conflicting edition is the domain's 409.
  assert.deepEqual(await createLot(adminCookie, 'admin-lot-00000001'), injected);
  const conflict = await post('admin/palette-auctions', { editionId: 'event:nope:missing', requestId: 'admin-lot-00000001' }, adminCookie);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'request_conflict');
  for (const requestId of ['short', 'x'.repeat(81), 'has spaces!!']) {
    assert.equal((await post('admin/palette-auctions', { editionId, requestId }, adminCookie)).status, 400);
  }
});

test('market history endpoint serves bounded, validated, read-only history', async t => {
  const { dir, base, post, adminCookie } = await fixture(t);
  // Deterministic snapshots seeded before simulation activation (the public
  // setter is the documented pre-activation seeding path).
  setMarketIndex(dir, 'wine', 101.111, { now: Date.parse('2026-09-15T00:00:00Z'), snapshot: true });
  setMarketIndex(dir, 'wine', 102.222, { now: Date.parse('2026-09-15T01:00:00Z'), snapshot: true });
  setMarketIndex(dir, 'wine', 103.333, { now: Date.parse('2026-09-15T02:00:00Z'), snapshot: true });
  setMarketIndex(dir, 'tools', 90, { now: Date.parse('2026-09-15T02:00:00Z'), snapshot: true });
  const history = await (await fetch(`${base}/api/market/wine/history`)).json();
  assert.equal(history.category, 'wine');
  assert.deepEqual(history.history, [
    { indexValue: 103.33, capturedAt: '2026-09-15T02:00:00.000Z' },
    { indexValue: 102.22, capturedAt: '2026-09-15T01:00:00.000Z' },
    { indexValue: 101.11, capturedAt: '2026-09-15T00:00:00.000Z' }]); // newest first, 2-decimal public rounding
  assert.equal((await (await fetch(`${base}/api/market/wine/history?limit=2`)).json()).history.length, 2);
  assert.equal((await (await fetch(`${base}/api/market/wine/history?limit=99999`)).json()).history.length, 3);
  assert.equal((await (await fetch(`${base}/api/market/wine/history?limit=abc`)).json()).history.length, 3);
  const unknown = await fetch(`${base}/api/market/nope/history`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'unknown_category' });
  assert.equal((await fetch(`${base}/api/market/wine/history/extra`)).status, 404);
  // After activation through publication the route keeps answering (values
  // are reconstruction-timing dependent; the contract here is shape-only).
  const published = await post('admin/news', { id: 'history-bust', title: 'T', body: 'B', status: 'published',
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 5 }] }, adminCookie);
  assert.equal(published.status, 200);
  const live = await (await fetch(`${base}/api/market/wine/history?limit=168`)).json();
  assert.equal(live.category, 'wine');
  for (const point of live.history) {
    assert.ok(Number.isFinite(point.indexValue));
    assert.ok(typeof point.capturedAt === 'string');
  }
});

test('market history is hidden while the market flag is off', async t => {
  const { base } = await fixture(t, {
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true', FEATURE_NEWS: '1'
  });
  assert.equal((await fetch(`${base}/api/market`)).status, 404);
  assert.equal((await fetch(`${base}/api/market/wine/history`)).status, 404);
});

test('authenticated profile exposes the shared progression read model', async t => {
  const { dir, base, register } = await fixture(t);
  const player = await register('Player');
  const initial = await (await fetch(`${base}/api/account/me`, { headers: { cookie: player.cookie } })).json();
  assert.deepEqual(initial.user.progression, { xp: 0, level: 1, levelStartXp: 0, nextLevelXp: 100,
    xpIntoLevel: 0, xpNeededForNextLevel: 100, progress: 0 });
  withDatabase(dir, db => db.prepare('UPDATE users SET xp = 4750 WHERE id = ?').run(player.user.id));
  const progressed = await (await fetch(`${base}/api/account/me`, { headers: { cookie: player.cookie } })).json();
  assert.deepEqual(progressed.user.progression, { xp: 4750, level: 7, levelStartXp: 3600, nextLevelXp: 4900,
    xpIntoLevel: 1150, xpNeededForNextLevel: 1300, progress: 1150 / 1300 });
  // No raw xp leaks outside the progression object.
  assert.equal('xp' in progressed.user, false);
});


test('authenticated My bids endpoint discovers a settled win without revealing rewards', async t => {
  const { dir, base, post, adminCookie, register, createLot } = await fixture(t);
  const player = await register('Historian');
  const lot = await createLot(adminCookie, 'history-api-lot-00001');
  withDatabase(dir, db => db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(player.user.id));
  assert.equal((await fetch(base + '/api/account/palette-auctions')).status, 401);
  assert.equal((await post('palette-auctions/bid', { id: lot.id, amount: lot.reserve }, player.cookie)).status, 200);
  const getMine = cookie => fetch(base + '/api/account/palette-auctions?limit=1', { headers: { cookie } }).then(r => r.json());
  const active = await getMine(player.cookie);
  assert.equal(active.auctions[0].leading, true);
  assert.equal(active.auctions[0].revealAvailable, false);
  assert.equal((await getMine(adminCookie)).auctions.length, 0);
  forceDue(dir, lot.id);
  const ended = await getMine(player.cookie);
  assert.equal(ended.auctions[0].won, true);
  assert.equal(ended.auctions[0].revealAvailable, true);
  assert.doesNotMatch(JSON.stringify(ended), /"rewards"|inventoryId|item_json/);
  const reveal = await fetch(base + '/api/account/palette-auctions/' + lot.id + '/rewards', { headers: { cookie: player.cookie } }).then(r => r.json());
  assert.equal(reveal.reveal.rewards.length, 3);
});

test('features discovery and participation history preserve independent flags', async t => {
  const { base, adminCookie } = await fixture(t, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, FEATURE_RESALES: 'true' });
  const result = await fetch(base + '/api/features').then(r => r.json());
  assert.deepEqual(result.features, { news: false, market: false, resales: true, palettes: false, paletteAuctions: false });
  assert.equal((await fetch(base + '/api/account/palette-auctions', { headers: { cookie: adminCookie } })).status, 404);
});
