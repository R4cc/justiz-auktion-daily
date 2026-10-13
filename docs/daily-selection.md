# Daily auction selection

Daily draws five unique product families from the collected Justiz-Auktion archive. It uses at least four categories, with at most two lots from any category and at most one drinks lot. Recently featured categories receive a ranking penalty. Previously used lots and their duplicate families remain excluded.

Wine, including sparkling wine and producer-only listings identified through bottle/vintage metadata, has a single deterministic 5% eligibility draw per UTC day and a 14-day cooldown after appearing. The draw is shared by every wine listing, so adding more wine to the archive does not increase its chance. Other drinks are not subject to this wine rule. If excluding wine makes a complete, varied Daily impossible, the picker can use one wine lot to keep the game playable.

Within the variety limits, the picker favors live source auctions, higher real source bid counts, and higher source prices. Bid counts come from the collector's `Anzahl Gebote` field. Player bids, NPC bids, J€ prices, and marketplace estimates are not selection signals. Bid-count and price bonuses grow logarithmically and are capped; small date-seeded variation and price/end-time variety keep comparable choices from becoming a fixed list.

Selection version 6 applies to newly generated Dailies. Existing saved Dailies and started games keep their original lots and frozen prices. Free Play and Higher or Lower keep their existing selection rules.
