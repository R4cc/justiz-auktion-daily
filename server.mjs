import {
  createServer
} from 'node:http';

import {
  createReadStream
} from 'node:fs';

import {
  readFile,
  stat
} from 'node:fs/promises';

import path from 'node:path';

import {
  fileURLToPath
} from 'node:url';

import {
  ROLLING_QUEUE_VERSION,
  enqueueRollingDiscovery,
  ensureDailyGame,
  processRollingTask,
  seedArchiveIfEmpty
} from './src/collector.mjs';

import {
  selectRandomSet,
  utcDateKey
} from './src/core.mjs';

import {
  formatPublicStats
} from './src/public-stats.mjs';

const projectDir =
  path.dirname(
    fileURLToPath(
      import.meta.url
    )
  );

const publicDir =
  path.join(
    projectDir,
    'dist'
  );

const dataDir =
  path.resolve(
    process.env.DATA_DIR ||
    path.join(
      projectDir,
      'runtime-data'
    )
  );

const port =
  Number(
    process.env.PORT ||
    3000
  );

const discoveryHours =
  Math.max(
    1,
    Number(
      process.env
        .DISCOVERY_INTERVAL_HOURS ||
      process.env
        .REFRESH_INTERVAL_HOURS ||
      6
    )
  );

const discoveryIntervalMs =
  discoveryHours *
  60 *
  60 *
  1000;

const discoveryCheckIntervalMs =
  Math.max(
    30_000,
    Number(
      process.env
        .DISCOVERY_CHECK_INTERVAL_MS ||
      60_000
    )
  );

const discoveryMaxPages =
  Math.max(
    1,
    Number(
      process.env
        .COLLECT_MAX_PAGES ||
      250
    )
  );

const fetchMinIntervalMs =
  Math.max(
    100,
    Number(
      process.env
        .FETCH_MIN_INTERVAL_MS ||
      250
    )
  );

const fetchInitialIntervalMs =
  Math.max(
    fetchMinIntervalMs,
    Number(
      process.env
        .FETCH_INITIAL_INTERVAL_MS ||
      750
    )
  );

const fetchMaxIntervalMs =
  Math.max(
    fetchInitialIntervalMs,
    Number(
      process.env
        .FETCH_MAX_INTERVAL_MS ||
      120_000
    )
  );

const fetchIdlePollMs =
  Math.max(
    5_000,
    Number(
      process.env
        .FETCH_IDLE_POLL_MS ||
      30_000
    )
  );

let rollingPromise = null;
let rollingTimer = null;
let discoveryTimer = null;
let shuttingDown = false;

let lastRefresh = {
  status:
    'starting',

  startedAt:
    null,

  finishedAt:
    null,

  error:
    null
};

const mimeTypes = {
  '.css':
    'text/css; charset=utf-8',

  '.html':
    'text/html; charset=utf-8',

  '.ico':
    'image/x-icon',

  '.jpg':
    'image/jpeg',

  '.jpeg':
    'image/jpeg',

  '.js':
    'text/javascript; charset=utf-8',

  '.json':
    'application/json; charset=utf-8',

  '.png':
    'image/png',

  '.svg':
    'image/svg+xml',

  '.webp':
    'image/webp'
};

function json(
  response,
  statusCode,
  body
) {
  response.writeHead(
    statusCode,
    {
      'content-type':
        'application/json; charset=utf-8',

      'cache-control':
        'no-store',

      'x-content-type-options':
        'nosniff'
    }
  );

  response.end(
    JSON.stringify(
      body
    )
  );
}

function text(
  response,
  statusCode,
  body
) {
  response.writeHead(
    statusCode,
    {
      'content-type':
        'text/plain; charset=utf-8',

      'content-length':
        Buffer.byteLength(
          body
        ),

      'cache-control':
        'no-store',

      'x-content-type-options':
        'nosniff',

      'referrer-policy':
        'no-referrer'
    }
  );

  response.end(body);
}

async function readDataJson(
  filename,
  fallback
) {
  try {
    return JSON.parse(
      await readFile(
        path.join(
          dataDir,
          filename
        ),
        'utf8'
      )
    );
  } catch (error) {
    if (
      error.code ===
      'ENOENT'
    ) {
      return fallback;
    }

    throw error;
  }
}

async function readFetchQueue() {
  return readDataJson(
    'fetch-queue.json',
    {
      version:
        null,

      updatedAt:
        null,

      lastRequestAt:
        null,

      lastDiscoveryAt:
        null,

      needsFullDiscovery:
        false,

      discovery:
        null,

      throttle:
        null,

      tasks:
        []
    }
  );
}

async function publicStats() {
  const [
    archive,
    queue,
    daily
  ] =
    await Promise.all([
      readDataJson(
        'auctions.json',
        {
          auctions:
            []
        }
      ),

      readFetchQueue(),

      readDataJson(
        'daily-games.json',
        {
          games:
            {}
        }
      )
    ]);

  return formatPublicStats({
    archive,
    queue,
    daily,

    fetchState:
      lastRefresh
  });
}

async function sendFile(
  request,
  response,
  root,
  requestPath,
  cacheControl
) {
  const relative =
    requestPath.replace(
      /^\/+/,
      ''
    ) ||
    'index.html';

  const filename =
    path.resolve(
      root,
      relative
    );

  if (
    filename !== root &&
    !filename.startsWith(
      `${root}${path.sep}`
    )
  ) {
    return false;
  }

  try {
    const details =
      await stat(
        filename
      );

    if (
      !details.isFile()
    ) {
      return false;
    }

    response.writeHead(
      200,
      {
        'content-type':
          mimeTypes[
            path.extname(
              filename
            ).toLowerCase()
          ] ||
          'application/octet-stream',

        'content-length':
          details.size,

        'cache-control':
          cacheControl,

        'x-content-type-options':
          'nosniff',

        'referrer-policy':
          'strict-origin-when-cross-origin',

        'permissions-policy':
          'camera=(), microphone=(), geolocation=(), payment=()',

        'content-security-policy':
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"
      }
    );

    if (
      request.method ===
      'HEAD'
    ) {
      response.end();
    } else {
      createReadStream(
        filename
      )
        .on(
          'error',
          error =>
            response.destroy(
              error
            )
        )
        .pipe(
          response
        );
    }

    return true;
  } catch (error) {
    if (
      error.code ===
      'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
}

async function dailyPayload() {
  const game =
    await ensureDailyGame({
      dataDir
    });

  return {
    date:
      game.date,

    gameNumber:
      game.gameNumber,

    generatedAt:
      game.generatedAt,

    auctions:
      game.auctions.map(
        auction => ({
          ...auction,

          actualBid:
            auction.correctPrice
        })
      )
  };
}

async function randomPayload() {
  const archive =
    JSON.parse(
      await readFile(
        path.join(
          dataDir,
          'auctions.json'
        ),
        'utf8'
      )
    );

  const game =
    selectRandomSet(
      archive.auctions ||
      []
    );

  return {
    ...game,

    auctions:
      game.auctions.map(
        auction => ({
          ...auction,

          actualBid:
            auction.correctPrice
        })
      )
  };
}

async function rollingFetch() {
  if (
    rollingPromise
  ) {
    return rollingPromise;
  }

  rollingPromise =
    (async () => {
      lastRefresh = {
        status:
          'running',

        startedAt:
          new Date()
            .toISOString(),

        finishedAt:
          null,

        error:
          null
      };

      try {
        const result =
          await processRollingTask({
            dataDir,

            minimumIntervalMs:
              fetchMinIntervalMs,

            initialIntervalMs:
              fetchInitialIntervalMs,

            maximumIntervalMs:
              fetchMaxIntervalMs
          });

        lastRefresh = {
          ...lastRefresh,
          ...result,

          status:
            result.status,

          finishedAt:
            new Date()
              .toISOString()
        };

        return result;
      } catch (error) {
        lastRefresh = {
          ...lastRefresh,

          status:
            'error',

          finishedAt:
            new Date()
              .toISOString(),

          error:
            error.message
        };

        console.error(
          'Auction refresh failed:',
          error
        );

        return {
          status:
            'error',

          error:
            error.message,

          waitMs:
            fetchMaxIntervalMs
        };
      } finally {
        rollingPromise =
          null;
      }
    })();

  return rollingPromise;
}

function scheduleNextRollingFetch(
  delayMs = 0
) {
  if (
    shuttingDown
  ) {
    return;
  }

  if (
    rollingTimer
  ) {
    clearTimeout(
      rollingTimer
    );
  }

  rollingTimer =
    setTimeout(
      async () => {
        rollingTimer =
          null;

        const result =
          await rollingFetch();

        let nextDelay =
          result?.waitMs;

        if (
          !Number.isFinite(
            nextDelay
          )
        ) {
          nextDelay =
            result?.status ===
              'idle'
              ? fetchIdlePollMs
              : result
                  ?.adaptiveIntervalMs ||
                fetchInitialIntervalMs;
        }

        scheduleNextRollingFetch(
          Math.max(
            50,
            nextDelay
          )
        );
      },
      Math.max(
        0,
        delayMs
      )
    );

  rollingTimer.unref();
}

function discoveryReferenceTime(
  queue,
  archive
) {
  const primary =
    Date.parse(
      queue.lastDiscoveryAt ||
      ''
    );

  if (
    Number.isFinite(
      primary
    )
  ) {
    return primary;
  }

  const fallbacks = [
    queue.updatedAt,
    queue.lastRequestAt,
    archive.updatedAt
  ]
    .map(
      value =>
        Date.parse(
          value ||
          ''
        )
    )
    .filter(
      Number.isFinite
    );

  return fallbacks.length
    ? Math.max(
        ...fallbacks
      )
    : null;
}

async function maybeScheduleDiscovery({
  force = false,
  wakeFetcher = true
} = {}) {
  if (
    rollingPromise
  ) {
    await rollingPromise;
  }

  const [
    queue,
    archive
  ] =
    await Promise.all([
      readFetchQueue(),

      readDataJson(
        'auctions.json',
        {
          updatedAt:
            null,

          auctions:
            []
        }
      )
    ]);

  if (
    queue.tasks?.length >
    0
  ) {
    return {
      scheduled:
        false,

      reason:
        'pending_queue',

      pending:
        queue.tasks.length
    };
  }

  const now =
    Date.now();

  const reference =
    discoveryReferenceTime(
      queue,
      archive
    );

  const requiresMigrationScan =
    queue.version !==
      ROLLING_QUEUE_VERSION ||
    queue.needsFullDiscovery ===
      true;

  const due =
    force ||
    requiresMigrationScan ||
    reference == null ||
    now -
      reference >=
      discoveryIntervalMs;

  if (!due) {
    return {
      scheduled:
        false,

      reason:
        'not_due',

      nextDiscoveryAt:
        new Date(
          reference +
          discoveryIntervalMs
        ).toISOString()
    };
  }

  const scheduledQueue =
    await enqueueRollingDiscovery({
      dataDir,

      maxPages:
        discoveryMaxPages,

      now,
      force
    });

  if (
    wakeFetcher &&
    scheduledQueue.tasks
      ?.length > 0
  ) {
    scheduleNextRollingFetch(
      0
    );
  }

  return {
    scheduled:
      true,

    pending:
      scheduledQueue.tasks
        ?.length ||
      0,

    lastDiscoveryAt:
      scheduledQueue
        .lastDiscoveryAt ||
      null
  };
}

function scheduleDiscoveryChecks() {
  if (
    discoveryTimer
  ) {
    clearInterval(
      discoveryTimer
    );
  }

  discoveryTimer =
    setInterval(
      () => {
        maybeScheduleDiscovery({
          wakeFetcher:
            true
        })
          .catch(
            error => {
              console.error(
                'Auction discovery scheduling failed:',
                error
              );
            }
          );
      },
      discoveryCheckIntervalMs
    );

  discoveryTimer.unref();
}

function scheduleUtcRollover() {
  const now =
    new Date();

  const next =
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() +
        1,
      0,
      0,
      5
    );

  const timer =
    setTimeout(
      async () => {
        try {
          await ensureDailyGame({
            dataDir
          });
        } finally {
          scheduleUtcRollover();
        }
      },
      next -
      now.getTime()
    );

  timer.unref();
}

await seedArchiveIfEmpty({
  dataDir,

  seedFile:
    path.join(
      projectDir,
      'seed',
      'auctions.json'
    )
});

await ensureDailyGame({
  dataDir
});

await maybeScheduleDiscovery({
  wakeFetcher:
    false
});

const server =
  createServer(
    {
      maxHeaderSize:
        16 * 1024
    },
    async (
      request,
      response
    ) => {
      try {
        const url =
          new URL(
            request.url,
            `http://${request.headers.host || 'localhost'}`
          );

        if (
          request.method ===
            'GET' &&
          url.pathname ===
            '/healthz'
        ) {
          const queue =
            await readFetchQueue();

          json(
            response,
            200,
            {
              status:
                'ok',

              date:
                utcDateKey(),

              refresh:
                lastRefresh,

              discovery: {
                intervalHours:
                  discoveryHours,

                maxPages:
                  discoveryMaxPages,

                lastDiscoveryAt:
                  queue
                    .lastDiscoveryAt ||
                  null,

                pending:
                  queue.tasks
                    ?.length ||
                  0,

                pagesFetched:
                  queue.discovery
                    ?.pagesFetched ||
                  0,

                listingsSeen:
                  queue.discovery
                    ?.listingsSeen ||
                  0,

                complete:
                  Boolean(
                    queue.discovery
                      ?.complete
                  ),

                completedAt:
                  queue.discovery
                    ?.completedAt ||
                  null
              },

              fetch: {
                minIntervalMs:
                  fetchMinIntervalMs,

                initialIntervalMs:
                  fetchInitialIntervalMs,

                maxIntervalMs:
                  fetchMaxIntervalMs,

                currentIntervalMs:
                  queue.throttle
                    ?.intervalMs ??
                  null
              }
            }
          );

          return;
        }

        if (
          request.method ===
            'GET' &&
          url.pathname ===
            '/stats'
        ) {
          text(
            response,
            200,
            await publicStats()
          );

          return;
        }

        if (
          request.method ===
            'GET' &&
          url.pathname ===
            '/api/daily'
        ) {
          json(
            response,
            200,
            await dailyPayload()
          );

          return;
        }

        if (
          request.method ===
            'GET' &&
          url.pathname ===
            '/api/random'
        ) {
          json(
            response,
            200,
            await randomPayload()
          );

          return;
        }

        if (
          request.method ===
            'GET' &&
          url.pathname
            .startsWith(
              '/auction-images/'
            )
        ) {
          if (
            await sendFile(
              request,
              response,
              path.join(
                dataDir,
                'images'
              ),
              url.pathname.slice(
                '/auction-images/'
                  .length
              ),
              'public, max-age=86400, immutable'
            )
          ) {
            return;
          }

          json(
            response,
            404,
            {
              error:
                'image_not_found'
            }
          );

          return;
        }

        if (
          request.method !==
            'GET' &&
          request.method !==
            'HEAD'
        ) {
          json(
            response,
            405,
            {
              error:
                'method_not_allowed'
            }
          );

          return;
        }

        const extension =
          path.extname(
            url.pathname
          ).toLowerCase();

        const cacheControl =
          url.pathname ===
            '/' ||
          extension ===
            '.html' ||
          extension ===
            '.css' ||
          extension ===
            '.js'
            ? 'no-cache'
            : 'public, max-age=3600';

        const served =
          await sendFile(
            request,
            response,
            publicDir,
            url.pathname,
            cacheControl
          );

        if (!served) {
          json(
            response,
            404,
            {
              error:
                'not_found'
            }
          );
        }
      } catch (error) {
        console.error(
          error
        );

        if (
          !response.headersSent
        ) {
          json(
            response,
            500,
            {
              error:
                'internal_error'
            }
          );
        } else {
          response.end();
        }
      }
    }
  );

server.requestTimeout =
  15_000;

server.headersTimeout =
  10_000;

server.keepAliveTimeout =
  5_000;

server.maxRequestsPerSocket =
  1000;

server.maxHeadersCount =
  50;

server.listen(
  port,
  '0.0.0.0',
  () => {
    console.log(
      `JUSTIZGUESSR listening on http://0.0.0.0:${port}`
    );

    console.log(
      `Adaptive auction fetcher: ${fetchInitialIntervalMs}ms initial, ` +
      `${fetchMinIntervalMs}ms minimum, ${fetchMaxIntervalMs}ms maximum`
    );

    console.log(
      `Auction discovery: every ${discoveryHours}h, up to ${discoveryMaxPages} listing pages, ` +
      'stopping automatically at the end'
    );
  }
);

scheduleNextRollingFetch(
  0
);

scheduleDiscoveryChecks();

scheduleUtcRollover();

function shutdown(
  signal
) {
  shuttingDown =
    true;

  if (
    rollingTimer
  ) {
    clearTimeout(
      rollingTimer
    );
  }

  if (
    discoveryTimer
  ) {
    clearInterval(
      discoveryTimer
    );
  }

  console.log(
    `Received ${signal}; shutting down`
  );

  server.close(
    error =>
      process.exit(
        error
          ? 1
          : 0
      )
  );

  setTimeout(
    () =>
      process.exit(1),
    10_000
  ).unref();
}

process.on(
  'SIGTERM',
  () =>
    shutdown(
      'SIGTERM'
    )
);

process.on(
  'SIGINT',
  () =>
    shutdown(
      'SIGINT'
    )
);