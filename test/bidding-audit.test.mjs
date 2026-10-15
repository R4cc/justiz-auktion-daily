import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions, withDatabase } from '../src/database.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { MARKET_CATEGORIES, setMarketIndex } from '../src/market.mjs';
import { createPaletteAuction, bidOnPaletteAuction } from '../src/palette-auctions.mjs';
import { listItem, placeBid, settleAuction } from '../src/resale.mjs';
import { NPC_BUYERS, npcCohort, seedNpcBuyers, tickNpcBuyers, tickPaletteBuyers, PALETTE_SHOWUP_MS } from '../src/npc-buyers.mjs';

const now = Date.parse('2026-10-15T12:00:00Z'), hour = 3600_000;
const unit = key => /:interest$|:palette-showup$/.test(key) ? 0 : .5;
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-bidding-audit-'));
  const accounts = new Accounts(dir, { now: () => now });
  upsertAuctions(dir, Array.from({ length: 24 }, (_, n) => ({ id: 1000 + n, title: `Laptop Lenovo ${n}`,
    category: 'Elektronik', currentBid: 10 + n * 20, image: '/favicon.png' })));
  const read = (sql, ...args) => withDatabase(dir, db => db.prepare(sql).all(...args));
  const write = (sql, ...args) => withDatabase(dir, db => db.prepare(sql).run(...args));
  for (const id of ['seller', 'player']) write(`INSERT INTO users(id,username,password_hash,tokens,xp,admin,created_at)
    VALUES (?,?,'disabled',1000000,40000,?,?)`, id, id, Number(id === 'seller'), now);
  seedNpcBuyers(dir, { now });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  const resale = (id = 'audit-item') => {
    write('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?, ?, ?, ?)', id, 'seller',
      JSON.stringify({ title: `Audit ${id}`, price: 1000, rarity: 'common', marketCategory: 'electronics' }), now);
    return listItem(dir, { id: 'seller' }, { inventoryId: id, startPrice: 10,
      endsAt: new Date(now + hour).toISOString() }, { now });
  };
  const primary = () => createPaletteAuction(dir, { editionId: loadPaletteCatalog(dir, { now }).palettes.find(p => p.id === 'fundkiste').editionId,
    requestId: 'audit-primary-request' }, { now, random: () => 0 });
  return { dir, accounts, read, write, resale, primary };
}
const cash = (f, id) => f.read('SELECT tokens FROM users WHERE id=?', id)[0].tokens;

// NPCs that lose a proxy challenge do not become the leader, so the ordinary
// "do not outbid yourself" check cannot make their scheduler slot idempotent.
test('a losing NPC palette challenge happens once per slot, including after restart', async t => {
  const f = await fixture(t), lot = f.primary();
  for (const { id } of MARKET_CATEGORIES) setMarketIndex(f.dir, id, 150, { now });
  bidOnPaletteAuction(f.dir, { id: 'player' }, lot.id, lot.reserve * 10, { now });
  assert.equal(tickPaletteBuyers(f.dir, { now: now + 30_000, unit }).bids, 1);
  const before = f.read('SELECT current_bid,max_bid,ends_at FROM primary_palette_auctions WHERE id=?', lot.id);
  const balance = cash(f, 'player');
  closeDataStore(f.dir);
  assert.equal(tickPaletteBuyers(f.dir, { now: now + 60_000, unit }).bids, 0);
  assert.deepEqual(f.read('SELECT current_bid,max_bid,ends_at FROM primary_palette_auctions WHERE id=?', lot.id), before);
  assert.equal(cash(f, 'player'), balance);
  assert.equal(tickPaletteBuyers(f.dir, { now: now + PALETTE_SHOWUP_MS + 30_000, unit }).bids, 1);
});

test('resale NPCs can afford the minimum even when their normal jump exceeds their wallet', async t => {
  const f = await fixture(t), lot = f.resale();
  tickNpcBuyers(f.dir, { now, unit });
  const npc = f.read('SELECT npc_id FROM resale_npc_interest WHERE auction_id=? ORDER BY npc_id LIMIT 1', lot.id)[0].npc_id;
  f.write('UPDATE resale_npc_interest SET active=0 WHERE auction_id=?', lot.id);
  f.write('UPDATE resale_npc_interest SET active=1,next_bid_at=? WHERE auction_id=? AND npc_id=?', now, lot.id, npc);
  f.write('UPDATE users SET tokens=10 WHERE id=?', npc);
  // Always choose a jump rather than the cheap exact-minimum branch.
  const jumps = key => /:interest$/.test(key) ? 0 : .999;
  assert.equal(tickNpcBuyers(f.dir, { now: now + 30_000, unit: jumps }).bids, 1);
  assert.equal(cash(f, npc), 0);
  assert.equal(f.read('SELECT max_bid FROM resale_auctions WHERE id=?', lot.id)[0].max_bid, 10);
  const sold = settleAuction(f.dir, lot.id, { now: now + hour });
  assert.equal(sold.winnerId, npc); assert.equal(sold.currentBid, 10);
});

test('palette NPCs cap a proposed maximum at their spendable funds', async t => {
  const f = await fixture(t), lot = f.primary();
  for (const { id } of MARKET_CATEGORIES) setMarketIndex(f.dir, id, 150, { now });
  const cohort = npcCohort(lot.id, 4), npc = cohort[Math.floor(now / PALETTE_SHOWUP_MS) % cohort.length];
  f.write('UPDATE users SET tokens=? WHERE id=?', lot.reserve, npc.id);
  assert.equal(tickPaletteBuyers(f.dir, { now: now + 30_000, unit }).bids, 1);
  assert.equal(cash(f, npc.id), 0);
  assert.equal(f.read('SELECT max_bid FROM primary_palette_auctions WHERE id=?', lot.id)[0].max_bid, lot.reserve);
});

test('automatic NPC proxy defenses do not restart the discretionary resale cooldown', async t => {
  const f = await fixture(t), lot = f.resale(), first = NPC_BUYERS[0], other = NPC_BUYERS[1];
  placeBid(f.dir, first, lot.id, 100, { now });
  // This player's losing challenge causes an automatic defense, not a new
  // discretionary NPC turn. More than 30 seconds have passed since that turn.
  placeBid(f.dir, { id: 'player' }, lot.id, 20, { now: now + 60_000 });
  assert.doesNotThrow(() => placeBid(f.dir, other, lot.id, 110, { now: now + 61_000 }));
  assert.equal(cash(f, first.id), 1_000_000_000);
});

test('a concurrent resale NPC winner does not abort the rest of the runtime tick', async t => {
  const f = await fixture(t), lot = f.resale();
  tickNpcBuyers(f.dir, { now, unit });
  const npc = f.read('SELECT npc_id FROM resale_npc_interest WHERE auction_id=? ORDER BY npc_id LIMIT 1', lot.id)[0].npc_id;
  f.write('UPDATE resale_npc_interest SET active=0 WHERE auction_id=?', lot.id);
  f.write('UPDATE resale_npc_interest SET active=1,next_bid_at=? WHERE auction_id=? AND npc_id=?', now, lot.id, npc);
  let raced = false;
  const concurrent = key => {
    if (!raced && key.endsWith(':cheap')) {
      raced = true;
      placeBid(f.dir, { id: npc }, lot.id, 20, { now: now + 30_000 });
    }
    return unit(key);
  };
  assert.doesNotThrow(() => tickNpcBuyers(f.dir, { now: now + 30_000, unit: concurrent }));
  assert.equal(raced, true);
  assert.equal(f.read('SELECT current_bidder_id FROM resale_auctions WHERE id=?', lot.id)[0].current_bidder_id, npc);
});

test('a banned selected NPC cannot abort either bidding runtime', async t => {
  const f = await fixture(t), lot = f.resale(), palette = f.primary();
  tickNpcBuyers(f.dir, { now, unit });
  f.write('UPDATE users SET banned=1 WHERE npc=1');
  assert.doesNotThrow(() => tickNpcBuyers(f.dir, { now: now + 90_000, unit }));
  for (const { id } of MARKET_CATEGORIES) setMarketIndex(f.dir, id, 150, { now });
  assert.doesNotThrow(() => tickPaletteBuyers(f.dir, { now: now + 30_000, unit }));
  assert.equal(f.read('SELECT current_bid FROM resale_auctions WHERE id=?', lot.id)[0].current_bid, null);
  assert.equal(f.read('SELECT current_bid FROM primary_palette_auctions WHERE id=?', palette.id)[0].current_bid, null);
});

test('NPC slot claims roll back with rejected bids and disappear with an economy reset', async t => {
  const f = await fixture(t), lot = f.primary(), npc = NPC_BUYERS[0], rival = NPC_BUYERS[1];
  f.write('UPDATE users SET tokens=0 WHERE id=?', npc.id);
  assert.throws(() => bidOnPaletteAuction(f.dir, npc, lot.id, lot.reserve, { now, npc: true }), /insufficient_tokens/);
  assert.equal(f.read('SELECT COUNT(*) AS n FROM primary_palette_npc_slots')[0].n, 0);
  f.write('UPDATE users SET tokens=? WHERE id=?', lot.reserve, npc.id);
  bidOnPaletteAuction(f.dir, npc, lot.id, lot.reserve, { now, npc: true });
  const before = cash(f, rival.id);
  assert.throws(() => bidOnPaletteAuction(f.dir, rival, lot.id, lot.reserve + 100, { now: now + 1000, npc: true }), /npc_bid_wait/);
  assert.equal(cash(f, rival.id), before);
  assert.equal(f.read('SELECT COUNT(*) AS n FROM primary_palette_npc_slots')[0].n, 1);
  f.accounts.resetEconomy({ id: 'seller', admin: true }, 'RESET ECONOMY');
  assert.equal(f.read('SELECT COUNT(*) AS n FROM primary_palette_npc_slots')[0].n, 0);
  assert.equal(f.read('SELECT COUNT(*) AS n FROM primary_palette_auctions')[0].n, 0);
});

test('upgrading an active NPC slot does not replay its old bid or rewrite history', async t => {
  const f = await fixture(t), lot = f.primary();
  for (const { id } of MARKET_CATEGORIES) setMarketIndex(f.dir, id, 150, { now });
  bidOnPaletteAuction(f.dir, { id: 'player' }, lot.id, lot.reserve * 10, { now });
  tickPaletteBuyers(f.dir, { now: now + 30_000, unit });
  const history = f.read('SELECT * FROM primary_palette_bids ORDER BY id');
  // Simulate the previous release, which had bids but no durable slot table.
  f.write('DROP TABLE primary_palette_npc_slots'); closeDataStore(f.dir);
  assert.equal(tickPaletteBuyers(f.dir, { now: now + 60_000, unit }).bids, 0);
  assert.deepEqual(f.read('SELECT * FROM primary_palette_bids ORDER BY id'), history);
  assert.equal(f.read('SELECT COUNT(*) AS n FROM primary_palette_npc_slots')[0].n, 1);
});


test('separate bidding processes cannot consume one palette NPC slot twice', async t => {
  const f = await fixture(t), lot = f.primary();
  bidOnPaletteAuction(f.dir, { id: 'player' }, lot.id, lot.reserve * 100, { now });
  const run = promisify(execFile), moduleUrl = new URL('../src/palette-auctions.mjs', import.meta.url).href;
  const script = `import {bidOnPaletteAuction} from ${JSON.stringify(moduleUrl)};
    try {
      bidOnPaletteAuction(process.argv[1], {id:process.argv[2]}, process.argv[3], Number(process.argv[4]), {now:Number(process.argv[5]),npc:true});
      process.stdout.write(JSON.stringify({accepted:true}));
    } catch(error) {
      if (!error.status) throw error;
      process.stdout.write(JSON.stringify({code:error.message}));
    }`;
  const results = await Promise.all([0, 1].map(index => run(process.execPath,
    ['--input-type=module', '-e', script, f.dir, NPC_BUYERS[index].id, lot.id, String(lot.reserve + 100 + index * 100), String(now + 30_000)])));
  const outcomes = results.map(result => JSON.parse(result.stdout));
  assert.equal(outcomes.filter(result => result.accepted).length, 1);
  assert.ok(outcomes.filter(result => !result.accepted).every(result => ['npc_bid_wait', 'bid_too_low'].includes(result.code)));
  assert.equal(f.read('SELECT COUNT(*) AS n FROM primary_palette_npc_slots WHERE auction_id=?', lot.id)[0].n, 1);
  assert.equal(f.read(`SELECT COUNT(*) AS n FROM primary_palette_bids b JOIN users u ON u.id=b.bidder_id
    WHERE b.auction_id=? AND u.npc=1`, lot.id)[0].n, 1);
});

test('NPCs cannot reuse other auctions escrow and can bid again after an exact player-funded refund', async t => {
  const f = await fixture(t), first = f.resale('first-budget'), second = f.resale('second-budget');
  tickNpcBuyers(f.dir, { now, unit });
  const npc = f.read('SELECT npc_id FROM resale_npc_interest WHERE auction_id=? ORDER BY npc_id LIMIT 1', first.id)[0].npc_id;
  f.write('UPDATE resale_npc_interest SET active=0');
  f.write('UPDATE resale_npc_interest SET active=1,next_bid_at=? WHERE npc_id=?', now, npc);
  // The two titles can have different cohorts; ensure this same buyer has
  // interest in both without changing its willingness-to-pay ceiling.
  f.write(`INSERT OR IGNORE INTO resale_npc_interest(auction_id,npc_id,max_bid,next_bid_at,created_at,active)
    VALUES (?,?,1000,?,?,1)`, second.id, npc, now, now);
  f.write('UPDATE users SET tokens=10 WHERE id=?', npc);
  const ledger = () => f.read(`SELECT (SELECT SUM(tokens) FROM users) +
    (SELECT COALESCE(SUM(max_bid),0) FROM resale_auctions WHERE settled_at IS NULL) AS total`)[0].total;
  const original = ledger();
  assert.equal(tickNpcBuyers(f.dir, { now: now + 30_000, unit }).bids, 1);
  assert.equal(cash(f, npc), 0); assert.equal(ledger(), original);
  const rows = f.read('SELECT id,current_bid FROM resale_auctions ORDER BY id');
  const held = rows.find(row => row.current_bid !== null), waiting = rows.find(row => row.current_bid === null);
  assert.ok(held && waiting);
  placeBid(f.dir, { id: 'player' }, held.id, 20, { now: now + 31_000 });
  assert.equal(cash(f, npc), 10); assert.equal(ledger(), original);
  assert.equal(tickNpcBuyers(f.dir, { now: now + 120_000, unit }).bids, 1);
  assert.equal(f.read('SELECT current_bidder_id FROM resale_auctions WHERE id=?', waiting.id)[0].current_bidder_id, npc);
  assert.equal(cash(f, npc), 0); assert.equal(ledger(), original);
});
