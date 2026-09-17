// Shared player-progression reads: the XP level curve. The thresholds were
// extracted verbatim from the primary palette auction domain, where they
// first shipped — progression is broader than any one system, so the curve
// lives here and palette auctions (and later every other level-gated
// feature) import it. Pure reads only: persisted users.xp is the single
// source of truth, nothing here grants XP or writes the database, and the
// curve itself is frozen (no rebalancing happened in this extraction).
export const XP_LEVEL_LIMIT = 20;

// Level thresholds: reaching level L requires xp >= 100·(L−1)², levels 1..20.
export function levelForXp(xp) {
  let level = 1;
  while (level < XP_LEVEL_LIMIT && xp >= 100 * level * level) level++;
  return level;
}

const levelFloorXp = level => 100 * (level - 1) ** 2;

// Defensive read model over a persisted xp value for profile/API consumers.
// users.xp is an INTEGER column, so real values are always finite
// non-negative integers; anything else (non-number, non-finite, negative,
// fractional) is normalized defensively — non-finite/negative reads as zero
// XP, fractions floor. Level 20 is terminal: nextLevelXp and
// xpNeededForNextLevel become null and progress is reported as a full 1, so
// the shape never contains NaN or Infinity.
export function progressionForXp(xp) {
  const safeXp = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  const level = levelForXp(safeXp);
  const levelStartXp = levelFloorXp(level);
  const nextLevelXp = level < XP_LEVEL_LIMIT ? levelFloorXp(level + 1) : null;
  const xpIntoLevel = safeXp - levelStartXp;
  const xpNeededForNextLevel = nextLevelXp === null ? null : nextLevelXp - levelStartXp;
  const progress = xpNeededForNextLevel === null ? 1 : xpIntoLevel / xpNeededForNextLevel;
  return { xp: safeXp, level, levelStartXp, nextLevelXp, xpIntoLevel, xpNeededForNextLevel, progress };
}
