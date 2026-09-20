import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { markNotificationsRead, notificationsForUser } from '../src/notifications.mjs';

const password = 'notification-test-password';
const firstDay = Date.parse('2026-09-20T12:00:00Z');

test('Daily notices are durable, delivered once and remain unread until the inbox is opened', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-notifications-'));
  const service = new Accounts(dir, { now: () => firstDay });
  await service.bootstrap('admin', password);
  const user = service.user(await service.login({ username: 'admin', password }));
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });

  const first = notificationsForUser(dir, user.id, { now: firstDay });
  assert.equal(first.unreadCount, 1);
  assert.equal(first.fresh.length, 1);
  assert.equal(first.fresh[0].type, 'daily');
  assert.equal(first.fresh[0].href, '/');

  const repeat = notificationsForUser(dir, user.id, { now: firstDay + 1000 });
  assert.equal(repeat.fresh.length, 0);
  assert.equal(repeat.unreadCount, 1);
  assert.equal(markNotificationsRead(dir, user.id, 'all', { now: firstDay + 2000 }).unreadCount, 0);

  const nextDay = notificationsForUser(dir, user.id, { now: firstDay + 86_400_000 });
  assert.equal(nextDay.fresh.length, 1);
  assert.equal(nextDay.unreadCount, 1);
  assert.equal(nextDay.notifications.filter(entry => entry.type === 'daily').length, 2);
});
