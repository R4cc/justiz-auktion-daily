# JUSTIZGUESSR

A daily price-guessing game based on public listings from [justiz-auktion.de](https://www.justiz-auktion.de/), plus replayable random rounds drawn from the saved auction archive.

**Higher or Lower** compares two confirmed ended auctions. Guess whether the next final bid is higher or lower; ties count either way. A miss ends the streak, while clearing the deck wins the run. The best streak is stored separately on the device. `GET /api/higher-lower` returns a fixed deck of up to 20 distinct product families (19 comparisons), with four categories and at most one drinks lot in each five-lot block. Smaller archives produce shorter decks; fewer than five suitable varied lots returns `503 insufficient_variety`. Active listings and legacy final prices observed before the auction ended are excluded. Each new run is independently shuffled and does not consume daily or free-play rotation history.

The application serves the game and its JSON API from one lightweight Node process. Guests can play without an account. Registered players earn tokens and collect digital auction items; accounts, sessions, rewarded game progress, inventories, auctions, daily sets, and the fetch queue persist in SQLite in the container's `/data` volume. Device-only game statistics remain separate for each account and for guests.

## Accounts, registration codes and cases

The interface defaults to **English**, with **Deutsch** available in the header. The choice is saved on the device and applies to navigation, games, authentication, inventory, shop, profile and admin pages. Auction titles and descriptions retain their original source language.

**Inventory** (`/inventory`), **Shop** (`/shop`) and **Profile** (`/profile`) are separate pages with reloadable URLs and browser back/forward support. Navigation stays visible to guests. Guests can browse the shop; opening cases requires login and sufficient tokens. Inventory and Profile show a login notice to guests. **Log in / Register** opens only authentication (`/login` and `/register`).

Inventory and Profile show the account's **total value in euros**, calculated from the saved auction prices of all items currently in its inventory. Each collected copy counts once; sold items stop counting immediately. Tokens have no euro conversion and are excluded. This is a collection value, not a cash balance or payout amount.

The **Friends** section on Profile lets you send a friend request using an exact username (case-insensitive). The recipient can accept or decline; the sender can cancel a pending request, and either friend can remove the friendship. Accepted friends see each other's inventory value, item count, and today's server-recorded Daily result out of 5,000 points. Unfinished games show progress and unplayed games are labelled separately; scores reset with the UTC date. Pending requests reveal only usernames and request direction. Use **Refresh** to fetch current friend statistics. Friendships persist in SQLite, with up to 100 friends and pending requests per account.

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in your Compose `.env` before starting the service. Usernames use 3–32 ASCII letters, numbers, underscores or hyphens (case-insensitive); passwords require 12–128 characters. Both admin variables must be supplied together. With both omitted, guest play stays available, but there is no initial admin to issue registration codes.

Sign in through **Log in / Register**, then open **Admin** (`/admin`). Admins can generate 1–50 single-use registration codes at a time, see whether they have been used, and revoke unused codes. Copy new codes immediately: their full values are shown only after generation, and only hashes are stored. Registration requires a username, password and valid code; no email or third-party login is used.

The Admin page also offers **Give players tokens**: enter a whole amount from 1 to 1,000,000 to credit every account that exists at submission time, including admin accounts. The grant is a single atomic transaction with a saved receipt and retry protection. Future registrations receive their normal starting balance but never inherit previous grants. The page shows the current recipient count and the latest 20 grant receipts. Grants do not consume or reset daily game rewards.

On restart, the configured admin is created if absent. Changing its configured password updates that admin and invalidates its sessions. An existing regular user cannot be promoted by choosing its name in the environment. Changing the configured username creates a separate admin; existing admins are retained. Keep credentials out of source control. Passwords use salted scrypt hashes, sessions are stored as hashes and expire after 30 days, and authentication is rate-limited. Compose enables Secure, HttpOnly, SameSite=Strict cookies for the HTTPS tunnel. Set `COOKIE_SECURE=false` only when testing over local HTTP; never use it for the public deployment.

Each newly created account starts with **1,000 tokens**. Existing accounts are not modified by this setting. One rewarded run is available per **UTC day**, shared between Daily and Higher or Lower:

- The first submitted answer reserves that day's rewarded run. Refreshing or returning to the same unfinished run resumes it, including on another device. Starting a screen without answering does not consume the allowance.
- Completing all five Daily guesses pays the price of the day's cheapest available case, funding one pull.
- Higher or Lower pays one-fifth of that case price per correct comparison, rounded to a whole token, once the final streak reaches **3**. It is capped at twice the case price, so a strong run can fund at most two pulls. Payment happens on a miss or deck completion. A shorter run pays zero and still uses that day's allowance.
- Additional games are practice and cannot earn more tokens. A new allowance arrives with the Daily reset at **00:00 UTC**. An abandoned run must be resumed before that reset; old runs cannot pay out afterward.

Reward rates are saved when a run starts, so its payout cannot change if case prices refresh while the run is in progress.

The shop offers **Seized Goods**, **Contraband**, **Car**, **Wine**, **Electronics**, **Tool**, **Jewellery**, and **Collector** cases. Themed cases draw only from their category; Contraband selects the upper-value portion of the mixed archive. Each opening saves one digital collectible to inventory before playing a 5.2-second rarity-only reel. Reduced motion shows the same full reel and jumps it between centered tiers, beginning at 80 ms and progressively slowing over 4.62 seconds without interpolated movement. After a 750 ms pause on the winning tier, a dialog reveals the item with keep, sell, and open-another options. The reel tiers and expandable contents list use only the selected case's current stock. Tokens cannot be bought with real money, transferred, or redeemed for cash; collectibles do not confer ownership of real auction lots.

Every case has a **daily edition**, refreshing at **00:00 UTC** with the Daily game. A SQLite snapshot fixes the entire edition across refreshes, archive updates and restarts. Newly collected auction stock enters the next edition. Definitions or economy changes invalidate the snapshot's configuration key; client catalog revisions prevent charging an outdated offer. Snapshots are retained for 30 days, while collected items retain their own permanent value records.

Collectible resale values follow their auction values directly: **one euro of auction value becomes one token**, rounded to the nearest whole token with a minimum of one. This applies to existing unsold collectibles as well as new finds. Each case price is calculated from the probability-weighted average resale value of that edition's contents and targets a 94.25% average token return, rounded to the nearest token.

Rarity is relative to each case's stock: families rank by `log10(price + 1) + 0.5 / sqrt(familySize)`, using the archived final price where available, otherwise the current bid. The five rank bands each reserve one distinct family and divide the rest in proportions 45/25/17/10/3. A deterministic rotating window selects up to 24 families across these bands, swapping items where spare stock exists. Duplicate listings count as one family and cannot increase draw odds. Small pools rotate fewer items; cases with fewer than five distinct eligible families show **Restocking** instead of substituting another category or redistributing the odds.

Legendary drops occur **0.1%** of the time. The common-to-legendary ticket weights remain 5000/3500/1200/290/10. Draw probabilities and weights stay out of the public catalog response and the interface; case prices, contents and euro-based resale values remain visible. Collected items retain their original rarity and euro value as editions rotate, and their resale value follows that saved euro value. Old case identifiers remain compatible.

The server chooses draws using cryptographic randomness. SQLite transactions make charging and item creation atomic; request IDs make case retries safe, and repeated sales or reward submissions cannot credit tokens twice. Logged-in Higher or Lower keeps future prices out of its game response and validates each comparison on the server. Guest endpoints remain public practice data; this is a casual game, not a competitive anti-cheat system. Back up the full `/data` volume, using SQLite's backup API or stopping the container before copying it.

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
