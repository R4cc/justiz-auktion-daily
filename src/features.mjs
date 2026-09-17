// Feature flags for the unfinished auction-economy systems. All default to off
// so the live game keeps its current shape; set the env var to any of
// 1/true/on/yes to expose the corresponding endpoints. Mutating resale routes
// (/api/account/resale/*) and the admin news route are gated by the same flags.
// FEATURE_PALETTES only controls the palette catalog/read model;
// FEATURE_PALETTE_AUCTIONS separately controls actual primary-auction
// acquisition (public lot reads, authenticated bidding/reveal and the admin
// lot-creation route) — enabling palettes alone must never expose auctions.
const enabled = value => ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());

export function featureFlags(env = process.env) {
  return {
    news: enabled(env.FEATURE_NEWS),
    market: enabled(env.FEATURE_MARKET),
    resales: enabled(env.FEATURE_RESALES),
    palettes: enabled(env.FEATURE_PALETTES),
    paletteAuctions: enabled(env.FEATURE_PALETTE_AUCTIONS)
  };
}
