import test from 'node:test';
import assert from 'node:assert/strict';
import { NPC_BUYERS, SPECIAL_NPC_BUYERS } from '../src/npc-roster.mjs';
import { NPC_COHORT_SIZE, npcBidAmount, npcCohort } from '../src/npc-buyers.mjs';

const requiredNames = ['Richard Lugner', 'Money Boy', 'Andreas Gabalier', 'Sebastian Kurz', 'HC Strache',
  'Herbert Kickl', 'Alexander Van der Bellen', 'Karl Nehammer', 'René Benko', 'Friedrich Merz'];

test('NPC roster has 800 unique stable identities with an 80% German/Austrian share', () => {
  assert.equal(NPC_BUYERS.length, 800);
  assert.equal(NPC_BUYERS.filter(npc => npc.region === 'at-de').length, 640);
  assert.equal(new Set(NPC_BUYERS.map(npc => npc.id)).size, 800);
  assert.equal(new Set(NPC_BUYERS.map(npc => npc.username.toLocaleLowerCase('de'))).size, 800);
  assert.deepEqual(SPECIAL_NPC_BUYERS.map(npc => npc.username), requiredNames);
  for (const npc of NPC_BUYERS) {
    assert.ok(npc.aggressiveness >= 0 && npc.aggressiveness <= 1);
    assert.ok(npc.cheapness >= 0 && npc.cheapness <= 1);
    assert.ok(npc.patience >= 0 && npc.patience <= 1);
    assert.ok(npc.categories.length >= 1 && new Set(npc.categories).size === npc.categories.length);
    assert.ok(Number.isInteger(npc.delaySeconds) && npc.delaySeconds >= 20 && npc.delaySeconds <= 90);
  }
});

test('named NPC personalities produce their intended playful bidding styles', () => {
  const named = Object.fromEntries(SPECIAL_NPC_BUYERS.map(npc => [npc.username, npc]));
  assert.ok(named['Money Boy'].aggressiveness > .9 && named['Money Boy'].cheapness < .1);
  assert.ok(named['Alexander Van der Bellen'].patience > .9 && named['Alexander Van der Bellen'].cheapness > .9);
  assert.ok(named['Sebastian Kurz'].cheapness > .8);
  assert.ok(named['Herbert Kickl'].aggressiveness > .95);
  assert.equal(named['Richard Lugner'].collector, true);
  assert.equal(named['René Benko'].willingness, 1.15);
  assert.ok(SPECIAL_NPC_BUYERS.every(npc => npc.flavor.length > 20));
});

test('each auction gets a stable small cohort from the large roster', () => {
  const first = npcCohort('auction-one');
  const repeat = npcCohort('auction-one');
  const other = npcCohort('auction-two');
  assert.equal(first.length, NPC_COHORT_SIZE);
  assert.equal(new Set(first.map(npc => npc.id)).size, NPC_COHORT_SIZE);
  assert.deepEqual(first.map(npc => npc.id), repeat.map(npc => npc.id));
  assert.notDeepEqual(first.map(npc => npc.id), other.map(npc => npc.id));
});

test('cheap NPCs add one token while aggressive NPCs can jump higher', () => {
  const interest = { auction_id: 'lot', current_bid: 10, start_price: 5, max_bid: 100, ends_at: 1_000_000 };
  const cheap = { id: 'cheap', cheapness: 1, aggressiveness: 0, patience: 1 };
  const aggressive = { id: 'aggressive', cheapness: 0, aggressiveness: 1, patience: 0 };
  assert.equal(npcBidAmount(interest, cheap, 0, () => .5), 11);
  assert.ok(npcBidAmount(interest, aggressive, 0, () => .9) > 11);
  assert.ok(npcBidAmount({ ...interest, max_bid: 11 }, aggressive, 0, () => .9) <= 11);
});
