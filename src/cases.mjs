import { readFileSync } from 'node:fs';
import { randomInt, createHash } from 'node:crypto';
import { auctionGallery } from './auction-images.mjs';
import { auctionSelectionCategory, buildAuctionFamilies, normalizeSelectionText } from './auction-selection.mjs';
import { ECONOMY_BALANCE, GAME_REWARDS, expectedItemValue } from './economy-balance.mjs';
import { marketIndexes, estimatedValueTokens } from './market.mjs';
import { readArchive, transaction, withDatabase } from './database.mjs';

export const RARITIES = [
  { id: 'common', name: 'Gewöhnlich' }, { id: 'uncommon', name: 'Ungewöhnlich' },
  { id: 'rare', name: 'Selten' }, { id: 'epic', name: 'Episch' }, { id: 'legendary', name: 'Legendär' }
];
export const CASE_WEIGHTS = [5000, 3500, 1200, 290, 10];
export const CASE_RETURN_TARGET = ECONOMY_BALANCE.paidCaseReturn;
export const DAILY_REWARD_FLOOR = ECONOMY_BALANCE.daily;
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
const CONFIG = hash({ version: 3, cases: CASES, rarities: RARITIES, weights: CASE_WEIGHTS, returnTarget: CASE_RETURN_TARGET });
const DAY_MS = 86400000;
export const rotationDate = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const tokenValue = price => Math.max(1, Math.round(price));

// Retained for callers that need the original archive-wide rarity heuristic.
export function itemRarity(price, familySize) {
  const score = .8 * Math.min(1, Math.log10(Math.max(0, price) + 1) / 5) + .2 / Math.sqrt(familySize);
  return RARITIES[[.32, .46, .60, .78].filter(threshold => score >= threshold).length];
}

// Exported so palette editions can reuse the exact legacy theme semantics
// (vehicle parts are not cars, spirits are not wine). Do not add new rules here.
export function matchesTheme(item, theme) {
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

// Shared tiered pool construction for case editions and palette editions:
// eligibility filtering, one representative per deduplicated family (chosen by
// the selection index), value-rank ordering, the premium trim, tier sizing and
// caps, and deterministic per-tier offsets. Case editions keep their theme
// predicate; palette event editions pass a market-category eligibility. This
// is the single rarity algorithm — do not fork it.
export function buildEditionItems(definition, families, dayIndex, eligible = null) {
  const predicate = eligible || (item => matchesTheme(item, definition.category));
  let stock = families.map(family => family.filter(predicate)).filter(family => family.length).map(family => {
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
  return selected.map(item => ({ ...item, sellValue: tokenValue(item.price) }));
}

function edition(definition, families, dayIndex) {
  const items = buildEditionItems(definition, families, dayIndex);
  const available = items.length >= 5;
  const expectedValue = available ? expectedItemValue(items, CASE_WEIGHTS) : 0;
  const cost = available ? Math.max(1, Math.ceil(expectedValue / CASE_RETURN_TARGET)) : 0;
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

export function caseRewards() { return { ...GAME_REWARDS }; }

// The contents rotate daily; the quote follows the market. The base-value
// floor also protects the legacy instant-sale mode in a falling market.
export function priceCaseCatalog(catalog, indexes = {}) {
  const cases = catalog.cases.map(box => ({ ...box, cost: box.available
    ? Math.max(1, Math.ceil(Math.max(expectedItemValue(box.items, box.weights),
      expectedItemValue(box.items, box.weights, item => estimatedValueTokens(item, indexes))) / CASE_RETURN_TARGET)) : 0 }));
  const poolRevision = catalog.poolRevision || catalog.revision;
  return { ...catalog, poolRevision, cases, revision: hash({ poolRevision, costs: cases.map(box => box.cost) }) };
}

export function quoteCaseCatalog(dataDir, catalog, now = Date.now()) {
  return withDatabase(dataDir, db => priceCaseCatalog(catalog, marketIndexes(db, now)));
}

// Free Daily cases use affordable archive finds, re-ranked within this pool.
// Whole vehicles and other expensive archive tails belong in paid auctions.
// The packaged starter archive supplies missing families in a thin archive;
// it never changes any already-prepared sealed reward.
const starterArchive = JSON.parse(readFileSync(new URL('../seed/auctions.json', import.meta.url), 'utf8')).auctions;
export function dailyRewardCatalog(catalog, fallback = [], now = Date.now()) {
  const candidates = [...(catalog?.cases || []).flatMap(box => box.items || []), ...fallback].map(item => ({
    ...item, id: item.auctionId ?? item.id,
    finalPrice: item.actualBid ?? item.price ?? item.finalPrice ?? item.currentBid
  })).filter(item => Number.isFinite(item.finalPrice) && item.finalPrice > 0
    && item.finalPrice <= ECONOMY_BALANCE.dailyCaseMaxItemValue);
  let result = caseCatalog(candidates, now);
  if (!result.cases.find(box => box.id === 'fundkiste')?.available) {
    result = caseCatalog([...candidates, ...starterArchive.filter(item => (item.finalPrice ?? item.currentBid) <= ECONOMY_BALANCE.dailyCaseMaxItemValue)], now);
  }
  return result;
}

export function drawItem(catalog, box, random = randomInt) {
  const total = box.weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) throw new Error('empty_catalog');
  let roll = random(total), index = 0;
  while (roll >= box.weights[index]) roll -= box.weights[index++];
  const pool = box.items.filter(item => item.rarity === RARITIES[index].id);
  return pool[random(pool.length)];
}

// Daily grants are free and separate from the paid case economy. A perfect
// 5,000-point run has better case-tier odds; even a zero-point run
// still receives one item. Integer weights always sum to 10,000.
export function dailyCaseWeights(score) {
  const progress = Math.min(1, Math.max(0, Number(score) / 5000 || 0));
  const uncommon = Math.round(1800 + 1700 * progress);
  const rare = Math.round(180 + 1420 * progress);
  const epic = Math.round(19 + 361 * progress);
  const legendary = Math.round(1 + 19 * progress);
  return [10000 - uncommon - rare - epic - legendary, uncommon, rare, epic, legendary];
}

export function drawDailyCaseItem(catalog, auctions, score, random = randomInt) {
  const weights = dailyCaseWeights(score);
  const mixed = catalog?.cases?.find(box => box.id === 'fundkiste');
  if (mixed?.available && RARITIES.every(rarity => mixed.items.some(item => item.rarity === rarity.id))) {
    return drawItem(catalog, { ...mixed, weights }, random);
  }
  // The Daily itself is a durable fallback if the archive cannot provide all
  // five case tiers. Its five lots are ranked by value and mapped to tiers.
  const ranked = [...auctions].sort((a, b) => (a.actualBid ?? a.currentBid ?? 0) - (b.actualBid ?? b.currentBid ?? 0));
  if (!ranked.length) throw new Error('game_unavailable');
  let roll = random(10000), tier = 0;
  while (roll >= weights[tier]) roll -= weights[tier++];
  const auction = ranked[Math.round(tier * (ranked.length - 1) / 4)];
  const price = Math.max(1, Number(auction.actualBid ?? auction.currentBid ?? auction.finalPrice) || 1);
  return { auctionId: auction.id, title: auction.title, image: auction.image || auction.images?.[0] || null,
    price, sellValue: tokenValue(price), rarity: RARITIES[tier].id, category: auction.category };
}
