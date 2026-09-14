import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDataStore } from '../src/database.mjs';
import { getNewsEvent, listNewsEvents, listPublishedNews, saveNewsEvent } from '../src/news.mjs';

const day = Date.parse('2026-09-12T12:00:00Z');
const event = {
  id: 'news-electronics-bust', title: 'Electronics retailer smuggled phones',
  body: 'A large electronics retailer was caught smuggling phones. Seized stock will be auctioned.',
  paletteIds: ['electronics'], marketEffects: [{ category: 'electronics', direction: 'down', magnitude: 0.85 }]
};

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
  const published = saveNewsEvent(dir, { ...event, status: 'published', publishedAt: null }, { now: day + 1000 });
  assert.equal(published.publishedAt, new Date(day + 1000).toISOString());
  assert.deepEqual(listPublishedNews(dir), [published]);
  const archived = saveNewsEvent(dir, { ...event, status: 'archived', publishedAt: published.publishedAt }, { now: day + 2000 });
  assert.deepEqual(listPublishedNews(dir), []);
  assert.deepEqual(listNewsEvents(dir, { status: 'archived' }), [archived]);
  // Updating keeps the whole document and created_at stable.
  assert.equal(getNewsEvent(dir, event.id).createdAt, new Date(day).toISOString());
  // Newest published first; the archived edition can be republished explicitly.
  saveNewsEvent(dir, { ...event, id: 'news-second', title: 'Second bust', status: 'published', publishedAt: day - 5000 });
  saveNewsEvent(dir, { ...event, status: 'published', publishedAt: day + 3000 });
  assert.deepEqual(listPublishedNews(dir).map(item => item.id), [event.id, 'news-second']);
  assert.equal(listPublishedNews(dir, { limit: 1 }).length, 1);
});

test('news serialization is structural: arrays and objects, never buried in prose', async t => {
  const dir = await fixture(t);
  const saved = saveNewsEvent(dir, {
    ...event, status: 'published', metadata: { bustLocation: 'Magdeburg', caseNumber: '42' }
  }, { now: day });
  assert.deepEqual(saved.paletteIds, ['electronics']);
  assert.deepEqual(saved.marketEffects, [{ category: 'electronics', direction: 'down', magnitude: 0.85 }]);
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
  assert.equal(listNewsEvents(dir).length, 0);
  // Missing id and optional fields default sensibly; palette effects may omit magnitude.
  const minimal = saveNewsEvent(dir, { title: 'Minimal', body: 'Body' }, { now: day });
  assert.match(minimal.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(minimal.paletteIds, []);
  assert.deepEqual(minimal.marketEffects, []);
  assert.deepEqual(minimal.metadata, {});
  const normalized = saveNewsEvent(dir, { title: 'Normalized', body: 'Body',
    marketEffects: [{ category: 'tools', direction: 'up' }] }, { now: day });
  assert.deepEqual(normalized.marketEffects, [{ category: 'tools', direction: 'up', magnitude: null }]);
});
