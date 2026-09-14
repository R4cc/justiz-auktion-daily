# Auction Economy Foundation — Handoff Notes

Status: **foundation + resale transactional core + deterministic market
simulation + real palette editions**. This document describes the technical
groundwork for turning the case-opening game into an auction-centric economy
(Mystery Palettes, news events, a global market, player resale auctions,
XP/levels, and later Storage Wars and businesses), including the resale-auction
transactional foundation (**bid escrow, outbid refunds, settlement, seller
payout, inventory ownership transfer**), the **durable news publication +
deterministic global market simulation** (72h linearly decaying index-point
effects, absolute per-category budget, hourly UTC snapshots), and **real
palette definitions with frozen themed editions and atomic news-driven
availability** (base daily editions + event editions; reference pricing
metadata). Auction acquisition (buying/opening palettes), NPCs, and XP remain
intentionally **not** implemented. Every placeholder below is marked as such.

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
| Public read APIs | `src/economy-api.mjs` | Flag-gated GET endpoints |
| Frontend data access | `dist/economy.js` | `window.justizEconomy` helpers, no UI |
| Tests | `test/market.test.mjs`, `test/news.test.mjs`, `test/resale.test.mjs`, `test/palettes.test.mjs`, `test/economy-api.test.mjs`, `test/simulation.test.mjs`, `test/palette-editions.test.mjs`, `test/acceptance.test.mjs` | full suite green (135 tests) |

## 2. Database changes (all additive, `PRAGMA user_version` bumped 2 → 3 → 4 → 5 → 6 → 7; never lowered)

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

## 4. APIs added

Public, read-only, flag-gated (`src/economy-api.mjs`, mounted in `server.mjs`
before the account API; disabled routes fall through to 404):

| Endpoint | Flag | Payload |
| --- | --- | --- |
| `GET /api/news?limit=` | `FEATURE_NEWS` | `{ news: [NewsEvent…] }` (published only, newest first) |
| `GET /api/market` | `FEATURE_MARKET` | `marketState()` |
| `GET /api/palettes` | `FEATURE_PALETTES` | `publicPaletteCatalog()` |
| `GET /api/resales?limit=` | `FEATURE_RESALES` | `{ listings: [...] }` (active only) |
| `GET /api/resales/:id` | `FEATURE_RESALES` | `{ listing }` incl. `bids` |

Authenticated, under the existing account API conventions (session cookie,
`x-requested-with: JUSTIZGUESSR` CSRF check, throttle), gated by
`FEATURE_RESALES` / `FEATURE_NEWS`:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/account/resale/listings` | `{ inventoryId, startPrice, endsAt }` → `{ listing, user }`. `endsAt` ISO within [now+1min, now+30d] |
| `GET /api/account/resale/listings` | The caller's listings (all statuses) |
| `POST /api/account/resale/bid` | `{ id, amount }` → `{ listing, user }` |
| `POST /api/account/resale/cancel` | `{ id }` → `{ listing, user }` |
| `POST /api/account/admin/news` | Admin-only seed/update tool: `saveNewsEvent` body → `{ event }`. Publishing applies real market effects atomically; drafts stay free-form |

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
  `FEATURE_PALETTES` (`1/true/on/yes`).
- Frontend: only `dist/economy.js` was added (a fetch helper exposing
  `window.justizEconomy.{news,market,palettes,resales,resale}` that resolves
  to `null` when a flag is off) plus bilingual error strings for the new error
  codes in `account.js`. No pages, no redesign.

## 6. Unfinished systems (explicitly out of scope here)

- Palette generation and activation are **implemented** (base daily editions
  plus news-driven event editions with frozen pools and fictional stories,
  §3). Still missing downstream: automatic news generation and the auction
  acquisition flow that consumes editions.
- Market fluctuation beyond news effects: no supply/demand drift, no
  scheduler-driven movement, no NPC reactions. The deterministic news-driven
  simulation (§3) is the only thing that moves indexes.
- NPC bidders and market-driven bidding behavior.
- Bidding UX, real-time updates (no websocket infrastructure exists).
- XP curves, levels, level-gated content (`requiredLevel` on palettes is
  metadata only; `users.xp` is a reserved column).
- Storage Wars and businesses (do not build).
- Settlement economics are **done** (escrow, refunds, payout, transfer — see
  §3 and §7.5); what is still missing for later passes is XP awarding and a
  real settlement scheduler.

## 7. Extension points for the next implementation

1. **Palette acquisition (the next big TODO)** — the frozen editions exist
   (`palette_editions`, served by `GET /api/palettes` with
   `acquisitionMode: 'auction'`, `purchasable: false`) but nothing consumes
   them. Primary auctions should compute and freeze their own reserve with
   the §3 reference formula and the market at lot creation, award three
   independent draws WITH replacement from the edition pool, and never touch
   `cases/open`. Do not wire palette entries into the legacy case flow.
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
   (`accounts.answer` is where token rewards land today). Design the curve
   later; expose via `accounts.profile` when needed.
7. **Storage Wars / businesses** — not started. The resale + market + palette
   foundations are the intended building blocks.

## 8. TODOs

- [ ] Palette acquisition flow (primary auctions consuming frozen editions;
      see §7.1) and news authoring UI (the `admin/news` POST is API-only).
- [ ] Frontend pages for news/market/resales/palettes (data layers exist; no
      routes, no UI, no styles). Charts would read `marketHistory`; there is
      deliberately no client market-write endpoint.
- [ ] XP awards on settlement and game rewards (design the curve first;
      `settleListingRow` is the natural hook).
- [ ] Scheduler that closes + settles due listings on a cadence (today reads
      do it lazily via `settleDueListings`).
- [ ] Decide whether `Getränke` should split from `wine` (data-only change in
      `market.mjs`; the `wine-tax-seizure` palette would follow the mapping).
- [ ] Weave `estimatedValueTokens` into inventory/resale surfaces when the
      UI needs live valuations (read-only; do not rewrite stored item JSON).
- [ ] Optional: expose feature flags through `compose.yml` env passthrough
      when a system goes live.

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
