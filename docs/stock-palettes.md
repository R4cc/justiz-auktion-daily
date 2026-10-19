# Mystery stock palette auctions

Mystery palettes appear only in the normal `/auction-house`, and acquisition requires winning a bid. Starter, Warehouse and Jackpot are price/chance tiers, not fixed bundle sizes. Before opening, the player knows the category, starting price and rarity/quantity probabilities. The item pool, actual items and total quantity are private; no outcome or inventory ID exists yet. Palette art shows **?**, and titles contain no promised unit count.

One active lot per eligible category/tier keeps affordable and expensive options available. Every automatic creation receives a randomized 30–90 minute duration. The scheduler chooses a random point inside the largest available deadline gap, leaving at least a minute from other active palette end times. Initial batches, partial renewals and downtime recovery all use the same transactional allocation; retries and restarts retain saved deadlines. Existing auctions retain their advertised deadlines, and existing late-bid extensions apply. Eligible sources use real archived auction finds and the packaged starter fallback, with shared store compatibility and whole-car filtering. Daily source pools rotate, but each lot retains its creation-time pool, reference values, starting price and chance structure privately in `primary_palette_mystery_stock`.

Each palette starts with three independent drops. Each drop independently selects an item rarity, a uniform item inside that rarity, and a base quantity. Repeats are allowed. After drawing, return protection adds copies of the most valuable drawn item as needed: an independent 80% roll targets at least 110% of the actual winning price; the remaining 20% targets at least 90%. Whole-unit rounding and natural jackpots can turn additional outcomes into wins. Item prices and rarities never change. Protection uses the same live market indexes and per-unit rounding as inventory at first opening, including market changes since bidding; later market movement and actual sale proceeds remain variable.

Baseline rarity weights (common through legendary):

| Tier | Rarity weights |
| --- | --- |
| Starter | 8500 / 1200 / 250 / 49 / 1 |
| Warehouse | 6500 / 2500 / 750 / 240 / 10 |
| Jackpot | 2000 / 4500 / 2500 / 900 / 100 |

Missing tiers receive zero probability and populated tiers normalize. We never fabricate rarities or items. Baseline quantity probabilities, **per drop**:

| Tier | Quantity choices | Corresponding probabilities | Average total units |
| --- | --- | --- | ---: |
| Starter | 1 / 2 / 3 / 6 / 12 / 24 | 55% / 25% / 12% / 6% / 1.8% / 0.2% | 6.102 |
| Warehouse | 1 / 3 / 6 / 12 / 24 / 48 | 22% / 28% / 24% / 18% / 7% / 1% | 20.46 |
| Jackpot | 1 / 4 / 12 / 24 / 48 / 96 | 5% / 10% / 25% / 35% / 20% / 5% | 78.75 |

There is no fixed-total split. Before return protection, maximum quantities are 72, 144 and 288 respectively; protection can exceed these amounts. New lots retain the 15 October upper-quantity weight boost (40% Starter, 30% Warehouse/Jackpot). Starting bids and NPC risk budgets use the original, unboosted distribution above. The reserve remains `ceil(max(base item EV, creation market item EV) × reference expected quantity / 0.82)`. Higher bids leave base odds unchanged, while return protection uses the visible price paid, excluding refunded proxy escrow. At any paid price, the protected expected opening value is at least 106% and the profitable-opening probability is at least 80%. NPCs never receive this player opening protection or peek at outcomes.

Winning settlement closes the auction, consumes the visible winning price, refunds unused proxy maximum and notifies the owner. It creates no stock. An unopened win contributes its public paid price to net worth, with no quantity/value leak. Only the winner's first rewards request opens it. Inside one transaction, `openMysteryStock` reads their current Luck, rolls the three item/quantity pairs and return protection with server cryptographic randomness, creates one ordinary inventory row per physical unit, allocates the actual winning price across acquisitions and saves the complete result. Luck upgrades after winning but before opening apply. Later upgrades and reloads cannot change the saved result. Failed minting rolls back the whole opening, including its reveal stamp; a lost response after commit returns the saved result without another draw, payment or mint. Client seeds, quantities, ranks and outcomes are never accepted.

Luck boosts rarity weights above the lowest populated tier and quantity weights above one unit by the existing relative 3%, 5% or 7%. The rolls remain independent. Each mean is bounded by its baseline × `(1 + bonus/100)`, so their product is bounded by the square. These bounds describe the base draws only; return protection is applied afterwards and has no additional Luck multiplier. Case Luck still applies only once. See [Skill tree](skill-tree.md).

The retained full-screen `/auction-house?reveal=ID` opening animates the item first, then its multiplier, for all three drops. Its header keeps the total unknown while opening; the completed haul shows the real sum. Reduced motion, inventory/store handoffs and navigation cancellation are preserved. The server already saved the outcome before the cosmetic animation, so leaving early never loses stock.

All unopened `opening-v2` mystery lots receive return protection, including existing auctions and wins with older frozen base odds. Already saved openings, bidder-backed fixed-size auctions, three-find legacy palettes and previously purchased palettes keep their original frozen contents and acquisition rules. Unbid old fixed-size lots are retired and replaced by mystery lots. Old paid palettes remain under My bids and winnings, and `/palettes` bookmarks redirect to the Auction House. There is no instant-purchase route or separate palette menu.

Fines can seize an unopened new win at its disclosed paid cost without rolling the contents. A seized win stops contributing to net worth and cannot be opened. Normal inventory resale locks, store capacity and theft rules apply once opened. Economy reset clears the private mystery table before primary auctions.

Routes:

- `GET /api/palette-auctions`: ordinary board with public odds only.
- `POST /api/account/palette-auctions/bid`: existing bid contract.
- `GET /api/account/palette-auctions/:id/rewards`: winner-only atomic first opening and stable replays.
- `GET /api/stock-palettes`: read-only, non-purchasable odds metadata; signed-in current-Luck preview.
- Existing own purchase list/reveal routes remain for legacy assets. Instant `stock-palettes/buy` returns 404.

New supply requires both palette flags. Existing session, CSRF, bans, temporary-password and jail guards apply. Validation covers deferred randomness/minting, price/EV bounds, quantity tails, opening-time Luck, refunds, privacy, retries/rollback, capacity, fine seizure, legacy transition and reset. Browser checks exercise bidding and the retained item/multiplier opening in EN/DE at 1440–320px.
