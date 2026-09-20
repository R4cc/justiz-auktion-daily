import { createHash } from 'node:crypto';
import { featureFlags } from './features.mjs';
import { loadPaletteCatalog } from './palette-definitions.mjs';
import { createPaletteAuction, settleDuePaletteAuctions, PALETTE_ACTIVE_TARGET, PALETTE_AUCTION_DURATION_MS } from './palette-auctions.mjs';
import { settleDueListings } from './resale.mjs';
import { tickNpcBuyers } from './npc-buyers.mjs';
import { tickWorldNews } from './world-news.mjs';
import { AccountError } from './errors.mjs';

// The board targets ten concurrent one-hour lots. One drop window every
// duration/target (six minutes) keeps their ends evenly staggered, and a lot
// always ends one full duration after its window — never after its creation
// moment — so a backfilled board still ends one lot at a time. The
// bucket-derived request id makes restarts and concurrent runtimes safe: the
// current window and the previous target-1 windows are retried idempotently
// on every tick (a fresh or restarted system fills the whole board at once),
// and older windows are never backfilled.
export const PALETTE_DROP_PERIOD_MS = PALETTE_AUCTION_DURATION_MS / PALETTE_ACTIVE_TARGET;

const TOLERATED_SUPPLY_ERRORS = new Set(['request_conflict', 'palette_edition_busy', 'palette_window_closes_early',
  'palette_edition_inactive', 'palette_edition_unavailable', 'insufficient_value_spread']);

export function supplyPaletteAuctions(dataDir, { now = Date.now() } = {}) {
  const catalog = loadPaletteCatalog(dataDir, { now });
  const editions = catalog.palettes.filter(p => p.availability === 'available' && p.endsAt >= now + 3600_000)
    .sort((a, b) => a.editionId < b.editionId ? -1 : a.editionId > b.editionId ? 1 : 0);
  const created = [], skipped = [];
  if (!editions.length) return { auctions: created, skipped };
  const currentBucket = Math.floor(now / PALETTE_DROP_PERIOD_MS);
  // Oldest window first, so a fresh board is filled with ends that are
  // already staggered and the newest window is the one dropped at the cap.
  for (let bucket = currentBucket - PALETTE_ACTIVE_TARGET + 1; bucket <= currentBucket; bucket++) {
    const selection = parseInt(createHash('sha256').update(`palette-drop:${bucket}`).digest('hex').slice(0, 8), 16);
    const requestId = createHash('sha256').update(`palette-drop:${bucket}`).digest('hex');
    const endsAt = (bucket + 1) * PALETTE_DROP_PERIOD_MS + PALETTE_AUCTION_DURATION_MS;
    // Try the remaining editions if the selected theme temporarily lacks a
    // viable value spread or already holds its concurrent lots. A window
    // whose whole board slot is taken creates no more than one auction.
    for (let offset = 0; offset < editions.length; offset++) {
      const edition = editions[(selection + offset) % editions.length];
      try {
        const auction = createPaletteAuction(dataDir, { editionId: edition.editionId, requestId, endsAt }, { now, automaticSupply: true });
        if (auction) created.push(auction.id);
        break;
      } catch (error) {
        if (!(error instanceof AccountError) || !TOLERATED_SUPPLY_ERRORS.has(error.message)) throw error;
        skipped.push(edition.editionId);
      }
    }
  }
  return { auctions: [...new Set(created)], skipped };
}

// Independent branches: a failed system cannot stop settlements elsewhere.
// Pure scheduling wrapper; creation and accounting remain domain-owned.
export function tickEconomy(dataDir, { now = Date.now(), flags = featureFlags() } = {}) {
  const result = {}, failures = [];
  const run = (name, work) => { try { result[name] = work(); } catch (error) { failures.push({ system: name, code: error instanceof AccountError ? error.message : 'internal_error' }); } };
  if (flags.news) run('news', () => tickWorldNews(dataDir, { now }));
  if (flags.paletteAuctions) {
    run('primarySettlement', () => settleDuePaletteAuctions(dataDir, { now }));
    run('supply', () => supplyPaletteAuctions(dataDir, { now }));
  }
  if (flags.resales) {
    run('resaleSettlement', () => settleDueListings(dataDir, { now }));
    run('buyers', () => tickNpcBuyers(dataDir, { now }));
  }
  return { ...result, failures };
}

export function startEconomyRuntime(dataDir, { flags = featureFlags(), now = Date.now,
  onError = result => console.error('Economy tick needs attention:', result) } = {}) {
  if (!flags.news && !flags.paletteAuctions && !flags.resales) return () => {};
  let stopped = false, timer;
  const tick = () => {
    if (stopped) return;
    const result = tickEconomy(dataDir, { now: now(), flags });
    if (result.failures.length || result.primarySettlement?.failed.length || result.resaleSettlement?.failed.length) onError(result);
    timer = setTimeout(tick, 30_000); timer.unref();
  };
  timer = setTimeout(tick, 1000); timer.unref();
  return () => { stopped = true; clearTimeout(timer); };
}
