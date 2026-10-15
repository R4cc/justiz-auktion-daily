// The public price is separate from the leader's private, escrowed ceiling.
// Earlier bids win ties; a challenger must exceed the ceiling to take over.
export function proxyMinimum(currentBid, leaderMax, leaderId, bidderId, startPrice, increment) {
  if (leaderId === bidderId) return (leaderMax ?? currentBid) + increment;
  return currentBid === null ? startPrice : currentBid + increment;
}

export function resolveProxyBid(currentBid, leaderMax, leaderId, bidderId, amount, startPrice, increment) {
  if (leaderId === null) return { leaderId: bidderId, maxBid: amount, visibleBid: startPrice,
    challengerBid: startPrice, autoBid: null };
  if (leaderId === bidderId) return { leaderId, maxBid: amount, visibleBid: currentBid,
    challengerBid: currentBid, autoBid: null };
  const ceiling = leaderMax ?? currentBid;
  if (amount > ceiling) return { leaderId: bidderId, maxBid: amount,
    visibleBid: Math.min(amount, ceiling + increment), challengerBid: Math.min(amount, ceiling + increment), autoBid: null };
  const visibleBid = Math.min(ceiling, amount + increment);
  return { leaderId, maxBid: ceiling, visibleBid, challengerBid: amount, autoBid: visibleBid };
}

// A private read model for the signed-in bidder. Only money reserved on this
// lot can supplement their wallet; another leader's ceiling stays private.
export function proxyBidBudget(currentBid, leaderMax, leaderId, bidderId, startPrice, increment, tokens) {
  const leading = leaderId === bidderId;
  const reservedMaximum = leading ? leaderMax ?? currentBid : 0;
  return { leading, reservedMaximum, availableTokens: tokens,
    minimumBid: proxyMinimum(currentBid, leaderMax, leaderId, bidderId, startPrice, increment),
    maximumBid: Math.min(Number.MAX_SAFE_INTEGER, tokens + reservedMaximum) };
}
