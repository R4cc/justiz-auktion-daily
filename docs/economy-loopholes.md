# Deferred economy loopholes

Audit date: 23 October 2026. These are separate future fixes, not changes made
by the current balance pass. The user limited **every change to 20%** and asked
that larger loophole corrections be deferred. This document changes no reward,
fine, Prestige effect, ownership rule, or existing transaction.

The reproductions below used isolated temporary SQLite databases and real
domain settlement functions. Synthetic accounts, item fixtures, saved perks,
and deterministic theft outcomes made the accounting reproducible. They are
proofs of reachable accounting behavior, not production telemetry, estimates
of abuse frequency, or claims about particular players. Each action used a new
request or auction identity; these are repeated legitimate settlements rather
than replaying one already-settled receipt.

## 1. Theft compensation can exceed collected penalties

**Confirmed:** a caught thief's store owner receives the entire assessed fine,
even when the thief pays none or only part of it. The owner keeps the targeted
stock because the attempt failed. An unpaid portion can become a jail sentence
instead of a currency payment, while the full owner credit remains.

Code pointers:

- `src/storefronts.mjs`: `settleBlackjack()` calls `imposeFine()` and then credits
  `attempt.fee` to `attempt.owner_id` without using the actual collected amount.
- `src/justice.mjs`: `imposeFine()`, `collectFine()`, and `jailDuration()` collect
  cash, store tills and eligible assets, preserve bid-backed auction locks, and
  can convert insolvency into jail. Later collections do not pass an owner or
  compensation claim back into the theft settlement.
- `src/theft-heat.mjs`: `heatScaledFine()` increases the assessed amount; it does
  not make owner compensation conditional on payment.

Verified cold-Heat examples used one J€100 shelf item and an assessed J€200
fine. The owner began each post-store-purchase example with J€99,000:

| Thief's available cash | Cash removed | Owner credit | New combined spendable currency | Result |
|---:|---:|---:|---:|---|
| J€1,000 | J€200 | J€200 | J€0 | Fine paid |
| J€0 | J€0 | J€200 | J€200 | J€200 converted to the first theft jail sentence |
| J€50 | J€50 | J€200 | J€150 | Remaining J€150 converted to jail |

A separate five-star example used a J€10,000 target and a J€600,000 assessed
fine. The assetless thief paid J€0, the owner's cash rose from J€99,000 to
J€699,000, and the J€600,000 shortfall became the first **theft** jail sentence
of five minutes. This is the existing insolvency sentence, not the separate
high-Heat recognition encounter's sentence.

An auction-lock example left the thief with a bid-backed inventory item that
collection must preserve. A J€200 fine initially collected J€0, credited the
owner J€200, and remained J€200 debt. Supplying the thief with J€50 later caused
collection to debit J€50 and leave J€150 debt; the owner received no additional
credit. Thus compensation currently happens upfront, independently of whether
the penalty is paid now, paid later, seized, or converted into jail.

**Implication:** cooperating accounts could turn uncompensated jail time into
owner currency. The isolated proofs confirm the accounting discrepancy; they
do not simulate a long-running multi-account farming operation or claim that
every penalty creates currency. Fully cash-funded penalties conserve it.

Future options requiring a separate decision:

- Pay owner compensation only from actually collected proceeds, with a durable
  claim that later collection can settle once.
- Define how seized inventory value funds compensation without paying the
  same value again, and ensure jail conversion does not count as cash funding.
- Alternatively treat theft fines as a currency sink and remove or separately
  cap owner rewards. This changes current owner benefits substantially.

Required regressions: fully funded, partially funded, insolvent, seized-asset,
store-till and auction-locked cases; later partial payments; jail conversion;
five-star amounts; restart, concurrent settlement and receipt replay. Assert
the combined currency change and retain stock/escrow ownership guarantees.

## 2. Prestige case discounts repeat on secondary transfers

**Confirmed:** resale settlement pays the seller the full agreed price while
returning the winning buyer's Prestige case discount from game funds. Eligibility
is checked for each auction, without a global claim on the physical case. New
auction identities let the same case receive another subsidy.

Code pointers:

- `src/resale.mjs`: `settleListingRow()` computes `caseDiscount` when every lot
  item has `kind === 'case'`, credits it to the winner, and records the reduced
  purchase basis through `acquireItems()`.
- `src/prestige-effects.mjs`: `prestigeEffects()` supplies the 50% case discount;
  `discountedCaseCost()` computes the buyer's effective cost.
- `src/trader.mjs`: `acquireItems()` replaces the new owner's purchase basis;
  it does not track a once-per-physical-case discount claim.

Actual-domain reproduction: two synthetic players each began with J€10,000
and the `cases` Prestige buff. One existing inventory case fixture was traded
back and forth for J€1,000 through `listItem()`, `placeBid()` and
`settleAuction()`. Neither player had the profit buff.

| Completed transfers of the same case | Combined player cash | Cumulative subsidy |
|---:|---:|---:|
| 0 | J€20,000 | J€0 |
| 1 | J€20,500 | J€500 |
| 2 | J€21,000 | J€1,000 |
| 3 | J€21,500 | J€1,500 |
| 4 | J€22,000 | J€2,000 |

After four transfers both players held J€11,000, and the original single
inventory row belonged to its original owner again. The fixture exercised the
real resale accounting for a persisted `kind: 'case'` item; it did not create
or open a hidden sealed reward. Preserving a fully prepared case's hidden
reward across this loop belongs in the eventual integration regression.

Future options: restrict subsidized discounts to primary system purchases, or
record a durable one-time discount entitlement per physical case, carried
through every ownership transfer. Define legacy eligibility and mixed/bulk case
lots explicitly. Reducing the perk by 20% would only reduce the per-transfer
subsidy; it would not bound repetition.

Required regressions: repeated A→B→A transfers of one case, one eligible buyer
versus two, mixed and all-case bundles, arbitrary agreed prices, primary
purchase discounts, saved hidden rewards, concurrent settlement, restart and
replay. Assert that seller proceeds and legitimate escrow refunds remain exact.

## 3. Prestige profit can subsidize wash trading

**Confirmed through both auctions and player stores:** `salePayout()` adds 25%
of positive profit to seller proceeds. A losing resale does not claw back a
previous bonus, and each new owner's acquisition basis resets to their paid
price. Cooperating buyers can repeatedly generate positive-profit sales and
matching loss sales with the same physical item.

Code pointers:

- `src/trader.mjs`: `salePayout()`, `acquireItems()` and `recordSale()` calculate
  a nonnegative bonus from the seller's current acquisition basis and record
  each sale. There is no global per-item consumed bonus budget.
- `src/resale.mjs`: `settleListingRow()` pays `salePayout()` while the buyer's
  escrow covers only the agreed auction price.
- `src/storefronts.mjs`: `buyStoreItem()` charges the buyer the shelf price,
  credits the extra `salePayout()` amount to the store till, and resets the
  buyer's basis. `collectStoreCash()` makes till proceeds spendable.
- `src/prestige-effects.mjs`: `prestigeEffects()` supplies the 25% profit buff.

Auction proof with fixed prices: A and B each started with J€10,000. Only A had
the profit buff. A J€1,000 market-value item began with a J€100 acquisition
basis. Every cycle sold A→B for J€1,000 and B→A for J€100. The first sale minted
`25% × (1,000 − 100) = J€225`; the loss on the return sale minted nothing.
Combined cash after one, two and three cycles was J€20,225, J€20,450 and
J€20,675. The same item returned to A with J€100 basis each time.

A second auction proof used two players starting with J€1 million each, both
with the profit buff, and one J€10,000 item with J€10,000 basis. Four alternating
sales at J€200,000, J€400,000, J€800,000 and J€1,600,000 increased combined cash
to J€2,047,500, J€2,097,500, J€2,197,500 and J€2,397,500 respectively. The item
count stayed one. Agreed prices can therefore also amplify the subsidy.

Player-store proof used two wine popups, no guards, one J€100 wine with J€100
basis, and the profit buff only on A. A's markup was 100% and B's was 0%.
Each cycle sold A→B for J€200, crediting J€225 to A's till, then B→A for J€100,
crediting J€100 to B's till. Post-setup combined cash plus tills progressed:

| Cycles | Player cash | Store tills | Combined cash and tills |
|---:|---:|---:|---:|
| 0 | J€197,500 | J€0 | J€197,500 |
| 1 | J€197,200 | J€325 | J€197,525 |
| 2 | J€196,900 | J€650 | J€197,550 |
| 3 | J€196,600 | J€975 | J€197,575 |

The same wine returned to A after each cycle. Normal shelf-price validation
and player markup limits were respected. Counting wallet cash alone would hide
this creation because the newly minted rewards accumulate in collectible tills.

**A live-value ceiling alone is insufficient:** the fixed-price auction proof
never sells above market value. Replacing 25% with 20% also leaves a repeatable
faucet. A per-account-per-item claim alone permits longer chains of cooperating
accounts; the physical item's reward history must be considered if retaining
player-funded bonus eligibility.

Future options: restrict minted profit rewards to genuinely NPC-funded final
disposals, or track a global per-item paid-bonus/high-water entitlement across
ownership changes. Specify category-market growth, genuine sequential traders,
bulk splits, unknown historical costs and existing saved grants before choosing
a policy. Preserve normal sale prices and profit accounting independently of
whether a trade qualifies for an additional game-funded reward.

Required regressions: both fixed-price and escalating-price auction loops;
player-store loops including tills and cash collection; alternating owners
with only one buff holder; auction/store mixed routes; new accounts in a chain;
NPC buyers, normal NPC store sales and store events; unknown/reward acquisition
bases; guards; bulk lots; restart, rollback and settlement replay. Legitimate
NPC-funded positive-profit rewards must retain the intended advertised benefit
under the chosen policy.

## Future delivery boundary

These issues require separate changes to reward eligibility or compensation
funding, plus migration and compatibility decisions. None is fixed merely by
small rate adjustments. Keep them separate from the current capped balance
changes and obtain authorization for the resulting behavior before implementing
them. Existing balances, item ownership, fine receipts, hidden rewards, auction
escrow and Prestige entitlements were not altered by this audit.
