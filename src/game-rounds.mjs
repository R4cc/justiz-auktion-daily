import { AccountError } from './errors.mjs';
import { censorCurrencyValues } from './core.mjs';

export const GUESS_TIME_LIMIT_MS = 25_000;

// Explicit allowlist: adding a field to an archive record cannot accidentally
// disclose an answer (including correctPrice, currentBid or finalPrice).
export function publicGameAuction(auction, revealed = false) {
  const fields = ['id', 'title', 'category', 'image', 'images', 'condition',
    'fulfillment', 'location', 'bidCount', 'bids', 'startAt', 'endAt'];
  const result = Object.fromEntries(fields.filter(key => auction[key] !== undefined)
    .map(key => [key, auction[key]]));
  if (auction.description !== undefined) result.description = censorCurrencyValues(auction.description);
  if (revealed) Object.assign(result, { actualBid: auction.actualBid ?? auction.correctPrice,
    startBid: auction.startBid, url: auction.url });
  return result;
}

export function publicRunAuctions(run) {
  return run.auctions.map((auction, position) => {
    const guessing = run.mode !== 'higher-lower';
    const revealed = guessing ? position < run.answers.length : position <= run.answers.length;
    // Daily lots become visible only when their persistent clock has started.
    if (guessing && !revealed &&
        (position !== run.answers.length || !run.roundDeadlineAt)) return {};
    return publicGameAuction(auction, revealed);
  });
}

export function startDailyRound(run, position, now) {
  if (!Number.isInteger(position) || position !== run.answers.length || run.complete)
    throw new AccountError('invalid_position', 409);
  if (!run.roundDeadlineAt) run.roundDeadlineAt = now + GUESS_TIME_LIMIT_MS;
}

export function dailyAnswer(run, answer, now) {
  if (!run.roundDeadlineAt) throw new AccountError('round_not_started', 409);
  if (answer !== null && (typeof answer !== 'number' || !Number.isFinite(answer) || answer < 0 || answer > 1e12))
    throw new AccountError('invalid_guess');
  // Expired submissions complete the round with zero points. Persisting the
  // submitted value separately makes a retry of a late request idempotent.
  return now >= run.roundDeadlineAt ? null : answer;
}

export function publicDailySummary(game) {
  return { date: game.date, gameNumber: game.gameNumber, generatedAt: game.generatedAt,
    auctionCount: game.auctions.length };
}
