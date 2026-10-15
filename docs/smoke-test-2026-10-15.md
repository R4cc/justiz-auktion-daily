# Application smoke test — 2026-10-15

Local tests used isolated databases, synthetic accounts and headless Chrome. No production player data was changed. Three subagents covered gameplay, trading and stores; the main agent covered account/admin, wallet and server integration.

## Fixed findings

- Higher-or-Lower: an answer request failure repainted the game before clearing its pending state, leaving both choices disabled. Failed requests now restore usable choices and allow retry.
- Auction House: unified palette/item cards omitted their category's 24-hour market trend chip. Restored it while preserving category privacy for sealed cases and mixed lots.
- Town: malformed or fractional `zoom` parameters could produce an invisible map. Normalize zoom to an integer from 1 to 3.
- Route assets: a failed dependency could still execute dependent scripts and poison subsequent retries. Preload downloads together, execute scripts only after prior dependencies succeed, and clear failed stylesheet URLs so they can reload.
- Admin archive: delayed search replies could replace newer results, and search failures escaped their timer callback. Ignore superseded replies and display current errors without breaking retry.

Added regressions for these findings and refreshed obsolete smoke fixtures/selectors to match the current public Daily, Auction House and store interfaces. Asset versions were updated for changed browser code.

## Verification

- Full Node test suite: **658 passed, 0 failed**.
- Syntax/JSON validation: **219 JavaScript files checked**.
- **29 browser smoke suites passed**:

| Area | Scripts (`scripts/`, all ending in `-smoke.mjs`) |
| --- | --- |
| Gameplay | `daily-menu`, `daily-results`, `leaderboard-ui` |
| Trading | `auction-house`, `auction-bid-budget`, `auction-winnings`, `inventory-items`, `inventory-categories`, `net-worth-ui`, `market-chaos`, `palettes-ui`, `palette-results`, `auction-text` |
| Stores and progression | `stores-redesign`, `visitor-storefront`, `store-reviews-ui`, `skills-ui`, `profile-ui`, `prestige-ui`, `store-cash`, `store-blackjack`, `new-stores`, `store-popularity`, `security-guard`, `criminal-record-ui` |
| Account and integration | `persistent-wallet`, `page-assets`, `account-admin`, `production-server` |

Coverage includes real bids/escrow/refunds/settlement, palette and case opening, inventory/restocking, six store types, purchases/reviews, register collection and retry idempotence, skills/prestige, friends, theft/police/jail, registration/login/logout, permissions, grants/bans/invites/password reset, keyboard navigation, reduced motion, and English/German phone/desktop layouts.

The production-server smoke starts the real server against temporary data and verifies health, all 12 account routes, 46 versioned JS/CSS assets, Brotli response integrity, cache validators and the production content security policy. This is a local integration run, not a live deployment check.

## Rerun

Use Node 22.13 or newer. Browser smoke scripts accept `CHROMIUM_PATH` and `PLAYWRIGHT_MODULE`; the latter should point to an installed Playwright ES module.

```sh
npm test
npm run typecheck
CHROMIUM_PATH=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/account-admin-smoke.mjs
CHROMIUM_PATH=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/page-assets-smoke.mjs
CHROMIUM_PATH=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/production-server-smoke.mjs
```
