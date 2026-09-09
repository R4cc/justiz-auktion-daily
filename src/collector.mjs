import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { selectDailySet, utcDateKey } from './core.mjs';

const BASE_URL = 'https://www.justiz-auktion.de';
const USER_AGENT = 'JUSTIZGUESSR/1.0 (+daily public auction indexer; respectful low-frequency fetches)';

function decodeEntities(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', lowbar: '_', period: '.', comma: ',', colon: ':', NewLine: '\n' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return named[entity] ?? named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function cleanText(value = '') {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMoney(value) {
  if (!value) return null;
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function zonedLocalToUtc(value, timeZone = 'Europe/Berlin') {
  const match = value?.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second = '00'] = match;
  const desired = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(desired)).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
  const observed = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(desired - (observed - desired)).toISOString();
}

function inferCategory(text) {
  const value = text.toLowerCase();
  const groups = [
    ['Fahrzeuge', /\b(pkw|auto|fahrzeug|bmw|mercedes|volkswagen|vw|audi|motorrad|roller)\b/],
    ['Fahrräder', /\b(fahrrad|mountainbike|e-bike|ebike)\b/],
    ['Schmuck & Uhren', /\b(ring|kette|armreif|armband|schmuck|gold|silber|uhr|rolex)\b/],
    ['Elektronik', /\b(notebook|laptop|computer|monitor|fernseher|smartphone|iphone|tablet|kamera|konsole)\b/],
    ['Werkzeuge', /\b(werkzeug|bohr|makita|hilti|bosch|säge|schleifer|maschine)\b/],
    ['Mode', /\b(sneaker|schuhe|jacke|shirt|kleidung|jeans|tasche)\b/],
    ['Sammlerstücke', /\b(münze|sammlung|figur|lego|modell|antiqu|briefmarke)\b/],
    ['Möbel & Wohnen', /\b(möbel|schrank|tisch|stuhl|sofa|lampe|porzellan)\b/],
    ['Kosmetik', /\b(parfum|eau de toilette|kosmetik)\b/]
  ];
  return groups.find(([, matcher]) => matcher.test(value))?.[0] || 'Sonstiges';
}

export function extractListingUrls(html) {
  const urls = new Set();
  const pattern = /href=["']([^"']*?-(\d{5,8})(?:[?#][^"']*)?)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeEntities(match[1]);
    if (/auktion_(?:drucken|gebote)/i.test(raw) || /uplimg/i.test(raw)) continue;
    try {
      const url = new URL(raw, BASE_URL);
      if (url.origin === BASE_URL) urls.add(url.href);
    } catch {}
  }
  return [...urls];
}

export function parseAuctionPage(html, url) {
  const text = cleanText(html);
  const id = Number(text.match(/Auktion ID\s*(\d+)/i)?.[1] || url.match(/-(\d{5,8})(?:\D|$)/)?.[1]);
  if (!id) throw new Error(`Could not find auction ID for ${url}`);
  const heading = html.match(/<h2\b[^>]*class=["'][^"']*auktionstitel[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const titleFallback = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s*\(#\d+\).*$/s, '');
  const title = cleanText(heading || titleFallback || `Auktion #${id}`);
  const startBid = parseMoney(text.match(/Startgebot:\s*([\d.,]+)\s*€/i)?.[1]);
  const currentBid = parseMoney(text.match(/Aktuelles Gebot:\s*([\d.,]+)\s*€/i)?.[1]);
  const bidCount = Number(text.match(/Anzahl Gebote\s*(\d+)/i)?.[1] || 0);
  const endText = text.match(/Endet am:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/i)?.[1];
  const condition = text.match(/Zustand:\s*([^\n]+)/i)?.[1]?.trim() || 'Keine Angabe';
  const fulfillment = text.match(/Versand:\s*([^\n]+)/i)?.[1]?.trim() || text.match(/Versandart:\s*([^\n]+)/i)?.[1]?.trim() || 'Siehe Auktion';
  const location = text.match(/Artikelstandort:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const descriptionHtml = html.match(/Artikelbeschreibung[\s\S]*?<\/h3>([\s\S]*?)(?:<h3\b[^>]*>|<div\b[^>]*class=["'][^"']*details)/i)?.[1] || '';
  const description = cleanText(descriptionHtml).slice(0, 1800) || `${condition}. Weitere Angaben auf der Originalauktion.`;
  const imageUrls = [];
  const imagePattern = /(?:src|href)=["']([^"']*uplimg\/[^"']+?\.(?:jpe?g|png|webp))(?:\?[^"']*)?["']/gi;
  const decodedHtml = decodeEntities(html);
  for (const match of decodedHtml.matchAll(imagePattern)) {
    const raw = match[1];
    if (/\/tn\//i.test(raw) || /tn\d+_/i.test(raw)) continue;
    try {
      const absolute = new URL(raw, BASE_URL).href;
      if (new URL(absolute).origin === BASE_URL && !imageUrls.includes(absolute)) imageUrls.push(absolute);
    } catch {}
  }
  return {
    id,
    title,
    description,
    category: inferCategory(`${title} ${description}`),
    sourceImages: imageUrls,
    startBid: startBid ?? 0,
    currentBid: currentBid ?? 0,
    finalPrice: endText && Date.parse(zonedLocalToUtc(endText)) <= Date.now() ? currentBid : null,
    bidCount,
    startAt: null,
    endAt: zonedLocalToUtc(endText),
    condition,
    fulfillment,
    location,
    url,
    capturedAt: new Date().toISOString()
  };
}

export function parseAuctionStart(html) {
  const text = cleanText(html);
  const value = text.match(/Starttermin\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}:\d{2}(?::\d{2})?)/i);
  return value ? zonedLocalToUtc(`${value[1]} ${value[2]}`) : null;
}

async function readJson(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filename);
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function cacheMainImage(auction, dataDir, fetchImpl, previous) {
  if (previous?.image?.startsWith('/auction-images/')) {
    return { ...auction, image: previous.image, images: previous.images || [previous.image] };
  }
  if (!auction.sourceImages?.[0]) return auction;
  try {
    const response = await fetchImpl(auction.sourceImages[0], { headers: { 'user-agent': USER_AGENT, accept: 'image/*' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) return auction;
    if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return auction;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > 12_000_000) return auction;
    const contentType = response.headers.get('content-type') || '';
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const filename = `${auction.id}.${extension}`;
    await mkdir(path.join(dataDir, 'images'), { recursive: true });
    await writeFile(path.join(dataDir, 'images', filename), bytes);
    return { ...auction, image: `/auction-images/${filename}`, images: [`/auction-images/${filename}`] };
  } catch {
    return auction;
  }
}

export async function collectAuctions({ dataDir, fetchImpl = fetch, pages = 4, maxDetails = 48, logger = console } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const archivePath = path.join(dataDir, 'auctions.json');
  const existing = await readJson(archivePath, { updatedAt: null, auctions: [] });
  const byId = new Map(existing.auctions.map(item => [item.id, item]));
  const listingUrls = new Set();
  for (let page = 0; page < pages; page += 1) {
    try {
      const html = await fetchText(`${BASE_URL}/auction_search.php?start=${page * 10}`, fetchImpl);
      extractListingUrls(html).forEach(url => listingUrls.add(url));
    } catch (error) {
      logger.warn(`Listing page ${page + 1} failed: ${error.message}`);
    }
  }

  const incoming = [];
  const detailUrls = [...listingUrls].slice(0, maxDetails);
  for (let index = 0; index < detailUrls.length; index += 5) {
    const batch = detailUrls.slice(index, index + 5);
    const records = await Promise.all(batch.map(async url => {
      try {
        const item = parseAuctionPage(await fetchText(url, fetchImpl), url);
        const previous = byId.get(item.id);
        if (previous?.startAt) item.startAt = previous.startAt;
        else {
          try { item.startAt = parseAuctionStart(await fetchText(`${BASE_URL}/auktion_drucken-${item.id}`, fetchImpl)); }
          catch (error) { logger.warn(`Start date fetch failed for ${item.id}: ${error.message}`); }
        }
        return item;
      }
      catch (error) { logger.warn(`Auction fetch failed for ${url}: ${error.message}`); return null; }
    }));
    incoming.push(...records.filter(Boolean));
  }

  for (const item of incoming) {
    const previous = byId.get(item.id);
    const withImage = await cacheMainImage(item, dataDir, fetchImpl, previous);
    byId.set(item.id, {
      ...previous,
      ...withImage,
      image: withImage.image || previous?.image || withImage.sourceImages?.[0] || null,
      images: withImage.images || previous?.images || withImage.sourceImages || [],
      firstCapturedAt: previous?.firstCapturedAt || item.capturedAt,
      finalPrice: withImage.finalPrice ?? previous?.finalPrice ?? null
    });
  }
  const updatedAt = new Date().toISOString();
  const auctions = [...byId.values()].map(item => {
    if (item.finalPrice == null && item.endAt && Date.parse(item.endAt) <= Date.now() && item.currentBid > 0) {
      return { ...item, finalPrice: item.currentBid, finalizedAt: updatedAt };
    }
    return item;
  });
  const archive = { updatedAt, auctions };
  await writeJsonAtomic(archivePath, archive);
  logger.info(`Collected ${incoming.length} auctions; archive contains ${archive.auctions.length}`);
  return archive;
}

export async function ensureDailyGame({ dataDir, dateKey = utcDateKey(), logger = console } = {}) {
  const dailyPath = path.join(dataDir, 'daily-games.json');
  const daily = await readJson(dailyPath, { updatedAt: null, games: {} });
  if (daily.games[dateKey]) return daily.games[dateKey];
  const archive = await readJson(path.join(dataDir, 'auctions.json'), { auctions: [] });
  const game = selectDailySet(archive.auctions, dateKey, daily.games);
  daily.games[dateKey] = game;
  const retainedDates = Object.keys(daily.games).sort().slice(-730);
  daily.games = Object.fromEntries(retainedDates.map(key => [key, daily.games[key]]));
  daily.updatedAt = new Date().toISOString();
  await writeJsonAtomic(dailyPath, daily);
  logger.info(`Generated game #${game.gameNumber} for ${dateKey}`);
  return game;
}

export async function seedArchiveIfEmpty({ dataDir, seedFile }) {
  const archivePath = path.join(dataDir, 'auctions.json');
  const current = await readJson(archivePath, null);
  if (current?.auctions?.length >= 5) return current;
  const seed = JSON.parse(await readFile(seedFile, 'utf8'));
  await writeJsonAtomic(archivePath, seed);
  return seed;
}
