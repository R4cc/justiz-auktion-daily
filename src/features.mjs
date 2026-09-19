// Auction economy is enabled by default. Explicit false/0/off/no disables a feature.
// Catalog and primary auctions remain independently configurable.
const enabled = value => ['1', 'true', 'on', 'yes'].includes(String(value == null || String(value).trim() === '' ? 'true' : value).trim().toLowerCase());

export function featureFlags(env = process.env) {
  return {
    news: enabled(env.FEATURE_NEWS),
    market: enabled(env.FEATURE_MARKET),
    resales: enabled(env.FEATURE_RESALES),
    palettes: enabled(env.FEATURE_PALETTES),
    paletteAuctions: enabled(env.FEATURE_PALETTE_AUCTIONS)
  };
}
