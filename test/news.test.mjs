import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDataStore, withDatabase } from '../src/database.mjs';
import { getNewsEvent, listNewsEvents, listPublishedNews, saveNewsEvent } from '../src/news.mjs';

const day = Date.parse('2026-09-12T12:00:00Z');
const event = {
  id: 'news-electronics-bust', title: 'Electronics retailer smuggled phones',
  body: 'A large electronics retailer was caught smuggling phones. Seized stock will be auctioned.',
  marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 12 }]
};
const receiptKinds = (dir, id) => withDatabase(dir, db =>
  db.prepare('SELECT kind FROM news_publications WHERE event_id = ?').all(id).map(row => row.kind));
const effectCount = (dir, eventId) => withDatabase(dir, db =>
  db.prepare('SELECT COUNT(*) AS count FROM market_effects WHERE event_id = ?').get(eventId).count);

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-news-'));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test('news events move through draft, published and archived visibility', async t => {
  const dir = await fixture(t);
  const draft = saveNewsEvent(dir, { ...event, status: 'draft' }, { now: day });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.publishedAt, null);
  assert.deepEqual(listPublishedNews(dir), []);
  assert.deepEqual(getNewsEvent(dir, draft.id), draft);
  // The server owns the publication timestamp; clients cannot backdate.
  assert.throws(() => saveNewsEvent(dir, { ...event, status: 'published', publishedAt: new Date(day - 5000).toISOString() }, { now: day + 500 }), /invalid_published_at/);
  const published = saveNewsEvent(dir, { ...event, status: 'published', publishedAt: null }, { now: day + 1000 });
  assert.equal(published.publishedAt, new Date(day + 1000).toISOString());
  assert.deepEqual(listPublishedNews(dir), [published]);
  const archived = saveNewsEvent(dir, { ...event, status: 'archived', publishedAt: published.publishedAt }, { now: day + 2000 });
  assert.deepEqual(listPublishedNews(dir), []);
  assert.deepEqual(listNewsEvents(dir, { status: 'archived' }), [archived]);
  // Updating keeps the whole document and created_at stable.
  assert.equal(getNewsEvent(dir, event.id).createdAt, new Date(day).toISOString());
  // A later event publishes newest-first; the archived one stays archived.
  saveNewsEvent(dir, { ...event, id: 'news-second', title: 'Second bust', status: 'published' }, { now: day + 3000 });
  assert.deepEqual(listPublishedNews(dir).map(item => item.id), ['news-second']);
  assert.equal(listPublishedNews(dir, { limit: 1 }).length, 1);
});

test('news serialization is structural: arrays and objects, never buried in prose', async t => {
  const dir = await fixture(t);
  const saved = saveNewsEvent(dir, {
    ...event, status: 'published', metadata: { bustLocation: 'Magdeburg', caseNumber: '42' }
  }, { now: day });
  assert.deepEqual(saved.paletteIds, []);
  assert.deepEqual(saved.marketEffects, [{ category: 'electronics', direction: 'down', magnitude: 12 }]);
  assert.deepEqual(saved.metadata, { bustLocation: 'Magdeburg', caseNumber: '42' });
  assert.equal(typeof saved.marketEffects, 'object');
  closeDataStore(dir);
  assert.deepEqual(getNewsEvent(dir, event.id), saved);
});

test('news validation rejects malformed events without partial writes', async t => {
  const dir = await fixture(t);
  const bad = async input => assert.throws(() => saveNewsEvent(dir, input, { now: day }), Error);
  await bad({ title: '', body: 'x' });
  await bad({ title: 'x'.repeat(201), body: 'x' });
  await bad({ title: 'T', body: '' });
  await bad({ title: 'T', body: 'x'.repeat(4001) });
  await bad({ title: 'T', body: 'x', status: 'sneaky' });
  await bad({ title: 'T', body: 'x', paletteIds: 'electronics' });
  await bad({ title: 'T', body: 'x', paletteIds: ['schatzkiste', 'unknown-palette'] });
  await bad({ title: 'T', body: 'x', marketEffects: [{ category: 'electronics', direction: 'sideways' }] });
  await bad({ title: 'T', body: 'x', marketEffects: [{ category: 'not-a-category', direction: 'up' }] });
  await bad({ title: 'T', body: 'x', marketEffects: [{ category: 'electronics', direction: 'up', magnitude: -1 }] });
  await bad({ title: 'T', body: 'x', marketEffects: 'electronics falls' });
  await bad({ title: 'T', body: 'x', metadata: [] });
  await bad({ title: 'T', body: 'x', publishedAt: 'not-a-date' });
  await bad({ ...event, id: 'bad id with spaces' });
  // One effect per category per event, even in drafts.
  await bad({ title: 'T', body: 'x', marketEffects: [
    { category: 'electronics', direction: 'up', magnitude: 2 },
    { category: 'electronics', direction: 'down', magnitude: 3 }] });
  assert.equal(listNewsEvents(dir).length, 0);
  // Missing id and optional fields default sensibly; drafts may keep the
  // placeholder null magnitude (and legacy fractional placeholder values).
  const minimal = saveNewsEvent(dir, { title: 'Minimal', body: 'Body' }, { now: day });
  assert.match(minimal.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(minimal.paletteIds, []);
  assert.deepEqual(minimal.marketEffects, []);
  assert.deepEqual(minimal.metadata, {});
  const normalized = saveNewsEvent(dir, { title: 'Normalized', body: 'Body',
    marketEffects: [{ category: 'tools', direction: 'up' }] }, { now: day });
  assert.deepEqual(normalized.marketEffects, [{ category: 'tools', direction: 'up', magnitude: null }]);
  const legacyDraft = saveNewsEvent(dir, { title: 'Legacy placeholder', body: 'Body',
    marketEffects: [{ category: 'tools', direction: 'up', magnitude: 0.85 }] }, { now: day });
  assert.deepEqual(legacyDraft.marketEffects, [{ category: 'tools', direction: 'up', magnitude: 0.85 }]);
});

test('publication requires whole index points 1..20; drafts tolerate placeholders', async t => {
  const dir = await fixture(t);
  // Null or fractional magnitudes are fine in drafts...
  saveNewsEvent(dir, { id: 'null-magnitude', title: 'T', body: 'B', status: 'draft',
    marketEffects: [{ category: 'tools', direction: 'up' }] }, { now: day });
  saveNewsEvent(dir, { id: 'fractional-magnitude', title: 'T', body: 'B', status: 'draft',
    marketEffects: [{ category: 'tools', direction: 'up', magnitude: 0.85 }] }, { now: day });
  // ...but cannot be published: magnitudes are index points, whole numbers 1..20.
  const unpublished = [[null, 'null'], [0.85, 'fractional'], [0, 'zero'], [-3, 'negative'], [21, 'too-big'], [1.5, 'half'], ['5', 'string']];
  for (const [magnitude, label] of unpublished) {
    assert.throws(() => saveNewsEvent(dir, { id: `publish-${label}`, title: 'T', body: 'B', status: 'published',
      marketEffects: [{ category: 'tools', direction: 'up', magnitude }] }, { now: day }), /invalid_market_effects/);
  }
  assert.deepEqual(listNewsEvents(dir, { status: 'published' }), []);
  for (const [magnitude, at] of [[1, day], [20, day + 1000]]) {
    saveNewsEvent(dir, { id: `publish-edge-${magnitude}`, title: 'T', body: 'B', status: 'published',
      marketEffects: [{ category: 'tools', direction: 'up', magnitude }] }, { now: at });
  }
  assert.deepEqual(listNewsEvents(dir, { status: 'published' }).map(row => row.id), ['publish-edge-20', 'publish-edge-1']);
});

test('published economics are immutable; title and body corrections are allowed', async t => {
  const dir = await fixture(t);
  const published = saveNewsEvent(dir, { ...event, status: 'published' }, { now: day });
  // A retry with the same economic payload is idempotent: no new effects,
  // no moved publishedAt, no restarted decay.
  const retry = saveNewsEvent(dir, { ...event, status: 'published', publishedAt: null }, { now: day + 3600_000 });
  assert.equal(retry.publishedAt, published.publishedAt);
  assert.equal(effectCount(dir, event.id), 1);
  assert.deepEqual(receiptKinds(dir, event.id), ["applied"]);
  // Text corrections are the only permitted changes.
  const corrected = saveNewsEvent(dir, { ...event, title: 'Corrected headline', body: 'Corrected body.',
    status: 'published', publishedAt: null }, { now: day + 7200_000 });
  assert.equal(corrected.title, 'Corrected headline');
  assert.equal(corrected.publishedAt, published.publishedAt);
  assert.equal(effectCount(dir, event.id), 1);
  // Every economic dimension conflicts.
  const conflicts = [
    { ...event, marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 13 }] },
    { ...event, marketEffects: [{ category: 'wine', direction: 'down', magnitude: 12 }] },
    { ...event, marketEffects: [] },
    { ...event, paletteIds: ['electronics'] },
    { ...event, metadata: { extra: true } },
    { ...event, publishedAt: new Date(day + 500).toISOString() }
  ];
  for (const payload of conflicts) {
    assert.throws(() => saveNewsEvent(dir, { ...payload, status: 'published' }, { now: day + 1000 }), /news_already_published/);
  }
  assert.equal(effectCount(dir, event.id), 1);
  // The identical timestamp explicitly resent is fine.
  saveNewsEvent(dir, { ...event, status: 'published', publishedAt: published.publishedAt }, { now: day + 1100 });
  assert.equal(effectCount(dir, event.id), 1);
});

test('status transitions: drafts are free, published archives, archived is terminal', async t => {
  const dir = await fixture(t);
  const draft = saveNewsEvent(dir, { ...event, status: 'draft' }, { now: day });
  // Base palette references are informational: they may be published without
  // any activation and create no windows or editions. Distinct categories
  // keep the events inside each other's effect budget.
  const baseRef = saveNewsEvent(dir, { ...event, id: 'base-ref', status: 'published',
    marketEffects: [{ category: 'wine', direction: 'up', magnitude: 4 }], paletteIds: ['electronics'] }, { now: day });
  assert.deepEqual(baseRef.paletteIds, ['electronics']);
  assert.deepEqual(baseRef.paletteWindows, []);
  // Event palette references resolve a default window, stored with the event.
  const eventRef = saveNewsEvent(dir, { ...event, id: 'event-ref', status: 'published',
    marketEffects: [{ category: 'collectibles', direction: 'up', magnitude: 4 }],
    paletteIds: ['electronics-smuggling'] }, { now: day });
  assert.deepEqual(eventRef.paletteWindows, [{ paletteId: 'electronics-smuggling', startOffsetHours: 0, durationHours: 72 }]);
  // Publish the plain draft cleanly, then archive.
  const published = saveNewsEvent(dir, { ...draft, status: 'published' }, { now: day + 1000 });
  assert.throws(() => saveNewsEvent(dir, { ...published, status: 'draft' }, { now: day + 2000 }), /invalid_news_transition/);
  const archived = saveNewsEvent(dir, { ...published, status: 'archived' }, { now: day + 3000 });
  assert.equal(archived.status, 'archived');
  assert.throws(() => saveNewsEvent(dir, { ...archived, status: 'published' }, { now: day + 4000 }), /invalid_news_transition/);
  assert.throws(() => saveNewsEvent(dir, { ...archived, status: 'draft' }, { now: day + 4000 }), /invalid_news_transition/);
  // Archived text stays correctable; its economics stay frozen.
  const corrected = saveNewsEvent(dir, { ...archived, title: 'Final wording', publishedAt: archived.publishedAt }, { now: day + 5000 });
  assert.equal(corrected.title, 'Final wording');
  assert.equal(corrected.publishedAt, published.publishedAt);
  assert.throws(() => saveNewsEvent(dir, { ...archived, marketEffects: [] }, { now: day + 6000 }), /news_already_published/);
});

test('archiving keeps effects until they expire naturally', async t => {
  const dir = await fixture(t);
  const published = saveNewsEvent(dir, { ...event, status: 'published' }, { now: day });
  assert.equal(effectCount(dir, event.id), 1);
  saveNewsEvent(dir, { ...published, status: 'archived' }, { now: day + 1000 });
  assert.equal(effectCount(dir, event.id), 1);
  assert.deepEqual(receiptKinds(dir, event.id), ["applied"]);
});

test('publication is exact-once across restarts', async t => {
  const dir = await fixture(t);
  const published = saveNewsEvent(dir, { ...event, status: 'published' }, { now: day });
  closeDataStore(dir);
  const retry = saveNewsEvent(dir, { ...event, status: 'published', publishedAt: null }, { now: day + 86400_000 });
  assert.equal(retry.publishedAt, published.publishedAt);
  assert.equal(effectCount(dir, event.id), 1);
  assert.deepEqual(receiptKinds(dir, event.id), ["applied"]);
});
