# Permanent stock palettes

`/palettes` is the stock supply destination, linked from the sidebar, Auction House and owned stores. Starter, Warehouse and Jackpot offers contain exactly 6, 24 and 72 physical units. Each palette draws three variations with replacement, all from one category. Budget and premium offers are permanent, without an auction window or stock counter. Wine, electronics, cars, toys, tools and jewellery use real archived auction finds; categories with no sources remain visibly unavailable. The packaged starter archive supplies permanent tools/electronics even on a fresh installation. Toys are filtered with the shared store compatibility rule; cars use whole-car eligibility.

The daily item pools are frozen in `stock_palette_editions`. For each populated rarity, a draw selects an item uniformly. Published integer tier weights differ by offer (common through legendary):

| Offer | Total units | Tier weights |
| --- | ---: | --- |
| Starter | 6 | 8500 / 1200 / 250 / 49 / 1 |
| Warehouse | 24 | 6500 / 2500 / 750 / 240 / 10 |
| Jackpot | 72 | 2000 / 4500 / 2500 / 900 / 100 |

Thin pools assign zero probability to absent tiers and normalize the populated tiers; the UI discloses the actual resulting odds. No fictional rarity copies are added. Each offer has these quantity splits, uniformly shuffled across the three draws (u = total / 6):

| Quantities | Probability |
| --- | ---: |
| u + u + 4u | 40% |
| u + 2u + 3u | 45% |
| 2u + 2u + 2u | 15% |

An item's tier and its multiplier are independent. Each position has expected quantity total/3. The exact bundle expectation is therefore total × weighted mean item value, including uniform probability inside each tier. Price is `ceil(max(base EV, current market EV) / 0.82)`, with a strictly increasing price ladder. The base floor prevents buying below legacy instant-sale expectations during a falling market. Skill-tree Luck adjusts personal item odds and the displayed live average contents value; prices retain the unskilled expectation, and quantity odds stay fixed. See [Skill tree](skill-tree.md) for the expected-value bound. The UI exposes tier odds, marginal multiplier odds, joint split odds and the live average contents value. Quantities are linked to preserve the disclosed total; they are not independent multiplier bets. Resale and NPC store demand use existing market rules.

The server freezes the split, three winners and reserved UUIDs when payment succeeds. Actor/request receipts make purchase retries idempotent; stale quote revisions reject before payment. No winners or reserved IDs appear in purchase/list responses. Owner-only reveal atomically inserts precisely the advertised number of ordinary inventory rows and splits the actual purchase cost across their acquisition records. Repeat reveals return the same saved results without minting again. Store stock selection, capacity limits and resale locks remain shared with all other inventory finds.

The full-screen reveal rolls each item before its quantity multiplier, shows the accumulating haul, supports reduced motion and hands off to inventory or stores. The opening URL permits reload/retry of the same frozen purchase. Leaving mid-animation does not lose or duplicate stock. Existing won auction palettes use the same screen while retaining their original three single-item rewards.

Unopened owned palettes count toward net worth at their paid cost without leaking hidden contents. Fine collection can seize a sealed palette at that disclosed cost, returning excess proceeds; seized palettes cannot be revealed. Economy reset clears editions and purchase receipts along with inventory and acquisition history.

Routes, gated by `FEATURE_PALETTES`:

- `GET /api/stock-palettes`: public quote with revision, category availability, pools and odds.
- `GET /api/account/stock-palettes`: own unopened purchases.
- `POST /api/account/stock-palettes/buy`: `{offerId,revision,requestId}`.
- `POST /api/account/stock-palettes/reveal`: `{id}`.

POST routes use existing session and CSRF guards; bans, password-change restrictions and jail apply. Purchases require fresh human authority in the domain too. No client price, quantity, outcome or seed is accepted.

Old supplier stock auctions without bids are retired. Escrowed supplier lots, bid history, player bulk resale listings and primary palette wins remain valid and settle through existing domains. The production runtime stops creating the old three-find primary palette auctions. Explicit legacy supply helpers remain for compatibility regression fixtures.

Validation: `node --test test/stock-palettes.test.mjs` and `node scripts/palettes-ui-smoke.mjs` (Node 22). The browser smoke covers EN/DE at 1440–320px, actual animation and reduced motion, lost-response retries, reload, exact quantities, owner store/Quick Restock handoff, navigation cleanup and discovery.
