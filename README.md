# JUSTIZGUESSR

A daily price-guessing game based on public listings from [justiz-auktion.de](https://www.justiz-auktion.de/), plus replayable random rounds drawn from the saved auction archive.

The application serves the game and its JSON API from one lightweight Node process. No account is required; player progress and streaks stay in the browser, while auction history and immutable daily sets are stored in the container's `/data` volume.

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

The `/data` volume preserves archived auctions, cached listing images, final prices, immutable daily game sets, and the pending fetch queue across container upgrades. The service discovers listings every six hours and then processes exactly one listing page, auction page, start-date page, or image per rolling interval (two minutes by default). Requests are never run concurrently, HTTP 429/5xx responses are retried with increasing delays, and completed auctions with a stored final price are not fetched again. A day's five auctions and their scoring prices are never changed after generation, and an auction already used by a previous daily is not selected for another one. Free-play rounds may include active or completed archived auctions and do not affect daily progress or streaks.

Optional environment variables:

- `PORT` — HTTP port inside the container, default `3000`
- `DATA_DIR` — persistent data directory, default `/data`
- `DISCOVERY_INTERVAL_HOURS` — interval for adding listing pages to the persistent queue, default `6` (the legacy `REFRESH_INTERVAL_HOURS` name remains supported)
- `FETCH_INTERVAL_SECONDS` — delay between individual outbound requests, default `120` and minimum `30`
- `COLLECT_PAGES` — listing-result pages included in each discovery sweep, default `12`

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

The game is then available at `http://localhost:3000`. Container health can be checked at `GET /healthz`, while `GET /stats` returns non-sensitive collector and queue totals as plain text. The current frozen daily set is served from `GET /api/daily`, and a fresh five-auction free-play set is served from `GET /api/random`.
