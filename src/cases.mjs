import { randomInt, createHash } from 'node:crypto';
import { auctionGallery } from './auction-images.mjs';
import { auctionSelectionCategory, buildAuctionFamilies, normalizeSelectionText } from './auction-selection.mjs';
import { readArchive, transaction, withDatabase } from './database.mjs';

export const RARITIES = [
  { id: 'common', name: 'Gewöhnlich' }, { id: 'uncommon', name: 'Ungewöhnlich' },
  { id: 'rare', name: 'Selten' }, { id: 'epic', name: 'Episch' }, { id: 'legendary', name: 'Legendär' }
];
export const CASE_WEIGHTS = [5000, 3500, 1200, 290, 10];
export const CASE_RETURN_TARGET = .9425;
export const CASES = [
  { id: 'fundkiste', name: 'Seized Goods Case', category: 'mixed', badge: 'JG' },
  { id: 'schatzkiste', name: 'Contraband Case', category: 'premium', badge: 'JG+' },
  { id: 'cars', name: 'Car Case', nameDe: 'Auto-Kiste', category: 'cars', badge: 'CAR' },
  { id: 'wine', name: 'Wine Case', nameDe: 'Wein-Kiste', category: 'wine', badge: 'VIN' },
  { id: 'electronics', name: 'Electronics Case', nameDe: 'Elektronik-Kiste', category: 'electronics', badge: 'ELEC' },
  { id: 'tools', name: 'Tool Case', nameDe: 'Werkzeug-Kiste', category: 'tools', badge: 'TOOL' },
  { id: 'jewellery', name: 'Jewellery Case', nameDe: 'Schmuck-Kiste', category: 'jewellery', badge: 'GEM' },
  { id: 'collectibles', name: 'Collector Case', nameDe: 'Sammler-Kiste', category: 'collectibles', badge: 'RARE' }
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CONFIG = hash({ version: 2, cases: CASES, rarities: RARITIES, weights: CASE_WEIGHTS, returnTarget: CASE_RETURN_TARGET });
const DAY_MS = 86400000;
export const rotationDate = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const tokenValue = price => Math.max(1, Math.round(price));

// Retained for callers that need the original archive-wide rarity heuristic.
export function itemRarity(price, familySize) {
  const score = .8 * Math.min(1, Math.log10(Math.max(0, price) + 1) / 5) + .2 / Math.sqrt(familySize);
  return RARITIES[[.32, .46, .60, .78].filter(threshold => score >= threshold).length];
}

function matchesTheme(item, theme) {
  if (theme === 'mixed' || theme === 'premium') return true;
  const category = auctionSelectionCategory(item), title = normalizeSelectionText(item.title);
  if (theme === 'cars') return category === 'Fahrzeuge' &&
    /\b(pkw|auto|car|personenkraftwagen|bmw|mercedes|volkswagen|vw|audi|hyundai|opel|skoda|ford|seat|toyota|tesla|renault|peugeot|fiat|citroen|kia|volvo|porsche)\b/.test(title) &&
    !/\b(reifen|felgen|ersatzteil|ersatzteile|anhanger|motorrad|motorroller|modellauto|radkappen|motor|getriebe|scheinwerfer|stossstange|autotur)\b/.test(title);
  if (theme === 'wine') {
    const text = normalizeSelectionText(`${item.title} ${String(item.description || '').slice(0, 600)}`);
    return category === 'Getränke' &&
      !/\b(whisky|whiskey|rum|cognac|brandy|vodka|wodka|likor|spirituosen|bier|gin|tequila)\b/.test(title) &&
      (/\b(wine|wein|weine|rotwein|weisswein|rosewein|riesling|merlot|cabernet|sauvignon|chardonnay|pinot|spatburgunder|burgunder|bordeaux|barolo|brunello|chianti|rioja|tempranillo|malbec|zinfandel|portwein|weingut|primitivo|avignonesi|champagner|champagne|prosecco|sekt|chablis|amarone|valpolicella|montepulciano|montalcino|sangiovese|sancerre|tignanello|sassicaia|ornellaia)\b/.test(text) ||
      (/\bflaschen?\b/.test(text) && /\b(jahrgang|trinkbarkeit)\b/.test(text)));
  }
  return category === ({ electronics: 'Elektronik', tools: 'Werkzeuge', jewellery: 'Schmuck & Uhren', collectibles: 'Sammlerstücke' })[theme];
}

function tierSizes(length) {
  // Reserve a distinct family for each rarity, then divide remaining stock by value rank.
  const shares = [.45, .25, .17, .1, .03], remaining = length - 5;
  const sizes = shares.map(share => 1 + Math.floor(remaining * share));
  const priority = shares.map((share, i) => ({ i, fraction: remaining * share % 1 }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0; sizes.reduce((a, b) => a + b, 0) < length; i++) sizes[priority[i].i]++;
  return sizes;
}

function edition(definition, families, dayIndex) {
  let stock = families.map(family => family.filter(item => matchesTheme(item, definition.category))).filter(family => family.length).map(family => {
    const auction = family[dayIndex % family.length];
    const price = auction.finalPrice ?? auction.currentBid;
    return { auctionId: auction.id, title: auction.title, image: auctionGallery(auction)[0],
      price, familySize: family.length, category: auctionSelectionCategory(auction),
      rank: Math.log10(price + 1) + .5 / Math.sqrt(family.length) };
  }).sort((a, b) => a.rank - b.rank || String(a.auctionId).localeCompare(String(b.auctionId), 'en'));
  if (definition.category === 'premium' && stock.length >= 8) stock = stock.slice(Math.floor(stock.length * .35));
  const caps = [8, 6, 5, 3, 2], selected = [];
  if (stock.length >= 5) {
    let start = 0;
    tierSizes(stock.length).forEach((size, tier) => {
      const pool = stock.slice(start, start + size); start += size;
      const count = Math.min(caps[tier], size === 1 ? 1 : Math.min(size - 1, Math.ceil(size * .65)));
      const offset = (dayIndex + parseInt(hash([definition.id, tier]).slice(0, 8), 16)) % size;
      for (let i = 0; i < count; i++) {
        const { rank, ...item } = pool[(offset + i) % size];
        selected.push({ ...item, rarity: RARITIES[tier].id });
      }
    });
  }
  const items = selected.map(item => ({ ...item, sellValue: tokenValue(item.price) }));
  const available = items.length >= 5;
  const totalWeight = CASE_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const expectedValue = available ? RARITIES.reduce((sum, rarity, tier) => {
    const pool = items.filter(item => item.rarity === rarity.id);
    const average = pool.reduce((value, item) => value + item.sellValue, 0) / pool.length;
    return sum + average * CASE_WEIGHTS[tier] / totalWeight;
  }, 0) : 0;
  const cost = available ? Math.max(1, Math.round(expectedValue / CASE_RETURN_TARGET)) : 0;
  return { id: definition.id, name: definition.name, nameDe: definition.nameDe || definition.name,
    category: definition.category, badge: definition.badge, cost, available, items,
    weights: CASE_WEIGHTS.map(weight => available ? weight : 0) };
}

export function caseCatalog(auctions, now = Date.now()) {
  const date = rotationDate(now), dayIndex = Math.floor(Date.parse(date) / DAY_MS);
  const eligible = auctions.filter(item => item.title && auctionGallery(item).length &&
    Number.isFinite(item.finalPrice ?? item.currentBid) && (item.finalPrice ?? item.currentBid) > 0)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
  const families = buildAuctionFamilies(eligible).map(family => family.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en')));
  const cases = CASES.map(definition => edition(definition, families, dayIndex));
  return { revision: hash({ date, config: CONFIG, cases }), rotationDate: date,
    rotatesAt: new Date(Date.parse(date) + DAY_MS).toISOString(), rarities: RARITIES, cases };
}

// Freeze each daily offer in SQLite: refreshes, collector updates and restarts cannot reroll it.
export function loadCaseCatalog(dataDir, now = Date.now()) {
  return withDatabase(dataDir, db => {
    db.exec(`CREATE TABLE IF NOT EXISTS case_rotations (
      date TEXT NOT NULL, config TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(date, config)
    ) STRICT`);
    const date = rotationDate(now);
    return transaction(db, () => {
      const stored = db.prepare('SELECT payload FROM case_rotations WHERE date = ? AND config = ?').get(date, CONFIG);
      if (stored) return JSON.parse(stored.payload);
      const catalog = caseCatalog(readArchive(dataDir).auctions, now);
      db.prepare('INSERT INTO case_rotations VALUES (?, ?, ?)').run(date, CONFIG, JSON.stringify(catalog));
      db.prepare('DELETE FROM case_rotations WHERE date < ?').run(rotationDate(now - 30 * DAY_MS));
      return catalog;
    });
  });
}

export function publicCaseCatalog(catalog) {
  return { revision: catalog.revision, rotationDate: catalog.rotationDate, rotatesAt: catalog.rotatesAt, rarities: catalog.rarities,
    rewards: caseRewards(catalog), cases: catalog.cases.map(({ weights, ...box }) => box) };
}

export function caseRewards(catalog) {
  const costs = catalog.cases.filter(box => box.available).map(box => box.cost);
  const daily = costs.length ? Math.min(...costs) : 100;
  return { daily, higherLowerPerCorrect: Math.max(1, Math.round(daily / 5)), higherLowerMax: daily * 2, minimumStreak: 3 };
}

export function drawItem(catalog, box, random = randomInt) {
  const total = box.weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) throw new Error('empty_catalog');
  let roll = random(total), index = 0;
  while (roll >= box.weights[index]) roll -= box.weights[index++];
  const pool = box.items.filter(item => item.rarity === RARITIES[index].id);
  return pool[random(pool.length)];
}
