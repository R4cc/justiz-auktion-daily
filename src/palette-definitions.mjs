import { createHash } from 'node:crypto';
import { AccountError } from './errors.mjs';
import { transaction, withDatabase, readArchiveRows, getState, setState } from './database.mjs';
import { auctionGallery } from './auction-images.mjs';
import { auctionSelectionCategory, buildAuctionFamilies } from './auction-selection.mjs';
import { buildEditionItems, caseRewards, loadCaseCatalog, matchesTheme, tokenValue,
  CASE_WEIGHTS, RARITIES } from './cases.mjs';
import { marketCategoryForItem, marketCategoryForListingCategory, marketCategoryForTheme,
  marketIndexAt, ensureMarketSchema } from './market.mjs';
import { ensureNewsSchema } from './news.mjs';

// Real palette definitions: data plus validation for base palettes (the
// legacy case ids, daily rotation) and event palettes (activated by news
// publications for a bounded window). Editions freeze a themed pool, its
// pricing inputs and the definition/version at generation time — later market
// movement, collector updates, restarts or definition edits never reroll or
// reprice a stored edition. Acquisition is NOT implemented here: palette
// entries are pure catalog data (`purchasable: false`), no case opening, no
// inventory minting, and the three rewards per future winning lot are never
// drawn in this package.
const fail = (code, status) => { throw new AccountError(code, status); };
export const REWARD_COUNT = 3;
// Reference pricing units: expectations are BUNDLE expectations (rewardCount
// draws), min/max stay PER-ITEM. v1 payloads mistakenly stored single-draw
// expectations; v2 is the corrected bundle math (see migrateBundlePricing).
export const PRICING_VERSION = 2;
const BUNDLE_PRICING_MARKER = 'palette_bundle_pricing_v2';
const DAY_MS = 86_400_000;
const hour = 3_600_000;
const MARKET_CATEGORY_IDS = new Set(['electronics', 'vehicles', 'wine', 'watches_jewelry', 'tools',
  'collectibles', 'household', 'luxury_goods', 'bicycles', 'books_media', 'fashion', 'cosmetics',
  'sport_leisure', 'other']);
// The incident label gives the auction room a short, scannable premise while
// the longer story supplies atmosphere. The marker stays internal and is not
// repeated in player-facing copy.
const story = (title, body, shortDescription, shortDescriptionDe) =>
  ({ title, body, shortDescription, shortDescriptionDe, fictional: true });

// allowedMarketCategories: null means unrestricted (mixed/premium base themes).
// requiredLevel is metadata until progression enforcement exists; base
// palettes stay at level 1 in this package.
const BASE_DEFINITIONS = [
  { id: 'fundkiste', name: 'Seized Goods Palette', nameDe: 'Fundpalette', badge: 'JG',
    allowedMarketCategories: null, legacyTheme: 'mixed',
    story: story('The Harbor Warehouse Clearance',
      'In Bauthaven, harbor customs clear a warehouse of unclaimed mixed goods. Everything in this palette belongs to that one seizure story.',
      'Customs warehouse bust', 'Zollrazzia im Hafenlager') },
  { id: 'schatzkiste', name: 'Contraband Palette', nameDe: 'Konterband-Palette', badge: 'JG+',
    allowedMarketCategories: null, legacyTheme: 'premium',
    story: story('The Vault Nobody Claimed',
      'A bank vault in Altstadt-Kolding is emptied after its lease expires. High-value odds and ends from the clearance fill this palette.',
      'Unclaimed vault clearance', 'Räumung eines herrenlosen Tresors') },
  { id: 'cars', name: 'Car Palette', nameDe: 'Auto-Palette', badge: 'CAR',
    allowedMarketCategories: ['vehicles'], legacyTheme: 'cars',
    story: story('The Impound Yard Sale',
      'The Nordhafen impound yard auctions complete passenger cars only — no parts, no motorcycles, just whole vehicles from one clearance.',
      'Police impound clearance', 'Räumung eines Polizeiverwahrplatzes') },
  { id: 'wine', name: 'Wine Palette', nameDe: 'Wein-Palette', badge: 'VIN',
    allowedMarketCategories: ['wine'], legacyTheme: 'wine',
    story: story('The Vineyard Cellar Release',
      'A vineyard cellar is released after its owner emigrated. Wine bottles only — the story deliberately keeps spirits out of this palette.',
      'Seized vineyard cellar', 'Beschlagnahmter Weinkeller') },
  { id: 'electronics', name: 'Electronics Palette', nameDe: 'Elektronik-Palette', badge: 'ELEC',
    allowedMarketCategories: ['electronics'], legacyTheme: 'electronics',
    story: story('The Returned Freight Pallet',
      'A freight forwarder liquidates a pallet of returned consumer electronics from a warehouse in Grayfield.',
      'Freight warehouse bust', 'Razzia im Frachtlager') },
  { id: 'tools', name: 'Tool Palette', nameDe: 'Werkzeug-Palette', badge: 'TOOL',
    allowedMarketCategories: ['tools'], legacyTheme: 'tools',
    story: story('The Closed Workshop Auction',
      'When toolmaker Brackwald & Söhne closes its workshop, the complete tool wall enters one seized-collection story.',
      'Illegal workshop bust', 'Razzia in illegaler Werkstatt') },
  { id: 'jewellery', name: 'Jewellery Palette', nameDe: 'Schmuck-Palette', badge: 'GEM',
    allowedMarketCategories: ['watches_jewelry'], legacyTheme: 'jewellery',
    story: story('The Pawnshop Back Room',
      'The back room of a pawnshop in Silberbruch is inventoried into one palette of watches and jewellery from a seizure.',
      'Pawnshop seizure', 'Pfandhaus-Beschlagnahme') },
  { id: 'collectibles', name: 'Collector Palette', nameDe: 'Sammler-Palette', badge: 'RARE',
    allowedMarketCategories: ['collectibles'], legacyTheme: 'collectibles',
    story: story('The Attic Collection',
      'An attic in Kirschau yields a lifetime collection of figurines, coins and models — one seizure, one palette.',
      'Estate attic clearance', 'Dachboden aus Nachlassauflösung') }
];
const EVENT_DEFINITIONS = [
  { id: 'electronics-smuggling', name: 'Smuggled Electronics', nameDe: 'Geschmuggelte Elektronik', badge: 'SMUG',
    allowedMarketCategories: ['electronics'], legacyTheme: null, requiredLevel: 3,
    story: story('The Grayfield Container Check',
      'Customs officers in Grayfield open a misdeclared container and find consumer electronics instead of machine parts. The seized goods appear as this event palette.',
      'Electronics smuggling bust', 'Razzia gegen Elektronikschmuggel') },
  { id: 'dealer-seizure', name: 'Dealer Seizure', nameDe: 'Händlerbeschlagnahme', badge: 'DEAL',
    allowedMarketCategories: ['vehicles', 'electronics', 'watches_jewelry', 'luxury_goods'], legacyTheme: null, requiredLevel: 5,
    story: story('The Kanalley & Co. Files',
      'The dealership Kanalley & Co. collapses and investigators seal the lot — cars, electronics, watches and luxury goods from one seizure.',
      'Dealer fraud bust', 'Razzia wegen Händlerbetrugs') },
  { id: 'wine-tax-seizure', name: 'Wine Tax Seizure', nameDe: 'Weinsteuerbeschlagnahme', badge: 'TAX',
    allowedMarketCategories: ['wine', 'collectibles'], legacyTheme: null, requiredLevel: 8,
    story: story('The Untaxed Cellars',
      'Tax investigators in Weißbrunn uncork an untaxed import scheme. Confiscated wine and cellar collectibles from the case form this palette.',
      'Wine tax bust', 'Razzia wegen Weinsteuerbetrugs') }
];

function validateDefinition(definition) {
  const categories = definition.allowedMarketCategories ?? [];
  if (!/^[a-z0-9-]{3,60}$/.test(definition.id) || !definition.name || !definition.nameDe || !definition.badge
    || definition.story?.fictional !== true || !definition.story?.title || !definition.story?.body
    || !definition.story?.shortDescription || !definition.story?.shortDescriptionDe
    || new Set(categories).size !== categories.length || !categories.every(id => MARKET_CATEGORY_IDS.has(id))
    || !Number.isInteger(definition.requiredLevel) || definition.requiredLevel < 1
    || definition.rewardCount !== REWARD_COUNT || !Number.isInteger(definition.version)) {
    fail('invalid_palette_definition', 500);
  }
}

// Base palettes: requiredLevel 1 in this package; event palettes carry their
// gated level as metadata only.
export const PALETTE_DEFINITIONS = [...BASE_DEFINITIONS, ...EVENT_DEFINITIONS]
  .map(definition => Object.freeze({
    ...definition,
    version: 1,
    requiredLevel: definition.requiredLevel ?? 1,
    rewardCount: REWARD_COUNT,
    kind: definition.requiredLevel === undefined ? 'base' : 'event'
  }));
for (const definition of PALETTE_DEFINITIONS) validateDefinition(definition);
const DEFINITIONS = new Map(PALETTE_DEFINITIONS.map(definition => [definition.id, definition]));
for (const base of BASE_DEFINITIONS) {
  if (!DEFINITIONS.has(base.id)) fail('invalid_palette_definition', 500);
}

export function paletteDefinition(id) { return DEFINITIONS.get(String(id)) || null; }
export function isEventPalette(id) { return DEFINITIONS.get(String(id))?.kind === 'event'; }

// Event edition selection index: deterministic from the event/palette/version
// triple — first eight hex characters of SHA-256 as an unsigned integer.
export function eventSelectionIndex(eventId, paletteId, definitionVersion) {
  return parseInt(createHash('sha256').update(JSON.stringify([eventId, paletteId, definitionVersion])).digest('hex').slice(0, 8), 16);
}

// Event eligibility is market-category membership, reusing the exact legacy
// semantic restrictions when the pool includes vehicles or wine (vehicle
// parts are not cars; spirits are not wine). No new taxonomy is invented.
function eventEligibility(definition) {
  const categories = definition.allowedMarketCategories;
  return item => {
    const category = marketCategoryForListingCategory(auctionSelectionCategory(item));
    if (!category || !categories.includes(category)) return false;
    if (category === 'vehicles' && !matchesTheme(item, 'cars')) return false;
    if (category === 'wine' && !matchesTheme(item, 'wine')) return false;
    return true;
  };
}

// Edition valuation reads the persisted market state, so the market schema is
// ensured here too (lazy owning-module creation, same pattern as everywhere).
// The news schema is ensured because edition rows reference news_events.
// The bundle-pricing correction runs here too, before any read or creation
// can expose mixed pricing versions; callers are already inside a
// BEGIN IMMEDIATE transaction, so everything below is atomic with them.
export function ensurePaletteEditionSchema(db, now = Date.now()) {
  ensureMarketSchema(db, now);
  ensureNewsSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS palette_editions (
    id TEXT PRIMARY KEY,
    palette_id TEXT NOT NULL,
    event_id TEXT REFERENCES news_events(id),
    rotation_date TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    CHECK((event_id IS NULL) = (rotation_date IS NOT NULL)),
    CHECK(ends_at > starts_at)
  ) STRICT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS palette_editions_rotation
    ON palette_editions(palette_id, rotation_date) WHERE event_id IS NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS palette_editions_event ON palette_editions(event_id, palette_id)`);
  migrateBundlePricing(db, now);
}

// One-time correction of pre-acquisition reference metadata: v1 payloads
// stored SINGLE-DRAW expectations while editions price a rewardCount-item
// bundle. Stored e0/et are multiplied by the payload's rewardCount; reserve
// and spread are recomputed purely from those corrected expectations and the
// stored per-item minimum/maximum — never against today's market or archive.
// Items, ids, rarity, story, windows, definitionVersion and valuationAt are
// untouched; malformed pricing is rejected rather than silently replaced.
// The durable marker is written last, making the migration exactly-once.
function migrateBundlePricing(db, now) {
  if (getState(db, BUNDLE_PRICING_MARKER, null)) return;
  let corrected = 0, retained = 0;
  const update = db.prepare('UPDATE palette_editions SET payload_json = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, payload_json FROM palette_editions ORDER BY id').all()) {
    let payload;
    try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid_stored_pricing', 500);
    if (payload.pricingVersion === PRICING_VERSION) continue;
    const rewardCount = payload.rewardCount;
    if (!Number.isSafeInteger(rewardCount) || rewardCount < 1 || !Array.isArray(payload.items)) fail('invalid_stored_pricing', 500);
    if (payload.pricing == null) {
      // Only a stock-shortage edition may lack pricing.
      if (payload.availabilityReason !== 'insufficient_stock' || payload.items.length >= 5) fail('invalid_stored_pricing', 500);
      payload.pricingVersion = PRICING_VERSION;
      update.run(JSON.stringify(payload), row.id);
      retained++;
      continue;
    }
    const pricing = payload.pricing;
    // A priced edition must carry usable stock and complete numeric inputs.
    if (payload.items.length < 5) fail('invalid_stored_pricing', 500);
    for (const field of ['e0', 'et', 'minMarketValue', 'maxMarketValue']) {
      if (!Number.isFinite(pricing[field])) fail('invalid_stored_pricing', 500);
    }
    pricing.e0 = pricing.e0 * rewardCount;
    pricing.et = pricing.et * rewardCount;
    pricing.referenceReserve = Math.ceil(Math.max(.75 * pricing.e0 + .25 * pricing.et, pricing.et) / .85);
    pricing.spreadOk = rewardCount * pricing.minMarketValue < pricing.referenceReserve
      && rewardCount * pricing.maxMarketValue > pricing.referenceReserve;
    payload.available = pricing.spreadOk;
    payload.availabilityReason = pricing.spreadOk ? null : 'insufficient_value_spread';
    payload.weights = pricing.spreadOk ? [...CASE_WEIGHTS] : CASE_WEIGHTS.map(() => 0);
    payload.pricingVersion = PRICING_VERSION;
    update.run(JSON.stringify(payload), row.id);
    corrected++;
  }
  const at = new Date(now).toISOString();
  setState(db, BUNDLE_PRICING_MARKER, { corrected, retained, migratedAt: at }, at);
}

// Reference pricing for a future three-item bundle (metadata only — no offer,
// no purchase, no open). p(item) = tierWeight / totalWeight / tierItemCount;
// E0 and Et are BUNDLE expectations: rewardCount times the single-draw
// expectation over frozen base token values (E0) and unrounded market-adjusted
// values captured once at generation time (Et). referenceReserve =
// ceil(max(0.75*E0 + 0.25*Et, Et) / 0.85). minMarketValue/maxMarketValue stay
// per-item; a usable edition needs both loss and upside at the reserve:
// rewardCount*min < reserve AND rewardCount*max > reserve.
// Exported as a pure helper for independent regression tests.
export function bundleReferencePricing(items, marketIndexOf, rewardCount = REWARD_COUNT) {
  const totalWeight = CASE_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const tierCounts = new Map();
  for (const item of items) tierCounts.set(item.rarity, (tierCounts.get(item.rarity) || 0) + 1);
  let e0 = 0, et = 0, min = Infinity, max = -Infinity;
  for (const item of items) {
    const tierWeight = CASE_WEIGHTS[RARITIES.findIndex(rarity => rarity.id === item.rarity)];
    const probability = tierWeight / totalWeight / tierCounts.get(item.rarity);
    const base = tokenValue(item.price);
    const market = base * marketIndexOf(item) / 100;
    e0 += probability * base;
    et += probability * market;
    min = Math.min(min, market);
    max = Math.max(max, market);
  }
  e0 *= rewardCount;
  et *= rewardCount;
  const referenceReserve = Math.ceil(Math.max(.75 * e0 + .25 * et, et) / .85);
  return { e0, et, referenceReserve, minMarketValue: min, maxMarketValue: max,
    spreadOk: rewardCount * min < referenceReserve && rewardCount * max > referenceReserve };
}

// Build one frozen edition payload from the archive behind `db` (db-scoped:
// safe inside the publication transaction). The pool, its prices, token base
// values, market categories, rarities, story, definition version, availability
// reason and pricing inputs are frozen here and never regenerated.
function buildEditionPayload(db, definition, { eventId = null, rotationDate = null, startsAt, endsAt, now }) {
  const eligible = readArchiveRows(db).auctions
    .filter(item => item.title && auctionGallery(item).length &&
      Number.isFinite(item.finalPrice ?? item.currentBid) && (item.finalPrice ?? item.currentBid) > 0)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
  const families = buildAuctionFamilies(eligible)
    .map(family => family.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en')));
  const selectionIndex = eventId !== null
    ? eventSelectionIndex(eventId, definition.id, definition.version)
    : Math.floor(Date.parse(rotationDate) / DAY_MS);
  const items = buildEditionItems({ id: definition.id, category: definition.legacyTheme }, families, selectionIndex,
    definition.kind === 'event' ? eventEligibility(definition) : null)
    .map(item => ({ ...item, marketCategory: marketCategoryForItem(item) }));
  const stockOk = items.length >= 5;
  const pricing = stockOk
    ? bundleReferencePricing(items, item => marketIndexAt(db, item.marketCategory, now), definition.rewardCount)
    : null;
  const available = Boolean(pricing?.spreadOk);
  return {
    id: eventId !== null ? `event:${eventId}:${definition.id}` : `base:${definition.id}:${rotationDate}`,
    palette_id: definition.id, event_id: eventId, rotation_date: rotationDate, starts_at: startsAt, ends_at: endsAt,
    payload: {
      paletteId: definition.id, definitionVersion: definition.version, kind: definition.kind,
      name: definition.name, nameDe: definition.nameDe, badge: definition.badge, story: definition.story,
      allowedMarketCategories: definition.allowedMarketCategories, legacyTheme: definition.legacyTheme,
      rewardCount: definition.rewardCount, requiredLevel: definition.requiredLevel,
      items, weights: available ? [...CASE_WEIGHTS] : CASE_WEIGHTS.map(() => 0),
      available, availabilityReason: !stockOk ? 'insufficient_stock' : !available ? 'insufficient_value_spread' : null,
      valuationAt: now, pricingVersion: PRICING_VERSION, pricing: pricing && { ...pricing }
    }
  };
}

function storeEdition(db, edition) {
  // INSERT OR IGNORE is the no-reroll guarantee: an existing stable edition id
  // is never regenerated, repriced or extended. Editions are never pruned —
  // future auction history will reference them.
  db.prepare(`INSERT OR IGNORE INTO palette_editions
    (id, palette_id, event_id, rotation_date, starts_at, ends_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(edition.id, edition.palette_id, edition.event_id, edition.rotation_date,
      edition.starts_at, edition.ends_at, JSON.stringify(edition.payload));
}

// Db-scoped: called from inside the news publication transaction for every
// resolved event window. Themed stock shortage is a valid outcome — the
// edition is persisted as unavailable and the publication still lands.
export function createEventEditions(db, eventId, windows, now) {
  ensurePaletteEditionSchema(db, now);
  for (const window of windows) {
    const definition = paletteDefinition(window.paletteId);
    if (!definition || definition.kind !== 'event') fail('invalid_palette_windows');
    const startsAt = now + window.startOffsetHours * hour;
    storeEdition(db, buildEditionPayload(db, definition, {
      eventId, startsAt, endsAt: startsAt + window.durationHours * hour, now
    }));
  }
}

// Db-scoped: freeze today's base editions (same stable ids as the legacy
// cases) on first touch. An existing edition is reused directly — no archive
// read, no payload generation — so stored editions survive even when the
// archive later changes or becomes unavailable. INSERT OR IGNORE still guards
// fresh rows against races.
export function ensureBaseEditions(db, date, now) {
  ensurePaletteEditionSchema(db, now);
  const exists = db.prepare('SELECT 1 FROM palette_editions WHERE id = ?');
  const startsAt = Date.parse(date);
  for (const definition of DEFINITIONS.values()) {
    if (definition.kind !== 'base') continue;
    const id = `base:${definition.id}:${date}`;
    if (exists.get(id)) continue;
    storeEdition(db, buildEditionPayload(db, definition, {
      rotationDate: date, startsAt, endsAt: startsAt + DAY_MS, now
    }));
  }
}

// scheduled: before startsAt · expired: at/after endsAt · restocking: inside
// the window but the frozen edition is unusable · available: inside the
// window and the frozen edition is usable.
function availabilityState(row, payload, now) {
  if (now < row.starts_at) return 'scheduled';
  if (now >= row.ends_at) return 'expired';
  return payload.available ? 'available' : 'restocking';
}

function serializeEdition(row, now) {
  const payload = JSON.parse(row.payload_json);
  const availability = availabilityState(row, payload, now);
  const reserve = payload.pricing?.referenceReserve ?? null;
  return {
    id: payload.paletteId, editionId: row.id,
    name: payload.name, nameDe: payload.nameDe, badge: payload.badge,
    type: payload.legacyTheme,
    marketCategory: payload.kind === 'event'
      ? (payload.allowedMarketCategories?.length === 1 ? payload.allowedMarketCategories[0] : null)
      : marketCategoryForTheme(payload.legacyTheme),
    kind: payload.kind, story: payload.story, allowedMarketCategories: payload.allowedMarketCategories,
    rewardCount: payload.rewardCount, requiredLevel: payload.requiredLevel,
    cost: availability === 'available' ? reserve : 0, referenceReserve: reserve,
    valuationAt: payload.valuationAt,
    startsAt: row.starts_at, endsAt: row.ends_at, rotationDate: row.rotation_date || null,
    available: availability === 'available', availability,
    availabilityReason: payload.availabilityReason,
    acquisitionMode: 'auction', purchasable: false,
    items: payload.items
  };
}

// Persisted palette catalog for GET /api/palettes. Base editions always
// follow the legacy daily rotation (via loadCaseCatalog, whose reward
// schedule the catalog keeps unchanged); event editions are included while
// endsAt > now, including scheduled ones. Availability is evaluated on every
// request with one captured now — no day-only in-memory cache for events. The
// revision derives from the included edition ids and their evaluated states.
export function loadPaletteCatalog(dataDir, { now = Date.now() } = {}) {
  const legacy = loadCaseCatalog(dataDir, now);
  return withDatabase(dataDir, db => transaction(db, () => {
    ensureBaseEditions(db, legacy.rotationDate, now);
    const rows = db.prepare(`SELECT * FROM palette_editions
      WHERE (event_id IS NOT NULL AND ends_at > ?) OR (event_id IS NULL AND rotation_date = ?)
      ORDER BY id`).all(now, legacy.rotationDate);
    const revision = createHash('sha256').update(JSON.stringify(rows.map(row => {
      const payload = JSON.parse(row.payload_json);
      return [row.id, availabilityState(row, payload, now), payload.pricing?.referenceReserve ?? null];
    }))).digest('hex');
    return {
      revision, rotationDate: legacy.rotationDate, rotatesAt: legacy.rotatesAt,
      rarities: legacy.rarities, rewards: caseRewards(legacy),
      palettes: rows.map(row => serializeEdition(row, now))
    };
  }));
}
