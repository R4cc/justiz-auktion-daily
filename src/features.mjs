// Feature flags for the unfinished auction-economy systems. All default to off
// so the live game keeps its current shape; set the env var to any of
// 1/true/on/yes to expose the corresponding read-only endpoints.
// Mutating resale routes (/api/account/resale/*) and the admin news route are
// gated by the same flags.
const enabled = value => ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());

export function featureFlags(env = process.env) {
  return {
    news: enabled(env.FEATURE_NEWS),
    market: enabled(env.FEATURE_MARKET),
    resales: enabled(env.FEATURE_RESALES),
    palettes: enabled(env.FEATURE_PALETTES)
  };
}
