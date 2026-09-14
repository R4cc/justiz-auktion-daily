# Auction Economy Foundation — Handoff Notes

Status: **foundation only**. This document describes the technical groundwork
for turning the case-opening game into an auction-centric economy (Mystery
Palettes, news events, a global market, player resale auctions, XP/levels, and
later Storage Wars and businesses). Gameplay mechanics, balancing, and
simulation are intentionally **not** implemented. Every placeholder below is
marked as such.

Everything shipped here is additive and flag-gated: with no environment
variables set, the live game behaves exactly as before.

---

## 1. What was implemented

| Area | Module | Notes |
| --- | --- | --- |
| Shared API error type | `src/errors.mjs` | `AccountError` moved here; re-exported from `src/accounts.mjs` for compatibility |
| Feature flags | `src/features.mjs` | Env-driven, all default off |
| Market categories + global market state | `src/market.mjs` | Category registry, mapping tables, neutral index store |
| News events | `src/news.mjs` | Domain validation + persistence + public serialization |
| Resale auctions | `src/resale.mjs` | Listings, bids, lazy close, item locking |
| Palette terminology | `src/palettes.mjs` | Palette view over the case catalog (compatibility layer) |
| Public read APIs | `src/economy-api.mjs` | Flag-gated GET endpoints |
| Frontend data access | `dist/economy.js` | `window.justizEconomy` helpers, no UI |
| Tests | `test/market.test.mjs`, `test/news.test.mjs`, `test/resale.test.mjs`, `test/palettes.test.mjs`, `test/economy-api.test.mjs` | 18 new tests; full suite green (82 tests) |

## 2. Database changes (all additive, `PRAGMA user_version` bumped 2 → 3)

No existing table, column, or row was modified or deleted. New tables are
created lazily by their owning modules (`CREATE TABLE IF NOT EXISTS` on first
use — the same pattern `cases.mjs` uses for `case_rotations`). Rollback is
trivial: drop the new tables; nothing else references them except the
documented lock checks.

- `news_events` (`src/news.mjs`) — `id TEXT PK`, `title`, `body`,
  `status CHECK IN ('draft','published','archived')`, `published_at TEXT`,
  `palette_ids TEXT` (JSON array of palette/case ids), `market_effects TEXT`
  (JSON array), `metadata_json TEXT`, `created_at`/`updated_at TEXT` (ISO).
- `market_categories` (`src/market.mjs`) — `category TEXT PK`,
  `base_index REAL`, `current_index REAL`, `updated_at TEXT`. Seeded with the
  neutral index **100** for every registry category on first touch
  (`INSERT OR IGNORE`, so later registry additions seed themselves and existing
  rows are never touched).
- `market_snapshots` (`src/market.mjs`) — `(category, captured_at) PK` +
  `index_value REAL`. Minimal history support; nothing writes to it
  automatically.
- `resale_auctions` (`src/resale.mjs`) — `id TEXT PK`, `seller_id → users`,
  `inventory_id → inventory` (**unique per active listing** via partial unique
  index), `start_price INTEGER`, `current_bid INTEGER`, `current_bidder_id`,
  `status CHECK IN ('active','ended','cancelled')`, `started_at`/`ends_at`/
  `closed_at INTEGER` (epoch ms, matching the accounts tables), `winner_id`.
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

### News events

`src/news.mjs` — whole-document upsert (`saveNewsEvent`), validation, and
serialization. Public shape:

```js
{
  id, title, body,
  status: 'draft' | 'published' | 'archived',
  publishedAt,            // ISO string or null; defaults to now on first publish
  paletteIds: ['electronics'],           // validated against real palette/case ids
  marketEffects: [{ category: 'electronics', direction: 'up' | 'down', magnitude: null }],
  metadata: {},           // free-form object for future event types
  createdAt, updatedAt
}
```

`magnitude` is a **placeholder** (nullable positive number). The future
simulation will decide what direction/magnitude mean; validation only enforces
the structural shape so effects are never buried in prose. Helpers:
`getNewsEvent`, `listNewsEvents({ status, limit })`, `listPublishedNews`.

### Global market state

Global (one row per category, shared by all players). Read via
`marketState(dataDir)` → `{ updatedAt, categories: [{ category, name, nameDe,
baseIndex, currentIndex, updatedAt }] }`. Writes go through the deliberately
boring `setMarketIndex(dataDir, category, index, { now, snapshot })` and
`snapshotMarketState` / `marketHistory`. **No fluctuation, scheduling, or
supply/demand logic exists.** Default index is 100 everywhere.

### Resale auctions

`src/resale.mjs` — plain functions in the `database.mjs`/`cases.mjs` style
(not a class). Invariants enforced in transactions:

1. **No duplication.** A listing references the original `inventory` row and
   serializes the item by joining it at read time. Nothing is ever copied or
   minted.
2. **Single active listing per item**, enforced by a partial unique index
   (`WHERE status = 'active'`) plus an explicit pre-check.
3. **Locking.** `accounts.sell` / `accounts.sellAll` refuse (`item_listed`,
   409) any item with an active listing. `Accounts`' constructor creates the
   resale tables so the lock check always has its target.
4. **Ownership.** Only the owner can list/cancel; listing someone else's row
   is a 404 (no existence leak). A sold item (`sold_at` set) cannot be listed.
5. **Lazy deterministic close.** Any read/bid first closes due auctions:
   `status='ended'`, `winner_id=current_bidder_id`. No timers, no cron.
6. Bid rules: integer tokens, first bid ≥ `start_price`, later bids must beat
   `current_bid` by ≥ 1, seller cannot bid, bidder's current balance must
   cover the amount (advisory — **no escrow exists yet**).
7. Cancel is only possible while active **and** bid-free; it releases the
   item. An `ended` listing **with a winner** also blocks re-listing, so an
   item cannot be sold twice while settlement is still pending.

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
| `POST /api/account/admin/news` | Admin-only seed/update tool: `saveNewsEvent` body → `{ event }`. Placeholder tooling so news can be tested without DB access |

Listing serialization (camelCase, matching project payload conventions):
`{ id, sellerId, sellerUsername, inventoryId, item: { title, image, price,
rarity, marketCategory }, startPrice, currentBid, bidCount, status, startedAt,
endsAt, winnerId, closedAt, bids? }`.

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

- Palette generation from fictional seizure stories (today's cases are still
  category-filtered archive rotations).
- News-driven palette availability and automatic news generation.
- Market simulation of any kind (fluctuation, scheduling, supply/demand).
- NPC bidders and market-driven bidding behavior.
- Bidding UX, real-time updates (no websocket infrastructure exists).
- XP curves, levels, level-gated content (`users.xp` is a reserved column).
- Storage Wars and businesses (do not build).
- Auction settlement economics: **no escrow, no token movement, no item
  transfer** — see §7.

## 7. Extension points for the next implementation

1. **Mystery Palette generation** — replace/augment `caseCatalog()` in
   `cases.mjs` (or wrap it) and expose the result through
   `publicPaletteCatalog`. Palette definitions should become data (a
   `PaletteItemPool` per story with themed item filters similar to
   `matchesTheme`). Keep `case_rotations`-style snapshots so editions stay
   frozen per day, and keep the `revision` contract for client retries.
2. **News-driven palette availability** — `news_events.palette_ids` already
   references palette ids. A future `processNewsEvent` would flip palette
   availability (e.g. a `palette_availability` table or an availability field
   on palette definitions) when an event publishes. `createEconomyApi`'s
   palettes endpoint is the natural read surface. Nothing automatic runs
   today.
3. **Market simulation** — implement on top of `setMarketIndex` +
   `snapshotMarketState` (e.g. a scheduled job applying news effects and
   supply/demand drift). Effects stored on news events
   (`{ category, direction, magnitude }`) are the intended input; the
   semantic of `magnitude` is yours to define. Keep the market global: every
   function in `market.mjs` is per-dataDir, never per-user.
4. **NPC bidding** — `resale_bids.bidder_id` currently always references a
   real user. Options: pseudo-user rows in `users` (admin-flagged), or a
   nullable `bidder_id` + new `npc` columns. `placeBid` is the transactional
   pattern to copy. Decide escrow first (see below).
5. **Auction settlement (the big TODO)** — when an auction ends with a
   winner, someone must (a) move tokens (escrow at bid time vs. payment at
   settlement), (b) transfer the inventory row (`UPDATE inventory SET user_id
   = winner`) — never insert a copy, (c) award XP (`users.xp` is waiting), and
   (d) release/complete the listing. `closeDueListings` in `resale.mjs` is the
   hook where winner determination already happens; settlement should be a
   separate transactional step invoked by your scheduler after close. Note the
   guard: an ended-with-winner listing blocks re-listing precisely so
   settlement cannot race a resale.
6. **XP / levels** — write to `users.xp` from settlement and game rewards
   (`accounts.answer` is where token rewards land today). Design the curve
   later; expose via `accounts.profile` when needed.
7. **Storage Wars / businesses** — not started. The resale + market + palette
   foundations are the intended building blocks.

## 8. TODOs

- [ ] Escrow design for bids (current balance check is advisory only; a
      bidder can spend tokens after bidding).
- [ ] Settlement implementation (see §7.5) — until then, winners are recorded
      but nothing is paid or transferred.
- [ ] News authoring UI/admin page (the `admin/news` POST is API-only).
- [ ] Frontend pages for news/market/resales (data layer in `economy.js` is
      ready; no routes, no UI, no styles exist).
- [ ] Decide whether `Getränke` should split from `wine` (data-only change in
      `market.mjs`).
- [ ] Runtime wiring of `marketHistory`/snapshots into any UI or simulation.
- [ ] Optional: expose feature flags through `compose.yml` env passthrough
      when a system goes live.

## 9. Design decisions to reconsider before core mechanics

- **"Bidder pays at settlement, not at bid"**: there is no token hold. If you
  keep this, cap concurrent bids per user; if you escrow, `placeBid` needs a
  release path on outbid. This choice drives NPC design too.
- **Lazy close instead of a scheduler**: deterministic and test-friendly, but
  winners only exist once someone looks at the listing. A scheduler that
  closes + settles on a cadence will probably replace `closeDueListings`
  calls in reads.
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
