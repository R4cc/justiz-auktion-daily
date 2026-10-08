export const BID_RESPONSE_WINDOW_MS = 10_000;

// Called only after a bid has passed validation, inside the auction's write
// transaction. Every accepted bid leaves at least ten seconds to respond.
export const auctionEndAfterBid = (endsAt, now) => Math.max(endsAt, now + BID_RESPONSE_WINDOW_MS);
