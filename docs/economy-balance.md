# Economy balance — updated 19 October 2026

The pass covers starting grants, Daily and Higher or Lower income, free and paid cases, tradable case supply, sealed palettes, resale and proxy bidding, NPC demand, wholesale stock, and business sales. Shared targets live in `src/economy-balance.mjs`; item euros stay tied to their historical auction, while current J€ estimates follow the category market.

## Income and progression

| Source | New balance | Reason |
|---|---|---|
| Starting grant | J€1,000 | Enough for an entry shop or several affordable auctions; existing balances stay intact. |
| Daily completion | J€1,000 at every score | Fixed participation income; case rarity remains score-based. |
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

Weekly Market frenzy events last one randomly timed hour per seven-day window. The normal category index is multiplied by a minute-by-minute path between 0.25× and 3×, with strong five-minute reversals and a return to normal at expiry. The private schedule/path seed persists once; reads and restarts cannot reroll it. All market-priced inventory, cases, NPC demand, store quotes and theft fines share the same event-adjusted index. Existing accepted transactions retain their receipts and frozen terms. Admin multipliers still compose with the event. History retains its turning points after it ends.

- Paid cases retain the existing `5000/3500/1200/290/10` item rarity weights. Price is `ceil(max(base EV, current market EV) / .82)`. Contents freeze daily; quotes refresh with the market and stale prices fail before charging. The base floor protects legacy instant sales. At neutral or hotter markets, expected reference return is at most 82%; actual NPC payouts are lower in ordinary resale. Even at a collector's 105% cap, the expected resale return stays below purchase cost.
- Sealed case face value is `round(.80 × tier-weighted base EV)`, minimum J€1. It depends on every eligible reward, never on the pre-drawn winner. New supplier reserves equal this face value. Opening has loss and upside; a rarity floor does not guarantee profit. Case supply retains its four-hour windows, two-hour duration and occasional drop roll. NPCs cannot buy cases.
- Legacy three-item palette reserves are `ceil(.70 × live three-item EV)`. Mystery stock pricing is described below. Using live EV throughout prevents the former blended base-price floor from pricing cold-market lots above their resale opportunity. Existing rarity weights and three cryptographic draws with replacement remain intact. A primary winning payment is consumed, providing a currency sink.
- Resale transfers existing inventory and currency; it creates no items. Private proxy ceilings remain fully escrowed, losing challengers keep their currency, and unused ceilings are refunded at settlement. Resale increments are J€1 below 100, J€5 below 500, J€10 below 1,000, then at least J€25 and 0.5% of reserve rounded up to J€25. Palette increments retain their smaller-value tiers, then also scale above J€5,000. Players and NPCs use the same domain rules and the UI reads the serialized increment.
- NPC resale demand is 60–96% of live estimates, with preferred collectors capped at 105%. Preference, patience, aggressiveness and market-dependent interest remain distinct. A quantity discount of `max(.75, 1 − .04 × log2(quantity))` prevents mass lots from receiving the same total premium as single finds. Existing persisted interests and escrow are honored; new interests use this balance. NPCs have finite seeded balances and never receive automatic refills.
- NPC palette ceilings are 64–84% of live reference bundle EV before integer flooring. New mystery stock retains its pre-improvement quantity reference for this risk budget. The five-minute consideration cadence, rotating cohort, show-up probability and human escrow accounting remain intact. A ceiling exactly equal to the required bid can participate.
- Wholesale reserves become 85% of current total unit value, replacing 75% of historical base value. Existing lots stay frozen. Eight staggered, two-hour lots continue to constrain stock supply.
- New stores default to 20% markup. Buying chance is `baseConversion × exp(−3 × (margin − 20) / 100)`, capped at 85%, multiplied by `min(1, sqrt(typicalItemValue / currentItemValue))`. Higher prices and extreme markups cost turnover. The displayed estimate averages actual stocked items. Existing shop prices, capacities and visitor rates remain appropriate progression investments: pop-up J€1,000, small J€4,000, medium J€15,000, large J€50,000, with category factors. Sales consume stock and credit the store’s till exactly once. Earnings become spendable only through that store’s Collect cash button. A 20% margin is close to the best profit per visitor for stock acquired at 85% of market value.
- Legacy instant sales remain available only with resales disabled, at saved rounded base value. Paid-case base pricing prevents a positive expected buy/sell loop, and single/bulk payouts reject unsafe balances before mutating inventory.

## Upgrade behavior

New store purchases require level 1 for pop-ups, 3 for small shops, 6 for medium shops and 10 for large shops. The server derives eligibility from saved XP for both plot and size purchases. Existing stores retain their size, stock and management access regardless of their owner's level.

Direct Case Store stock refills globally every four hours: Lost Property 100, Evidence Locker 60, Seized Treasure 35, Vault 20, and Collector's Cache 10. Legacy themed openings retain 10 per category. Upgrades preserve the current window's sold counts and all purchase receipts; prices and drop odds are unchanged.

Reward receipts migrate atomically from `(user, date)` to `(user, date, mode)` without paying again or modifying balances. Higher-or-Lower runs retain their saved rates. Daily runs completed after the 14 October patch use the flat J€1,000 payout, including previously started runs; completed receipts keep their original payout. Already-earned Higher or Lower rewards count toward later top-ups, including amounts above the new cap from an older schedule.

Palette pricing v4 migrates v1 single-draw expectations once, and preserves v2/v3 bundle expectations without multiplying again. Edition reference metadata uses frozen valuation inputs; live reserves, proxy ceilings, bid history, hidden reward JSON, ownership and existing inventory never change. A v4 marker makes the migration idempotent. Existing prepared Daily cases retain their old sealed result and face value. Already recorded store sales and owner-selected margins remain intact; unsold stock uses the updated demand curve.

## Validation and practical limits

`node --test` covers reward separation, top-ups, retries, restart and legacy migrations, price changes between quoting and opening, cold/hot markets, exact draw expectations, free-case value bounds, hidden-case price independence, shared bulk valuation, NPC/player increments, escrow refunds, wholesale quote freezing and slow demand for expensive business stock. `node scripts/check.mjs` checks project syntax and JSON.

Run `node scripts/economy-report.mjs --stress` for the checked-in [report](economy-balance-report.md), or pass an archive JSON path. The stress scenario examines 360 synthetic lots over 30 rotations and three market regimes, sampling 2,000 openings per legacy three-item palette offer. At reserve, palette reference-value profit chance averages about 70%, and median reference return about 130%. In that scenario Daily-case EV is J€272–396 instead of the unrestricted J€4,261–10,327. These are reference values: NPC interest, auction competition, clearing prices, capacity, stock availability and time to sell determine realized income. No live player telemetry or container deployment is implied by this local validation.

## Player theft — 12 October 2026

All other player stores permit free single-deck blackjack theft, with hit/stand only and dealer standing on soft 17. Ties give no item and no fine. Card order is uniformly shuffled with server-side cryptographic randomness and is unaffected by item prices, store guards or districts. The paid roulette fee is replaced by a caught-wheel fine: `max(ceil(liveMarketValue × 1.5), ceil(previousFine × 0.5))`. The previous fine includes the J€20 minimum, a 4× value multiplier, district and Security skill effects. A Security Guard changes catch probability rather than fine size. A J€100 item therefore risks a J€200 fine at an ordinary unguarded location.

`test/blackjack.test.mjs` simulates 60,000 seeded hands using a hit/stand strategy and checks ordinary win/loss/push frequencies. At zero Heat, a new loss gets an independent 30% caught / 70% escape wheel, or 50% caught / 50% escape with an active Security Guard. Heat increases these catch odds as described below. This reduces ordinary expected fine cost by 70%, without changing fair card odds, and gives a small positive expected return for ordinary unguarded items at their nominal market value. Security Guards raise catch probability; Security skill ranks, safe districts and the minimum fine raise fine amounts. High resale proceeds can make theft more profitable. These are simulation results, not player telemetry; assetless offenders instead pay through escalating loss of application access. Future market changes and voluntary overpayments can still change realized proceeds.

Cash pays fines first, then the bailiff seizes inventory at current market estimates. Bidder-backed listings and hidden palette reward inventory stay protected while debt waits for assets. With no unsold inventory and unpaid debt, the remaining amount becomes 5/15/45-minute jail sentences, increasing threefold to a 24-hour cap according to recorded catches. Only a caught wheel incurs a fine. Unfinished hands lose after ten minutes; pending wheels resolve automatically after two more minutes. The roll is drawn once, kept private until settlement, and cannot change across retries or reloads. Wins and pushes bypass the wheel; escape gives neither loot nor fine. Existing paid attempts preserve their original saved terms. Ownership transfer, fines, seizures and receipts are atomic and idempotent; player and store cooldowns are removed as of 23 October 2026. A player must still finish the current hand or police wheel before starting another attempt.

## Balance patch — 14 October 2026

- Base hourly visitors for every store size increase by 25%: 1.25 / 2.5 / 6.25 / 13.75 before popularity and district multipliers. Fractional visitors retain deterministic hourly rounding.
- Positive and negative review effects on popularity and traffic are 150% stronger than the original baseline (the earlier +25% effect doubled): the review multiplier ranges from −25% to +25% before the existing popularity cap and confidence prior.
- New theft quotes halve fines, including the small-item floor (J€20 → J€10), with an explicit minimum of 1.5× live item value. Districts and Security skill still apply; accepted attempts retain their saved quotes.
- Normal-item resale NPCs consider bids 1.2× as often: their initial and repeat delays are divided by 1.2. Existing interest uses the new repeat delay after its next due tick. Budgets, demand and sealed-palette bidding slots retain their existing rules.
- Daily games completed after the patch pay exactly J€1,000, including runs started earlier. Completed receipts are preserved; retries cannot pay twice. Case rarity still uses the existing score-based weights.

## Security guard — 14 October 2026

Security Guards are toggleable in store management. They charge 5% of net tracked sale profits earned while active, with fractional fees carried across sales and toggles, no upfront payment and no retroactive charge. Unknown acquisition costs stay excluded; rewards with a known zero cost count as profit. Losses offset future profits. Player purchases, NPC sales and sale events share the same accounting; tills retain net proceeds and displayed trading profit includes guard expenses. New failed thefts use 30% catch odds normally or 50% with a guard; guard fine doubling is removed. Quotes and heist entry display and validate current odds, which freeze for that attempt. Old active hands/pending wheels retain their saved original risk. A caught thief credits the entire saved fine to the store owner’s wallet once, even when the thief’s unpaid amount is converted to jail.

## Mystery palette profit — 15 October 2026

New mystery stock auctions keep the previous reference quantity distribution for starting prices and NPC risk budgets. Actual quantity odds give weights above the reference mean a relative boost: 40% for Starter, 30% for Warehouse and 30% for Jackpot. Item rarity odds, three independent draws, quantity limits and Luck remain unchanged. Offers freeze the improved odds and their original bidding reference quantity; old auctions and saved openings retain their contracts. Public quantity percentages include the improvement and any applicable Luck.

The target is roughly 20% more profitable openings **relative to the previous probability**, measured at the same starting bid and stable market values, not 20 percentage points or guaranteed realized resale profit. Run `node scripts/palette-profit-report.mjs` (packaged archive) or add `--stress` for a broad synthetic archive. The report calculates exact three-draw probabilities and expected returns for each size at unchanged starting prices and NPC budgets. Neutral-market profit chances rose by 17.58–22.60% relatively across the packaged and stress archives (roughly 5–6 percentage points). Competitive player bids and subsequent market movement still change actual profit.


## Mystery palette return protection — 19 October 2026

At the first opening of every unopened mystery stock palette, an independent 80% roll now guarantees contents worth at least 110% of the actual winning price. All other openings return at least 90%, so opening-value losses cannot exceed 10%. The server adds physical copies of the most valuable drawn item to cover a shortfall; original item prices, rarities and natural jackpots remain intact. Base quantity limits apply before these additional units. Live market value at opening determines the supplement, including market movement since creation or bidding. Sale proceeds and later market prices are not guaranteed.

This also covers existing unopened mystery wins with older frozen base odds; saved results replay unchanged. Starting prices, proxy refunds and NPC budgets retain their previous baseline. Acquisition costs still sum to the paid bid across every minted unit. Protection and saved results share the opening transaction, so errors roll back all additions and retries never grant a second supplement.

The minimum expected opening return is `0.8 × 1.1 + 0.2 × 0.9 = 1.06` at any paid price. The profit report now shows conservative lower bounds for protected win probability and return, compared with the 15 October quantity buff. These are opening market values, not realized sales. Pure branch sweeps and auction integration tests cover the 80% threshold, 90% floor, market drops, actual competitive winning prices, rollback and replay.


## Theft Heat — 23 October 2026

Each player starts with zero wanted stars and can reach five, in half-star steps. A committed theft attempt adds half a star; a successful theft adds another half-star per stolen item worth less than J€500, one star from J€500, one-and-a-half from J€2,500, or two from J€10,000. Each additional stolen item contributes again, so both item value and the number of items stolen matter. The successful-theft increment uses the server's live reference value at the start, independent of the owner's shelf markup, and only applies when ownership actually transfers. Failed starts and receipt replays add nothing; failed transfers roll back the increment.

One half-star fades every 30 real minutes, including offline. Reads do not reset the clock; partial elapsed intervals carry across subsequent attempts. Heat survives restarts and Prestige, while an administrative economy reset clears it. No existing theft history is converted into retroactive Heat.

Every full star adds 10 percentage points to police catch odds after the guard baseline and Prestige reduction, capped at 95%. The preview uses the player's current Heat; starting the hand adds Heat for later attempts. The accepted hand freezes both its catch chance and its potential stolen-item increment, so time, later price changes and replays cannot change its saved terms. The police wheel's colored area and stopping angle reflect the exact saved odds, including half-stars and fractional Prestige odds. Stars and the value-based increments are shown in stores and the player's profile in English and German.


## Case Store rebates — 23 October 2026

Administrators can schedule a percentage rebate for any named Case Store case or all five cases, with explicit start/end times, and stop it early. Rebates range from 1% to 100%, apply to all buyers, and persist across restarts. Intervals include the start and exclude the end. Overlapping offers use the highest percentage, then the latest expiry; they never compound with one another. Apply the rebate to the buyer's normal price after Prestige, rounding up to whole J€. A 100% rebate is free but still consumes global stock. Contents and rarity odds keep their existing rules.

The Case Store shows the original buyer price, sale price, percentage and expiry. Starting, expiring or stopping a rebate updates the quote revision; purchases revalidate the current revision atomically before charging or consuming stock. Saved purchases retain their paid cost and can be replayed or opened after expiry without another charge. Rebates apply to direct Case Store purchases, not auction winning bids or already owned cases. An economy reset clears rebate schedules.


## Case winning values — 23 October 2026

Direct Case Store prices keep their existing expected-value baseline. Each offer now selects real items near its price from the frozen mixed and category editions, retains the original valuable jackpot finds, and uses the shared rarity ranking. A value-aware probability distribution favors useful ordinary results rather than allowing a few expensive jackpot items to conceal frequent near-total losses. The usual pool returns at least half the undiscounted case price, with a small ordinary-draw tail that keeps low-value outcomes possible. Its unbuffed expected live reference return targets 95% of the existing undiscounted price; sparse catalogs use the closest available real values rather than inventing item prices or extra copies. Luck applies after this fit and does not reprice the case. Prestige discounts and rebates lower payment without lowering the item quality or draw basis.

Quotes publish the actual resulting rarity probabilities, and sealed draws use that same distribution. New winners remain private and frozen at purchase. Existing unopened paid cases get one first-opening upgrade opportunity when the saved find is worth less than half the recorded acquisition cost. Valuable saved wins, new balanced winners and free Daily grants are preserved. Only real better-valued items qualify; a rare low-result branch remains. The existing reward identity, paid cost, ownership locks and acquisition history remain intact. The upgrade, consumption and saved opening result commit together, and replays cannot reroll or add another item.

Run `node scripts/case-value-report.mjs <archive.json>` or `--stress` for exact before/after value probabilities over multiple rotations and market regimes. The checked-in [case value audit](case-value-balance-report.md) uses an archived snapshot and a synthetic stress pool. These are reference-value models; later market changes and realized auction or store proceeds can differ. Free Daily draw odds retain their separate rules. Legacy paid direct-open cases use the same value-aware probability model within their own themed item pools.


## High-Heat recognition and fines — 23 October 2026

Completed case purchases/openings, palette reveals, inventory sales, player-store purchases, register collections with cash, and auction listings/bids can expose a wanted player to police. Read-only pages, refreshes, authentication, administrative tools, Daily answers and penalty payments do not create checks. Below four stars there is no recognition roll. At four, four-and-a-half and five stars the chance is 2%, 6% and 15% respectively, with at most one random check per two real minutes across all eligible activities. Completed-item/receipt keys are persisted even for skipped checks, so retries cannot reroll them later. Pending theft blackjack/police-wheel attempts keep their existing resolution rather than receiving another recognition check.

| Wanted stars | Recognition per eligible check | Fine multiplier | First recognition sentence |
|---:|---:|---:|---:|
| 4 | 2% | 12× | 15 minutes |
| 4½ | 6% | 18× | 30 minutes |
| 5 | 15% | 30× | 60 minutes |

For comparison, ten independent checks at a constant star level give an 18.3%, 46.1% or 80.3% chance of recognition. Ordinary decay still removes half a star every thirty minutes. Fines scale from the existing theft fine using multipliers for every half-star: 1 / 1.25 / 1.5 / 2 / 3 / 4 / 6 / 8 / 12 / 18 / 30. The accepted theft attempt saves its fine; later Heat changes cannot increase that saved amount. Safer cooled quotes are accepted without exceeding the player's preview.

Recognition fines use a base of the larger of J€250 and 2% of current net worth, multiplied by Heat. Both fine and sentence are fixed when recognized. Recognition occurs after a successful activity: its purchase, item or trade is already saved. A persistent, non-dismissible police encounter then blocks gameplay until the player pays from available cash or chooses the saved jail sentence. Insufficient cash cannot overdraw the account; jail is always available. Serving a recognition sentence retains cash and items. Repeat recorded offenses double the recognition sentence, capped at twenty-four hours. Both choices reduce Heat to at most three stars, and penalty resolution is atomic and idempotent. Reloads, session changes, concurrent tabs and later Heat decay cannot dismiss an unresolved encounter. Timed jail remains enforced by both account and public economy APIs.

Recognition incidents appear in the criminal record and lifetime catch totals. Paid recognition fines are a currency sink and count once in spending statistics. Prestige cannot bypass a pending encounter; completed records retire with the existing criminal-record reset policy while lifetime statistics remain. Administrative economy resets clear recognition checks and encounters.
