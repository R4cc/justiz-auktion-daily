import { AccountError } from './errors.mjs';
import { estimatedValueTokens, marketIndexes } from './market.mjs';
import { inventoryIsLocked } from './resale.mjs';
import { sealedPaletteInventoryIds } from './palette-auctions.mjs';
import { pushNotification } from './notifications.mjs';

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
export function ensureJusticeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS player_justice (
    user_id TEXT PRIMARY KEY REFERENCES users(id), fine_due INTEGER NOT NULL DEFAULT 0,
    offences INTEGER NOT NULL DEFAULT 0, jailed_until INTEGER NOT NULL DEFAULT 0,
    last_result TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS justice_seizures (
    id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), inventory_id TEXT NOT NULL,
    value INTEGER NOT NULL, created_at INTEGER NOT NULL
  ) STRICT`);
}
export function justiceStatus(db, userId, now) {
  ensureJusticeSchema(db);
  const row = db.prepare('SELECT * FROM player_justice WHERE user_id=?').get(userId);
  return { fineDue: row?.fine_due || 0, offences: row?.offences || 0,
    jailedUntil: row?.jailed_until || 0, jailed: Boolean(row && row.jailed_until > now),
    lastConsequence: row?.last_result ? JSON.parse(row.last_result) : null };
}
export function assertPlayerFree(db, userId, now = Date.now()) {
  const status = justiceStatus(db, userId, now);
  if (status.jailed) { const error = new AccountError('player_jailed', 423); error.justice = status; throw error; }
  return status;
}
export const jailDuration = offences => Math.min(24 * 60, 5 * 3 ** Math.min(6, Math.max(0, offences - 1))) * 60000;

// Keep bidder escrow intact. Only listings with no bids may be cancelled for
// collection. Remaining debt waits for money/stock to become available.
export function collectFine(db, userId, now) {
  ensureJusticeSchema(db);
  const row = db.prepare('SELECT * FROM player_justice WHERE user_id=?').get(userId);
  if (!row?.fine_due || row.jailed_until > now) return null;
  const user = db.prepare('SELECT tokens FROM users WHERE id=?').get(userId);
  let due = row.fine_due, paidCash = Math.min(user.tokens, due);
  db.prepare('UPDATE users SET tokens=tokens-? WHERE id=?').run(paidCash, userId); due -= paidCash;
  const seized = [], hidden = sealedPaletteInventoryIds(db), indexes = marketIndexes(db, now);
  const items = db.prepare('SELECT id,item FROM inventory WHERE user_id=? AND sold_at IS NULL').all(userId)
    .filter(item => !hidden.has(item.id)).map(item => ({...item, value: estimatedValueTokens(JSON.parse(item.item), indexes)})).sort((a,b)=>a.value-b.value||a.id.localeCompare(b.id));
  for (const item of items) {
    if (!due) break;
    if (hasTable(db, 'resale_auctions')) {
      const listings = db.prepare(`SELECT a.id FROM resale_auction_items ai JOIN resale_auctions a ON a.id=ai.auction_id
        WHERE ai.inventory_id=? AND a.seller_id=? AND a.status='active' AND a.settled_at IS NULL AND a.current_bidder_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM resale_bids b WHERE b.auction_id=a.id)`).all(item.id,userId);
      for (const listing of listings) db.prepare("UPDATE resale_auctions SET status='cancelled',closed_at=? WHERE id=?").run(now,listing.id);
    }
    if (inventoryIsLocked(db,item.id)) continue;
    // All changes are part of the caller's transaction: no partial seizure.
    db.prepare('DELETE FROM business_stock WHERE inventory_id=? AND sold_at IS NULL').run(item.id);
    db.prepare('UPDATE inventory SET sold_at=? WHERE id=? AND user_id=? AND sold_at IS NULL').run(now,item.id,userId);
    db.prepare('INSERT INTO justice_seizures(user_id,inventory_id,value,created_at) VALUES (?,?,?,?)').run(userId,item.id,item.value,now);
    seized.push({id:item.id,title:JSON.parse(item.item).title,value:item.value});
    const applied = Math.min(due,item.value); due -= applied;
    if (item.value > applied) db.prepare('UPDATE users SET tokens=tokens+? WHERE id=?').run(item.value-applied,userId);
  }
  const remainingItems = db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE user_id=? AND sold_at IS NULL').get(userId).n;
  let jailedUntil = row.jailed_until, convertedToSentence = 0;
  if (due && !remainingItems) {
    jailedUntil = now + jailDuration(row.offences); convertedToSentence = due; due = 0;
  }
  if (!paidCash && !seized.length && jailedUntil===row.jailed_until) return null;
  const result = { fine: row.fine_due, paidCash, seized, remainingFine: due, jailedUntil, convertedToSentence, offences: row.offences };
  db.prepare('UPDATE player_justice SET fine_due=?,jailed_until=?,last_result=? WHERE user_id=?').run(due,jailedUntil,JSON.stringify(result),userId);
  pushNotification(db,userId,{type:'store',sourceKey:`justice:${userId}:${row.offences}:${now}`,titleEn:jailedUntil>now?'Sent to jail':'Fine collection',titleDe:jailedUntil>now?'Haftstrafe':'Bußgeldvollstreckung',
    bodyEn:`Paid J€ ${paidCash}; the bailiff seized ${seized.length} item(s). ${jailedUntil>now?'Your account is locked until your sentence ends.':due?'Remaining fine will be collected when assets become available.':'The fine is settled.'}`,
    bodyDe:`J€ ${paidCash} bezahlt; der Gerichtsvollzieher hat ${seized.length} Artikel gepfändet. ${jailedUntil>now?'Dein Konto ist bis zum Ende der Haftstrafe gesperrt.':due?'Der Rest wird bei verfügbarem Vermögen eingezogen.':'Das Bußgeld ist beglichen.'}`,href:'/inventory'},now);
  return result;
}
export function imposeFine(db, userId, fine, now) {
  ensureJusticeSchema(db);
  db.prepare(`INSERT INTO player_justice(user_id,fine_due,offences) VALUES (?,?,1)
    ON CONFLICT(user_id) DO UPDATE SET fine_due=fine_due+excluded.fine_due,offences=offences+1`).run(userId,fine);
  const collected=collectFine(db,userId,now);
  if(collected)return collected;
  const status=justiceStatus(db,userId,now),pending={fine,paidCash:0,seized:[],remainingFine:status.fineDue,jailedUntil:status.jailedUntil,convertedToSentence:0,offences:status.offences};
  db.prepare('UPDATE player_justice SET last_result=? WHERE user_id=?').run(JSON.stringify(pending),userId);
  return pending;
}
