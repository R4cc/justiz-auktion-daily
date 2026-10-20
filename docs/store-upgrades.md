# Store upgrades

Owners can upgrade a store one size at a time from its management overview or settings. The price is 90% of the normal opening price for the target size, store type and current district, rounded to whole J€. The existing property's value is not deducted from this price. The target size's normal level requirement applies.

| Upgrade | Construction time | Required level | Normal capacity | Car-lot capacity |
|---|---:|---:|---:|---:|
| Pop-up → Small | 2 real hours | 3 | 10 → 25 | 1 → 3 |
| Small → Medium | 8 real hours | 6 | 25 → 60 | 3 → 8 |
| Medium → Large | 48 real hours | 10 | 60 → 150 | 8 → 20 |

Payment is taken from available wallet cash when construction starts. The confirmation shows the price, full purchase comparison, duration, target capacity and level requirement. Only one upgrade may be active per store; sizes cannot be skipped. Construction cannot be cancelled except by resetting or Prestiging away the store, which also forfeits the construction payment.

The store remains open with its original size, capacity and visitor rate until completion. Existing stock, cash register, reviews, identity, guard, location and ownership are retained. Offline time counts. The economy runtime, owner dashboard, town map and visitor store reads all finish due upgrades through the same transition. Old-size hours settle before the size changes, so a long offline interval never earns the larger visitor rate retroactively. Completion updates the existing plot and sends one bilingual notification.

The paid construction cost counts as an asset in net worth until completion; afterward the store is valued at its new size's normal purchase price. Upgrade costs count once in lifetime store spending and do not increment stores opened. Receipts and the wallet charge commit atomically, and request retries cannot buy an upgrade twice.

Abandoned stores must receive genuinely new stock before upgrading. A store under active construction cannot be taken over. Construction does not reset its last-restock timestamp: continue stocking it to avoid abandonment once construction finishes. Prestige clears construction from retired stores so a reused plot cannot later change size from a former owner's upgrade. The administrative economy reset removes upgrade receipts with the other economy state.
