import { randomInt, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { advanceShop, ensureBusinessSchema, shopStock } from './businesses.mjs';
import { marketIndexes } from './market.mjs';
import { inventoryIsLocked } from './resale.mjs';
import { pushNotification } from './notifications.mjs';

export const STORE_EVENT_INTERVAL = 24 * 3_600_000;
export const STORE_EVENT_CHANCE = 25;
export const STORE_EVENTS = [
  { id: 'bombing', weight: 3, effect: 'loss', fraction: 1, titleEn: 'Terrorist attack: shelves blown to hell', titleDe: 'Terroranschlag: Regale in die Luft gejagt', bodyEn: 'A terrorist blew up your storefront. Every stocked item is gone. Nobody was hurt, but your insurance company has mysteriously stopped answering.', bodyDe: 'Ein Terrorist hat deinen Laden gesprengt. Der gesamte Warenbestand ist weg. Niemand wurde verletzt, aber deine Versicherung geht plötzlich nicht mehr ans Telefon.' },
  { id: 'heist', weight: 7, effect: 'loss', fraction: 1, titleEn: 'The midnight clean-out', titleDe: 'Nachts komplett ausgeraubt', bodyEn: 'A professional crew stole every item on your shelves. They even took the welcome mat. Your shop can be restocked.', bodyDe: 'Eine Profi-Bande hat sämtliche Regale leergeräumt. Sogar die Fußmatte ist weg. Du kannst deinen Laden wieder auffüllen.' },
  { id: 'rich_buyer', weight: 25, effect: 'sale', fraction: 1, multiplier: 1, titleEn: 'Rich guy, zero self-control', titleDe: 'Reicher Typ, null Selbstbeherrschung', bodyEn: 'A billionaire walked in, said “I’ll take the lot,” and bought every stocked item at your shelf prices. Apparently budgeting is for peasants.', bodyDe: 'Ein Milliardär kam rein, sagte „Ich nehme alles“ und kaufte deinen gesamten Bestand zum Regalpreis. Haushaltsplanung ist wohl nur etwas für den Pöbel.' },
  { id: 'flood', weight: 10, effect: 'loss', fraction: .5, titleEn: 'Indoor swimming pool, unwanted edition', titleDe: 'Unfreiwilliger Indoor-Pool', bodyEn: 'A burst pipe drowned half your stock. The plumber called it “an exciting water feature.” You called it something unprintable.', bodyDe: 'Ein Rohrbruch hat die Hälfte deiner Waren ruiniert. Der Klempner nennt es „ein spannendes Wasserspiel“. Du nennst es etwas Unanständiges.' },
  { id: 'goose_rampage', weight: 8, effect: 'loss', fraction: .25, titleEn: 'HONK if you hate profit', titleDe: 'HUP, wenn du Gewinne hasst', bodyEn: 'A feral goose stormed the shelves and wrecked a quarter of your stock. Negotiations failed. The goose demanded bread.', bodyDe: 'Eine wilde Gans hat ein Viertel deines Warenbestands zerlegt. Verhandlungen scheiterten. Die Gans verlangt Brot.' },
  { id: 'tax_raid', weight: 12, effect: 'fine', titleEn: 'The taxman smelled happiness', titleDe: 'Das Finanzamt riecht Glück', bodyEn: 'An inspector found your “creative accounting.” A J€100 fine, capped at your wallet balance, has been collected. The receipt is somehow still missing.', bodyDe: 'Ein Prüfer hat deine „kreative Buchführung“ entdeckt. Eine Strafe von J€100 wurde eingezogen, höchstens dein Guthaben. Der Beleg ist trotzdem verschwunden.' },
  { id: 'collector', weight: 20, effect: 'sale', fraction: .5, maxItems: 3, multiplier: 1.5, titleEn: 'Collector with expensive problems', titleDe: 'Sammler mit teuren Problemen', bodyEn: 'An obsessive collector bought up to three items at 150% of your shelf prices. Their therapist would like a word.', bodyDe: 'Ein besessener Sammler kaufte bis zu drei Artikel für 150% deines Regalpreises. Sein Therapeut hätte da ein paar Fragen.' },
  { id: 'windfall', weight: 15, effect: 'gift', titleEn: 'Mysterious envelope, very real money', titleDe: 'Mysteriöser Umschlag, echtes Geld', bodyEn: 'Someone slipped J€200 under the door with a note saying “you saw nothing.” Your accountant suggests calling it a donation.', bodyDe: 'Jemand schob J€200 unter der Tür durch. Auf dem Zettel steht „Du hast nichts gesehen“. Dein Buchhalter empfiehlt „Spende“.' }
];
const gooseSave = { id: 'goose_guard', effect: 'none', titleEn: 'Goose guard ruined the heist', titleDe: 'Wachgans vereitelt den Raub', bodyEn: 'The midnight crew met your goose guard. One HONK later, they fled empty-handed. All stock survived.', bodyDe: 'Die Einbrecher trafen auf deine Wachgans. Ein HUP später flohen sie mit leeren Händen. Dein Bestand ist sicher.' };
const fail = (code, status = 400) => { throw new AccountError(code, status); };
export function ensureStoreEventSchema(db) {
  ensureBusinessSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS store_event_checks (
    business_id TEXT PRIMARY KEY REFERENCES businesses(id), checked_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_events (
    id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), owner_id TEXT NOT NULL REFERENCES users(id),
    result TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS store_events_pending ON store_events(owner_id, acknowledged_at, created_at)`);
}
function owner(db, user) {
  const row = db.prepare('SELECT id, tokens FROM users WHERE id = ? AND npc = 0 AND banned = 0 AND must_change_password = 0').get(user?.id || '');
  if (!row) fail('login_required', 401);
  return row;
}
const pending = (db, userId) => db.prepare('SELECT result FROM store_events WHERE owner_id = ? AND acknowledged_at IS NULL ORDER BY created_at, id LIMIT 50').all(userId).map(row => JSON.parse(row.result));

// Lazy, server-owned checks happen when the owner visits either store page.
// Missed days produce one check, never a backlog of catastrophic rolls.
export function checkStoreEvents(dataDir, user, { now = Date.now(), random = randomInt } = {}) {
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreEventSchema(db); const player = owner(db, user); marketIndexes(db, now);
    for (const shop of db.prepare('SELECT * FROM businesses WHERE user_id = ? ORDER BY bought_at, id').all(player.id)) {
      const last = db.prepare('SELECT checked_at FROM store_event_checks WHERE business_id = ?').get(shop.id)?.checked_at ?? shop.bought_at;
      if (now < last + STORE_EVENT_INTERVAL) continue;
      db.prepare('INSERT INTO store_event_checks VALUES (?, ?) ON CONFLICT(business_id) DO UPDATE SET checked_at = excluded.checked_at').run(shop.id, now);
      advanceShop(db, shop, now);
      const stock = shopStock(db, shop.id, shop.type, shop.profit_margin, now);
      if (!stock.length || random(100) >= STORE_EVENT_CHANCE) continue;
      let roll = random(100), event = STORE_EVENTS.find(candidate => (roll -= candidate.weight) < 0);
      if (event.id === 'heist' && shop.goose_guard && random(2) === 0) event = gooseSave;
      const id = randomUUID(), affected = ['loss', 'sale'].includes(event.effect)
        ? stock.slice(0, Math.min(event.maxItems ?? stock.length, Math.ceil(stock.length * event.fraction))) : [];
      let money = event.effect === 'gift' ? 200 : event.effect === 'fine' ? -Math.min(100, db.prepare('SELECT tokens FROM users WHERE id = ?').get(player.id).tokens) : 0;
      for (const entry of affected) {
        if (inventoryIsLocked(db, entry.id)) fail('item_locked', 409);
        if (!db.prepare('UPDATE inventory SET sold_at = ? WHERE id = ? AND user_id = ? AND sold_at IS NULL').run(now, entry.id, player.id).changes) fail('stock_conflict', 409);
        if (!db.prepare('DELETE FROM business_stock WHERE business_id = ? AND inventory_id = ? AND sold_at IS NULL').run(shop.id, entry.id).changes) fail('stock_conflict', 409);
        if (event.effect === 'sale') {
          const price = Math.round(entry.askingPrice * event.multiplier); money += price;
          db.prepare('INSERT INTO business_sales VALUES (?, ?, ?, ?, ?)').run(`event:${id}:${entry.id}`, shop.id, entry.id, price, now);
        }
      }
      const balance = db.prepare('SELECT tokens FROM users WHERE id = ?').get(player.id).tokens;
      if (!Number.isSafeInteger(money) || !Number.isSafeInteger(balance + money) || balance + money < 0) fail('token_balance_limit', 409);
      db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(money, player.id);
      if (event.effect === 'sale') db.prepare('UPDATE businesses SET sales = sales + ?, revenue = revenue + ?, visitors = visitors + 1 WHERE id = ?').run(affected.length, money, shop.id);
      const result = { id, shopId: shop.id, shopName: shop.store_name || '', shopType: shop.type, type: event.id, titleEn: event.titleEn, titleDe: event.titleDe, bodyEn: event.bodyEn, bodyDe: event.bodyDe,
        itemsLost: event.effect === 'loss' ? affected.length : 0, itemsSold: event.effect === 'sale' ? affected.length : 0, money, createdAt: now };
      db.prepare('INSERT INTO store_events VALUES (?, ?, ?, ?, ?, NULL)').run(id, shop.id, player.id, JSON.stringify(result), now);
      pushNotification(db, player.id, { type: 'store', sourceKey: `store-event:${id}`, titleEn: event.titleEn, titleDe: event.titleDe, bodyEn: event.bodyEn, bodyDe: event.bodyDe, href: `/stores?shop=${encodeURIComponent(shop.id)}` }, now);
    }
    return { events: pending(db, player.id) };
  }));
}
export function acknowledgeStoreEvents(dataDir, user, ids, { now = Date.now() } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || id.length > 100)) fail('invalid_store_events');
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureStoreEventSchema(db); const player = owner(db, user);
    db.prepare(`UPDATE store_events SET acknowledged_at = ? WHERE owner_id = ? AND acknowledged_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(now, player.id, ...ids);
    return { events: pending(db, player.id) };
  }));
}
