import { randomInt, createHash } from 'node:crypto';
import { auctionGallery } from './auction-images.mjs';
import { auctionSelectionCategory, buildAuctionFamilies, normalizeSelectionText } from './auction-selection.mjs';
import { readArchive, transaction, withDatabase } from './database.mjs';

export const RARITIES = [
  { id: 'common', name: 'Gewöhnlich' }, { id: 'uncommon', name: 'Ungewöhnlich' },
  { id: 'rare', name: 'Selten' }, { id: 'epic', name: 'Episch' }, { id: 'legendary', name: 'Legendär' }
];
// Integer tickets keep the refund chance exactly 50%, with a 94.25% expected return.
export const CASE_WEIGHTS = [5000, 3500, 1200, 290, 10];
export const SALE_MULTIPLIERS = [.1, 1, 2.5, 7.5, 25];
export const CASES = [
  { id: 'fundkiste', name: 'Seized Goods Case', category: 'mixed', badge: 'JG', baseCost: 100, referenceValue: 100 },
  { id: 'schatzkiste', name: 'Contraband Case', category: 'premium', badge: 'JG+', baseCost: 250, referenceValue: 500 },
  { id: 'cars', name: 'Car Case', nameDe: 'Auto-Kiste', category: 'cars', badge: 'CAR', baseCost: 500, referenceValue: 5000 },
  { id: 'wine', name: 'Wine Case', nameDe: 'Wein-Kiste', category: 'wine', badge: 'VIN', baseCost: 150, referenceValue: 80 },
  { id: 'electronics', name: 'Electronics Case', nameDe: 'Elektronik-Kiste', category: 'electronics', badge: 'ELEC', baseCost: 200, referenceValue: 200 },
  { id: 'tools', name: 'Tool Case', nameDe: 'Werkzeug-Kiste', category: 'tools', badge: 'TOOL', baseCost: 150, referenceValue: 100 },
  { id: 'jewellery', name: 'Jewellery Case', nameDe: 'Schmuck-Kiste', category: 'jewellery', badge: 'GEM', baseCost: 350, referenceValue: 500 },
  { id: 'collectibles', name: 'Collector Case', nameDe: 'Sammler-Kiste', category: 'collectibles', badge: 'RARE', baseCost: 200, referenceValue: 100 }
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CONFIG = hash({ version: 1, cases: CASES, rarities: RARITIES, weights: CASE_WEIGHTS, sales: SALE_MULTIPLIERS });
const DAY_MS = 86400000;
export const rotationDate = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

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
  const prices = (selected.length ? selected : stock).map(item => item.price).sort((a, b) => a - b);
  const median = prices.length ? (prices[Math.floor((prices.length - 1) / 2)] + prices[Math.floor(prices.length / 2)]) / 2 : definition.referenceValue;
  const marketFactor = Math.max(.75, Math.min(1.5, 1 + Math.log2((median + 1) / (definition.referenceValue + 1)) * .12));
  const offerFactor = [.9, 1, 1.1, 1.05, .95][(dayIndex + parseInt(hash(definition.id).slice(0, 8), 16)) % 5];
  const cost = Math.max(50, Math.round(definition.baseCost * marketFactor * offerFactor / 10) * 10);
  const items = selected.map(item => ({ ...item, sellValue: Math.round(cost * SALE_MULTIPLIERS[RARITIES.findIndex(r => r.id === item.rarity)]) }));
  const available = items.length >= 5;
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
    cases: catalog.cases.map(({ weights, ...box }) => box) };
}

export function drawItem(catalog, box, random = randomInt) {
  const total = box.weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) throw new Error('empty_catalog');
  let roll = random(total), index = 0;
  while (roll >= box.weights[index]) roll -= box.weights[index++];
  const pool = box.items.filter(item => item.rarity === RARITIES[index].id);
  return pool[random(pool.length)];
}
