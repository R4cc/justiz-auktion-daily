# Lighthouse performance audit — 15 October 2026

Mobile Lighthouse 13.5.0 / Chrome 154, simulated 150ms RTT, 1,638 Kbps and 4× CPU slowdown. SEO was excluded. Daily used a guest session; Auction House and Town used a synthetic signed-in account in an isolated seeded local database. Each result is a cold-browser local run, not production telemetry or a deployment check; timings vary with host load and live auction contents.

| Page | Performance score | Largest contentful paint | Total blocking time | Transferred |
| --- | ---: | ---: | ---: | ---: |
| Daily | 64 → 95 | 7.0s → 2.8s | 136ms → 81ms | 912 → 235 KiB |
| Auction House | 60 → 87 | 7.6s → 3.7s | 182ms → 124ms | 1301 → 648 KiB |
| Town | 54 → 91 | 7.1s → 3.3s | 368ms → 84ms | 933 → 282 KiB |

## Changes

- Self-hosted the existing Manrope and DM Mono WOFF2 fonts, with their SIL licenses, removing third-party font CSS/DNS dependencies. Preloaded the main font and retained swap behavior.
- Loaded page-specific styles and feature scripts only for the routes that need them. Downloads run together, classic-script execution preserves dependency order, and SPA navigation reuses loaded modules without duplicate listeners. Global game/dialog assets remain available.
- Added Brotli/gzip negotiation and an 8 MiB bounded static-response cache. ETags allow conditional requests; versioned CSS/JS and bundled fonts use immutable caching. HTML still revalidates, and private API responses remain no-store. Existing security headers remain in place.
- Reserved initial content space to keep the footer from jumping into and out of the first viewport. Direct account entry reuses its fresh session; initial notifications keep their toasts without immediately repeating the session request. Later navigation, focus and periodic notifications still refresh.

## Verification and reproduction

Run `node --test` and `node scripts/check.mjs`. The static-response tests cover Brotli/gzip and quality negotiation, HEAD, 304, changed-file invalidation and font responses. `node scripts/page-assets-smoke.mjs` checks all 12 account routes, asset avoidance on Daily, one-time script execution, session freshness and EN/DE at 1440/390/320px. The existing bidding and store-owner browser checks also passed.

To audit an isolated running server (use a supported Node 22 runtime):

```sh
CHROME_PATH=/usr/bin/google-chrome npx --yes lighthouse@13.5.0 http://127.0.0.1:3187/ --chrome-flags="--headless --no-sandbox --disable-dev-shm-usage" --only-categories=performance,accessibility,best-practices --output=json --output=html --output-path=/tmp/lighthouse-daily
```

For authenticated routes, supply a private local JSON headers file through `--extra-headers=/path/to/headers.json`. Never commit session cookies. The saved HTML and JSON evidence from this run has synthetic session headers redacted and is available in the task's Lighthouse artifacts.

Remaining observations: Lighthouse still identifies some unused styles/functions in the shared game shell. Signed-in mobile pages retain a small layout shift (about 0.06) when the wallet/XP bar appears. Accessibility findings were recorded by Lighthouse but were outside this performance pass. No SEO changes or changelog entries were made.
