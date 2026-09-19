import { createHash } from 'node:crypto';
import { featureFlags } from './features.mjs';
import { loadPaletteCatalog } from './palette-definitions.mjs';
import { createPaletteAuction, settleDuePaletteAuctions } from './palette-auctions.mjs';
import { settleDueListings } from './resale.mjs';
import { tickNpcBuyers } from './npc-buyers.mjs';
import { tickWorldNews } from './world-news.mjs';
import { AccountError } from './errors.mjs';

export function supplyPaletteAuctions(dataDir, { now = Date.now() } = {}) {
  const catalog = loadPaletteCatalog(dataDir, { now });
  const editions = catalog.palettes.filter(p => p.availability === 'available' && p.endsAt >= now + 3600_000)
    .sort((a, b) => (a.kind === 'event' ? 0 : 1) - (b.kind === 'event' ? 0 : 1)
      || (a.editionId < b.editionId ? -1 : a.editionId > b.editionId ? 1 : 0));
  const created = [], skipped = [];
  for (const edition of editions) {
    const requestId = createHash('sha256').update(`primary:${edition.editionId}:${Math.floor(now / 3600_000)}`).digest('hex');
    try {
      const auction = createPaletteAuction(dataDir, { editionId: edition.editionId, requestId }, { now, automaticSupply: true });
      if (auction) created.push(auction.id);
    } catch (error) {
      if (!(error instanceof AccountError) || error.message !== 'insufficient_value_spread') throw error;
      skipped.push(edition.editionId);
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
