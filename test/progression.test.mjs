import test from 'node:test';
import assert from 'node:assert/strict';
import { levelForXp, progressionForXp, XP_LEVEL_LIMIT } from '../src/progression.mjs';

test('levelForXp keeps the frozen 100·(level−1)² curve up to the cap', () => {
  assert.equal(XP_LEVEL_LIMIT, 20);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(399), 2);
  assert.equal(levelForXp(400), 3);
  assert.equal(levelForXp(900), 4);
  assert.equal(levelForXp(32400), 19);
  assert.equal(levelForXp(36099), 19);
  assert.equal(levelForXp(36100), 20); // 100·19² — the terminal threshold
  assert.equal(levelForXp(999_999), 20); // capped, never past 20
  assert.equal(levelForXp(Number.MAX_SAFE_INTEGER), 20);
});

test('progressionForXp reports the full read shape at every boundary', () => {
  assert.deepEqual(progressionForXp(0), { xp: 0, level: 1, levelStartXp: 0, nextLevelXp: 100,
    xpIntoLevel: 0, xpNeededForNextLevel: 100, progress: 0 });
  assert.deepEqual(progressionForXp(99), { xp: 99, level: 1, levelStartXp: 0, nextLevelXp: 100,
    xpIntoLevel: 99, xpNeededForNextLevel: 100, progress: 0.99 });
  assert.deepEqual(progressionForXp(100), { xp: 100, level: 2, levelStartXp: 100, nextLevelXp: 400,
    xpIntoLevel: 0, xpNeededForNextLevel: 300, progress: 0 });
  assert.deepEqual(progressionForXp(399), { xp: 399, level: 2, levelStartXp: 100, nextLevelXp: 400,
    xpIntoLevel: 299, xpNeededForNextLevel: 300, progress: 0.9966666666666667 });
  // Level 19 → 20 is the last transition; 36099 is one XP short of terminal.
  assert.deepEqual(progressionForXp(36099), { xp: 36099, level: 19, levelStartXp: 32400,
    nextLevelXp: 36100, xpIntoLevel: 3699, xpNeededForNextLevel: 3700, progress: 3699 / 3700 });
});

test('level 20 is terminal with a finite, NaN-free progress of 1', () => {
  for (const xp of [36100, 36101, 1_000_000, 10 ** 15]) {
    const progression = progressionForXp(xp);
    assert.equal(progression.level, 20);
    assert.equal(progression.levelStartXp, 36100);
    assert.equal(progression.nextLevelXp, null);
    assert.equal(progression.xpNeededForNextLevel, null);
    assert.equal(progression.xpIntoLevel, xp - 36100);
    assert.equal(progression.progress, 1);
    assert.ok(Number.isFinite(progression.progress));
    for (const value of Object.values(progression)) assert.ok(!(typeof value === 'number' && !Number.isFinite(value)));
  }
});

test('unexpected XP input is sanitized defensively to the zero-XP read', () => {
  // The contract: non-number, non-finite or negative values read as zero XP
  // (persisted users.xp is always a finite non-negative INTEGER); fractions
  // floor. No input may produce NaN/Infinity anywhere in the shape.
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, '400', -1, -1000, {}]) {
    assert.deepEqual(progressionForXp(invalid), progressionForXp(0));
  }
  assert.equal(progressionForXp(99.9).xp, 99);
  assert.deepEqual(progressionForXp(100.5), progressionForXp(100));
  assert.equal(progressionForXp(-0.5).level, 1);
});
