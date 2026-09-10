import path from 'node:path';

import {
  collectAuctions,
  ensureDailyGame,
  seedArchiveIfEmpty
} from '../src/collector.mjs';

const projectDir =
  path.resolve(
    new URL(
      '..',
      import.meta.url
    ).pathname.slice(
      process.platform ===
        'win32'
        ? 1
        : 0
    )
  );

const dataDir =
  path.resolve(
    process.env.DATA_DIR ||
    path.join(
      projectDir,
      'runtime-data'
    )
  );

const maxPages =
  Math.max(
    1,
    Number(
      process.env
        .COLLECT_MAX_PAGES ||
      250
    )
  );

const maxDetails =
  process.env
    .COLLECT_MAX_DETAILS
    ? Math.max(
        1,
        Number(
          process.env
            .COLLECT_MAX_DETAILS
        )
      )
    : Number
        .POSITIVE_INFINITY;

await seedArchiveIfEmpty({
  dataDir,

  seedFile:
    path.join(
      projectDir,
      'seed',
      'auctions.json'
    )
});

await collectAuctions({
  dataDir,
  maxPages,
  maxDetails
});

await ensureDailyGame({
  dataDir
});