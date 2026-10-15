import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { closeDataStore, readArchive, upsertAuctions, withDatabase } from '../src/database.mjs';

test('admin archive export includes every full item without images and enforces access', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'jg-archive-export-'));
  t.after(async () => { closeDataStore(dataDir); await rm(dataDir, { recursive: true, force: true }); });
  const password = 'archive-export-test-password';
  let result;
  const api = await createAccountApi({ dataDir, env: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password },
    json: (_, status, body) => { result = { status, body }; } });
  const accounts = new Accounts(dataDir);
  const adminToken = await accounts.login({ username: 'admin', password });
  const admin = accounts.user(adminToken);
  const playerToken = await accounts.register({ username: 'player', password, code: accounts.codes(admin, 1)[0] });
  const get = async (token, route = 'admin/auctions/export?query=no-match&page=2') => {
    const headers = {};
    await api({ method: 'GET', headers: { cookie: token ? `jg_session=${token}` : '' } },
      { setHeader: (name, value) => { headers[name] = value; } }, new URL(`/api/account/${route}`, 'http://localhost'));
    return { ...result, headers };
  };
  assert.equal((await get()).status, 401);
  assert.equal((await get(playerToken)).status, 403);
  assert.deepEqual((await get(adminToken)).body, { updatedAt: null, auctions: [] });

  const updatedAt = '2026-10-15T08:00:00.000Z';
  const items = Array.from({ length: 31 }, (_, i) => ({
    id: i + 1, title: `Österreichisches Werkzeug ${i}`, description: 'Full description', category: 'Werkzeuge',
    startBid: 0, currentBid: i, finalPrice: i % 2 ? null : i, bidCount: i,
    startAt: updatedAt, endAt: null, capturedAt: updatedAt, condition: 'Gebraucht',
    fulfillment: 'Versand', location: 'Wien', url: `https://www.justiz-auktion.de/item-${i + 1}`,
    image: '/auction-images/cover.jpg', images: ['/auction-images/cover.jpg'],
    sourceImages: ['https://example.com/source.jpg'], imageCache: { 'https://example.com/source.jpg': '/auction-images/cover.jpg' }, imageCount: 1
  }));
  upsertAuctions(dataDir, items, updatedAt);
  const exported = await get(adminToken);
  assert.equal(exported.status, 200);
  assert.equal(exported.headers['content-disposition'], 'attachment; filename="auction-archive.json"');
  assert.deepEqual(exported.body, { updatedAt, auctions: items.map(({ image, images, sourceImages, imageCache, imageCount, ...item }) => item) });
  assert.doesNotMatch(JSON.stringify(exported.body), /source\.jpg|cover\.jpg|"(?:image|images|sourceImages|imageCache|imageCount)":/);
  assert.deepEqual(readArchive(dataDir), { updatedAt, auctions: items });
  const page = await get(adminToken, 'admin/auctions?page=2');
  assert.equal(page.body.auctions.length, 6);
  assert.equal((await get(adminToken, 'admin/auctions/1')).body.auction.image, items[0].image);
  withDatabase(dataDir, db => db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(admin.id));
  assert.equal((await get(adminToken)).status, 403);
});
