import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAuctions, ensureDailyGame, seedArchiveIfEmpty } from './src/collector.mjs';
import { selectRandomSet, utcDateKey } from './src/core.mjs';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(projectDir, 'dist');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectDir, 'runtime-data'));
const port = Number(process.env.PORT || 3000);
const refreshHours = Math.max(1, Number(process.env.REFRESH_INTERVAL_HOURS || 6));
const collectPages = Math.max(1, Number(process.env.COLLECT_PAGES || 4));
let refreshPromise = null;
let lastRefresh = { status: 'starting', startedAt: null, finishedAt: null, error: null };

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

async function sendFile(request, response, root, requestPath, cacheControl) {
  const relative = requestPath.replace(/^\/+/, '') || 'index.html';
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) return false;
  try {
    const details = await stat(filename);
    if (!details.isFile()) return false;
    response.writeHead(200, {
      'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'content-length': details.size,
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filename).on('error', error => response.destroy(error)).pipe(response);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function dailyPayload() {
  const game = await ensureDailyGame({ dataDir });
  return {
    date: game.date,
    gameNumber: game.gameNumber,
    generatedAt: game.generatedAt,
    auctions: game.auctions.map(auction => ({
      ...auction,
      actualBid: auction.correctPrice
    }))
  };
}

async function randomPayload() {
  const archive = JSON.parse(await readFile(path.join(dataDir, 'auctions.json'), 'utf8'));
  const game = selectRandomSet(archive.auctions || []);
  return {
    ...game,
    auctions: game.auctions.map(auction => ({
      ...auction,
      actualBid: auction.correctPrice
    }))
  };
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    lastRefresh = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null };
    try {
      await collectAuctions({ dataDir, pages: collectPages });
      await ensureDailyGame({ dataDir });
      lastRefresh = { ...lastRefresh, status: 'ok', finishedAt: new Date().toISOString() };
    } catch (error) {
      lastRefresh = { ...lastRefresh, status: 'error', finishedAt: new Date().toISOString(), error: error.message };
      console.error('Auction refresh failed:', error);
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function scheduleUtcRollover() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 5);
  const timer = setTimeout(async () => {
    await refresh();
    scheduleUtcRollover();
  }, next - now.getTime());
  timer.unref();
}

await seedArchiveIfEmpty({ dataDir, seedFile: path.join(projectDir, 'seed', 'auctions.json') });
await refresh();
await ensureDailyGame({ dataDir });

const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      json(response, 200, { status: 'ok', date: utcDateKey(), refresh: lastRefresh });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/daily') {
      json(response, 200, await dailyPayload());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/random') {
      json(response, 200, await randomPayload());
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/auction-images/')) {
      if (await sendFile(request, response, path.join(dataDir, 'images'), url.pathname.slice('/auction-images/'.length), 'public, max-age=86400, immutable')) return;
      json(response, 404, { error: 'image_not_found' });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      json(response, 405, { error: 'method_not_allowed' });
      return;
    }
    const served = await sendFile(request, response, publicDir, url.pathname, url.pathname === '/' ? 'no-cache' : 'public, max-age=3600');
    if (!served) json(response, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: 'internal_error' });
    else response.end();
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;
server.maxHeadersCount = 50;

server.listen(port, '0.0.0.0', () => {
  console.log(`JUSTIZGUESSR listening on http://0.0.0.0:${port}`);
});

setInterval(refresh, refreshHours * 60 * 60 * 1000).unref();
scheduleUtcRollover();

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  server.close(error => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
