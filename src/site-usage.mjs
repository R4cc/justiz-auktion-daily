import { withDatabase, transaction } from './database.mjs';

const DAY = 86400000;
const pages = new Set(['/', '/stores', '/town', '/businesses', '/inventory', '/shop', '/auction-house', '/auctions', '/marketplace', '/palettes', '/market', '/skills', '/loans', '/profile', '/leaderboard', '/login', '/register', '/admin', '/changelog']);
function routeGroup(pathname) {
  if (pages.has(pathname)) return pathname;
  if (pathname.startsWith('/api/account/admin')) return null;
  if (pathname.startsWith('/api/')) {
    const group = pathname.split('/')[2];
    return `/api/${['account','stores','town','guest','daily','random','higher-lower','auctions','market'].includes(group) ? group : 'other'}`;
  }
  return null;
}
export function ensureSiteUsageSchema(db, now = Date.now()) {
  db.exec(`CREATE TABLE IF NOT EXISTS site_usage_daily (
    date TEXT NOT NULL, route TEXT NOT NULL, requests INTEGER NOT NULL,
    client_errors INTEGER NOT NULL, server_errors INTEGER NOT NULL, duration_ms REAL NOT NULL,
    PRIMARY KEY(date,route)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS site_usage_meta (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL) STRICT`);
  if (now !== null) db.prepare('INSERT OR IGNORE INTO site_usage_meta VALUES(1,?)').run(now);
}
export function createSiteUsageTracker({ dataDir, now = Date.now, intervalMs = 30000, onError = () => {} }) {
  withDatabase(dataDir, db => ensureSiteUsageSchema(db, now()));
  const pending = new Map();
  let closed = false, prunedDate = null;
  function flush() {
    const today=new Date(now()).toISOString().slice(0,10);
    if (!pending.size && prunedDate===today) return;
    withDatabase(dataDir, db => transaction(db, () => {
      const save = db.prepare(`INSERT INTO site_usage_daily VALUES(?,?,?,?,?,?) ON CONFLICT(date,route) DO UPDATE SET
        requests=requests+excluded.requests,client_errors=client_errors+excluded.client_errors,
        server_errors=server_errors+excluded.server_errors,duration_ms=duration_ms+excluded.duration_ms`);
      for (const row of pending.values()) save.run(row.date,row.route,row.requests,row.clientErrors,row.serverErrors,row.durationMs);
      db.prepare('DELETE FROM site_usage_daily WHERE date<?').run(new Date(Math.floor(now()/DAY)*DAY-89*DAY).toISOString().slice(0,10));
    }));
    pending.clear();
    prunedDate=today;
  }
  flush();
  const timer = setInterval(() => { try { flush(); } catch (error) { onError(error); } }, intervalMs);
  timer.unref();
  return {
    flush,
    observe(request, response, url) {
      const route = routeGroup(url.pathname);
      if (closed || !route || !['GET','POST'].includes(request.method)) return;
      const started = performance.now(), date = new Date(now()).toISOString().slice(0,10);
      response.once('finish', () => {
        if (closed) return;
        const key = `${date}:${route}`, row = pending.get(key) || {date,route,requests:0,clientErrors:0,serverErrors:0,durationMs:0};
        row.requests++; row.clientErrors += Number(response.statusCode>=400&&response.statusCode<500);
        row.serverErrors += Number(response.statusCode>=500); row.durationMs += Math.max(0,performance.now()-started);
        pending.set(key,row);
      });
    },
    close() { if (closed) return; clearInterval(timer);try { flush(); } catch (error) { onError(error); } closed = true; }
  };
}
