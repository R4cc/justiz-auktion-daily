import { repairLegacyAuctionText } from './html-text.mjs';

// Only presentation fields change: bids, prices, ownership, IDs, URLs and
// request identifiers keep their original values. Includes frozen rewards/pools
// so sealed items and past Daily games don't reintroduce the encoded titles.
const jsonColumns = {
  auctions: ['payload_json'], daily_game_auctions: ['payload_json'], account_games: ['payload'],
  inventory: ['item'], daily_case_rewards: ['item'], case_openings: ['item'], sealed_cases: ['reward'],
  case_purchases: ['item'], case_rotations: ['payload'], palette_editions: ['payload_json'],
  primary_palette_rewards: ['item_json'], primary_palette_auctions: ['public_snapshot_json'],
  stock_palette_editions: ['payload'], stock_palette_purchases: ['offer', 'rewards'],
  primary_palette_stock_draws: ['draws', 'rewards'], primary_palette_mystery_stock: ['offer', 'rewards']
};
const textFields = new Set(['title', 'titleDe', 'description', 'descriptionDe']);
function repairFields(value) {
  if (!value || typeof value !== 'object') return false;
  let changed = false;
  for (const [key, entry] of Object.entries(value)) {
    if (textFields.has(key) && typeof entry === 'string') {
      const repaired = repairLegacyAuctionText(entry);
      if (repaired !== entry) { value[key] = repaired; changed = true; }
    } else if (repairFields(entry)) changed = true;
  }
  return changed;
}

// Called once by database startup inside a transaction. Stream rows to keep
// large archives within the production memory limit; skip unchanged payloads.
export function repairSavedAuctionText(db) {
  let updated = 0;
  for (const [table, fields] of Object.entries(jsonColumns)) {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) continue;
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    for (const column of fields.filter(field => columns.includes(field))) {
      const write = db.prepare(`UPDATE ${table} SET ${column}=?${table === 'auctions' ? ',title=?' : ''} WHERE rowid=?`);
      for (const row of db.prepare(`SELECT rowid AS row_id,${column} AS payload${table === 'auctions' ? ',title' : ''} FROM ${table} WHERE ${column} IS NOT NULL AND instr(${column},'&')>0`).iterate()) {
        const value = JSON.parse(row.payload);
        if (!repairFields(value)) continue;
        const payload = JSON.stringify(value);
        if (table === 'auctions') write.run(payload, typeof value.title === 'string' ? value.title : repairLegacyAuctionText(row.title), row.row_id);
        else write.run(payload, row.row_id);
        updated++;
      }
    }
  }
  return updated;
}
