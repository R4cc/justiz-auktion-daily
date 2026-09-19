// Usernames are personal data. Anywhere they leave the server without a
// signed-in viewer (leaderboard, marketplace listings, bid history) they are
// reduced to a short prefix plus asterisks, so guests can tell entries apart
// without learning full names. Signed-in viewers always see real names.
const CENSOR = '****';

export function maskUsername(username) {
  if (typeof username !== 'string' || !username) return username;
  // At least two characters of the name must stay hidden, even for the
  // shortest names the registration rules allow.
  const visible = username.length <= 3 ? Math.min(1, username.length - 1) : 2;
  return username.slice(0, visible) + CENSOR;
}

export function maskLeaderboard(board) {
  return { ...board, leaders: board.leaders.map(leader => ({ ...leader, username: maskUsername(leader.username) })) };
}

export function maskListing(listing) {
  return { ...listing, sellerUsername: maskUsername(listing.sellerUsername),
    ...(Array.isArray(listing.bids)
      ? { bids: listing.bids.map(bid => ({ ...bid, bidderUsername: maskUsername(bid.bidderUsername) })) }
      : {}) };
}
