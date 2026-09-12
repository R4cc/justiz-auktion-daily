import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATABASE_FILENAME = 'justizguessr.sqlite';

const openDatabases = new Map();

function readLegacyJson(filename, fallback) {
  if (!existsSync(filename)) return fallback;
  return JSON.parse(readFileSync(filename, 'utf8'));
}

function transaction(database, work) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function prepareAuctionUpsert(database) {
  return database.prepare(`
    INSERT INTO auctions (
      id, title, category, image, current_bid, final_price, end_at,
      captured_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      image = excluded.image,
      current_bid = excluded.current_bid,
      final_price = excluded.final_price,
      end_at = excluded.end_at,
      captured_at = excluded.captured_at,
      payload_json = excluded.payload_json
  `);
}

function upsertAuction(statement, auction) {
  statement.run(
    Number(auction.id),
    auction.title || '',
    auction.category || null,
    auction.image || null,
    Number.isFinite(auction.currentBid) ? auction.currentBid : null,
    Number.isFinite(auction.finalPrice) ? auction.finalPrice : null,
    auction.endAt || null,
    auction.capturedAt || null,
    JSON.stringify(auction)
  );
}

function setState(database, key, value, updatedAt = new Date().toISOString()) {
  updatedAt ||= new Date().toISOString();
  database.prepare(`
    INSERT INTO app_state (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), updatedAt);
}

function getState(database, key, fallback) {
  const row = database.prepare('SELECT value_json FROM app_state WHERE key = ?').get(key);
  return row ? JSON.parse(row.value_json) : fallback;
}

function writeQueueToDatabase(database, queue) {
  database.prepare('DELETE FROM fetch_tasks').run();
  const insert = database.prepare(`
    INSERT INTO fetch_tasks (
      task_key, kind, url, auction_id, priority, attempts, not_before, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const task of queue.tasks || []) {
    insert.run(
      `${task.kind}:${task.url}`,
      task.kind,
      task.url,
      Number.isFinite(task.auctionId) ? task.auctionId : null,
      Number(task.priority || 0),
      Number(task.attempts || 0),
      Number(task.notBefore || 0),
      JSON.stringify(task)
    );
  }
  setState(database, 'fetch_queue', { ...queue, tasks: [] }, queue.updatedAt);
}

function importDailyGames(database, daily) {
  const insertGame = database.prepare(`
    INSERT OR IGNORE INTO daily_games (date, game_number, generated_at, selection_version)
    VALUES (?, ?, ?, ?)
  `);
  const insertAuction = database.prepare(`
    INSERT INTO daily_game_auctions (
      date, position, auction_id, correct_price, payload_json
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const rememberAuction = database.prepare(`
    INSERT OR IGNORE INTO daily_auction_usage (auction_id, first_date)
    VALUES (?, ?)
  `);

  for (const [date, game] of Object.entries(daily?.games || {}).sort(([a], [b]) => a.localeCompare(b))) {
    insertGame.run(date, game.gameNumber || null, game.generatedAt || null, game.selectionVersion || null);
    for (const [position, auction] of (game.auctions || []).entries()) {
      rememberAuction.run(Number(auction.id), date);
      insertAuction.run(
        date,
        position,
        Number(auction.id),
        Number.isFinite(auction.correctPrice) ? auction.correctPrice : null,
        JSON.stringify(auction)
      );
    }
  }
}

function migrateLegacyFiles(database, dataDir) {
  const migrated = database.prepare("SELECT value_json FROM app_state WHERE key = 'legacy_json_migrated'").get();
  if (migrated) return;

  const archive = readLegacyJson(path.join(dataDir, 'auctions.json'), { auctions: [] });
  const daily = readLegacyJson(path.join(dataDir, 'daily-games.json'), { games: {} });
  const queue = readLegacyJson(path.join(dataDir, 'fetch-queue.json'), null);

  transaction(database, () => {
    const upsert = prepareAuctionUpsert(database);
    for (const auction of archive.auctions || []) upsertAuction(upsert, auction);
    importDailyGames(database, daily);
    if (queue) writeQueueToDatabase(database, queue);
    if (archive.updatedAt) setState(database, 'archive_updated_at', archive.updatedAt, archive.updatedAt);
    if (daily.updatedAt) setState(database, 'daily_updated_at', daily.updatedAt, daily.updatedAt);
    setState(database, 'legacy_json_migrated', {
      migratedAt: new Date().toISOString(),
      auctions: archive.auctions?.length || 0,
      dailyGames: Object.keys(daily.games || {}).length,
      queueTasks: queue?.tasks?.length || 0
    });
  });
}

function openDatabase(dataDir) {
  const resolvedDataDir = path.resolve(dataDir);
  const existing = openDatabases.get(resolvedDataDir);
  if (existing) return existing;

  mkdirSync(resolvedDataDir, { recursive: true });
  const database = new DatabaseSync(path.join(resolvedDataDir, DATABASE_FILENAME));
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK(json_valid(value_json)),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      image TEXT,
      current_bid REAL,
      final_price REAL,
      end_at TEXT,
      captured_at TEXT,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS auctions_end_at_idx ON auctions(end_at);
    CREATE INDEX IF NOT EXISTS auctions_final_price_idx ON auctions(final_price);

    CREATE TABLE IF NOT EXISTS daily_games (
      date TEXT PRIMARY KEY,
      game_number INTEGER,
      generated_at TEXT,
      selection_version INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS daily_game_auctions (
      date TEXT NOT NULL REFERENCES daily_games(date) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      auction_id INTEGER NOT NULL,
      correct_price REAL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      PRIMARY KEY (date, position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS daily_auction_usage (
      auction_id INTEGER PRIMARY KEY,
      first_date TEXT NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO daily_auction_usage (auction_id, first_date)
      SELECT auction_id, MIN(date)
      FROM daily_game_auctions
      GROUP BY auction_id;

    CREATE TABLE IF NOT EXISTS random_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS random_game_auctions (
      random_game_id INTEGER NOT NULL REFERENCES random_games(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      auction_id INTEGER NOT NULL,
      PRIMARY KEY (random_game_id, position)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS random_game_auction_usage_idx
      ON random_game_auctions(auction_id, random_game_id);

    CREATE TABLE IF NOT EXISTS fetch_tasks (
      task_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      auction_id INTEGER,
      priority INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      not_before REAL NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS fetch_tasks_schedule_idx
      ON fetch_tasks(not_before, priority DESC);

    PRAGMA user_version = 2;
  `);
  migrateLegacyFiles(database, resolvedDataDir);
  openDatabases.set(resolvedDataDir, database);
  return database;
}

function withDatabase(dataDir, work) {
  return work(openDatabase(dataDir));
}

export function initializeDataStore(dataDir) {
  return withDatabase(dataDir, () => undefined);
}

export function closeDataStore(dataDir) {
  const resolvedDataDir = path.resolve(dataDir);
  const database = openDatabases.get(resolvedDataDir);
  if (!database) return;
  database.close();
  openDatabases.delete(resolvedDataDir);
}

export function readArchive(dataDir) {
  return withDatabase(dataDir, database => ({
    updatedAt: getState(database, 'archive_updated_at', null),
    auctions: database.prepare('SELECT payload_json FROM auctions ORDER BY id').all()
      .map(row => JSON.parse(row.payload_json))
  }));
}

export function upsertAuctions(dataDir, auctions, updatedAt = new Date().toISOString()) {
  return withDatabase(dataDir, database => transaction(database, () => {
    const upsert = prepareAuctionUpsert(database);
    for (const auction of auctions) upsertAuction(upsert, auction);
    setState(database, 'archive_updated_at', updatedAt, updatedAt);
    return { updatedAt, auctions };
  }));
}

export function readQueue(dataDir, fallback) {
  return withDatabase(dataDir, database => {
    const queue = getState(database, 'fetch_queue', fallback);
    const tasks = database.prepare(`
      SELECT payload_json FROM fetch_tasks
      ORDER BY priority DESC, not_before, task_key
    `).all().map(row => JSON.parse(row.payload_json));
    return { ...queue, tasks };
  });
}

export function writeQueue(dataDir, queue) {
  return withDatabase(dataDir, database => transaction(database, () => writeQueueToDatabase(database, queue)));
}

export function readDailyGames(dataDir) {
  return withDatabase(dataDir, database => {
    const games = {};
    const gameRows = database.prepare('SELECT * FROM daily_games ORDER BY date').all();
    const auctionQuery = database.prepare(`
      SELECT payload_json FROM daily_game_auctions
      WHERE date = ? ORDER BY position
    `);
    for (const row of gameRows) {
      games[row.date] = {
        date: row.date,
        gameNumber: row.game_number,
        generatedAt: row.generated_at,
        selectionVersion: row.selection_version,
        auctions: auctionQuery.all(row.date).map(item => JSON.parse(item.payload_json))
      };
    }
    return {
      updatedAt: getState(database, 'daily_updated_at', null),
      games
    };
  });
}

export function readDailyUsedIds(dataDir) {
  return withDatabase(dataDir, database => new Set(
    database.prepare('SELECT auction_id FROM daily_auction_usage').all()
      .map(row => Number(row.auction_id))
  ));
}

export function saveDailyGame(dataDir, game) {
  return withDatabase(dataDir, database => transaction(database, () => {
    database.prepare('DELETE FROM daily_games WHERE date = ?').run(game.date);
    database.prepare(`
      INSERT INTO daily_games (date, game_number, generated_at, selection_version)
      VALUES (?, ?, ?, ?)
    `).run(game.date, game.gameNumber, game.generatedAt, game.selectionVersion || null);
    const insert = database.prepare(`
      INSERT INTO daily_game_auctions (date, position, auction_id, correct_price, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const rememberAuction = database.prepare(`
      INSERT INTO daily_auction_usage (auction_id, first_date)
      VALUES (?, ?)
    `);
    for (const [position, auction] of game.auctions.entries()) {
      rememberAuction.run(Number(auction.id), game.date);
      insert.run(
        game.date,
        position,
        Number(auction.id),
        Number.isFinite(auction.correctPrice) ? auction.correctPrice : null,
        JSON.stringify(auction)
      );
    }
    const updatedAt = new Date().toISOString();
    setState(database, 'daily_updated_at', updatedAt, updatedAt);
    return game;
  }));
}

export function readRandomUsage(dataDir) {
  return withDatabase(dataDir, database => new Map(
    database.prepare(`
      SELECT auction_id, COUNT(*) AS use_count, MAX(random_game_id) AS last_game_id
      FROM random_game_auctions GROUP BY auction_id
    `).all().map(row => [
      Number(row.auction_id),
      { useCount: Number(row.use_count), lastGameId: Number(row.last_game_id) }
    ])
  ));
}

export function recordRandomGame(dataDir, game) {
  return withDatabase(dataDir, database => transaction(database, () => {
    const result = database.prepare('INSERT INTO random_games (generated_at) VALUES (?)')
      .run(game.generatedAt);
    const gameId = Number(result.lastInsertRowid);
    const insert = database.prepare(`
      INSERT INTO random_game_auctions (random_game_id, position, auction_id)
      VALUES (?, ?, ?)
    `);
    for (const [position, auction] of game.auctions.entries()) {
      insert.run(gameId, position, Number(auction.id));
    }
    return gameId;
  }));
}

export function readRandomStats(dataDir) {
  return withDatabase(dataDir, database => ({
    games: Number(database.prepare('SELECT COUNT(*) AS count FROM random_games').get().count),
    uniqueAuctions: Number(database.prepare('SELECT COUNT(DISTINCT auction_id) AS count FROM random_game_auctions').get().count)
  }));
}
