# JUSTIZGUESSR

A daily price-guessing game based on public listings from [justiz-auktion.de](https://www.justiz-auktion.de/), plus replayable random rounds drawn from the saved auction archive.

**Higher or Lower** compares two confirmed ended auctions. Guess whether the next final bid is higher or lower; ties count either way. A miss ends the streak, while clearing the deck wins the run. The best streak is stored separately on the device. `GET /api/higher-lower` returns a fixed deck of up to 20 distinct product families (19 comparisons), with four categories and at most one drinks lot in each five-lot block. Smaller archives produce shorter decks; fewer than five suitable varied lots returns `503 insufficient_variety`. Active listings and legacy final prices observed before the auction ended are excluded. Each new run is independently shuffled and does not consume daily or free-play rotation history.

The application serves the game and its JSON API from one lightweight Node process. Guests can play without an account. Registered players earn **J€ (Justiz€)** and collect digital auction items; accounts, sessions, rewarded game progress, inventories, auctions, daily sets, and the fetch queue persist in SQLite in the container's `/data` volume. Device-only game statistics remain separate for each account and for guests.

## Accounts, registration codes and cases

The interface defaults to **English**, with **Deutsch** available in the header. The choice is saved on the device and applies to navigation, games, authentication, inventory, shop, profile and admin pages. Auction titles and descriptions retain their original source language.

**Inventory** (`/inventory`), **Shop** (`/shop`) and **Profile** (`/profile`) are separate pages with reloadable URLs and browser back/forward support. Navigation stays visible to guests. Guests can browse the shop; opening cases requires login and sufficient J€. Inventory and Profile show a login notice to guests. **Log in / Register** opens only authentication (`/login` and `/register`).

Inventory and Profile show the account's **total value in euros**, calculated from the saved auction prices of all items currently in its inventory. Each collected copy counts once; sold items stop counting immediately. Justiz€ has no real-euro conversion and is excluded. This is a collection value, not a cash balance or payout amount.

The **Friends** section on Profile lets you send a friend request using an exact username (case-insensitive). The recipient can accept or decline; the sender can cancel a pending request, and either friend can remove the friendship. Accepted friends see each other's inventory value, item count, and today's server-recorded Daily result out of 5,000 points. Unfinished games show progress and unplayed games are labelled separately; scores reset with the UTC date. Pending requests reveal only usernames and request direction. Use **Refresh** to fetch current friend statistics. Friendships persist in SQLite, with up to 100 friends and pending requests per account.

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in your Compose `.env` before starting the service. Usernames use 3–32 ASCII letters, numbers, underscores or hyphens (case-insensitive); passwords require 12–128 characters. Both admin variables must be supplied together. With both omitted, guest play stays available, but there is no initial admin to issue registration codes.

Sign in through **Log in / Register**, then open **Admin** (`/admin`). Admins can generate 1–50 single-use registration codes at a time, see whether they have been used, and revoke unused codes. Copy new codes immediately: their full values are shown only after generation, and only hashes are stored. Registration requires a username, password and valid code; no email or third-party login is used.

The Admin page also offers J€ grants. An admin can select one existing user and add a whole amount from J€ 1 to J€ 1,000,000 to that account, or credit every account that exists at submission time, including admin accounts. Each grant is a single atomic transaction with a saved receipt and retry protection. Future registrations receive their normal starting balance but never inherit previous bulk grants. The page shows current user balances, the bulk recipient count, and the latest 20 receipts of each kind. Grants do not consume or reset daily game rewards.

**Market controls** in Admin provide percentage buttons for every category, including +5%, +10% and −80%. Changes compound against current category prices and persist through market updates and restarts. **Reset** removes that category's manual adjustment; automatic trends and news continue underneath. The current index, total manual adjustment and latest 20 changes are shown. Changes affect shared market valuations, including inventory estimates, business stock pricing and new buyer valuations. Existing bids and frozen auction limits retain their original values. Mutations are atomic and protected against duplicate retries.

Each player row on the Admin page also has **Reset password**. It replaces the player's password with a 16-character temporary password that is shown once, signs the player out everywhere, and cannot target admin accounts. The temporary password works for exactly one login, and that session can do nothing but set a new password: every other page and API action waits until the new password is saved. If the one login is not completed into a new password, the player needs another reset from an admin.

On restart, the configured admin is created if absent. Changing its configured password updates that admin and invalidates its sessions. An existing regular user cannot be promoted by choosing its name in the environment. Changing the configured username creates a separate admin; existing admins are retained. Keep credentials out of source control. Passwords use salted scrypt hashes, sessions are stored as hashes and expire after 30 days, and authentication is rate-limited. Compose enables Secure, HttpOnly, SameSite=Strict cookies for the HTTPS tunnel. Set `COOKIE_SECURE=false` only when testing over local HTTP; never use it for the public deployment.

Each newly created account starts with **J€1,000**. Daily and Higher or Lower have separate rewards per **UTC day**:

- Completing all five Daily rounds pays **J€200–350**: J€200 for completion plus a score bonus up to J€150. It also grants one tradable, sealed case. Higher scores improve its tier odds.
- Free Daily cases use archive finds worth at most J€1,000 at their saved reference price, with affordable starter items filling thin pools. Rarity is relative to this pool. Paid cases and palettes retain the full archive's expensive finds.
- Higher or Lower pays **J€25 per correct comparison** once a run reaches a streak of 3, capped at **J€250 for the day**. A better completed run pays only the difference from the amount already earned. Failed attempts and repeats cannot consume Daily income or pay twice.
- Reward limits reset at **00:00 UTC**. Progress resumes across devices; old runs cannot pay after the reset.

Reward schedules freeze when a run starts. Existing paid receipts and unfinished runs retain their saved rates through upgrades.

The **Case Store** at `/shop` is always available alongside auctions. Buy **Lost Property**, **Evidence Locker**, **Seized Treasure**, **Vault**, or **Collector’s Cache** sealed cases directly with J€. Every case can draw all five rarities across market categories; higher prices shift the odds toward rarer finds. Even the most expensive case can contain a common item. The store shows prices, drop percentages, and possible contents; purchases add unopened, tradable cases to inventory. Open them whenever you like using the existing case reveal. All five cases remain stocked: a thin or empty archive uses the packaged starter edition. Purchases freeze the sealed reward and reference value, so later market movements and edition rotations cannot change the contents. Prices target the existing 82% paid-case expected return using the larger of base and live market expectations, with at least J€1 between successive cases after rounding. Sealed cases retain a reference value of 80% of expected contents, so a purchase can lose value. Stale quotes are rejected before charging, and saved request receipts prevent retries from buying or charging twice.

When palette auctions are disabled, the shop also retains the legacy themed instant openings: **Seized Goods**, **Contraband**, **Car**, **Wine**, **Electronics**, **Tool**, **Jewellery**, and **Collector**. Themed cases draw only from their category. Each opening saves one digital collectible to inventory before playing the rarity reel. J€ cannot be bought with real money, transferred, or redeemed for cash; collectibles do not confer ownership of real auction lots.

Case contents have a **daily edition**, refreshing at **00:00 UTC** with the Daily game. A SQLite snapshot fixes the contents across refreshes, archive updates and restarts; purchase quotes follow the live market. Newly collected auction stock enters the next edition. Definitions or economy changes invalidate the snapshot's configuration key; client catalog revisions prevent charging an outdated offer. Snapshots are retained for 30 days, while collected items retain their own permanent value records.

Collectible resale values follow their auction values directly: **one euro of auction value becomes J€ 1**, rounded to whole J€ with a minimum of J€ 1. This applies to existing unsold collectibles as well as new finds. Each case price is calculated from the probability-weighted average resale value of that edition's contents and targets a 82% expected return at reference market value, rounded up to whole J€. Prices use the larger of base and current market expectations, preventing both hot-market resale arbitrage and cheap instant-selling loops in a cold market. Actual auction proceeds depend on bids.

Rarity is relative to each case's stock: families rank by `log10(price + 1) + 0.5 / sqrt(familySize)`, using the archived final price where available, otherwise the current bid. The five rank bands each reserve one distinct family and divide the rest in proportions 45/25/17/10/3. A deterministic rotating window selects up to 24 families across these bands, swapping items where spare stock exists. Duplicate listings count as one family and cannot increase draw odds. Small pools rotate fewer items; legacy themed cases with fewer than five distinct eligible families show **Restocking** instead of substituting another category or redistributing the odds.

For legacy themed instant openings, legendary drops occur **0.1%** of the time. The common-to-legendary ticket weights remain 5000/3500/1200/290/10. Legacy themed draw probabilities and weights stay out of the public catalog response and the interface; case prices, contents and euro-based resale values remain visible. Collected items retain their original rarity and euro value as editions rotate, and their resale value follows that saved euro value. Previously purchased sealed cases retain their names, values, and prepared rewards; request receipts still replay safely.

The server chooses draws using cryptographic randomness. SQLite transactions make charging and item creation atomic; request IDs make case retries safe, and repeated sales or reward submissions cannot credit J€ twice. Logged-in Higher or Lower keeps future prices out of its game response and validates each comparison on the server. Guest endpoints remain public practice data; this is a casual game, not a competitive anti-cheat system. Back up the full `/data` volume, using SQLite's backup API or stopping the container before copying it.

## Auction economy foundation (experimental)

The playable auction economy is enabled by default: category markets, periodic Mystery Palette auctions, player resale listings, businesses, and the palette catalog. Auctions you bid on stay visible after they finish: won Mystery Palettes remain under **My bids** until you reveal their contents, and every other finished lot is reachable behind a small **Archived auctions** button on the auction pages. News is dormant and is not exposed to players. No feature environment variables are needed. Set any of `FEATURE_MARKET`, `FEATURE_RESALES`, `FEATURE_PALETTES`, `FEATURE_PALETTE_AUCTIONS`, or `FEATURE_BUSINESSES` to `false` to disable that feature independently. See [the economy handoff](docs/auction-economy-foundation.md) for API contracts and operations.

Every accepted bid with less than 10 seconds remaining resets the auction deadline to 10 seconds after that bid. Further late bids reset it again. This applies to player resale, stock/case supply and Mystery Palette auctions, including human and NPC bids, private maximum increases and offers beaten by an existing maximum. Rejected bids leave deadlines unchanged, and ended auctions stay closed. Pages refresh every second near a deadline so other bidders can see extensions promptly.

Businesses are available at `/businesses`. Each player can own up to three stores; existing larger portfolios remain manageable but cannot buy more. Wine, toy, electronics, and car shops each have four sizes, chosen in the Buy store dialog. Street pop-ups, small, medium, and large shops hold 10, 25, 60, and 150 items respectively; car dealerships hold 1, 3, 8, and 20 vehicles. Base prices by size are J€1,000, J€4,000, J€15,000, and J€50,000; electronics stores cost 1.2 times and car dealerships 2.5 times those amounts. Larger locations draw more visitors. Items must match the shop type. NPC direct auctions replenish eight bulk lots every two hours, and winning lots settle into individual inventory units. Bids reserve J€ immediately; outbid players receive exact refunds. Store customers are simulated hourly on the server, including elapsed hours while the site is offline. New stores start with a configurable 20% margin over market value. Higher margins reduce turnover, and expensive items need suitable customers. Existing stores keep their chosen margins, and each sale credits the owner once. Wholesale reserves are 85% of live market value and freeze when the lot is created. Unsold stock can be removed from a store and used elsewhere.

**Store events** give each stocked store a 25% event chance per 24-hour check, first eligible 24 hours after purchase. Checks run when the owner visits `/stores` or `/businesses`; offline time produces one check, with no accumulated rolls. Bombings and professional heists clear all shelf stock; floods and goose rampages destroy part of it; rich buyers and collectors pay real shelf prices (collectors pay 150%); tax raids deduct up to J€100; mysterious donations grant J€200. A goose guard has a 50% chance to stop the full-stock heist. Store buildings and personal backpack items survive. Results appear in an EN/DE modal until acknowledged and remain in the notification inbox. Refreshing or retrying cannot reroll or apply an event twice.

**Visit stores** (`/stores`) is the player store directory, with search, category filters and shareable storefront URLs (`/stores?shop=ID`). Guests can browse; signed-in players can buy real shelf items directly, tip J€5/10/25, applaud, ring the bell or tell a terrible joke. Reactions and visits count once per player/store/UTC day. Owners can set a name and tagline from Businesses. Verified buyers can leave and edit one 1–5 star review per store. Purchases pay the owner and transfer the existing inventory item atomically; the buyer can then collect, auction or restock it. Player and NPC sales retain a separate history.

**Mischief** lets players try to steal one shelf item. The game shows six arrows to remember and repeat, followed by a server-side chance roll. The fee and odds are shown before starting; the owner keeps the fee on every outcome, including abandonment. Fees are 10% of market value, rounded up with a J€5 minimum. Escape chance falls with item value (5–35%); a permanent **goose guard** costs the owner J€250 and halves the chance (2% minimum). Attempts last 65 seconds, with a 30-minute player cooldown and a 5-minute store cooldown. Pending games survive navigation and restarts; completed games cannot reroll. Items can sell while a game is in progress, and an unavailable item ends the attempt without transferring anything. Purchases, tips, guard payments and attempt fees have saved receipts and retry protection. Store interactions notify the owner through the inbox.

Palette auctions start at **70% of the live expected value of three draws**. NPC palette ceilings stay below expected value; ordinary NPC resale ceilings are 60–96% of current market estimates, with preferred collectors allowed up to 105%. Bulk resale lots receive a demand discount. Both auction types enforce value-scaled raises for players and NPCs and preserve private proxy ceilings, escrow refunds, and settlement idempotency. Tradable cases have a frozen reference value of 80% of expected contents; their price does not reveal the sealed winner, and opening can lose value.

See [the balance rationale and migration rules](docs/economy-balance.md) and [the reproducible stress report](docs/economy-balance-report.md). Run `node scripts/economy-report.mjs --stress` or pass an archive JSON path to audit other stock.

## Run with Docker

```bash
docker run --rm \
  --user 65532:65532 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 100 \
  --memory 256m \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  -p 127.0.0.1:3000:3000 \
  -v justizguessr-data:/data \
  your-user/justizguessr:latest
```

The `/data` volume preserves `justizguessr.sqlite`, cached listing images, and any legacy JSON files. On first startup, existing `auctions.json`, `daily-games.json`, and `fetch-queue.json` data is imported into SQLite without deleting the source files. Those JSON files are backup-only after a successful import.

The service discovers listings every six hours and processes one listing page, auction page, start-date page, or image at a time. Queue state and retry timing are committed after every step. HTTP 429/5xx responses use an adaptive backoff, and completed auctions with a stored final price are not fetched again. Each fetched auction updates one database row instead of rewriting the complete archive.

A daily game's five auctions and scoring prices are immutable. The database enforces that an auction ID can belong to only one daily game, and daily-use history is retained indefinitely. New daily games and free-play rounds use the same variety rules:

- At least four product categories in five lots, at most two lots in any category, and at most one drinks lot (wine, champagne, spirits, etc.). Titles and product descriptions are classified at selection time, so older records tagged “Sonstiges” are covered too.
- One representative per likely duplicate product family. Matching uses normalized product names, reordered words, model numbers, text similarity, supporting descriptions, and shared source images. Different photos or auction IDs do not bypass text matching. This is a conservative heuristic, not visual image recognition; genuinely different names with no supporting metadata may still evade it.
- Daily games exclude families containing a previously used auction. Unused archived lots can supply missing categories. Existing published daily sets are never regenerated when selection rules change.
- Free play prefers least-used product families within the category constraints. Usage is combined across duplicate listings, so a fresh duplicate ID cannot reset rotation. Scarce categories may repeat before a large wine pool is exhausted; variety takes priority over global exhaustion.

If the archive cannot satisfy those limits, selection fails rather than silently allowing a repetitive game. Source listings remain in the archive; grouping only affects game selection.


Optional environment variables:

- `PORT` — HTTP port inside the container, default `3000`
- `DATA_DIR` — persistent data directory, default `/data`
- `DISCOVERY_INTERVAL_HOURS` — interval for adding listing pages to the persistent queue, default `6` (the legacy `REFRESH_INTERVAL_HOURS` name remains supported)
- `COLLECT_MAX_PAGES` — maximum listing-result pages included in a discovery sweep, default `250`
- `FETCH_MIN_INTERVAL_MS` — fastest allowed fetch pace, default `250`
- `FETCH_INITIAL_INTERVAL_MS` — starting fetch interval, default `750`
- `FETCH_MAX_INTERVAL_MS` — maximum adaptive interval after failures, default `120000`
- `FETCH_IDLE_POLL_MS` — idle queue polling interval, default `30000`

## Run behind Cloudflare Tunnel

`compose.yml` runs the distroless app as UID/GID `65532`, drops every Linux capability, enables `no-new-privileges`, uses a read-only root filesystem, and exposes port 3000 only to the shared Docker network. It does not publish a host port.

Compose trusts Cloudflare's `CF-Connecting-IP` header for per-visitor rate limits. Keep the app reachable only through the tunnel when `TRUST_CLOUDFLARE_IP=true`; direct clients could otherwise forge that header. Other deployments leave the setting off and use the socket IP.

The final application image contains no shell or package manager. CI publishes a software bill of materials and maximum-mode provenance alongside pushed images. You can pin `JUSTIZGUESSR_TAG` and `CLOUDFLARED_TAG` to immutable versions for controlled upgrades.

Set `DOCKERHUB_USERNAME` and `CLOUDFLARE_TUNNEL_TOKEN`, then run:

```bash
docker compose up -d
```

In the remotely managed Cloudflare Tunnel, route the public hostname to:

```text
http://justizguessr:3000
```

The application still has outbound HTTPS access so it can refresh Justiz-Auktion data. Only `/data` is writable; use the named volume or provide a bind mount owned by UID/GID `65532`.

## DockerHub publishing

The `ci` workflow builds pull requests without publishing. Pushes to `main` publish `latest`, the package version, and the commit SHA. Pushes to `dev` publish `dev` and `dev-<sha>`.

Configure these GitHub Actions repository variables:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

## Local development

```bash
npm ci
npm test
npm start
```

Local execution requires Node.js 22.13 or newer for the built-in SQLite module.

The game is then available at `http://localhost:3000`. Container health can be checked at `GET /healthz`, while `GET /stats` returns non-sensitive collector and queue totals as plain text. The current frozen daily set is served from `GET /api/daily`, and a fresh five-auction free-play set is served from `GET /api/random`.

Known auctions refresh independently of listing discovery: every 6 hours when more than a day remains, hourly within 24 hours, every 15 minutes within 6 hours, and every 5 minutes within the last hour. Once the stored end time passes, a direct detail fetch takes priority over discovery, including for auctions no longer listed in search. These are target intervals subject to the shared request throttle and retry backoff. Updated end times extend monitoring. Only a successful observation after the returned end time establishes a final price; simply passing the deadline never finalizes a cached bid. Confirmed final records stop polling, while older records finalized before their last observation reached the end time are rechecked. Unavailable pages retain retry backoff, with a 24-hour cooldown after repeated failures. Published daily games keep their original answers; refreshed prices feed subsequent selections.
