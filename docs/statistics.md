# Profile statistics

The authenticated `GET /api/account/statistics` endpoint returns the current player's recorded lifetime statistics. It does not accept another player's ID. The Profile Statistics tab groups these into money, cases, trading, stores, theft, and games, with earnings and case-rarity breakdowns.

## Accounting definitions

- Money earned includes sale proceeds, game rewards, gifts, tips, cash windfalls, and theft fines received by store owners. Store earnings count when earned, including money still in registers.
- Money spent includes settled purchases, recorded store opening costs, tips, guard wages, cash fines, and cash losses from store events. Starting money, bid deposits, unused bid refunds, and register collection are excluded from income and expenses.
- Total case cost includes paid case purchases from the Case Store and settled case auctions, even when the cases are unopened. Opened case cost is shown separately. Free Daily cases cost zero. Prestige discounts use the actual paid price.
- Case value is the reference value of the items revealed when opening cases, not cash income or their later market value. Unopened cases contribute no result value or rarity information. Opening retries count once; transferring a sealed case does not attribute its eventual opening to the seller.
- Items sold includes business, auction, and instant sales. Trading profit subtracts recorded acquisition costs and associated guard wages from purchased-item proceeds. Free rewards and sales with unknown acquisition costs are excluded from this profit calculation.
- Store visitors combine recorded NPC visitors and unique player visits per store and day. Register collections count only receipts that collected positive cash.
- Theft counters follow each attempt's latest outcome. Fine expenses count actual cash and register money collected, rather than assigning a cash value to seized inventory or jail sentences.
- Game records include completed rounds, recorded rewards, best scores/streaks, and XP earned. Other counters include Prestige resets and verified store reviews; editing a review does not create another posted-review count.

## Persistence and older data

`user_statistics_events` stores actor-scoped snapshots keyed by stable receipt/source IDs. Repeated reads and payment retries update the same event rather than accumulating duplicates. Synchronization and reads run transactionally; fine cash payments also record their actual payment events directly.

Prestige snapshots recoverable history before clearing acquisition ledgers or retiring inventory and businesses. The statistics ledger remains through Prestige. An administrator's global economy reset clears it along with economy history.

Older receipts are backfilled where the original data exists. Historical store opening costs and some older purchase/payment history cannot be recovered reliably. Unknown costs remain unknown instead of being reconstructed from today's prices; the UI identifies missing costs and describes totals as recorded lifetime history. Statistics cannot recover data deleted by a past economy reset.
