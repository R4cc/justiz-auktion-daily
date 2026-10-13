import { createHash, randomBytes } from 'node:crypto';
import { getState, setState } from './database.mjs';

export const MARKET_CHAOS_MARKER = 'weekly_market_chaos_v1';
export const MARKET_CHAOS_WEEK_MS = 7 * 86400_000;
export const MARKET_CHAOS_DURATION_MS = 3600_000;
export const MARKET_CHAOS_STEP_MS = 5 * 60_000;
export const MARKET_CHAOS_MIN_MULTIPLIER = .25;
export const MARKET_CHAOS_MAX_MULTIPLIER = 3;
const MINUTE = 60_000;
const draw = (seed, key) => parseInt(createHash('sha256').update(`${seed}:${key}`).digest('hex').slice(0, 8), 16) / 0x100000000;

// Initialized inside the market tick transaction. Reads never sample, schedule
// or reroll anything. Keep the seed private so future timing/quotes are hidden.
export function ensureMarketChaos(db, now, { seed = null } = {}) {
  if (!getState(db, MARKET_CHAOS_MARKER, null)) {
    setState(db, MARKET_CHAOS_MARKER, { activatedAtMs: Math.ceil(now / MINUTE) * MINUTE,
      seed: seed ?? randomBytes(32).toString('hex') });
  }
}

function eventForWeek(state, week) {
  if (!state || week < 0) return null;
  // Give a fresh market at least six hours before its first frenzy. Every
  // subsequent seven-day window gets one random, minute-aligned full hour.
  const grace = week === 0 ? 6 * 3600_000 : 0;
  const slots = (MARKET_CHAOS_WEEK_MS - MARKET_CHAOS_DURATION_MS - grace) / MINUTE + 1;
  const startsAt = state.activatedAtMs + week * MARKET_CHAOS_WEEK_MS + grace
    + Math.floor(draw(state.seed, `week:${week}:start`) * slots) * MINUTE;
  return { id: `market-frenzy:${state.activatedAtMs}:${week}`, startsAt, endsAt: startsAt + MARKET_CHAOS_DURATION_MS };
}

function eventAt(state, at) {
  if (!state || at < state.activatedAtMs) return null;
  const event = eventForWeek(state, Math.floor((at - state.activatedAtMs) / MARKET_CHAOS_WEEK_MS));
  return at >= event.startsAt && at < event.endsAt ? event : null;
}

export function marketChaosEvent(db, at) {
  const event = eventAt(getState(db, MARKET_CHAOS_MARKER, null), at);
  return event ? { ...event, durationMs: MARKET_CHAOS_DURATION_MS,
    minMultiplier: MARKET_CHAOS_MIN_MULTIPLIER, maxMultiplier: MARKET_CHAOS_MAX_MULTIPLIER } : null;
}

export function marketChaosMultiplier(db, category, at) {
  const state = getState(db, MARKET_CHAOS_MARKER, null), event = eventAt(state, at);
  if (!event) return 1;
  const elapsed = Math.floor((at - event.startsAt) / MINUTE) * MINUTE;
  const step = Math.floor(elapsed / MARKET_CHAOS_STEP_MS), fraction = (elapsed % MARKET_CHAOS_STEP_MS) / MARKET_CHAOS_STEP_MS;
  const phase = draw(state.seed, `${event.id}:${category}:phase`) < .5 ? 0 : 1;
  const anchor = index => {
    if (index === 0 || index === MARKET_CHAOS_DURATION_MS / MARKET_CHAOS_STEP_MS) return 0;
    const up = (index + phase) % 2 === 0;
    const magnitude = .75 + draw(state.seed, `${event.id}:${category}:${index}`) * .25;
    return Math.log(up ? MARKET_CHAOS_MAX_MULTIPLIER : MARKET_CHAOS_MIN_MULTIPLIER) * magnitude;
  };
  // Log interpolation keeps every minute positive while categories rapidly
  // alternate between pumps and crashes. Both endpoints return to baseline.
  return Math.exp(anchor(step) + (anchor(step + 1) - anchor(step)) * fraction);
}

// Include the actual event turning points in coarse charts/snapshots, so a
// one-hour frenzy remains visible even in the week/month range after expiry.
export function marketChaosHistoryTimes(db, from, to) {
  const state = getState(db, MARKET_CHAOS_MARKER, null), times = [];
  if (!state || to < state.activatedAtMs) return times;
  const first = Math.max(0, Math.floor((from - state.activatedAtMs) / MARKET_CHAOS_WEEK_MS));
  const last = Math.floor((to - state.activatedAtMs) / MARKET_CHAOS_WEEK_MS);
  for (let week = first; week <= last; week++) {
    const event = eventForWeek(state, week);
    for (let at = event.startsAt; at <= event.endsAt; at += MARKET_CHAOS_STEP_MS) {
      if (at >= from && at <= to) times.push(at);
    }
  }
  return times;
}
