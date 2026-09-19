// The playable auction economy is enabled by default. News is intentionally
// dormant for now; its backend can remain in place without being exposed by
// configuration, discovery, routes or the normal runtime.
const enabled = value => ['1', 'true', 'on', 'yes'].includes(String(value == null || String(value).trim() === '' ? 'true' : value).trim().toLowerCase());

export function featureFlags(env = process.env) {
  return {
    news: false,
    market: enabled(env.FEATURE_MARKET),
    resales: enabled(env.FEATURE_RESALES),
    palettes: enabled(env.FEATURE_PALETTES),
    paletteAuctions: enabled(env.FEATURE_PALETTE_AUCTIONS)
  };
}
