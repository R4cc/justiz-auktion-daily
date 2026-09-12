# JUSTIZGUESSR

A daily price-guessing game based on public listings from [justiz-auktion.de](https://www.justiz-auktion.de/), plus replayable random rounds drawn from the saved auction archive.

The application serves the game and its JSON API from one lightweight Node process. No account is required; player progress and streaks stay in the browser. Auctions, immutable daily sets, random-game rotation history, and the fetch queue are stored in SQLite in the container's `/data` volume.

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

A daily game's five auctions and scoring prices are immutable. The database enforces that an auction ID can belong to only one daily game, and daily-use history is retained indefinitely. Free-play uses a persistent least-used rotation: every eligible unique auction is drawn once before the pool begins another pass. With 1,200 eligible auctions, that normally prevents a repeat for roughly 240 five-auction games.

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
