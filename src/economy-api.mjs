import { supplyReviewAuctions } from './review-auctions.mjs';
import { townMap } from './town-map.mjs';
import { featureFlags } from './features.mjs';
import { marketHistory, marketState } from './market.mjs';
import { supplyStockPaletteAuctions, stockPaletteAuctionCatalog } from './stock-palette-auctions.mjs';
import { loadPaletteCatalog } from './palette-definitions.mjs';
import { listPublishedNews } from './news.mjs';
import { listResales, getResale } from './resale.mjs';
import { getPaletteAuction, listPaletteAuctions } from './palette-auctions.mjs';
import { AccountError } from './errors.mjs';
import { Accounts } from './accounts.mjs';
import { maskBidHistory, maskListing } from './username-privacy.mjs';
import { supplyStockAuctions } from './businesses.mjs';
import { supplyCaseAuctions } from './case-supply.mjs';
import { listStores, visitStore } from './storefronts.mjs';

// Read-only public endpoints for the flag-gated economy foundation.
// Every route is off until its feature flag is enabled; disabled routes fall
// through (404) so unfinished systems never surface to normal players.
export function createEconomyApi({ dataDir, json, flags = featureFlags(), accounts = null }) {
  const limited = (value, fallback, max) => Math.min(Math.max(Number(value) || fallback, 1), max);
  // Malformed percent-encoding must 404 like any unknown id, not 500.
  const decoded = raw => { try { return decodeURIComponent(raw); } catch { return raw; } };
  let sessionAccounts = accounts;
  // Resale listings and bid history carry usernames; signed-in viewers see
  // them in full, everyone else gets the censored prefix.
  const sessionUser = request => {
    sessionAccounts ||= new Accounts(dataDir, { flags });
    const token = request.headers?.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jg_session='))?.slice(11);
    const user = sessionAccounts.user(token);
    return user?.must_change_password ? null : user;
  };
  const signedIn = request => Boolean(sessionUser(request));
  return (request, response, url) => {
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/account/')) return false;
    try {
      const player=request.headers?.cookie?.includes('jg_session=') ? sessionUser(request) : null;
      if ((player?.justice?.jailed||player?.justice?.policeEncounter) && url.pathname!=='/api/features') { const error=new AccountError(player.justice.policeEncounter?'police_recognized':'player_jailed',423); error.justice=player.justice; throw error; }
      if (url.pathname === '/api/features') {
        json(response, 200, { features: Object.fromEntries(Object.keys(featureFlags({})).map(key => [key, Boolean(flags[key])])) });
        return true;
      }
      if (flags.businesses && url.pathname === '/api/town') {
        json(response,200,townMap(dataDir,sessionUser(request))); return true;
      }
      if (flags.businesses && (url.pathname === '/api/stores' || url.pathname.startsWith('/api/stores/'))) {
        const viewer = sessionUser(request);
        json(response, 200, url.pathname === '/api/stores'
          ? listStores(dataDir, viewer, { query: url.searchParams.get('query') || '', type: url.searchParams.get('type') || '', offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit') })
          : visitStore(dataDir, viewer, decoded(url.pathname.slice('/api/stores/'.length))));
        return true;
      }
      if (flags.news && url.pathname === '/api/news') {
        json(response, 200, { news: listPublishedNews(dataDir, { limit: limited(url.searchParams.get('limit'), 20, 100) }) });
        return true;
      }
      if (flags.market && url.pathname === '/api/market') {
        json(response, 200, marketState(dataDir));
        return true;
      }
      if (flags.market && url.pathname.startsWith('/api/market/') && url.pathname.endsWith('/history')) {
        // Range charts reconstruct bounded minute/intraday samples from the
        // shared simulation; legacy limit-based readers keep hourly history.
        const category = decoded(url.pathname.slice('/api/market/'.length, -'/history'.length));
        const now = Date.now(), range = url.searchParams.get('range');
        json(response, 200, { category, updatedAt: new Date(now).toISOString(), range,
          history: marketHistory(dataDir, category,
            { now, range, limit: limited(url.searchParams.get('limit'), 168, 1000) }) });
        return true;
      }
      if (flags.palettes && url.pathname === '/api/stock-palettes') {json(response,200,stockPaletteAuctionCatalog(dataDir,{userId:player?.must_change_password?null:player?.id}));return true;}
      if (flags.palettes && url.pathname === '/api/palettes') {
        // Persisted palette catalog: frozen editions with evaluated
        // availability; the legacy case catalog is untouched by this.
        json(response, 200, loadPaletteCatalog(dataDir));
        return true;
      }
      if (flags.paletteAuctions && url.pathname === '/api/palette-auctions') {
        // Active primary lots only; the domain owns bounds and serialization
        // (its explicit public allowlist never includes hidden rewards or
        // reserved inventory ids).
        if(flags.palettes)supplyStockPaletteAuctions(dataDir);
        json(response, 200, { auctions: listPaletteAuctions(dataDir, {
          limit: limited(url.searchParams.get('limit'), 50, 200),
          offset: Number(url.searchParams.get('offset')) || 0 }) });
        return true;
      }
      if (flags.paletteAuctions && url.pathname.startsWith('/api/palette-auctions/')) {
        const auction = getPaletteAuction(dataDir,
          decoded(url.pathname.slice('/api/palette-auctions/'.length)),
          { viewerId: player?.id });
        json(response, 200, { auction: player ? auction : maskBidHistory(auction) });
        return true;
      }
      if (flags.resales && url.pathname === '/api/resales') {
        if (flags.businesses) supplyReviewAuctions(dataDir);
        if (flags.businesses) supplyStockAuctions(dataDir,{retire:true});
        supplyCaseAuctions(dataDir);
        const listings = listResales(dataDir, { limit: limited(url.searchParams.get('limit'), 50, 200) });
        json(response, 200, { listings: signedIn(request) ? listings : listings.map(maskListing) });
        return true;
      }
      if (flags.resales && url.pathname.startsWith('/api/resales/')) {
        const listing = getResale(dataDir, decoded(url.pathname.slice('/api/resales/'.length)),
          { viewerId: player?.must_change_password ? null : player?.id });
        json(response, 200, { listing: signedIn(request) ? listing : maskListing(listing) });
        return true;
      }
    } catch (error) {
      if (error instanceof AccountError) json(response, error.status, { error: error.message, ...(error.justice ? {justice:error.justice} : {}) });
      else { console.error('Economy API failed'); json(response, 500, { error: 'internal_error' }); }
      return true;
    }
    return false;
  };
}
