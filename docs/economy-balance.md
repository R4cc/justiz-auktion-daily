# Economy balance — 1 October 2026

The pass covers starting grants, Daily and Higher or Lower income, free and paid cases, tradable case supply, sealed palettes, resale and proxy bidding, NPC demand, wholesale stock, and business sales. Shared targets live in `src/economy-balance.mjs`; item euros stay tied to their historical auction, while current J€ estimates follow the category market.

## Income and progression

| Source | New balance | Reason |
|---|---|---|
| Starting grant | J€1,000 | Enough for an entry shop or several affordable auctions; existing balances stay intact. |
| Daily completion | J€200 + round(J€150 × score / 5,000) | Stable participation income with a skill bonus; independent of expensive case rotations. |
| Daily physical case | One per day, score-weighted tier, saved item price ≤ J€1,000 | Prevent whole-car archive tails from overwhelming all other income. Affordable contents are re-ranked; thin pools use packaged starter stock. |
| Higher or Lower | J€25 × streak from 3 correct; J€250 maximum per UTC day | Separate from Daily. Completed improvements pay only the difference from today's prior reward; misses and repeats cannot mint currency. |
| Admin grants | Existing authorized, receipt-protected grants | Administrative interventions are outside normal progression. |
| XP | Existing Daily 150 XP, resale XP and quadratic level curve | Currency changes preserve progression gates and existing XP. |

Daily case-tier weights interpolate from `8000/1800/180/19/1` at zero points to `4500/3500/1600/380/20` at 5,000 points. The case then draws an item using its own tier weights:

| Case tier | Common | Uncommon | Rare | Epic | Legendary |
|---|---:|---:|---:|---:|---:|
| Standard | 7500 | 2000 | 450 | 49 | 1 |
| Improved | 0 | 8000 | 1750 | 245 | 5 |
| Rare | 0 | 0 | 9000 | 980 | 20 |
| Epic | 0 | 0 | 0 | 9950 | 50 |
| Legendary | 0 | 0 | 0 | 0 | 10000 |

The resulting chance of a legendary **item**, accounting for both draws, ranges from 0.03155% to 0.273%. A high score improves the reward without making expensive jackpots a routine income source. Odds remain internal, consistent with the existing interface.

## Pricing and currency flows

- Paid cases retain the existing `5000/3500/1200/290/10` item rarity weights. Price is `ceil(max(base EV, current market EV) / .82)`. Contents freeze daily; quotes refresh with the market and stale prices fail before charging. The base floor protects legacy instant sales. At neutral or hotter markets, expected reference return is at most 82%; actual NPC payouts are lower in ordinary resale. Even at a collector's 105% cap, the expected resale return stays below purchase cost.
- Sealed case face value is `round(.80 × tier-weighted base EV)`, minimum J€1. It depends on every eligible reward, never on the pre-drawn winner. New supplier reserves equal this face value. Opening has loss and upside; a rarity floor does not guarantee profit. Case supply retains its four-hour windows, two-hour duration and occasional drop roll. NPCs cannot buy cases.
- Palette reserves are `ceil(.70 × live three-item EV)`. Using live EV throughout prevents the former blended base-price floor from pricing cold-market lots above their resale opportunity. Existing rarity weights and three cryptographic draws with replacement remain intact. A primary winning payment is consumed, providing a currency sink.
- Resale transfers existing inventory and currency; it creates no items. Private proxy ceilings remain fully escrowed, losing challengers keep their currency, and unused ceilings are refunded at settlement. Resale increments are J€1 below 100, J€5 below 500, J€10 below 1,000, then at least J€25 and 0.5% of reserve rounded up to J€25. Palette increments retain their smaller-value tiers, then also scale above J€5,000. Players and NPCs use the same domain rules and the UI reads the serialized increment.
- NPC resale demand is 60–96% of live estimates, with preferred collectors capped at 105%. Preference, patience, aggressiveness and market-dependent interest remain distinct. A quantity discount of `max(.75, 1 − .04 × log2(quantity))` prevents mass lots from receiving the same total premium as single finds. Existing persisted interests and escrow are honored; new interests use this balance. NPCs have finite seeded balances and never receive automatic refills.
- NPC palette ceilings are 64–84% of live bundle EV before integer flooring. The five-minute consideration cadence, rotating cohort, show-up probability and human escrow accounting remain intact. A ceiling exactly equal to the required bid can participate.
- Wholesale reserves become 85% of current total unit value, replacing 75% of historical base value. Existing lots stay frozen. Eight staggered, two-hour lots continue to constrain stock supply.
- New stores default to 20% markup. Buying chance is `baseConversion × exp(−3 × (margin − 20) / 100)`, capped at 85%, multiplied by `min(1, sqrt(typicalItemValue / currentItemValue))`. Higher prices and extreme markups cost turnover. The displayed estimate averages actual stocked items. Existing shop prices, capacities and visitor rates remain appropriate progression investments: pop-up J€1,000, small J€4,000, medium J€15,000, large J€50,000, with category factors. Sales consume stock and credit currency exactly once. A 20% margin is close to the best profit per visitor for stock acquired at 85% of market value.
- Legacy instant sales remain available only with resales disabled, at saved rounded base value. Paid-case base pricing prevents a positive expected buy/sell loop, and single/bulk payouts reject unsafe balances before mutating inventory.

## Upgrade behavior

Reward receipts migrate atomically from `(user, date)` to `(user, date, mode)` without paying again or modifying balances. Existing runs retain their saved rates, including old flat Daily rewards; new default runs include the score bonus. Already-earned Higher or Lower rewards count toward later top-ups, including amounts above the new cap from an older schedule.

Palette pricing v4 migrates v1 single-draw expectations once, and preserves v2/v3 bundle expectations without multiplying again. Edition reference metadata uses frozen valuation inputs; live reserves, proxy ceilings, bid history, hidden reward JSON, ownership and existing inventory never change. A v4 marker makes the migration idempotent. Existing prepared Daily cases retain their old sealed result and face value. Already recorded store sales and owner-selected margins remain intact; unsold stock uses the updated demand curve.

## Validation and practical limits

`node --test` covers reward separation, top-ups, retries, restart and legacy migrations, price changes between quoting and opening, cold/hot markets, exact draw expectations, free-case value bounds, hidden-case price independence, shared bulk valuation, NPC/player increments, escrow refunds, wholesale quote freezing and slow demand for expensive business stock. `node scripts/check.mjs` checks project syntax and JSON.

Run `node scripts/economy-report.mjs --stress` for the checked-in [report](economy-balance-report.md), or pass an archive JSON path. The stress scenario examines 360 synthetic lots over 30 rotations and three market regimes, sampling 2,000 openings per palette offer. At reserve, palette reference-value profit chance averages about 70%, and median reference return about 130%. In that scenario Daily-case EV is J€272–396 instead of the unrestricted J€4,261–10,327. These are reference values: NPC interest, auction competition, clearing prices, capacity, stock availability and time to sell determine realized income. No live player telemetry or container deployment is implied by this local validation.
