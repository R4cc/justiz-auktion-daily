import { featureFlags } from './features.mjs';
import { rotationDate, loadCaseCatalog } from './cases.mjs';
import { marketState } from './market.mjs';
import { listPublishedNews } from './news.mjs';
import { publicPaletteCatalog } from './palettes.mjs';
import { listResales, getResale } from './resale.mjs';
import { AccountError } from './errors.mjs';

// Read-only public endpoints for the flag-gated economy foundation.
// Every route is off until its feature flag is enabled; disabled routes fall
// through (404) so unfinished systems never surface to normal players.
export function createEconomyApi({ dataDir, json, flags = featureFlags() }) {
  let catalog;
  function getCatalog() {
    if (!catalog || catalog.rotationDate !== rotationDate()) catalog = loadCaseCatalog(dataDir);
    return catalog;
  }
  const limited = (value, fallback, max) => Math.min(Math.max(Number(value) || fallback, 1), max);
  return (request, response, url) => {
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/')) return false;
    try {
      if (flags.news && url.pathname === '/api/news') {
        json(response, 200, { news: listPublishedNews(dataDir, { limit: limited(url.searchParams.get('limit'), 20, 100) }) });
        return true;
      }
      if (flags.market && url.pathname === '/api/market') {
        json(response, 200, marketState(dataDir));
        return true;
      }
      if (flags.palettes && url.pathname === '/api/palettes') {
        json(response, 200, publicPaletteCatalog(getCatalog()));
        return true;
      }
      if (flags.resales && url.pathname === '/api/resales') {
        json(response, 200, { listings: listResales(dataDir, { limit: limited(url.searchParams.get('limit'), 50, 200) }) });
        return true;
      }
      if (flags.resales && url.pathname.startsWith('/api/resales/')) {
        json(response, 200, { listing: getResale(dataDir, decodeURIComponent(url.pathname.slice('/api/resales/'.length))) });
        return true;
      }
    } catch (error) {
      if (error instanceof AccountError) json(response, error.status, { error: error.message });
      else { console.error('Economy API failed'); json(response, 500, { error: 'internal_error' }); }
      return true;
    }
    return false;
  };
}
