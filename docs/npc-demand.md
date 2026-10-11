# NPC auction demand

Supplier stock reserves are 85% of the market estimate. This is a wholesale
discount, not a guaranteed resale profit. In an isolated neutral-market audit,
default 70%-estimate listings sold 36 of 42 finds, but only three made a profit.
Listing at acquisition cost plus J€1 and retrying six times sold all 42 at a
profit before this change: every listing UUID selected fresh NPC buyers.
Exact sale totals can vary because listing IDs and inventory IDs are random.

NPC resale buyers now share an audience for the same archived item during a
six-hour UTC window. Ownership changes, splitting bundles, cancelling and
relisting cannot reroll that audience. Items without an archive ID use their
title, market category and reference price. A new window can attract different
buyers; market movements still influence their interest and willingness to pay.

NPC purchases consume demand across all sellers. Each purchased unit fades
linearly out of demand pressure over six hours. Active NPC winning bids and
ended but unsettled NPC wins also commit their entire quantity, preventing a
wave of simultaneous listings from behaving like independent customer pools.
The price multiplier is `max(0.35, 1 / (1 + committedUnits / 8))`. An auction's
own standing bid is excluded from its calculation. Human purchases and bids
do not consume this simulated NPC demand.

Before each future NPC bid, the buyer rechecks market price and demand against
its original private ceiling. A demand or market drop stops further bidding;
accepted bids, escrow, owners, settlements and XP receipts remain intact.
Buyer interest is retained so recovering demand can resume bidding. No new
purchase costs, proxy ceilings or private buyer budgets are published. Public
resale responses add only the coarse `npcDemand` level: steady, limited or low.
Cases use `null`, since NPCs do not bid on sealed cases. Palette auctions and
store customers keep their separate existing rules.

The same cost-plus audit after this change sold 2 of 42 finds over six attempts;
the rest remained owned and could be kept, repriced or stocked in a store.
This is a controlled balance check, not a forecast of live player results.

Run `node scripts/audit-npc-flips.mjs` for default pricing or append `--at-cost`
for the repeated profitable-ask strategy. Both use real supply, acquisition,
escrow, NPC bidding and settlement in a disposable database. Regression tests
also cover audience stability, bundled demand, recovery, human bids, restart
behavior, market drops and unchanged transaction/XP behavior.
