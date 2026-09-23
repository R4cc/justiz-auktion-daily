import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clientIp } from '../src/client-ip.mjs';
import { enqueueRollingDiscovery, processRollingTask } from '../src/collector.mjs';
import { closeDataStore } from '../src/database.mjs';

const logger = { info() {}, warn() {} };

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'jg-security-'));
  t.after(async () => { closeDataStore(dataDir); await rm(dataDir, { recursive: true, force: true }); });
  await enqueueRollingDiscovery({ dataDir, pages: 1, now: 1_000 });
  return dataDir;
}

test('visitor IP is trusted only in explicit tunnel mode and only when valid', () => {
  const request = { socket: { remoteAddress: '172.18.0.2' }, headers: { 'cf-connecting-ip': '203.0.113.7' } };
  assert.equal(clientIp(request), '172.18.0.2');
  assert.equal(clientIp(request, true), '203.0.113.7');
  request.headers['cf-connecting-ip'] = '203.0.113.7, 198.51.100.2';
  assert.equal(clientIp(request, true), '172.18.0.2');
  request.headers['cf-connecting-ip'] = 'not-an-ip';
  assert.equal(clientIp(request, true), '172.18.0.2');
});

test('collector rejects redirects to private network before making a request', async t => {
  const dataDir = await fixture(t);
  const requested = [];
  const result = await processRollingTask({ dataDir, now: 2_000, logger, fetchImpl: async url => {
    requested.push(url);
    return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  } });
  assert.equal(result.status, 'error');
  assert.equal(requested.length, 1);
  assert.match(requested[0], /^https:\/\/www\.justiz-auktion\.de\//);
});

test('collector does not submit a source page form to another origin', async t => {
  const dataDir = await fixture(t);
  const requested = [];
  const result = await processRollingTask({ dataDir, now: 2_000, logger, fetchImpl: async url => {
    requested.push(url);
    return new Response('<form action="http://127.0.0.1:3000/private" method="POST"><select name="pagesize"><option value="10">10</option><option value="50">50</option></select></form>');
  } });
  assert.equal(result.status, 'error');
  assert.equal(requested.length, 1);
});

test('collector rejects an oversized HTML response while streaming it', async t => {
  const dataDir = await fixture(t);
  const result = await processRollingTask({ dataDir, now: 2_000, logger, fetchImpl: async () =>
    new Response(Buffer.alloc(5_000_001, 65), { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result.status, 'error');
  assert.match(result.error, /too large/);
});
