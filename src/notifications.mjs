import { transaction, withDatabase } from './database.mjs';
import { AccountError } from './errors.mjs';

const utcDate = now => new Date(now).toISOString().slice(0, 10);

export function ensureNotificationSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title_en TEXT NOT NULL,
    title_de TEXT NOT NULL,
    body_en TEXT NOT NULL,
    body_de TEXT NOT NULL,
    href TEXT,
    source_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER,
    read_at INTEGER,
    UNIQUE(user_id, source_key)
  ) STRICT`);
  db.exec(`CREATE INDEX IF NOT EXISTS account_notifications_user
    ON account_notifications(user_id, created_at DESC, id DESC)`);
}

export function pushNotification(db, userId, notification, now = Date.now()) {
  ensureNotificationSchema(db);
  const user = db.prepare('SELECT npc FROM users WHERE id = ?').get(String(userId));
  if (!user || user.npc) return false;
  const result = db.prepare(`INSERT OR IGNORE INTO account_notifications
    (user_id, type, title_en, title_de, body_en, body_de, href, source_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, notification.type, notification.titleEn, notification.titleDe,
      notification.bodyEn, notification.bodyDe, notification.href || null,
      notification.sourceKey, now);
  return Boolean(result.changes);
}

function serialize(row) {
  return { id: row.id, type: row.type, titleEn: row.title_en, titleDe: row.title_de,
    bodyEn: row.body_en, bodyDe: row.body_de, href: row.href || null,
    createdAt: row.created_at, readAt: row.read_at || null };
}

export function notificationsForUser(dataDir, userId, { now = Date.now(), limit = 100 } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureNotificationSchema(db);
    const date = utcDate(now);
    pushNotification(db, userId, {
      type: 'daily', sourceKey: `daily:${date}`, href: '/',
      titleEn: 'A new Daily is ready', titleDe: 'Ein neues Daily ist bereit',
      bodyEn: 'Five fresh auctions are waiting for your guesses.',
      bodyDe: 'Fünf neue Auktionen warten auf deine Tipps.'
    }, now);
    const bounded = Math.max(1, Math.min(200, Math.floor(limit) || 100));
    const rows = db.prepare(`SELECT * FROM account_notifications WHERE user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, bounded);
    const fresh = rows.filter(row => row.delivered_at === null).map(serialize);
    if (fresh.length) {
      const ids = fresh.map(entry => entry.id);
      db.prepare(`UPDATE account_notifications SET delivered_at = ?
        WHERE user_id = ? AND delivered_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
        .run(now, userId, ...ids);
    }
    return { notifications: rows.map(serialize), fresh,
      unreadCount: db.prepare('SELECT COUNT(*) AS count FROM account_notifications WHERE user_id = ? AND read_at IS NULL').get(userId).count };
  }));
}

export function markNotificationsRead(dataDir, userId, ids, { now = Date.now() } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureNotificationSchema(db);
    if (ids === 'all') db.prepare('UPDATE account_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
    else {
      if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1) || ids.length > 200) {
        throw new AccountError('invalid_notifications', 400);
      }
      if (ids.length) db.prepare(`UPDATE account_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL
        AND id IN (${ids.map(() => '?').join(',')})`).run(now, userId, ...ids);
    }
    return { unreadCount: db.prepare('SELECT COUNT(*) AS count FROM account_notifications WHERE user_id = ? AND read_at IS NULL').get(userId).count };
  }));
}
