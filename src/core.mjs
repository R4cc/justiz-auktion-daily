import { createHash } from 'node:crypto';

export const GAME_EPOCH = Date.UTC(2026, 0, 1);

export function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function gameNumber(dateKey = utcDateKey()) {
  return Math.floor((Date.parse(`${dateKey}T00:00:00Z`) - GAME_EPOCH) / 86400000) + 1;
}

export function scoreGuess(guess, actual) {
  if (!Number.isFinite(guess) || guess < 0 || !Number.isFinite(actual) || actual <= 0) return 0;
  const error = Math.abs(guess - actual) / actual;
  return Math.round(1000 * Math.exp(-2.5 * error));
}

function deterministicJitter(dateKey, id) {
  const bytes = createHash('sha256').update(`${dateKey}:${id}`).digest();
  return bytes.readUInt32BE(0) / 0xffffffff;
}

function deterministicOrder(dateKey, id) {
  const bytes = createHash('sha256').update(`order:${dateKey}:${id}`).digest();
  return bytes.readUInt32BE(0) / 0xffffffff;
}

function priceBand(price) {
  if (price < 50) return 'under-50';
  if (price < 250) return 'under-250';
  if (price < 1000) return 'under-1000';
  if (price < 5000) return 'under-5000';
  return 'over-5000';
}

function endSlot(endAt) {
  return endAt ? endAt.slice(0, 13) : 'unknown';
}

function qualityScore(auction, now) {
  let score = 0;
  if (auction.image) score += 35;
  if ((auction.description || '').length >= 80) score += 18;
  if ((auction.title || '').length >= 12) score += 12;
  if ((auction.bidCount || 0) > 0) score += 20;
  if ((auction.bidCount || 0) >= 5) score += 8;
  if (auction.endAt && Date.parse(auction.endAt) > now) score += 20;
  return score;
}

function playableAuction(auction, correctPrice = auction.finalPrice ?? auction.currentBid) {
  return {
    id: auction.id,
    title: auction.title,
    description: auction.description,
    category: auction.category || 'Sonstiges',
    image: auction.image,
    images: auction.images || [auction.image],
    condition: auction.condition || 'Keine Angabe',
    fulfillment: auction.fulfillment || 'Siehe Auktion',
    startBid: auction.startBid,
    correctPrice,
    bidCount: auction.bidCount || 0,
    startAt: auction.startAt || null,
    endAt: auction.endAt || null,
    location: auction.location || null,
    sourceCapturedAt: auction.capturedAt || null,
    url: auction.url
  };
}

export function selectDailySet(auctions, dateKey, previousSets = {}, count = 5) {
  const now = Date.parse(`${dateKey}T00:00:00Z`);
  const historicalDates = Object.keys(previousSets).sort();
  const recentDates = historicalDates.slice(-30);
  const previouslyUsed = new Set(historicalDates.flatMap(key => previousSets[key]?.auctions?.map(item => item.id) || []));
  const recentCategoryCounts = recentDates.slice(-7)
    .flatMap(key => previousSets[key]?.auctions || [])
    .reduce((counts, item) => counts.set(item.category, (counts.get(item.category) || 0) + 1), new Map());
  const candidates = auctions
    .filter(auction => auction?.id && auction.title && auction.image)
    .filter(auction => Number.isFinite(auction.currentBid) && auction.currentBid > 0)
    .filter(auction => !auction.endAt || Date.parse(auction.endAt) > now)
    .filter(auction => !previouslyUsed.has(auction.id))
    .map(auction => ({ ...auction, _quality: qualityScore(auction, now), _jitter: deterministicJitter(dateKey, auction.id) }));

  const selected = [];
  const categories = new Set();
  const priceBands = new Set();
  const endSlots = new Set();
  const remaining = [...candidates];

  while (selected.length < count && remaining.length) {
    remaining.sort((a, b) => {
      const score = item => item._quality
        + (categories.has(item.category) ? -100 : 60)
        - (recentCategoryCounts.get(item.category) || 0) * 12
        + (priceBands.has(priceBand(item.currentBid)) ? 0 : 20)
        + (endSlots.has(endSlot(item.endAt)) ? -260 : 35)
        + item._jitter * 12;
      return score(b) - score(a);
    });
    const choice = remaining.shift();
    selected.push(choice);
    categories.add(choice.category || 'Sonstiges');
    priceBands.add(priceBand(choice.currentBid));
    endSlots.add(endSlot(choice.endAt));
  }

  if (selected.length < count) {
    const alreadySelected = new Set(selected.map(item => item.id));
    const archived = auctions
      .filter(item => item?.id && item.title && item.image && (item.finalPrice ?? item.currentBid) > 0)
      .filter(item => !alreadySelected.has(item.id) && !previouslyUsed.has(item.id))
      .sort((a, b) => deterministicJitter(dateKey, b.id) - deterministicJitter(dateKey, a.id));
    selected.push(...archived.slice(0, count - selected.length));
  }

  if (selected.length < count) throw new Error(`Only ${selected.length} eligible auctions are available; ${count} required`);

  const ordered = selected.sort((a, b) => deterministicOrder(dateKey, a.id) - deterministicOrder(dateKey, b.id));

  return {
    date: dateKey,
    gameNumber: gameNumber(dateKey),
    generatedAt: new Date().toISOString(),
    auctions: ordered.map(({ _quality, _jitter, ...auction }) => playableAuction(
      auction,
      auction.endAt && Date.parse(auction.endAt) <= now ? auction.finalPrice ?? auction.currentBid : auction.currentBid
    ))
  };
}

export function selectRandomSet(auctions, count = 5, random = Math.random) {
  const unique = [...new Map(auctions.map(auction => [auction?.id, auction])).values()]
    .filter(auction => auction?.id && auction.title && auction.image)
    .filter(auction => Number.isFinite(auction.finalPrice ?? auction.currentBid) && (auction.finalPrice ?? auction.currentBid) > 0);
  if (unique.length < count) throw new Error(`Only ${unique.length} playable auctions are available; ${count} required`);

  for (let index = unique.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [unique[index], unique[target]] = [unique[target], unique[index]];
  }

  return {
    mode: 'random',
    generatedAt: new Date().toISOString(),
    auctions: unique.slice(0, count).map(auction => playableAuction(auction))
  };
}
