# Skill tree, first chapter

The sidebar links to `/skills`. The available branches are Luck multiplier, Increased security and Increased influence. Six other branches are visibly locked and marked Coming soon. Available branches have ranks I–III costing **1, 3 and 6 points**, cumulatively 10 for a completed branch. Rank IV is Coming soon and displays its future cost of 12 points; the domain and database prevent unlocking it now.

Points are derived from the current persisted XP through the shared level curve: **earned = current account level**, including one point at level 1. Existing accounts receive credit immediately without a claim or one-time grant migration. Available points equal earned points minus cumulative costs of purchased ranks. XP level-ups therefore grant exactly one extra point; repeated profile reads, upgrades and reloads cannot duplicate points. The current level cap of 20 provides 20 total points, so players choose how to distribute them. Upgrades do not cost J€ or change XP. No respec is offered in this first chapter; Economy Reset clears ranks and purchase receipts along with XP.

`user_skills` stores current ranks. `skill_purchases` stores actor/request-id receipts. Upgrades require the exact next rank, sufficient fresh points and a valid human session. Locked branches, skipped ranks, stale tabs, receipt conflicts, bans, forced password changes and jail are enforced by the domain. Rank and receipt updates are one transaction. Clients cannot set costs, effects, points or another account's identity. Lost-response retries return the current tree without buying another rank.

## Luck calculation

| Rank | Additional cost | Total spent | Relative luck | Maximum case reference return | Maximum mystery stock reference return |
| --- | ---: | ---: | ---: | ---: | ---: |
| I | 1 | 1 | +3% | 84.46% | 86.99% |
| II | 3 | 4 | +5% | 86.10% | 90.41% |
| III | 6 | 10 | +7% | 87.74% | 93.88% |

Luck increases weights of populated tiers above the lowest populated tier by the stated relative factor. The lowest tier retains its base weight. All weights are scaled by 100 before the bonus is applied, using exact integers; tiny jackpot probabilities are not rounded up. Normalization determines the final displayed probabilities. This is a relative odds multiplier, not a percentage-point addition or a reward-value multiplier.

For any nonnegative outcome values, each unnormalized weight increases by at most `1 + luck/100`, and the normalizing total never decreases. Consequently `lucky EV <= baseline EV × (1 + luck/100)` for any archive distribution. Paid case prices use `ceil(max(base EV, market EV)/0.82)` before skills, bounding rank-III reference return at `0.82 × 1.07 = 87.74%`.

New mystery stock palettes apply the same relative modifier separately to rarity and quantity: higher rarities and quantities above one unit get better odds. These independent expectations multiply, giving the conservative bound `0.82 × 1.07² = 93.8818%` at reserve. Their starting prices include both complete baseline distributions; higher winning bids lower the reference return and never improve the odds. Actual gains are generally smaller, and market movement/store demand affect sale proceeds. See [Stock palettes](stock-palettes.md) for the tier tables. Public odds are previews, not guaranteed totals.

Paid Case Shop draws, legacy direct case draws, newly prepared Daily contents and mystery palette first openings share `luckWeights`. Daily case-tier selection is not boosted a second time. New stock lots freeze only their private source pool, price and chance structure at creation; settlement awards a sealed asset without generating items. The winner's **current rank at first opening**, including upgrades after winning, applies to both rolls. The atomic opening saves items, actual quantities, inventory IDs and Luck once; retries and later upgrades cannot reroll it. Old prepared cases, settled fixed-size palettes and legacy purchases preserve their saved rewards. Public auction metadata uses baseline odds, while signed-in bid rooms/catalogs preview current Luck. Prices and source pools remain unchanged by upgrades.

## Security and influence

Security increases fines for new theft attempts at **all stores owned by the skilled player** by 10%, 20% or 30%. The existing minimum fine, goose guard and district protection form the baseline, then the skill is applied once. Visitor quotes and authoritative heist starts read the owner's current rank. Stale fines are rejected; already-started heists retain their saved fine. Blackjack shuffling, cards, dealer rules, payouts and outcomes are unaffected. The thief's own Security skill does not protect someone else's store.

Influence gives verified reviews more weight in a store's aggregate reputation. Its three ranks use qualitative labels and descriptions; no exact influence percentage is displayed or serialized in the tree/profile. Existing reviews respond to the author's current rank. Individual star ratings, verified-purchase gating, one editable review per customer and banned-author exclusions stay intact. Both store directory and store detail use the same weighted reputation read model. This first pass affects reputation; it does not add a separate NPC sales bonus.

## Routes and verification

- `GET /api/account/skills` returns the own tree, earned/spent/available points, ranks and unlockable definitions.
- `POST /api/account/skills/upgrade` accepts `{skillId,rank,requestId}` and returns `{tree,user}` under the existing session, CSRF and request-throttling rules.

`test/skills.test.mjs` covers every level, exact costs, idempotency, overspend/stale/locked guards, transaction rollback, reset, the analytical EV ceiling across extreme value spreads, actual improved draws, personal quotes, frozen rewards, owner security and fair deck shuffling, verified weighted reviews and HTTP authorization. `scripts/skills-ui-smoke.mjs` checks EN/DE at 1440–320px, point backfill, ranks, future nodes, retry after accepted response loss, stale-tab recovery, persisted upgrades, insufficient-points states, personal luck indicators, guest gating, sidebar badges and navigation cleanup.
