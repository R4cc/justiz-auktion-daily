# Town map redesign — 2026-10-15

The town now starts with six large district signs on a colorful illustrated board. A district opens a focused neighborhood with readable, clickable store and plot markers. My stores and Open a store lead directly to useful lists. One map/list switch works on every screen size; optional district/type filters sit behind Filters. The empty preview panel and duplicate map controls are removed.

Selecting a location updates the marker and a compact card without rebuilding the canvas. Zoom preserves the canvas, keyboard focus and map center. The mobile card keeps the selected marker visible. Return links preserve map/list mode, filters, selection, zoom and pan. Reserved plots do not offer a purchase action.

Store type choices show all six exact server prices before review. The selected price, capacity and balance change stay together in the checkout area, followed by explicit confirmation. Level, money and store-limit gates continue to use server data. Economic rules and purchase APIs are unchanged.

## Verification

The dedicated `scripts/town-ui-smoke.mjs` entry point now runs `scripts/town-map-smoke.mjs` against temporary data and real Chrome. It covers:

- All six districts and all 25 durable locations, including a fully occupied town with all six store types and escaped long names.
- Marker hit targets, unobstructed district signs, map/list selection, filters, empty results and reset.
- Keyboard zoom/pan, Escape/focus restoration, mouse drag, native touch panning and pointer cancellation.
- Canvas identity through selection/zoom, saved map position and shop-return links.
- English/German layouts at 320, 390, 600, 768, 1024, 1440 and 3840 pixels.
- Guest browsing; insufficient money, level requirements and store limits; all six quoted prices; actual purchase balance/capacity; a competing buyer taking a plot before confirmation.
- Malformed URLs, corrupt saved state, a failed read followed by retry, stale responses after navigation and unavailable reserved locations.

Additional browser checks: `stores-redesign-smoke.mjs`, `new-stores-smoke.mjs`, `page-assets-smoke.mjs`, and `production-server-smoke.mjs`. The latter exercises all 12 account routes under the real server's CSP and validates compressed assets/cache headers.

Full Node suite: 660 tests. Syntax/JSON validation includes all 221 JavaScript files. Tests use isolated fixtures, not production player data.

Run with Node22 and installed Playwright/Chrome:

```sh
CHROMIUM_PATH=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/town-ui-smoke.mjs
npm test
npm run typecheck
```
