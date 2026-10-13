# Store popularity and positive review auctions

Popularity keeps the existing assortment appeal: stock variety, average value and shelf fill. The review system applies a small multiplier before the existing 1.5 ceiling. The UI maps this shared effective value to a 0–100% meter on store cards, owner dashboards, storefronts and the town list.

Customer ratings retain Influence weights of 1, 1.25, 1.5 and 1.75. A purchased five-star review has weight 0.25; all bought reviews together count for at most ten ordinary reviews per store. All actual counts, including purchased reviews, are shown in the five-to-one-star bar chart. Purchased reviews create no customer identities, written comments, purchase receipts or likes.

Foot traffic uses a neutral prior of twenty three-star reviews and a maximum review adjustment of ±10%. Bought reviews alone therefore approach a +3.33% traffic boost at the paid-weight ceiling. They cannot create traffic for an empty store with zero assortment appeal, override the popularity ceiling or generate sale inventory. Buying further packs after that ceiling increases displayed counts but no longer increases paid rating weight.

The Five Star Agency NPC supplies a guaranteed auction at 08:00 UTC and, on about half of days, another at 20:00 UTC. Each window lasts twelve hours and deterministically chooses 5, 10, 15, 20 or 30 reviews. Reserves are J€60 per review. Restarts only backfill still-open windows, preserving their original ending times; window IDs prevent duplicate supply. Standard auction anti-sniping, proxy bids, escrow, refunds, settlement and notifications apply. NPC buyers do not purchase review packs.

The winner receives the original review-pack inventory item. They may keep or resell it, or redeem it for a currently owned store. Redemption requires a live human account, no auction lock and an authentic server-issued pack record. It atomically flushes the store's previous simulated sales, consumes the inventory item, records the five-star counts and sends a notification. The inventory ID is the durable receipt: retries for the same store return the original result, while attempts to use it for another store fail. Rating effects apply only from the redemption timestamp. Unredeemed packs can transfer through normal resale; paid feedback belongs to the chosen store after redemption.

The economy reset clears pack records before dependent inventory, stores and NPC accounts. Balance targets live in `src/economy-balance.mjs`; scheduling and available pack sizes live in `src/review-auctions.mjs`.
