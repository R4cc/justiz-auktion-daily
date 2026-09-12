import { auctionSelectionCategory, buildAuctionFamilies, chooseVariedAuctions } from './auction-selection.mjs';
import { auctionGallery } from './auction-images.mjs';
import { createHash } from 'node:crypto';

export const GAME_EPOCH = Date.UTC(2026, 0, 1);

export function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function gameNumber(dateKey = utcDateKey()) {
  return Math.floor(
    (
      Date.parse(`${dateKey}T00:00:00Z`) -
      GAME_EPOCH
    ) / 86400000
  ) + 1;
}

export function scoreGuess(guess, actual) {
  if (
    !Number.isFinite(guess) ||
    guess < 0 ||
    !Number.isFinite(actual) ||
    actual <= 0
  ) {
    return 0;
  }

  // A fixed cushion keeps small Euro misses on inexpensive auctions from
  // consuming most of the score. The power curve rewards close guesses
  // generously while still separating increasingly large misses.
  const priceDistance =
    Math.abs(guess - actual) /
    (actual + 15);

  return Math.round(
    1000 /
    (
      1 +
      Math.pow(
        priceDistance / 0.5,
        1.7
      )
    )
  );
}

export function censorCurrencyValues(value = '') {
  const amount =
    String.raw`(?:\d{1,3}(?:[.,'’\s\u00a0]\d{3})+|\d+)(?:[,.](?:\d{1,2}|-{1,2}))?(?:\s*(?:Tsd\.?|Mio\.?|k))?`;

  const currency =
    String.raw`(?:€|&euro;|&#8364;|&#x20ac;|EUR|Euro|CHF|Schweizer(?:ische)?\s+Franken|Franken|USD|US-Dollar|Dollar|GBP|Pfund|£|&pound;|&#163;|CAD|AUD|JPY|¥|US\$|\$)`;

  const currencyValue =
    new RegExp(
      String.raw`(?:${currency}\s*(?::|=)?\s*(?:ca\.?\s*)?${amount}|${amount}\s*${currency})`,
      'giu'
    );

  const priceLabel =
    String.raw`(?:aktuelles\s+Gebot|derzeitiges\s+Gebot|momentanes\s+Gebot|Höchstgebot|Gebotsstand|Startgebot|Mindestgebot|Endgebot|Gebot|Zuschlagspreis|Schätzwert|Verkehrswert|Wiederbeschaffungswert|Warenwert|Zeitwert|Neupreis|Listenpreis|Kaufpreis|Verkaufspreis|Startpreis|aktueller\s+Preis|Preis|Wert|UVP|VB|NP)`;

  const labeledValue =
    new RegExp(
      String.raw`\b(${priceLabel})\b\s*(?:(?:in\s+Höhe\s+)?von|beträgt|beläuft\s+sich\s+auf|lag\s+bei|liegt\s+bei|war|ist|:|=)?\s*(?:ca\.?\s*)?${amount}`,
      'giu'
    );

  return String(value || '')
    .replace(
      currencyValue,
      '[Preis ausgeblendet]'
    )
    .replace(
      labeledValue,
      (_, label) =>
        `${label}: [Preis ausgeblendet]`
    );
}

function deterministicJitter(
  dateKey,
  id
) {
  const bytes =
    createHash('sha256')
      .update(
        `${dateKey}:${id}`
      )
      .digest();

  return bytes.readUInt32BE(0) /
    0xffffffff;
}

function deterministicOrder(
  dateKey,
  id
) {
  const bytes =
    createHash('sha256')
      .update(
        `order:${dateKey}:${id}`
      )
      .digest();

  return bytes.readUInt32BE(0) /
    0xffffffff;
}

function priceBand(price) {
  if (price < 50) {
    return 'under-50';
  }

  if (price < 250) {
    return 'under-250';
  }

  if (price < 1000) {
    return 'under-1000';
  }

  if (price < 5000) {
    return 'under-5000';
  }

  return 'over-5000';
}

function endSlot(endAt) {
  return endAt
    ? endAt.slice(0, 13)
    : 'unknown';
}

function qualityScore(
  auction,
  now
) {
  let score = 0;

  if (auction.image) {
    score += 35;
  }

  if (
    (
      auction.description ||
      ''
    ).length >= 80
  ) {
    score += 18;
  }

  if (
    (
      auction.title ||
      ''
    ).length >= 12
  ) {
    score += 12;
  }

  if (
    (
      auction.bidCount ||
      0
    ) > 0
  ) {
    score += 20;
  }

  if (
    (
      auction.bidCount ||
      0
    ) >= 5
  ) {
    score += 8;
  }

  if (
    auction.endAt &&
    Date.parse(
      auction.endAt
    ) > now
  ) {
    score += 20;
  }

  return score;
}

function playableAuction(
  auction,
  correctPrice =
    auction.finalPrice ??
    auction.currentBid
) {
  return {
    id:
      auction.id,

    title:
      auction.title,

    description:
      censorCurrencyValues(
        auction.description
      ),

    category:
      auctionSelectionCategory(auction),

    image:
      auction.image,

    images:
      auctionGallery(auction),

    condition:
      auction.condition ||
      'Keine Angabe',

    fulfillment:
      auction.fulfillment ||
      'Siehe Auktion',

    startBid:
      auction.startBid,

    correctPrice,

    bidCount:
      auction.bidCount ||
      0,

    startAt:
      auction.startAt ||
      null,

    endAt:
      auction.endAt ||
      null,

    location:
      auction.location ||
      null,

    sourceCapturedAt:
      auction.capturedAt ||
      null,

    url:
      auction.url
  };
}

function eligibleAuction(auction) {
  return auction?.id && auction.title && auction.image &&
    Number.isFinite(auction.finalPrice ?? auction.currentBid) &&
    (auction.finalPrice ?? auction.currentBid) > 0;
}

export function selectDailySet(auctions, dateKey, previousSets = {}, count = 5, usedAuctionIds = []) {
  const now = Date.parse(dateKey + 'T00:00:00Z');
  const history = Object.keys(previousSets).filter(date => date < dateKey).sort()
    .flatMap(date => previousSets[date]?.auctions || []);
  const used = new Set([...usedAuctionIds, ...history.map(item => item.id)].map(Number));
  const recent = Object.keys(previousSets).filter(date => date < dateKey).sort().slice(-7)
    .flatMap(date => previousSets[date]?.auctions || []);
  const recentCategories = new Map();
  for (const item of recent) {
    const category = auctionSelectionCategory(item);
    recentCategories.set(category, (recentCategories.get(category) || 0) + 1);
  }
  const byId = new Map(auctions.map(item => [Number(item?.id), item]));
  const families = buildAuctionFamilies([...auctions, ...history]);
  const active = item => (!item.endAt || Date.parse(item.endAt) > now) && Number.isFinite(item.currentBid) && item.currentBid > 0;
  const rank = (item, selected = []) => qualityScore(item, now) + (active(item) ? 100 : 0)
    - (recentCategories.get(auctionSelectionCategory(item)) || 0) * 12
    + (selected.some(other => priceBand(other.currentBid) === priceBand(item.currentBid)) ? 0 : 20)
    + (selected.some(other => endSlot(other.endAt) === endSlot(item.endAt)) ? -50 : 35)
    + deterministicJitter(dateKey, item.id) * 12;
  const candidates = [];
  for (const family of families) {
    if (family.some(item => used.has(Number(item.id)))) continue;
    const members = [...new Map(family.map(item => [Number(item.id), byId.get(Number(item.id))])).values()]
      .filter(eligibleAuction).sort((a, b) => rank(b) - rank(a) || Number(a.id) - Number(b.id));
    if (members.length) candidates.push(members[0]);
  }
  const selected = chooseVariedAuctions(candidates, count, rank);
  selected.sort((a, b) => deterministicOrder(dateKey, a.id) - deterministicOrder(dateKey, b.id));
  return {
    date: dateKey,
    gameNumber: gameNumber(dateKey),
    generatedAt: new Date().toISOString(),
    auctions: selected.map(item => playableAuction(item, active(item) ? item.currentBid : item.finalPrice ?? item.currentBid))
  };
}

export function selectRandomSet(auctions, count = 5, random = Math.random, usage = new Map()) {
  const byId = [...new Map(auctions.filter(Boolean).map(item => [Number(item.id), item])).values()];
  const useCount = item => {
    const value = usage instanceof Map ? usage.get(Number(item.id)) : usage?.[item.id];
    return Math.max(0, Number(typeof value === 'object' ? value?.useCount : value) || 0);
  };
  const families = buildAuctionFamilies(byId);
  const candidates = [];
  const ranks = new Map();
  // One random draw and one usage total per family: hundreds of duplicate listings
  // have the same chance as one item, and cannot reset rotation with a new auction ID.
  for (const family of families) {
    const members = family.filter(eligibleAuction).sort((a, b) => useCount(a) - useCount(b) || Number(a.id) - Number(b.id));
    if (!members.length) continue;
    const choice = members[0];
    ranks.set(choice, -family.reduce((sum, item) => sum + useCount(item), 0) + Math.min(.999999, Math.max(0, random())));
    candidates.push(choice);
  }
  const selected = chooseVariedAuctions(candidates, count, item => ranks.get(item));
  // Avoid always opening with the rarest or least-used category.
  for (let index = selected.length - 1; index > 0; index--) {
    const target = Math.min(index, Math.floor(Math.max(0, random()) * (index + 1)));
    [selected[index], selected[target]] = [selected[target], selected[index]];
  }
  return { mode: 'random', generatedAt: new Date().toISOString(), auctions: selected.map(item => playableAuction(item)) };
}
