import path from 'node:path';
import { collectAuctions, ensureDailyGame, seedArchiveIfEmpty } from '../src/collector.mjs';

const projectDir = path.resolve(new URL('..', import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectDir, 'runtime-data'));
await seedArchiveIfEmpty({ dataDir, seedFile: path.join(projectDir, 'seed', 'auctions.json') });
await collectAuctions({ dataDir, pages: Number(process.env.COLLECT_PAGES || 4) });
await ensureDailyGame({ dataDir });
