# Navigation performance

The backend remains Node 22 with SQLite. Authored browser files remain in `dist/`.
Run `npm run build` to generate `web-build/`; local startup prefers that directory
when present. Rebuild after editing browser sources. Docker builds it before
copying only production assets into the runtime image.

Vite bundles the ES module route loader. The existing classic scripts retain
their shared bindings during incremental migration. Production HTML references
the hashed module and content-derived cache versions for scripts and styles.
Route hover/focus prefetches code only; it does not execute it or fetch API data.

## API compatibility

- `GET /api/account/businesses` retains the full inventory response.
- `?view=summary` returns stores and `availableStock` counts without inventory.
- `?view=summary&events=1` also checks owner events and returns `events` and the
  refreshed `user`, avoiding a separate event-check request on Your Stores.
- `GET /api/account/businesses/inventory?shop=ID&offset=0&limit=48` returns the
  owner's matching, unlisted, unshelved, revealed inventory, with `total`, `offset`,
  `limit` and nullable `nextOffset`. Page size is capped at 96.
- `quick=1` returns capacity-bounded restocking suggestions. Optional `space`
  supports pending shelf removals; it never changes stock. Transfers continue
  through the existing atomic, idempotent mutation.
- Store reads/visits accept summary mode to defer owner review rows. Visitor
  reviews and existing full responses remain available.

Dashboard reads advance only the owner's stores and prestige restocker. Global
supply, unrelated store catch-up and settlements stay in the economy runtime.
Stock transfers still revalidate ownership, capacity, locks and live values.

## Repeatable measurements

Use Node 22, matching CI and Docker:

```sh
npm run perf:profile
node scripts/navigation-performance.mjs
WEB_BUILD=1 node scripts/navigation-performance.mjs
```

Browser measurements require `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` pointing to
an installed Playwright module and Chromium executable. On Windows, set these
environment variables with PowerShell before invoking the scripts.

The profiler creates temporary SQLite data for inventories of 0, 1,000 and 5,000
items. JSON lines report warm median/max processing and API duration, prepared
statement/exec counts, JSON bytes and event-loop delay. The browser benchmark
uses a synthetic 5,000-item account, a 390px viewport, 4x CPU slowdown and a 100ms
delay per API request. It measures cold Stores, repeated owner/visitor navigation
and a navigation request that coincides with an economy tick.

These are local regression measurements, not production latency or capacity
claims. Compare the same fixture, runtime, network delay and CPU settings. Small
inventories, real tunnel latency and contention can produce different results.

### Measured comparison, 2026-10-23

Baseline `485d9d6`, Node 22.23.4, 5,000 inventory items. Domain/API measurements
use five warm samples; navigation uses three warm samples with the settings
above. The optimized browser run serves the production build.

| Measurement | Before | After |
| --- | ---: | ---: |
| Legacy dashboard median | 205 ms | 48 ms |
| Dashboard statement preparations | 20,250 | 174 |
| Dashboard database exec calls | 5,049 | 27 |
| Initial summary JSON, one empty store | 985,758 bytes (full response) | 3,054 bytes |
| Account profile median | 30 ms | 12.5 ms |
| Your Stores navigation median | 729 ms | 343 ms |
| Owner storefront navigation median | 730 ms | 460 ms |
| Visitor storefront navigation median | 351 ms | 300 ms |
| Shared startup JavaScript, raw / gzip | 373 / 117 KiB | 255 / 82 KiB |

Cold directory loading remained roughly flat in this run (578 vs 595 ms,
one sample each). During a forced economy tick, Your Stores took 849 ms
before and 481 ms after.
Large background ticks can still delay requests because they share the main
thread; worker isolation remains a separate, measured follow-up.

Functional coverage: `npm test`, `npm run typecheck`,
`scripts/loading-performance-smoke.mjs`, `scripts/page-assets-smoke.mjs`,
`scripts/qol-stores-smoke.mjs` and `scripts/profile-ui-smoke.mjs`.
