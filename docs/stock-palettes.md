# Stock palette auctions

Stock palettes appear among the normal `/auction-house` listings. Players acquire them only by bidding and winning; there is no separate shop or sidebar entry. Starter, Warehouse and Jackpot lots contain exactly 6, 24 and 72 physical units. Each palette draws three variations with replacement, all from one category. One live lot per populated category and size keeps budget and premium choices available. Initial deadlines are staggered across an hour; replacement lots run a full hour. Normal late-bid extensions apply.

Wine, electronics, cars, toys, tools and jewellery use real archived auction finds. The packaged starter archive provides tools/electronics on a fresh installation. Categories without eligible sources produce no lots. Toys use shared store compatibility rules; cars require whole-car eligibility. Daily pools are frozen in `stock_palette_editions`, and each auction retains its exact public pool, reserve and reference values across daily rotation.

For each populated rarity, a draw selects an item uniformly. Published integer tier weights differ by size (common through legendary):

| Offer | Total units | Tier weights |
| --- | ---: | --- |
| Starter | 6 | 8500 / 1200 / 250 / 49 / 1 |
| Warehouse | 24 | 6500 / 2500 / 750 / 240 / 10 |
| Jackpot | 72 | 2000 / 4500 / 2500 / 900 / 100 |

Absent tiers have zero probability; populated tiers are normalized, and the UI discloses actual odds. No fictional rarity copies are added. Each lot has these quantity splits, uniformly shuffled across the three draws (u = total / 6):

| Quantities | Probability |
| --- | ---: |
| u + u + 4u | 40% |
| u + 2u + 3u | 45% |
| 2u + 2u + 2u | 15% |

An item's tier and its multiplier are independent. Each position has expected quantity total/3. Bundle expectation is therefore total × weighted mean item value, including uniform probability inside each tier. The reserve is `ceil(max(base EV, current market EV) / 0.82)`, retaining the former offer pricing and an increasing size ladder. The base floor prevents acquisition below legacy instant-sale expectations during a falling market. The final price is determined by bidding and can exceed the reserve. Quantities are linked to preserve the disclosed total; they are not independent multiplier bets. The bid room exposes item pools, tier odds, marginal multiplier odds, joint split odds and average contents value. Resale and NPC store demand use existing market rules; NPC valuation includes the full quantity.

`createStockPaletteAuction` runs quote, snapshot and hidden draw creation inside one transaction. It reserves one UUID per physical unit and freezes exact draws for each supported Luck bonus (0%, 3%, 5%, 7%). The winner's current Luck selects one pre-frozen version once at settlement. Neither bidding nor revealing rerolls anything. Subsequent upgrades cannot alter settled outcomes. Personal bid-room odds preview the current skill; [Skill tree](skill-tree.md) documents its expected-value bound.

Stock lots reuse `primary_palette_auctions` bidding, proxy maxima, escrow, outbid refunds, extensions and winner authorization. Settlement atomically inserts precisely the advertised number of ordinary inventory rows, allocates the actual winning price across acquisition records, refunds unused maximum-bid escrow and freezes the result. A failed mint rolls back the entire settlement. Unbid lots create no inventory and release their hidden reservations. Public lists, participation history and admin reads expose no hidden draws or reserved IDs. Won units stay sealed until the owner reveals them; unopened wins contribute their paid price to net worth without leaking contents. Repeat reveals return saved results without minting or charging again.

The full-screen opening stays on the Auction House route: `/auction-house?reveal=AUCTION_ID`. It rolls each item before its quantity multiplier, shows the accumulating haul, supports reduced motion and hands off to inventory or stores. Leaving or reloading does not lose or duplicate stock. Existing three-find auction wins use the same screen with their original single-item rewards.

Previously purchased palettes remain under My bids and winnings and open through `/auction-house?open-palette=PURCHASE_ID`. Their frozen contents, ownership, acquisition costs and existing fine-seizure rules are preserved. Old `/palettes` bookmarks redirect to the Auction House, including opening links. No new instant purchase is possible.

Routes:

- `GET /api/palette-auctions`: normal board; supplies current stock lots when both palette flags are enabled.
- `POST /api/account/palette-auctions/bid`: existing authenticated bid contract.
- `GET /api/account/palette-auctions/:id/rewards`: winner-only reveal.
- `GET /api/stock-palettes`: read-only catalog metadata, marked `purchasable: false`.
- `GET /api/account/stock-palettes`: preserved old purchases.
- `POST /api/account/stock-palettes/reveal`: owner-only old purchase reveal.

`POST /api/account/stock-palettes/buy` is removed and returns 404. The domain rejects direct purchases by default; its explicit legacy fixture option is never forwarded from HTTP. Existing session, CSRF, bans, password-change restrictions and jail guards apply. No client price, quantity, outcome or seed is accepted. New stock supply requires `FEATURE_PALETTES` and `FEATURE_PALETTE_AUCTIONS`; existing primary wins retain their normal auction reveal behavior.

Old supplier resale lots with bids, player bulk resale listings and primary wins remain valid. The production runtime creates category stock palette auctions instead of old three-find automatic drops. Legacy manual auction helpers remain for compatibility. Economy reset clears hidden stock draws and unit reservations before deleting primary auctions, along with old purchase receipts and inventory history.

Validation: `test/stock-palette-auctions.test.mjs` covers supply/renewal, escrow, privacy, atomic settlement, winner Luck, NPC quantity valuation, no-bid expiry and reset. Existing palette and stock suites retain legacy reward coverage. `scripts/palettes-ui-smoke.mjs` exercises real bids and refunds, the retained opening, exact quantities, reload, old purchase preservation, blocked instant purchase, inventory/Quick Restock handoff and EN/DE at 1440–320px. Use Node 22.
