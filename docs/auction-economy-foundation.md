# Auction Economy Foundation — Handoff Notes

Status: **foundation + resale transactional core + deterministic market
simulation + real palette editions + primary-auction HTTP exposure +
progression read model**. This document describes the technical groundwork
for turning the case-opening game into an auction-centric economy (Mystery
Palettes, news events, a global market, player resale auctions, XP/levels,
and later Storage Wars and businesses), including the resale-auction
transactional foundation (**bid escrow, outbid refunds, settlement, seller
payout, inventory ownership transfer**), the **durable news publication +
deterministic global market simulation** (72h linearly decaying index-point
effects, absolute per-category budget, hourly UTC snapshots), **real
palette definitions with frozen themed editions and atomic news-driven
availability** (base daily editions + event editions; reference pricing
metadata), and the **preparation pass** that extracted progression into its
own module, exposed XP/level through the profile read model, wired the
primary-palette-auction domain to feature-gated HTTP routes (public reads,
authenticated bid/reveal, admin creation) and exposed market history
read-only. Auction acquisition *gameplay* (automatic lot generation, NPC
bidders, XP awards, UI) remains intentionally **not** implemented. Every
placeholder below is marked as such.

Everything shipped here is additive and flag-gated: with no environment
variables set, the live game behaves exactly as before.

---

## 1. What was implemented

| Area | Module | Notes |
| --- | --- | --- |
| Shared API error type | `src/errors.mjs` | `AccountError` moved here; re-exported from `src/accounts.mjs` for compatibility |
| Feature flags | `src/features.mjs` | Env-driven, all default off |
| Market categories + global market state | `src/market.mjs` | Category registry, mapping tables, deterministic effect-based indexes, hourly snapshots, valuation helper |
| News events | `src/news.mjs` | Draft/published/archived state machine, atomic publication with receipts and market effects |
| Resale auctions | `src/resale.mjs` | Listings, escrowed bids, lazy close + settlement, item locking, seller payout |
| Palette terminology | `src/palettes.mjs` | Palette view over the case catalog (compatibility layer) |
| Palette definitions + editions | `src/palette-definitions.mjs` | Base/event registry, frozen themed editions, reference pricing, persisted catalog |
| Primary palette auctions | `src/palette-auctions.mjs` | Sealed system-issued lots: creation, escrowed bidding, settlement (currency sink), winner-only reveal |
| Progression reads | `src/progression.mjs` | Shared XP level curve (`levelForXp`) + defensive profile read model (`progressionForXp`); pure reads, no grants |
| Public read APIs | `src/economy-api.mjs` | Flag-gated GET endpoints (news, market, market history, palettes, palette auctions, resales) |
| Frontend data access | `dist/economy.js` | `window.justizEconomy` helpers (GETs + authenticated palette-auction calls via `account.js`), no UI |
| Tests | `test/market.test.mjs`, `test/news.test.mjs`, `test/resale.test.mjs`, `test/palettes.test.mjs`, `test/economy-api.test.mjs`, `test/simulation.test.mjs`, `test/palette-editions.test.mjs`, `test/acceptance.test.mjs`, `test/palette-auctions.test.mjs`, `test/progression.test.mjs`, `test/palette-auction-api.test.mjs` | full suite green (166 tests) |

## 2. Database changes (all additive, `PRAGMA user_version` bumped 2 → 3 → 4 → 5 → 6 → 7 → 8; never lowered)

No existing table, column, or row was modified or deleted. New tables are
created lazily by their owning modules (`CREATE TABLE IF NOT EXISTS` on first
use — the same pattern `cases.mjs` uses for `case_rotations`). Rollback is
trivial: drop the new tables; nothing else references them except the
documented lock checks.

- `news_events` (`src/news.mjs`) — `id TEXT PK`, `title`, `body`,
  `status CHECK IN ('draft','published','archived')`, `published_at TEXT`,
  `palette_ids TEXT` (JSON array of palette ids), `palette_windows TEXT NOT
  NULL DEFAULT '[]'` (JSON array of `{ paletteId, startOffsetHours,
  durationHours }`, added via an idempotent column-existence migration),
  `market_effects TEXT` (JSON array), `metadata_json TEXT`, `created_at`/
  `updated_at TEXT` (ISO).
- `market_categories` (`src/market.mjs`) — `category TEXT PK`,
  `base_index REAL`, `current_index REAL`, `updated_at TEXT`. Seeded with the
  neutral index **100** for every registry category on first touch
  (`INSERT OR IGNORE`, so later registry additions seed themselves and existing
  rows are never touched).
- `market_snapshots` (`src/market.mjs`) — `(category, captured_at) PK` +
  `index_value REAL`. Hourly UTC history grid plus optional arbitrary-time
  snapshots; retention is time-based (30 days). Effects/receipts are never
  deleted with snapshots.
- `market_effects` (`src/market.mjs`) — `source_id TEXT PK`, `event_id →
  news_events` (NULL for bootstrap effects), `category → market_categories`,
  `delta REAL`, `starts_at`/`ends_at INTEGER` (epoch ms, exactly 72h apart),
  `UNIQUE(event_id, category)`. Source ids: `news:<eventId>:<category>` and
  `bootstrap:<category>`. Index `market_effects_active(category, starts_at,
  ends_at)` serves the time-range lookups.
- `news_publications` (`src/news.mjs`) — `event_id → news_events PK`,
  `processed_at INTEGER`, `kind CHECK IN ('applied','legacy')`,
  `payload_json` (the original publication document). One receipt per
  published event — the database-level exact-once guard for publication.
- `palette_editions` (`src/palette-definitions.mjs`) — `id TEXT PK` (stable:
  `base:<paletteId>:<UTCdate>` / `event:<eventId>:<paletteId>`),
  `palette_id TEXT`, `event_id → news_events` (NULL for base editions),
  `rotation_date TEXT` (base only), `starts_at`/`ends_at INTEGER` (window),
  `payload_json` (complete frozen pool, definition version, story, weights,
  pricing inputs, availability reason, reward count). CHECKs require base rows
  to have a rotation date and event rows an event id, and `ends_at > starts_at`.
  `UNIQUE(event_id, palette_id)` plus a partial unique index on
  `(palette_id, rotation_date) WHERE event_id IS NULL`. Editions are never
  pruned — future auction history will reference them.
- `app_state['market_simulation_v1']` — durable migration marker storing the
  activation timestamp (`{ activatedAt, activatedAtMs }`). Presence switches
  reads to the computed simulation and makes the activation migration
  exactly-once.
- `app_state['palette_bundle_pricing_v2']` — durable marker for the one-time
  bundle-pricing correction of stored palette editions (`{ corrected,
  retained, migratedAt }`); written last inside the migrating transaction.
  Also: `news_events.palette_windows` (default `'[]'`) was added via an
  idempotent column-existence migration at marker 6.
- `primary_palette_auctions` (`src/palette-auctions.mjs`) — `id TEXT PK`,
  `creation_request_id TEXT NOT NULL UNIQUE`, `edition_id → palette_editions`,
  `reserve INTEGER CHECK > 0`, `current_bid`, `current_bidder_id → users`,
  `status CHECK IN ('active','ended')`, `started_at`/`ends_at INTEGER`
  (exactly one hour apart), `closed_at`/`settled_at INTEGER NULL`,
  `winner_id → users`, `valuation_at INTEGER`, `required_level INTEGER`,
  `public_snapshot_json` (the frozen public view). Index
  `primary_palette_auctions_active(status, ends_at)` serves the deadline
  listing.
- `primary_palette_rewards` — `(auction_id, position 0..2) PK`,
  `inventory_id TEXT NOT NULL UNIQUE` (a **reserved** UUID, deliberately not
  an inventory FK — the inventory rows do not exist until settlement),
  `item_json` (the complete hidden reward snapshot frozen at creation).
- `primary_palette_bids` — append-only bid history: `auction_id →
  primary_palette_auctions`, `bidder_id → users`, `amount INTEGER CHECK > 0`,
  `created_at INTEGER`; index `(auction_id, id)`.
- `users.xp` — the ALTER migration the foundation claimed but never wrote was
  finally added (marker 8): databases created before the economy foundation
  gain `xp INTEGER NOT NULL DEFAULT 0`; existing users start at zero XP and
  existing values are never touched. No XP earning exists yet.
- `resale_auctions` (`src/resale.mjs`) — `id TEXT PK`, `seller_id → users`,
  `inventory_id → inventory` (**unique per active listing** via partial unique
  index), `start_price INTEGER`, `current_bid INTEGER`, `current_bidder_id`,
  `status CHECK IN ('active','ended','cancelled')`, `started_at`/`ends_at`/
  `closed_at`/`settled_at INTEGER` (epoch ms, matching the accounts tables),
  `winner_id`. `settled_at` was added later via the `PRAGMA table_info` ALTER
  pattern together with a one-time legacy cleanup (see §3, resale auctions).
- `resale_bids` (`src/resale.mjs`) — `auction_id → resale_auctions`,
  `bidder_id → users`, `amount INTEGER CHECK > 0`, `created_at INTEGER`.
- `users.xp` (`src/accounts.mjs`) — `INTEGER NOT NULL DEFAULT 0`, added via the
  existing `PRAGMA table_info` ALTER pattern. **Reserved, unused.** No code
  reads or writes it yet.

Inventory items opened from now on additionally store `marketCategory` inside
their existing `inventory.item` JSON (frozen at open time, like `rarity` and
`sellValue`). Legacy items without that field derive the category on read
(see §4); they are never rewritten.

## 3. New domain models / types

### Mystery Palettes (compatibility layer over cases)

`cases.mjs` remains the single source of truth for edition generation
(stock selection, rarity tiers, weights, pricing, snapshots). **Do not rename
case internals yet** — the frontend, tests, and stored `case_openings` rows all
speak "case". `src/palettes.mjs` provides the palette vocabulary on top:

- `paletteFromCase(box)` — renames `case.category` → `type` (the
  seizure-story theme), adds `marketCategory`, and expresses availability as
  `availability: 'available' | 'restocking'` (alongside the boolean).
- `publicPaletteCatalog(catalog)` — `{ revision, rotationDate, rotatesAt,
  rarities, rewards, palettes }`; identical numbers to `publicCaseCatalog`,
  zero behavioral change.

The intended story mapping (already encoded in
`marketCategoryForTheme`): a palette is a coherent seized-asset collection
(e.g. "Drug Dealer Bust" → cars/watches/phones/luxury). Today's eight cases
map to: cars→vehicles, wine→wine, electronics→electronics, tools→tools,
jewellery→watches_jewelry, collectibles→collectibles, premium→luxury_goods,
mixed→`null` (multi-category).

Naming note: the suggested `AuctionEvent` name was deliberately **not** used
for news, to avoid confusion with resale auctions; the domain is
`news_events` / `NewsEvent`.

### Market categories

`src/market.mjs` owns a data-driven registry (`MARKET_CATEGORIES`): stable
snake_case ids with en/de display names — electronics, vehicles, wine,
watches_jewelry, tools, collectibles, household, luxury_goods, bicycles,
books_media, fashion, cosmetics, sport_leisure, other. Extending it is a
data-only change; new ids seed themselves into `market_categories`.

Resolution chain (exported helpers):
- `marketCategoryForListingCategory('Elektronik')` — the German listing
  categories from `auction-selection.mjs` are the coarse source vocabulary;
  the mapping table is the single place the two meet.
- `marketCategoryForAuction(auction)` — classifies live via
  `auctionSelectionCategory`.
- `marketCategoryForItem(item)` — returns the stored `marketCategory` if
  valid, else derives from the item's frozen German `category`, else
  classifies. This is what makes legacy inventory backwards compatible.
- `marketCategoryForTheme(caseTheme)` — palette-type mapping above.

Known approximation (data-only to change later): the listing category
`Getränke` (drinks incl. spirits) currently maps to `wine`.

### News events (publication state machine)

`src/news.mjs` — whole-document upsert (`saveNewsEvent`) with a strict state
machine; `admin/news` remains the only write entry point (admin + CSRF, see
§4). Public shape:

```js
{
  id, title, body,
  status: 'draft' | 'published' | 'archived',
  publishedAt,            // ISO string or null; set by the server on first publication
  paletteIds: [],         // base ids are informational; event ids activate windows
  paletteWindows: [],     // materialized [{ paletteId, startOffsetHours, durationHours }]
  marketEffects: [{ category: 'electronics', direction: 'up' | 'down', magnitude: 5 }],
  metadata: {},           // free-form object for future event types
  createdAt, updatedAt
}
```

Transitions: `draft → {draft, published, archived}`,
`published → {published, archived}`, `archived → {archived}` (terminal).
`published → draft`, `archived → published`, `archived → draft` are rejected
with `AccountError('invalid_news_transition', 409)`.

Publication rules:

- **Server-owned timestamp.** First publication (create-as-published or
  draft → published) stamps `publishedAt = now`; a supplied non-null
  `publishedAt` is rejected (`invalid_published_at`) — clients cannot
  backdate. On later saves, missing/null `publishedAt` means "keep original";
  an explicitly different timestamp conflicts.
- **Magnitudes are index points.** Structural validation accepts `null`
  placeholder magnitudes (and legacy fractional values) in drafts, rejects
  duplicate categories per event always, and publication requires an integer
  magnitude 1..20 per effect (`invalid_market_effects` otherwise).
- **Palette windows.** `paletteIds` is validated against the palette
  definitions registry (base + event ids). Base ids are informational
  references only — they never open windows. Event ids resolve a window
  (defaults: offset 0h, duration 72h; `paletteWindows` may override with
  `startOffsetHours` 0..168 and `durationHours` 1..168). An explicit window
  must reference an event definition also in `paletteIds`; duplicates and
  unknown ids are rejected (`invalid_palette_windows`). The stored
  `palette_windows` list is the materialized effective window set (defaults
  filled in, sorted by palette id). Windows belong to the immutable economic
  payload and the publication receipt.
- **Exact-once.** Publication atomically writes the final news row, an
  `applied` receipt (the original payload), one `market_effects` row per
  effect, and one frozen palette edition per resolved event window — all in
  one transaction; any validation or database failure rolls all of it back.
  A retry with the same id and same normalized economic payload (effects,
  paletteIds, windows, metadata, publishedAt — order-insensitive) returns the
  existing publication without new effects, without regenerating editions,
  without moving `publishedAt` and without restarting decay; a conflicting
  economic payload is rejected with `news_already_published` (409).
- **Corrections.** Published events accept `title`/`body` corrections only;
  effects, paletteIds, metadata and `publishedAt` are frozen. Archiving does
  not undo effects — they simply decay out.
- **Budget.** Before publishing, every affected category must satisfy
  `sum(abs(active contributions at now)) + new magnitude <= 30` (see the
  market section); otherwise the entire publication is rejected with
  `market_effect_budget` (409).

### Global market state (deterministic simulation)

Global (one row per category, shared by all players), computed **from
persisted effects** — never by applying deltas onto a running value, and with
no random or background movement anywhere. 100 is neutral.

At time `t`, for a category:

```
remaining(t)    = clamp(1 - (t - startsAt) / 259200000, 0, 1)   // 72h linear decay
contribution(t) = delta * remaining(t)                           // delta = ±magnitude index points
index(t)        = clamp(100 + sum(contributions), 70, 130)
```

- Effects last exactly 72 hours. Internal arithmetic is unrounded; public
  indexes (`marketState`, `marketHistory`) are rounded to two decimals. A
  down-15 effect walks its category 100 → 85 → 92.5 → 100 at 0h/36h/72h.
- **Absolute budget 30 per category:** before publication,
  `sum(abs(active contributions at now)) + new magnitude <= 30`. Opposing
  effects consume the same absolute budget; the range 70..130 follows from it.
- `marketState(dataDir, { now })` returns the existing shape with one captured
  `now` for the whole response. `market_categories.current_index` is a cache
  refreshed on reads (materialization helper), not the source of truth;
  `base_index` is 100 after activation.
- **Snapshots:** reads lazily fill the hourly UTC grid through
  `floor(now/hour)*hour`, starting at the first hour boundary at/after
  activation; values are reconstructed from effects at each boundary (never
  copied from today's index), `INSERT OR IGNORE`, at most 720 boundaries per
  refresh, snapshots older than 30 days are pruned. `marketHistory(category,
  { now, limit })` refreshes against the injectable `now` and keeps its
  response shape. `snapshotMarketState({ now })` remains as a compatibility
  helper recording computed state at arbitrary moments.
- **Activation migration (exactly once, one transaction):** the first
  publication under the new rules creates the schemas and, if the
  `market_simulation_v1` marker is absent: every existing published/archived
  news event receives a `legacy` receipt with its existing payload and its
  placeholder effects are **never replayed** (they never moved tokens or
  indexes; replaying fractional placeholders would fabricate history);
  existing drafts stay editable and receive no receipt; every manually-set
  category index becomes a `bootstrap:<category>` effect with
  `delta = clamp(oldIndex, 70, 130) - 100` starting at activation and decaying
  over 72h (zero deltas omitted, fractional deltas preserved — the deliberate
  bounding of old hand-set out-of-range indexes is what keeps production
  indexes inside 70..130 from the first second); base index becomes 100;
  historical snapshots stay untouched; the marker is written last. Reads
  before activation keep returning the legacy stored values (on fresh
  databases those are the neutral 100s, so nothing observable changes).
- `setMarketIndex` (the placeholder setter) still works for legacy/manual
  setup **before** activation and is rejected with
  `market_simulation_owned` (409) after it. There are intentionally no
  client market-write endpoints and no scheduler — request-driven refresh is
  deterministic and sufficient.
- **Valuation helper (read-only):** `estimatedValueTokens(item, indexes)` =
  `max(1, round(tokenValue(item.price) * indexForItemCategory / 100))` using
  the existing category fallback chain. It never rewrites `item.price`,
  `item.sellValue`, rarity or inventory JSON, and is not yet woven into
  inventory/resale APIs.

### Palette definitions and frozen editions

`src/palette-definitions.mjs` — data plus validation plus the persisted
catalog. `cases.mjs` stays the single source of truth for the tier/rarity
algorithm: `buildEditionItems` was extracted there and is shared by legacy
case editions and palette editions verbatim (no diverging rarity logic).

- **Definitions.** `PALETTE_DEFINITIONS`: the eight legacy case ids as `base`
  definitions (`requiredLevel: 1`) plus three `event` definitions —
  `electronics-smuggling` (electronics, level 3), `dealer-seizure`
  (vehicles/electronics/watches_jewelry/luxury_goods, level 5),
  `wine-tax-seizure` (wine/collectibles, level 8). Fields: `id`, `version`,
  `name`, `nameDe`, `badge`, `kind`, `story { title, body, fictional: true }`,
  `allowedMarketCategories` (null = unrestricted for mixed/premium),
  `legacyTheme`, `rewardCount: 3`, `requiredLevel` (metadata only until
  progression enforcement exists). Stories are explicitly fictional seized
  collections; they never assert a real auction owner committed a crime.
- **Eligibility.** Base pools keep the exact legacy `matchesTheme` rules
  (vehicle parts are not cars, spirits are not wine). Event pools use market
  category membership via the existing listing-category mapping, reusing the
  same `matchesTheme` semantics when the pool includes vehicles or wine. No
  new taxonomy was invented.
- **Generation.** Same eligibility requirements, family deduplication, tier
  sizes, caps `[8,6,5,3,2]` and deterministic ordering as cases; editions
  have 5..24 items across all five tiers, weights `[5000,3500,1200,290,10]`,
  equal odds within a tier. A future winning lot awards three independent
  draws WITH replacement — not drawn or minted anywhere yet. Base editions
  select via the existing UTC dayIndex; event editions via
  `SHA-256([eventId, paletteId, version])`'s first eight hex chars as an
  unsigned integer. Selection seeds are internal and never serialized.
- **Freezing.** Each item's price, token base value, market category, rarity
  and display fields, plus the definition/version and story, are frozen into
  `payload_json` at generation; market movement, collector updates, restarts
  and definition edits never reroll or reprice a stored edition
  (`INSERT OR IGNORE` on the stable edition id; editions are never pruned).
  Insufficient themed stock produces a persisted unavailable edition with
  `availabilityReason: 'insufficient_stock'` — categories are never
  substituted and the edition is not regenerated later.
- **Reference pricing (metadata only, no buy/open offer).** With
  `p(item) = tierWeight / totalWeight / tierItemCount`:
  `E0 = rewardCount·Σ p·baseValueTokens` over frozen base token values, `Et =
  rewardCount·Σ p·unrounded market-adjusted values` (captured once at
  generation from the persisted market state — never gated by feature
  flags), and `referenceReserve = ceil(max(0.75·E0 + 0.25·Et, Et) / 0.85)`.
  **Units:** stored `pricing.e0`/`pricing.et` are BUNDLE expectations
  (`rewardCount` = 3 draws); `minMarketValue`/`maxMarketValue` stay PER-ITEM.
  A usable edition requires `rewardCount·minItemMarketValue < referenceReserve
  < rewardCount·maxItemMarketValue` (both loss and upside possible);
  otherwise it freezes unavailable with `availabilityReason:
  'insufficient_value_spread'`. Payloads carry `pricingVersion: 2` — v1
  payloads (written before the correction) stored single-draw expectations by
  mistake; see the migration below. A future primary auction computes its own
  reserve with the same formula and the market at lot creation.
- **Bundle-pricing migration (`palette_bundle_pricing_v2`).** One-time,
  atomic, idempotent correction of pre-acquisition reference metadata,
  running inside the same transaction as the first edition read/creation
  after the upgrade (marker written last, so never rerun). For stored
  unversioned rows: `e0`/`et` are multiplied by the payload's `rewardCount`,
  and `referenceReserve`, `spreadOk`, `available`, `availabilityReason` and
  `weights` are recomputed purely from those corrected expectations and the
  stored per-item minimum/maximum — never against today's market or archive.
  Rows with `insufficient_stock` (null pricing) retain that state. Items,
  ids, rarity, story, windows, `definitionVersion` and `valuationAt` are
  untouched; malformed pricing is rejected (`invalid_stored_pricing`, 500)
  rather than silently replaced. This intentionally corrected reference
  metadata before acquisition existed — there are no player payments to
  adjust. Base editions are also no longer regenerated on every catalog
  read: an existing edition row is reused directly (no archive access), so
  stored editions survive even if the archive later disappears; INSERT OR
  IGNORE still guards freshly generated rows.
- **Availability.** Evaluated per request with one captured now:
  `scheduled` before `startsAt`, `expired` at/after `endsAt`, `restocking`
  inside the window with a frozen-unusable edition, `available` otherwise;
  the boolean `available` agrees with the state. Archiving news does not end
  an edition early. The catalog returns current base editions plus event
  editions with `endsAt > now` (scheduled ones included); multiple event
  editions of one definition coexist, identified by `editionId`. The
  revision is derived from included edition ids and their evaluated states.
- **Public shape** (`GET /api/palettes`, flag `FEATURE_PALETTES`): top-level
  `revision`, `rotationDate`, `rotatesAt`, `rarities`, `rewards` (still the
  unchanged legacy case reward schedule — never derived from reserves), and
  `palettes[]` with `id`, `editionId`, `name`, `nameDe`, `type`,
  `marketCategory`, `badge`, `kind`, `story`, `allowedMarketCategories`,
  `rewardCount`, `requiredLevel`, `cost` (= `referenceReserve` when usable,
  0 otherwise), `referenceReserve`, `valuationAt`, `startsAt`, `endsAt`,
  `rotationDate`, `available`, `availability`, `availabilityReason`,
  `acquisitionMode: 'auction'`, `purchasable: false`, and `items`. Internal
  weights are not serialized. Nothing here is wired into the legacy
  `cases/open` flow — no purchasing, no minting.

### Progression (XP levels — shared read model)

`src/progression.mjs` owns the level curve, extracted verbatim from the
primary palette auction domain where it first shipped:

- `XP_LEVEL_LIMIT = 20`; reaching level L requires `xp >= 100·(L−1)²`.
- `levelForXp(xp)` — the unchanged curve function; `src/palette-auctions.mjs`
  imports it (and re-exports both symbols for compatibility) instead of
  owning it, so every future level-gated feature shares one definition.
- `progressionForXp(xp)` — pure defensive read helper for profile/API
  consumers: `{ xp, level, levelStartXp, nextLevelXp, xpIntoLevel,
  xpNeededForNextLevel, progress }`. Non-number/non-finite/negative input
  reads as zero XP, fractions floor; at level 20 `nextLevelXp` and
  `xpNeededForNextLevel` are `null` and `progress` is exactly `1` — the
  shape is never NaN/Infinity. No database access, no XP grants, no curve
  changes: persisted `users.xp` stays the single source of truth.

The authenticated profile (`GET /api/account/me`) exposes exactly this
object as `user.progression` (raw `xp` is not additionally leaked; the
number lives inside `progression`). XP leaderboards were deliberately not
added. Boundary coverage (0, 99, 100, every threshold, 19→20, terminal,
very large, invalid inputs) lives in `test/progression.test.mjs`.

### Resale auctions

`src/resale.mjs` — plain functions in the `database.mjs`/`cases.mjs` style
(not a class). Invariants enforced in transactions:

1. **No duplication.** A listing references the original `inventory` row and
   serializes the item by joining it at read time. Nothing is ever copied or
   minted; ownership moves **only** at settlement, by updating that same
   row's `user_id`.
2. **Single active listing per item**, enforced by a partial unique index
   (`WHERE status = 'active'`) plus an explicit pre-check.
3. **Locking.** One shared condition (`RESALE_LOCK_SQL` in `resale.mjs`, used
   by `inventoryIsLocked`/`lockedInventoryIds`): an item is locked while its
   auction is `active` **or** `ended` with a winner but not yet settled.
   `accounts.sell`, `accounts.sellAll` and `listItem` all refuse (`item_listed`,
   409) through those helpers — there is exactly one lock predicate in the
   codebase. Settled, cancelled and bid-less lost auctions release the item;
   after settlement only the winner, as the new owner, may relist.
4. **Ownership.** Only the owner can list/cancel; listing someone else's row
   is a 404 (no existence leak). A sold item (`sold_at` set) cannot be listed.
5. **Escrow at bid time.** A row's `current_bid` together with its
   `current_bidder_id` **is** the escrow — no separate ledger table. Those
   tokens were deducted from the bidder's `users.tokens` the moment the bid
   was placed; `users.tokens` is always spendable balance and never counts
   tokens held in bids. Consequences:
   - First bid: the full amount is reserved atomically
     (`UPDATE users SET tokens = tokens - ? WHERE tokens >= ?` — a rejected
     debit can never partially apply).
   - A different bidder outbids: new bidder is charged the full amount and
     the previous holder is refunded their exact amount **in the same
     transaction**. No intermediate state is observable.
   - The current highest bidder raises their own bid: only the difference is
     charged (no refund-then-recharge).
   - A rejected bid (invalid amount, lowball, seller's own auction,
     insufficient funds) changes no balances, no bid rows, no current bid.
   - While an auction is live, exactly its `current_bid` is out of
     circulation; bid transitions and settlement never create or destroy
     tokens (asserted in tests via `SUM(tokens)`).
6. **Deterministic lazy close.** Close and settlement are conceptually
   separate steps. Any operation first closes due auctions
   (`status='ended'`, `winner_id=current_bidder_id`). Reads (`getResale`,
   `listResales`) additionally run settlement (`settleDueListings`) lazily —
   that is the stand-in for a scheduler until one exists. `settleAuction(id)`
   and `settleDueListings()` are the explicit entry points a future scheduler
   should call; no cron infrastructure exists yet.
7. **Settlement (idempotent).** For an ended auction with a winner, one
   transaction verifies: not already settled; the seller still owns the
   inventory row; the item is not sold; the escrow is internally consistent
   (winner = current bidder, positive amount, winner ≠ seller). It then
   transfers the inventory row (`UPDATE inventory SET user_id = winner`),
   credits the seller with the escrowed amount, and stamps `settled_at` with
   a guarded `UPDATE ... WHERE settled_at IS NULL` — the database-level
   idempotency guarantee. Repeat calls return the settled state unchanged:
   no second payout, transfer, or winner-balance change. The winner already
   paid at bid time and is never charged at settlement. Ended without bids:
   only `settled_at` is stamped; the seller keeps the item, no tokens move.
8. **Settlement robustness.** All verification happens before any write, so a
   failure rolls back with nothing half-settled. `settleDueListings` settles
   each due auction in its own transaction and reports (instead of throwing)
   per-auction failures: a corrupted listing stays ended-but-unsettled — and
   therefore locked — rather than silently destroying tokens or blocking the
   others. A direct `settleAuction` call surfaces the error
   (`escrow_inconsistent`/`settlement_conflict`). Settlement is a pure
   database operation: it does not depend on sessions or login state.
9. Bid rules: integer tokens, first bid ≥ `start_price`, later bids must beat
   `current_bid` by ≥ 1, seller cannot bid, balance must cover the charge.
10. Cancel is only possible while active **and** bid-free; it releases the
   item (no escrow can exist on a bid-free auction, so no refund path is
   needed there).
11. **Legacy foundation rows.** Foundation bids were advisory (no tokens
   moved), so a foundation auction with a high bidder can never settle under
   escrow rules without minting tokens. When the `settled_at` column is
   added to an existing database, a one-time cleanup cancels every auction
   that already has a `current_bidder_id` — nothing was ever escrowed, so
   there is nothing to refund; `resale_bids` history rows stay untouched and
   the item is released. Bid-free auctions simply continue under the new
   rules. The feature is flag-gated and was never live, so this only affects
   development databases.

### Primary palette auctions (sealed, system-issued)

`src/palette-auctions.mjs` — domain functions only. Deliberately no shared
framework with resale: primary auctions sell **system-issued sealed
contents**, the winning payment is a **currency sink** (no seller is ever
paid), and settlement mints exactly three inventory items. The HTTP layer
(§4) is a **thin adapter** over these functions behind
`FEATURE_PALETTE_AUCTIONS` — public reads in `economy-api.mjs`,
authenticated bid/reveal and admin-only creation in `account-api.mjs`; no
auction business rule is duplicated in a route handler. Still unwired:
automatic lot generation, schedulers, NPCs, and any UI.

- **Creation** (`createPaletteAuction(dataDir, {editionId, requestId},
  {now, random})`, trusted/server-only). `requestId` is persistent and
  globally unique (16..80 ASCII letters/digits/hyphens): a replay with the
  same id returns the original lot unchanged — even after expiry, even with a
  moved market — without repricing or redrawing; the same requestId with a
  different editionId is `request_conflict` (409). The edition must be a
  persisted, usable, in-window edition (`palette_edition_not_found` 404 /
  `palette_edition_unavailable` 409 / `palette_edition_inactive` 409);
  editions are loaded, never generated here. Every lot runs exactly **one
  hour** and must fit entirely inside the edition window
  (`palette_window_closes_early` 409 — auctions are never shortened at the
  end of a window). The reserve is recomputed at creation with
  `bundleReferencePricing` against the global unrounded category indexes
  (frozen edition pricing is not trusted); a failing spread rejects the lot
  (`insufficient_value_spread` 409). Reserve, `valuation_at`,
  `required_level` and the public snapshot are frozen on the lot. Three
  rewards are drawn **with replacement** from the frozen pool/weights via
  `crypto.randomInt` (an injectable `random` exists for deterministic tests;
  timestamps/public ids are never seeds), their complete hidden snapshots and
  distinct reserved inventory UUIDs are persisted in the same transaction,
  and **no inventory rows are created yet**.
- **Bidding** (`bidOnPaletteAuction`). The bidder is read fresh from the
  database (missing → `login_required` 401, banned → `account_banned` 403).
  Bids are rejected at `now >= ends_at` (`palette_auction_ended` 409); first
  bid ≥ reserve, later bids ≥ current+1 (`bid_too_low` 409). The frozen
  `requiredLevel` gates bidding: levels derive from persisted `users.xp` with
  threshold `100·(level−1)²` (levels 1..20, `levelForXp`), never from a
  client-supplied level (`level_required` 403). Escrow accounting matches
  resale semantics exactly — first bid debits in full, a different bidder
  debits the new amount and refunds the prior holder atomically, the leader
  raising pays only the difference, rejected bids change nothing — including
  safe-integer overflow guards on refunds. No bid or auction cancellation
  exists in this domain.
- **Settlement** (`settlePaletteAuction`, one `BEGIN IMMEDIATE` transaction,
  db-scoped internals, idempotent via the `settled_at` guard). Before the
  deadline: `auction_still_active` 409. At/after: the lot closes and the
  current bidder becomes the winner. **No bids** → settled, no inventory, no
  token movement. **With bids** → escrow consistency and exactly three valid
  rewards are verified, then the three reserved inventory rows are inserted
  for the winner (plain INSERTs — a conflicting reserved id aborts and rolls
  back everything; `INSERT OR IGNORE` is never used to hide conflicts). Items
  retain their frozen `price`, `rarity`, `sellValue` and `marketCategory`
  and gain palette provenance: `paletteAuctionId`, `paletteEditionId`,
  `rewardPosition`, and `bundleCostTokens` — the **entire winning bid**, not
  a per-item cost; no legacy `caseId`/`caseCost` fields are fabricated. The
  winning escrow is consumed (sink); the winner is never charged again; the
  winning bid row stays as history. Repeat settlement — including across
  restarts — returns the same terminal state and mints nothing. Expired
  unclaimed lots settle through explicit calls only (no batch scheduler).
- **Accounting invariant** (test-enforced): before settlement, all user
  balances plus the sum of `current_bid` over **unsettled** primary auctions
  are conserved by every operation; a successful settlement reduces that sum
  by exactly the winning bid; nothing else in this domain creates or
  destroys tokens.
- **Public surfaces.** `getPaletteAuction` settles its own due lot before
  answering; `listPaletteAuctions` defaults to active unexpired lots with
  bounded integer pagination. Responses are explicit allowlists (identity,
  frozen story/pool display, `rewardCount`, `reserve`, `currentBid`,
  `bidCount`, `requiredLevel`, status/timestamps, `winnerId`). They **never**
  contain reward snapshots, selected source ids, reserved inventory ids,
  randomness or selected-value totals — the candidate pool is public, the
  drawn outcome is not, and an administrator is not entitled to it either.
  `getPaletteAuctionRewards` authenticates fresh database state (banned
  users out), refuses before the deadline (`rewards_unavailable` 409, no
  details), settles on demand, and reveals the frozen snapshots **only to
  the recorded winner** — everyone else (losers, admins, the no-bid case)
  gets the same generic `palette_rewards_not_found` 404. Retrieval is
  repeat-stable, unaffected by later resale/ownership transfer, and never
  mints inventory or debits tokens.

New error codes: `palette_edition_not_found` (404),
`palette_edition_unavailable` (409), `palette_edition_inactive` (409),
`palette_window_closes_early` (409), `insufficient_value_spread` (409),
`palette_auction_not_found` (404), `palette_auction_ended` (409),
`auction_still_active` (409), `level_required` (403),
`rewards_unavailable` (409), `palette_rewards_not_found` (404),
`palette_auction_inconsistent` (500, defensive corruption guard).

## 4. APIs added

Public, read-only, flag-gated (`src/economy-api.mjs`, mounted in `server.mjs`
before the account API; disabled routes fall through to 404):

| Endpoint | Flag | Payload |
| --- | --- | --- |
| `GET /api/news?limit=` | `FEATURE_NEWS` | `{ news: [NewsEvent…] }` (published only, newest first) |
| `GET /api/market` | `FEATURE_MARKET` | `marketState()` |
| `GET /api/market/:category/history?limit=` | `FEATURE_MARKET` | `{ category, history: [{ indexValue, capturedAt }…] }` — `marketHistory()` read-only; category validated by the domain (`unknown_category` 404), limit bounded 1..1000 by the domain, default 168 (hourly points, 7 days). Malformed paths that are not exactly `/api/market/<category>/history` fall through 404 |
| `GET /api/palettes` | `FEATURE_PALETTES` | `publicPaletteCatalog()` |
| `GET /api/palette-auctions?limit=&offset=` | `FEATURE_PALETTE_AUCTIONS` | `{ auctions: [...] }` — `listPaletteAuctions()` (active lots, domain bounds limit 1..200 / offset ≥ 0) |
| `GET /api/palette-auctions/:id` | `FEATURE_PALETTE_AUCTIONS` | `{ auction }` — `getPaletteAuction()`; safe URL decoding (malformed encoding 404s like an unknown id); the domain's explicit public allowlist is the only serialization — no reward snapshots, reserved inventory ids, or randomness |
| `GET /api/resales?limit=` | `FEATURE_RESALES` | `{ listings: [...] }` (active only) |
| `GET /api/resales/:id` | `FEATURE_RESALES` | `{ listing }` incl. `bids` |

Authenticated, under the existing account API conventions (session cookie,
`x-requested-with: JUSTIZGUESSR` CSRF check, throttle), gated by
`FEATURE_RESALES` / `FEATURE_NEWS` / `FEATURE_PALETTE_AUCTIONS`:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/account/resale/listings` | `{ inventoryId, startPrice, endsAt }` → `{ listing, user }`. `endsAt` ISO within [now+1min, now+30d] |
| `GET /api/account/resale/listings` | The caller's listings (all statuses) |
| `POST /api/account/resale/bid` | `{ id, amount }` → `{ listing, user }` |
| `POST /api/account/resale/cancel` | `{ id }` → `{ listing, user }` |
| `POST /api/account/admin/news` | Admin-only seed/update tool: `saveNewsEvent` body → `{ event }`. Publishing applies real market effects atomically; drafts stay free-form |
| `POST /api/account/palette-auctions/bid` | `{ id, amount }` → `{ auction, user }` — thin adapter over `bidOnPaletteAuction`; the domain owns level gate, escrow, balance, minimum bid, deadline and ban handling; `user` is the refreshed profile (spendable balance after the escrow debit) |
| `GET /api/account/palette-auctions/:id/rewards` | Winner-only reveal → `{ reveal }` — `getPaletteAuctionRewards()`; before deadline `rewards_unavailable` 409, non-winners (losers, admins, no-bid case) get the same generic `palette_rewards_not_found` 404, no admin bypass; safe id decoding |
| `POST /api/account/admin/palette-auctions` | Admin-only test/operations surface: `{ editionId, requestId }` → `{ auction }` — `createPaletteAuction()` with its requestId idempotency; editionId + requestId are the only inputs, every other field (reserve, rewards, duration, level, valuation, winner, seed) is dropped at the route |

Listing serialization (camelCase, matching project payload conventions):
`{ id, sellerId, sellerUsername, inventoryId, item: { title, image, price,
rarity, marketCategory }, startPrice, currentBid, bidCount, status, startedAt,
endsAt, winnerId, closedAt, settledAt, bids? }`. `settledAt` is the only
settlement field exposed; escrow internals are not serialized (the escrow
amount is simply `currentBid`). There are intentionally no HTTP endpoints for
settlement — reads settle lazily, and a future scheduler calls the module
functions directly.

New error codes introduced by publication/simulation (all `AccountError`):
`market_effect_budget` (409), `invalid_news_transition` (409),
`news_already_published` (409), `invalid_palette_windows` (400),
`market_simulation_owned` (409); `invalid_market_effects` (400) and
`invalid_published_at` (400) keep their old codes but stricter meanings
(integer index points; no client-supplied publication timestamps). The
package-1 placeholder rejection `palette_activation_unavailable` was removed
when edition activation landed. `GET /api/market` returns computed indexes
once the simulation is activated; before activation it keeps returning the
stored placeholder values. `GET /api/palettes` serves the persisted edition
catalog (frozen pools, evaluated availability) instead of the compatibility
view — `paletteFromCase`/`publicPaletteCatalog` remain exported for internal
compatibility, and `/api/account/cases` keeps its exact legacy shape.

There are intentionally **no** HTTP endpoints for `setMarketIndex` — market
writes belong to the future simulation, not to clients.

## 5. Compatibility decisions around the case system

- `cases.mjs` is untouched — all palette naming lives in
  `src/palettes.mjs`. `/api/account/cases` keeps its exact shape; shop,
  inventory, case_openings, and `case_rotations` snapshots keep working.
- `AccountError` moved to `src/errors.mjs` (so economy modules can use it
  without an import cycle through `accounts.mjs`) and is **re-exported** from
  `src/accounts.mjs`; `instanceof` semantics are unchanged.
- `marketCategory` is additive on new inventory items and derived for legacy
  ones; `collectibleIdentity`, `groupedInventory` (frontend), and all euro
  summaries ignore it.
- Feature flags default **off**, so the production surface is unchanged.
  Enable per system with `FEATURE_NEWS`, `FEATURE_MARKET`, `FEATURE_RESALES`,
  `FEATURE_PALETTES`, `FEATURE_PALETTE_AUCTIONS` (`1/true/on/yes`).
  `FEATURE_PALETTES` and `FEATURE_PALETTE_AUCTIONS` are deliberately
  distinct: the former is the catalog/read model only; the latter controls
  actual primary-auction acquisition (public lot reads, authenticated
  bid/reveal, admin creation). Enabling palettes alone never exposes
  auctions (test-enforced).
- Frontend: only `dist/economy.js` exists (a fetch helper exposing
  `window.justizEconomy.{news,market,marketHistory,palettes,
  paletteAuctions,paletteAuction,paletteAuctionBid,paletteAuctionRewards,
  adminCreatePaletteAuction,resales,resale}`; the GET helpers resolve to
  `null` when a flag is off) plus bilingual error strings for the new error
  codes in `account.js`. The authenticated palette-auction helpers delegate
  to `account.js`'s `accountApi` (`window.accountApi`) so the CSRF header,
  cookie handling and the `AccountError` payload contract (rejected promise
  with `error.code`) live in exactly one place. No pages, no redesign.

## 6. Unfinished systems (explicitly out of scope here)

- Palette generation, activation and the sealed primary-auction **domain
  plus HTTP exposure** are implemented (§3, §4): creation, escrowed bidding,
  settlement, winner-only reveal, public reads, the authenticated
  bid/reveal routes and the admin creation route all work. Still missing:
  **automatic lot generation / scheduling policy** (someone must call the
  admin creation route for lots to exist) and every player-facing UI.
- Market fluctuation beyond news effects: no supply/demand drift, no
  scheduler-driven movement, no NPC reactions. The deterministic news-driven
  simulation (§3) is the only thing that moves indexes.
- NPC bidders and market-driven bidding behavior.
- Bidding UX, real-time updates (no websocket infrastructure exists).
- XP earning and balancing: level *checks* are live (threshold
  `100·(level−1)²` from `users.xp`, shared module in §3) and the profile
  exposes `progression`, but nothing awards XP yet and the curve is not
  designed.
- Storage Wars and businesses (do not build).
- Resale settlement economics are **done**; a real settlement scheduler is
  still future work (reads settle lazily today).

## 7. Extension points for the next implementation

1. **Palette acquisition — domain and routes implemented; generation policy
   missing.** Sealed primary auctions exist as server functions (§3) behind
   `FEATURE_PALETTE_AUCTIONS` HTTP routes (§4): lots freeze a recomputed
   reserve, draw three hidden rewards, escrow bids, settle as a currency sink
   and reveal to the winner only; list/detail/bid/reveal and the admin
   creation route are wired. The next pass decides **when and how lots
   appear** (automatic generation / scheduling policy, NPCs driving demand),
   plus a settlement scheduler if lazy settlement is not enough. The legacy
   `cases/open` flow stays untouched; do not wire palette entries into it.
2. **News-driven palette availability — implemented.** Event publications
   create frozen editions for their resolved windows; what could still be
   added later is automatic news generation and admin tooling for windows.
3. **Market simulation — deterministic core implemented.** News publications
   move indexes through `market_effects` (72h linear decay, absolute budget
   30, formula in §3); reads compute from effects and lazily fill the hourly
   snapshot grid. Still open for later passes: supply/demand drift on top of
   the same effect representation, a scheduler (request-driven refresh is
   intentionally sufficient for now), and NPC reactions. Keep the market
   global: every function in `market.mjs` is per-dataDir, never per-user.
4. **NPC bidding** — `resale_bids.bidder_id` currently always references a
   real user. Options: pseudo-user rows in `users` (admin-flagged), or a
   nullable `bidder_id` + new `npc` columns. `placeBid` is the transactional
   pattern to copy; escrow semantics already work for any user row (NPC
   winners would need their escrow funded like anyone else's, or settlement
   would need an explicit NPC branch).
5. **Auction settlement — implemented.** Escrow at bid time, outbid refunds,
   idempotent settlement, seller payout, and inventory transfer all live in
   `src/resale.mjs` (`placeBid`, `settleAuction`, `settleDueListings`; see
   §3). What remains for later passes: XP awards at settlement
   (`users.xp` is waiting — settlement is the natural hook) and replacing
   lazy read-driven settlement with a scheduler that calls
   `settleDueListings` on a cadence. The close/settlement split is already
   shaped for that: `closeDueListings` determines winners,
   `settleListingRow` moves value and ownership, and both are idempotent
   under repeated invocation.
6. **XP / levels** — write to `users.xp` from settlement and game rewards
   (`accounts.answer` is where token rewards land today). Design the award
   policy later; the read side is done (`src/progression.mjs` + the
   profile's `progression` object, §3).
7. **Storage Wars / businesses** — not started. The resale + market + palette
   foundations are the intended building blocks.

## 8. TODOs

The backend surfaces for the economy are now stable (see "Next
implementation pass" below); almost everything remaining is gameplay
policy or frontend:

1. [ ] **Automatic primary auction generation / scheduling policy** — lots
   exist only through the admin creation route; decide when and how many
   appear, and whether NPCs drive demand (see §7.1 and §7.4).
2. [ ] **Main frontend economy experience** — pages, routes, styles for the
   economy systems; data access is complete in `dist/economy.js`.
3. [ ] **Mystery Palette bidding + reveal UX** — the bid/reveal routes and
   helpers exist; no UI.
4. [ ] **News feed UI** — `/api/news` exists; no page.
5. [ ] **Market charts** — `/api/market` and
   `/api/market/:category/history` exist; no chart.
6. [ ] **Resale marketplace UI** — listing/bid/cancel routes exist; no page.
7. [ ] **NPC bidders** — identities/personality, funding model, bidding
   behavior (§7.4).
8. [ ] **XP award policy and balance** — nothing awards XP yet; `users.xp`,
   `src/progression.mjs` and the profile `progression` object are ready.
9. [ ] **Gradual replacement of legacy case purchasing** — decide the
   transition from `cases/open` to primary auctions; instant sell stays.
10. [ ] **Scheduler/background processing where actually necessary** —
    resale reads settle lazily via `settleDueListings`; primary lots settle
    on read or explicit call only.
11. [ ] Later: Storage Wars / businesses (do not build yet).

Smaller: news authoring UI (API-only today), `Getränke` splitting from
`wine` (data-only in `market.mjs`), weaving `estimatedValueTokens` into
inventory/resale surfaces (read-only), and exposing feature flags through
`compose.yml` env passthrough when a system goes live.

## 8a. Next implementation pass

Stable backend surfaces now available (all flag-gated, all tested):

- `GET /api/news`, `GET /api/market`, `GET /api/market/:category/history`
  (`FEATURE_NEWS` / `FEATURE_MARKET`).
- `GET /api/palettes` (`FEATURE_PALETTES`): frozen edition catalog with
  availability windows and `requiredLevel` metadata.
- `GET /api/palette-auctions[/:id]`, `POST /api/account/palette-auctions/bid`,
  `GET /api/account/palette-auctions/:id/rewards`,
  `POST /api/account/admin/palette-auctions` (`FEATURE_PALETTE_AUCTIONS`) —
  thin adapters; all rules live in `src/palette-auctions.mjs`.
- Resale routes (`FEATURE_RESALES`) and the admin news route
  (`FEATURE_NEWS`).
- `GET /api/account/me` now exposes `user.progression`
  (`{xp, level, levelStartXp, nextLevelXp, xpIntoLevel,
  xpNeededForNextLevel, progress}`); `src/progression.mjs` is the shared
  curve.
- Frontend data helpers: `window.justizEconomy` (all GETs plus
  authenticated bid/reveal/admin-create through `window.accountApi`).

Main decisions the next (stronger) implementation still needs to make —
deliberately left open by the preparation pass:

- When and how many primary lots are generated, and from which editions
  (automatic generation policy; the admin route is manual only).
- Whether/when a settlement scheduler replaces lazy settlement.
- NPC bidder design (identity, funding, bidding behavior) — none exists.
- XP award policy and balance (nothing awards XP; the curve itself is
  frozen at `100·(level−1)²`, levels 1..20).
- How the legacy case shop is gradually replaced by auction acquisition
  (both run in parallel today; `cases/open` is untouched).
- Frontend structure for the economy pages (no routes/pages/styles exist).

## 9. Design decisions to reconsider before core mechanics

- **Escrow representation**: `current_bid` + `current_bidder_id` double as the
  escrow (tokens are deducted from balances at bid time; see §3). This avoids
  a ledger table entirely. If auctions ever need to distinguish "escrowed"
  from "winning amount" (fees, partial refunds), add an explicit
  `escrow_amount` column then — do not fork the meaning of `current_bid`
  silently.
- **Effect semantics**: magnitude = whole index points (1..20), linear decay
  over exactly 72h, absolute budget 30 per category, public two-decimal
  rounding. If future gameplay needs compounding or longer horizons, extend
  the effect row rather than redefining `delta`.
- **Edition immutability vs. definition edits**: stored editions are never
  regenerated (stable ids + `INSERT OR IGNORE`). If a palette story or pool
  rule changes, only future editions are affected; historical ones keep the
  old definition/version frozen in `payload_json`. Revisit only if a definition
  ever needs retroactive correction — that would require an explicit migration,
  not a regeneration.
- **`luxury_goods` has no listing-category source**: `dealer-seizure` lists
  the category, but today's German listing vocabulary never maps into it, so
  that share of the pool is currently empty. Adding a mapping is a data-only
  change in `market.mjs`.
- **Activation at first publication**: the migration (legacy receipts,
  bootstrap effects, base reset, marker) runs inside the first publication's
  transaction, and pre-activation reads keep the placeholder view. On fresh
  databases this is indistinguishable (everything is neutral 100); on legacy
  dev databases hand-set indexes survive untouched until the new economy
  actually goes live. Revisit if a deployment ever needs reads to activate.
- **No scheduler**: market history backfills lazily on reads (bounded, at
  most 720 boundaries per refresh) and resale auctions settle lazily. Both
  stay deterministic across read frequency and restarts; a scheduler can wrap
  `settleDueListings` later without changing semantics.
- **Legacy news is never replayed**: old placeholder effects (fractional or
  null magnitudes) were never backed by token or index movement, so legacy
  receipts record them for auditability only. This is deliberate — replaying
  them would fabricate market history. Likewise no historical activation
  backfill runs for package-1 events: their economics are closed.
- **Lazy close/settlement instead of a scheduler**: deterministic and
  test-friendly, but winners only exist and get paid once someone reads a
  listing. A scheduler calling `settleDueListings` on a cadence will probably
  replace the lazy settlement in reads (the lazy close in mutation paths can
  stay).
- **`marketCategory` frozen on items vs. derived**: new items store it (like
  `rarity`/`sellValue`), legacy items derive. If the mapping table changes
  later, legacy items' effective category changes with it — decide whether to
  backfill at that point.
- **Whole-document news upserts**: `saveNewsEvent` replaces the entire event
  (except `created_at`). If you need append-only audit trails for events,
  revisit before building automation on top.
- **Partial unique index for active listings** prevents double-listing but
  means a cancelled auction's row stays forever as history; consider an
  archival/cleanup policy once volume matters.
- **XP column placement**: `users.xp` assumes a single scalar. If levels
  derive from activity history rather than a sum, migrate before it accrues
  meaning.
- **Flags are env-only**: there is no per-user or runtime toggle
  infrastructure. If you need gradual rollouts, that's new work.

## 10. Acceptance validation (deterministic news/market core)

`test/acceptance.test.mjs` is a dedicated acceptance pass for the publication
and simulation contract described in §3. It uses only the public publication
API (`saveNewsEvent`), injected clocks, temporary SQLite databases, and raw
row counts — it asserts concrete expected values, never just "did not throw".
Production behavior matches every documented value; there are no known
deviations. The covered scenarios:

1. **Linear decay.** A down-15 effect published at t0 reads exactly 85 at t0,
   92.5 at t0+36h, and 100 at t0+72h; the persisted `market_effects` row is
   exactly one row with `delta = -15`, `starts_at = t0`,
   `ends_at = t0 + 259200000`; unrelated categories stay at 100.
2. **Read-frequency independence.** A database read every 6 hours and one
   never read until t0+36h produce identical indexes (92.5), identical
   36-boundary hourly histories (each value equal to
   `round(85 + 15·elapsedHours/72, 2)`), and identical snapshot row counts.
3. **Exact-once across restart.** Closing and reopening SQLite, then retrying
   the original publication ten hours later, leaves exactly one `applied`
   receipt (`processed_at = t0`), exactly one effect row (`starts_at = t0` —
   decay not restarted), an unchanged `publishedAt`, a single `news_events`
   row, and an index (87.08 at t0+10h) consistent with the original schedule.
4. **Archiving does not stop recovery.** Archiving one hour after publication
   keeps the single effect row and the original schedule: 85.21 at t0+1h,
   92.71 at t0+37h, 100 at t0+72h.
5. **Opposing effects share the absolute budget.** With an active up-20 on
   tools, a down-11 publication is rejected (`market_effect_budget`, 409,
   no row/receipt/news changes); down-10 is accepted (index 110, two effect
   rows); a further +1 is rejected again with the budget at ~30.
6. **Atomic multi-category rejection.** With tools exhausted (30 active
   points), a publication containing both a fitting wine effect and a
   busting tools effect changes no category index, adds no effect rows for
   either category, and leaves `news_events`, `news_publications` and the
   rejected event untouched.
7. **Downtime backfill and retention.** After 40 days without reads, the next
   read backfills exactly 720 hourly UTC boundaries per category
   (`newest = floor(now/h)·h`, `oldest = newest − 719h`, all within 30-day
   retention), reconstructs the expired effect's window as 100 everywhere,
   fabricates nothing before the activation boundary, and keeps the effect
   and receipt rows (720·14 snapshot rows in total).
8. **Legacy placeholder effects are never applied.** Foundation-era
   published/archived events with fractional placeholder magnitudes receive
   `kind='legacy'` receipts (drafts receive none) but zero `market_effects`
   rows during the activation migration: electronics and wine stay exactly
   100 while the fresh publication's category moves to 105.

## 11. Bundle-pricing validation (palette correction)

Independent regression coverage for the corrected bundle units and the
`palette_bundle_pricing_v2` migration, all in `test/palette-editions.test.mjs`:

- **Hand-calculated pure fixture** (no production loop copied): one item per
  rarity with token values 10/20/50/100/1000 against the exported
  `bundleReferencePricing` helper. Single-draw neutral expectation 21.9;
  three-item E0 = Et = 65.7 → reserve 78; at index 80 Et = 52.56 → reserve
  74; at index 120 Et = 78.84 → reserve 93. min/max verified as per-item
  (12/1200 at index 120), `rewardCount` honored as a parameter (6 draws →
  131.4/155), tolerances for floats, exact integer reserves.
- **Integration**: the public catalog formula test recomputes bundle
  expectations from the frozen pool and asserts stored `pricing.e0`/`et`,
  per-item min/max, `pricingVersion: 2`, and `cost = referenceReserve`.
- **Migration**: v1 rows are corrected exactly once (21.9 → 65.7, reserve
  26 → 78) with the marker `{corrected, retained, migratedAt}` written last;
  reopen-and-reread cannot multiply again; a v1 row frozen unusable by the
  mixed math becomes usable under corrected math; null-pricing
  insufficient-stock rows stay unavailable (`restocking`); pools,
  timestamps, story and identity are byte-identical; later market moves and
  archive rewrites cannot alter corrected historical pricing; a sabotaged
  mid-migration UPDATE rolls back every row and leaves the marker unwritten.
- **No regeneration**: repeated catalog reads reuse stored base editions
  without touching the archive — proven by dropping the `auctions` table
  entirely and still reading the identical frozen catalog.
