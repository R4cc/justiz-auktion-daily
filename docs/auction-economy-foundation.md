# Auction Economy — Technical Handoff

Status: **first playable auction economy**. The existing transactional auction,
market, edition and progression domains are retained. All five economy flags
default on; the Compose file passes them through explicitly. Explicit false values disable individual systems; an unset or empty variable enables it.

## Player loop and routes

Daily → J€ and 150 XP → sealed Mystery Palette auction → three fixed rewards
→ inventory → player resale marketplace → human/NPC buyers → seller J€ and XP.

Player-facing currency is **J€ (Justiz€)**. Existing persisted and API fields such
as `tokens` and `estimatedValueTokens` retain their names for data compatibility;
they are implementation details and are never shown as the currency name.
Persisted market effects influence current item estimates and the demand of
newly initialized NPC buyers. Automatic news publication is dormant.

- `/auctions`: active lots, candidate pools, level/affordability information,
  bidding, and **My bids** (active and recent ended participation).
- `/marketplace`: public listings, item valuation, bidding/history and **My
  listings**, including cancellation before any bids and final sale information.
- `/inventory`: list individual items, starting price and 5/15/60 minute duration
  selection (default 15 minutes). Listed items are marked; matching copies remain
  grouped and the next available copy can be listed.
- `/market`: all category indexes, deviation from neutral 100, update timestamps,
  category selection and native SVG hourly-history chart.
- `/profile`: XP, level, progress and remaining XP; level 20 is terminal.
- `/shop`: compatibility alias to Auctions when primary auctions are enabled;
  otherwise the original case shop. Daily gameplay is otherwise unchanged.

The authored frontend is vanilla JS in `dist/`. `economy.js` owns data helpers;
`economy-ui.js` owns new views and dialogs; `account.js` owns authentication,
routing, inventory and the shared `spinCaseReel` animation. Existing cards,
Manrope/DM Mono fonts, paper/green palette and rarity presentation are reused.
Navigation scrolls horizontally on narrow screens. Copy is EN/DE. Dialogs
restore focus, polling preserves bid form input, and countdowns use aria-live=off.

Auctions and marketplace poll every 12 seconds while the document is visible.
Navigation cancels timers and invalidates pending responses. Requests are guarded
by visit, request and account identity. Market uses the same visibility-aware
refresh cadence. No WebSockets or chart dependencies.

## Flags and compatibility

| Flag | Effect |
| --- | --- |
| `FEATURE_PALETTE_AUCTIONS` | Primary reads, participation history, bid/reveal/admin-create, Auctions UI, automatic supply and settlement |
| `FEATURE_RESALES` | Resale routes/UI, listing cap, NPC runtime, resale settlement, instant-sell rejection |
| `FEATURE_MARKET` | Public market/history routes and Market UI |
| `FEATURE_PALETTES` | Persisted palette catalog HTTP route only |

News is hard-disabled in normal feature discovery and runtime configuration;
its backend tables and domain code remain dormant. Primary supply can persist/use
editions without exposing the palette catalog endpoint. Resales use global
valuations without enabling the Market page.

With resales enabled, `Accounts.sell` and `sellAll` reject with
`instant_sell_disabled` (409), including HTTP callers. Inventory and legacy case
result dialogs omit instant-sell actions. With resales disabled, old sell paths
and locking rules remain intact. Legacy case HTTP operations remain available
for compatibility; the enabled primary experience routes players to auctions.
Daily XP earning is independent of feature flags; J€ reward selection/rates
and Higher-or-Lower gameplay are unchanged.

## Runtime and automatic primary supply

`src/economy-runtime.mjs` exports `tickEconomy(dataDir, { now, flags })`,
`supplyPaletteAuctions` and `startEconomyRuntime`. Accounts/schema initialization
precedes runtime startup in `server.mjs`.

- First tick after 1 second, then every 30 seconds via an unref'ed timeout.
- Shutdown clears the timer. All flags off creates no timer and performs no work.
- Each enabled system is isolated: primary and resale failures cannot block the
  other settlement branch. Failures are reported without hidden rewards.
- Primary and resale sweeps run before supply/NPC bidding. Existing lazy
  settlement remains as a correctness fallback for reads.
- Primary sweep: bounded 100 by default (maximum 1000), independent transaction
  per lot; corrupt domain state is reported and other lots can settle.
- Market drift (under `FEATURE_MARKET`): with news dormant, indexes would sit
  at neutral forever. Every two hours each category moves to a fresh random
  regime of ±25 index points (±25%) with a squared draw — small moves are
  common, full swings rare. A regime is an ordinary market effect that decays
  back toward neutral over one effect duration and is replaced on the next
  window; the first drift also performs the one-time simulation activation.
- Palette NPC buyers (under `FEATURE_RESALES`): every five minutes each active
  lot gets at most one deterministic consideration from a rotating cohort of
  the twelve NPC buyers. Their ceiling is the market-adjusted expected bundle
  value times a persona multiplier, so a hot market (index above 100) lets
  NPCs chase a lot past its frozen reserve and a cold market silences them.
  Bids use the identical escrow/refund accounting as human bids through a
  trusted runtime path; NPC accounts stay rejected on every player-facing
  surface.

Primary supply keeps **around ten concurrent lots on the board**. It creates one
global lot per six-minute UTC bucket (one hour divided by the target of ten), so
lot ends stay evenly staggered — every lot ends one full hour after its bucket,
never after its creation moment. It loads/persists current base editions and
considers only available frozen editions whose window fits the complete auction.
A bucket-derived request ID prevents duplicates across ticks, restarts and
concurrent runtimes; the current bucket and the previous nine are retried
idempotently on every tick (a fresh or restarted system fills the whole board at
once), and older buckets are never backfilled. At most ten automatically supplied
palettes may be active at once, and at most two of them per edition.

Every creation calls `createPaletteAuction`. A trusted `automaticSupply` option
checks the global target and the per-edition concurrency cap under that domain's
write transaction, preventing parallel schedulers from overfilling; a saturated
edition is skipped so the window can fall through to another theme. Manual admin
creation retains its existing behavior. Request ID is SHA-256 of
`primary:<editionId>:<UTC-hour>`.
The unique creation receipt prevents restart rerolls and repeated generation in
the same slot. The next UTC-hour slot may replace an expired lot. Availability,
spread validation, frozen reserve formula, weights, duration and 3 draws remain
owned by the existing domain. Rewards still use cryptographic randomness.

Each new lot also selects one story from a 100-case bilingual pool and freezes
it in the public snapshot. The pool contains 90 general cases using invented
people, places and organisations, plus 10 clearly labelled Austrian parody
cases. Every theme has nine general cases and one parody, keeping the parody
share at ten percent for category-specific palettes too. Selection is a stable
hash of request ID, palette ID and definition version, so a creation replay or
restart keeps the exact story. Bidder cameo names are never used in event copy.

## Primary history and winner reveal

`paletteAuctionsByUser(dataDir, user, { now, limit, offset })` reads auctions with
at least one bid by that user. It returns public auction fields plus
`highestBid`, `leading`, `led`, `won`, `revealAvailable`. Every accepted bid was
at one point leading, so `led` is true for every participation row. Active lots
sort first; recent ended lots follow. Default 50, maximum 100, bounded integer
pagination. The frontend displays up to 100 recent entries. Due participating
lots settle before serialization, allowing discovery without a background tick.

The response has **no hidden reward data or reserved inventory IDs**.
`getPaletteAuctionRewards` remains the only explicit reveal endpoint; only the
recorded winner can retrieve the fixed snapshots after settlement. Admin is not
a bypass. Settlement consumes the winning escrow and inserts exactly three
reserved inventory rows atomically. Reads/retries never duplicate rewards.

The winner reveals rewards sequentially through the shared legacy case reel.
Only rarity cards appear during each spin. The server result is already fixed;
client randomness decorates the reel and never selects an economic outcome.
Reduced motion uses the existing timed stepped presentation. Closing/navigating
invalidates the sequence. Reveal can be replayed safely. The summary shows three
items, total historical euro value, winning bid, and a rough J€ difference
using frozen item values. It does not promise a resale price.

## XP and schema version 9

Schema additions are idempotent, additive and lazy like the existing domains:

- `users.npc INTEGER NOT NULL DEFAULT 0`: existing rows remain human.
- `xp_events`: `user_id`, `source_type` (`daily` or `resale`), `source_id`,
  positive integer `amount`, `created_at`; primary key
  `(user_id, source_type, source_id)`.
- `resale_npc_interest`: `(auction_id, npc_id)` primary key, `max_bid`,
  `next_bid_at`, `created_at`, nullable `last_bid_at`, integer `active`;
  indexed by `(active, next_bid_at)`.
- `app_state['world-news-bucket:<bucket>']`: durable skipped-bucket receipt.
  Successful buckets use existing news event/publication receipts.
- `PRAGMA user_version` advances to 9, never lowers a newer version.

`src/xp.mjs` owns only the small ledger and sale formula. Receipt insertion and
XP increment run inside the same economic transaction as Daily completion or
resale settlement. Failed transactions roll all changes back.

- Daily completion: **150 XP**, source ID = account game/run ID. Awarded even if
  Higher-or-Lower already claimed that day's J€ reward. Completion retries,
  reloads and restarts cannot repeat it.
- Successful resale: seller gets
  `clamp(10, 200, round(20 * log2(1 + finalSalePrice / 100)))`.
  Human and NPC winning bids use exactly the same settlement path.
- No XP for bids, primary wins/reveals, listings, cancellations, unsold lots,
  legacy instant sells or Higher-or-Lower. No scan/backfill of old completed
  games or settled auctions.
- Level L remains `100 * (L - 1)^2` XP, capped at level 20. Profile reads fresh
  `users.xp` via `progressionForXp`; no duplicated level arithmetic.

## NPC buyers and resale accounting

`src/npc-roster.mjs` defines exactly 800 persistent buyers with stable IDs and
unique display names: 640 German/Austrian profiles (80%) and 160 wider
European/English profiles. The roster includes 12 legacy identities and ten
playful named characters alongside deterministic generated names. Every profile
has preferred categories, willingness, aggressiveness, cheapness, patience,
collector status and timing. Registry names contain spaces, outside the
human-registration username alphabet. Each account is seeded once with
**J€ 1,000,000,000**, representing external consumer demand. Repeated seeds
insert only missing identities and never refill balances or reset inventory.

NPCs cannot log in, receive sessions, bid on primary palettes, or create resale
listings. Session lookup independently excludes them. Friends, human leaderboards,
admin player-management lists and playerCount exclude them. Both global and
individual admin J€ grants exclude them. Their names appear naturally in
resale bid history, without AI badges. Won items stay in NPC inventory and leave
the human resale market.

On the first runtime observation of a listing, a deterministic 16-person cohort
is selected from the full roster. Its interest decisions are persisted in one
transaction, including inactive decisions. The existing
`estimatedValueTokens(item, currentIndexes)` supplies value; preference,
aggressiveness, collector status and a deterministic ±0.05 variation bound ordinary WTP to
0.70–1.15 times that estimate. One collector can reach 1.25 for preferred items.
Interest probability uses preference times `(index / 100)^3`, bounded 0.05–0.92.
Both interest probability and WTP therefore respond materially to market indexes.
Once initialized, max_bid and interest remain frozen through market changes,
page refreshes and restarts. New listings reflect newer market state.

Scheduled buyers wait according to patience and aggressiveness, then either add
the minimum J€ 1 increment according to cheapness or make a bounded jump
toward WTP according to aggressiveness. They react when outbid below WTP and
shorten their personality-based delay in the last two minutes. No NPC jumps
straight to WTP. A database-backed guard inside `placeBid`
allows at most one NPC bid per listing per 30 seconds, including replayed ticks
and parallel runtimes. At most 200 unseen listings initialize and 1000 due
interest rows are considered per tick. All actual bids use `placeBid`:
full escrow debit, exact outbid refund, leader raises pay the difference.
Settlement transfers the existing inventory row and pays the seller once.
No parallel NPC currency/accounting system or recurring mint/refill exists.

Resale domain enforces **5 active listings per human** after closing due
listings; cancelled, ended and settled lots do not count. Sixth listing returns
`listing_limit` (409). Backend duration support remains 1 minute–30 days.

## Market contracts and dormant news backend

Global market is computed from persisted news effects. Each signed effect
contributes `delta * clamp(1 - elapsed / 72h, 0, 1)`. Index is
`clamp(100 + sum(contributions), 70, 130)`. Absolute active contribution budget
is 30/category; opposing effects consume the same budget. Hourly history is
reconstructed from effects, bounded to 30 days/720 boundaries. Legacy publication
receipts remain inert and are never replayed as new effects.

`marketIndexes(db, now)` is a transaction-safe read helper; inventory/resale/NPC
serialization uses `estimatedValueTokens`. Inventory includes the estimate when
market or resales are enabled, and `listed` for current item locks. Listings
include `estimatedValueTokens` and `currentBidderId`; detail bid history includes
public usernames. Item price, sellValue and frozen reward JSON are never updated
for market valuation. Historical auction values and current J€ estimates have
separate labels in the UI.

`src/world-news.mjs` retains 10 predefined bilingual scenarios for possible
future use:
electronics seizure, dealer seizure, wine-tax seizure, chip shortage, poor wine
harvest, collector trend, workshop clearance, cycling festival, jewellery sale
and book festival. No external service or LLM is called.

The dormant implementation supports one event per **12-hour UTC bucket**. Deterministic selection starts at
bucket modulo scenario count, then tries alternatives in stable order if budgets
are exhausted. `saveNewsEvent` remains the publication authority and owns all
budget checks, market effects, receipts and frozen event editions. Magnitudes
are 5–9 points. Associated event editions last 48 hours. Durable IDs prevent
republication across restart. It is not called by the normal runtime, and no News
page or normal News feature flag is exposed.

## HTTP and data helpers

New routes:

- `GET /api/features` → `{features: {news, market, resales, palettes, paletteAuctions}}`.
  Public boolean allowlist only; no environment or secrets.
- `GET /api/account/palette-auctions?limit=50&offset=0` → `{auctions}`;
  authenticated and primary-auction flag gated.

Existing routes reused:

- `/api/palette-auctions[/:id]`, account `/palette-auctions/bid`,
  `/palette-auctions/:id/rewards`, admin `/palette-auctions`.
- `/api/resales[/:id]`, account `/resale/listings`, `/resale/bid`, `/resale/cancel`.
- `/api/market`, `/api/market/:category/history`, `/api/palettes`.
- Account `/me`, `/inventory`, Daily start/answer, legacy cases/sells.

Authenticated mutations retain the existing CSRF header/session handling.
`window.justizEconomy` delegates mutations to `accountApi`; UI errors use readable
EN/DE copy. Public primary serialization is still an explicit allowlist.

## Validation and remaining scope

`npm test` and `npm run typecheck` are required. The latter is the repository's
JavaScript syntax/JSON check, not a TypeScript type-analysis build.

Implementation validation: **191/191 tests pass** (25 new tests); typecheck
passes for **54 JavaScript files** and project JSON. `git diff --check` passes.

Coverage added in `test/economy-playable.test.mjs`: supply/event priority/window
eligibility/restart, My bids secrecy/discovery, settlement, Daily XP and rollback,
resale XP boundaries/idempotency, listing cap, instant-sell gating, immutable value
serialization, NPC visibility/session isolation, funding persistence, market WTP,
interest persistence/timing, escrow/refunds/NPC wins/human wins, news exact-once,
budget fallback/skip and runtime flag/timer isolation. API tests cover the new
history and feature surfaces and both instant-sell paths. Existing case animation
tests exercise the extracted shared reel including reduced-motion and navigation.
Frontend helper/sequence contracts are covered in `test/economy-ui.test.mjs`.

Browser validation uses a temporary local SQLite fixture, separate from live
player data. It covers mobile/desktop layout, My bids → sequential reveal →
inventory, listing creation, primary bidding, market, EN/DE and profile.

Intentional limits: recent history is bounded, supply needs sufficient archived
stock and windows, persisted NPC valuations do not track later market changes on that same
listing, and polling means updates can lag one interval. No production rollout
or sustained-load benchmark is part of this implementation.

Future work remains: **Storage Wars; businesses; storage, vehicles and logistics;
more sophisticated economy simulation if desired; optional real-time transport/
WebSockets if later scale justifies it.** No fees, crafting, insurance,
restoration, direct trades, real-money or premium-currency mechanics were added.

## Player-facing UI update

The economy pages connect market movement, palette wins, inventory and resale.
Listing an item opens
My listings immediately. Winners receive a sealed-palette introduction before the
existing sequential reel. Market history includes visible sample points and a
readable table; current indexes distinguish above/below normal in text.

## Economy reset

The admin page includes an explicit, phrase-confirmed economy reset. It runs in
one database transaction and restores every human account to J€ 1,000 and
0 XP while deleting inventories, account game runs and rewards, case-opening
receipts, J€ grant history, XP receipts, resale auctions and primary palette
auctions. Runtime-owned NPC accounts are removed and recreated normally.

Authentication and social identity are outside the reset boundary: user ids,
usernames, password hashes, active session tokens, registration codes, bans,
admin roles and friendships remain unchanged. News, market history, palette
editions, case rotations and the source auction archive are also retained. Each
completed reset writes a small audit row shown on the admin page.
