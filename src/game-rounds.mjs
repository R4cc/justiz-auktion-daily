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
  if (!run.roundDeadlineAt) {
    run.roundDeadlineAt = now + GUESS_TIME_LIMIT_MS;
    delete run.roundDraft;
  }
}

function validateGuess(answer) {
  if (answer !== null && (typeof answer !== 'number' || !Number.isFinite(answer) || answer < 0 || answer > 1e12))
    throw new AccountError('invalid_guess');
}

export function saveDailyDraft(run, position, answer, revision, now) {
  if (run.mode === 'higher-lower') throw new AccountError('invalid_mode');
  if (!Number.isInteger(position) || position !== run.answers.length || run.complete)
    throw new AccountError('invalid_position', 409);
  if (!run.roundDeadlineAt) throw new AccountError('round_not_started', 409);
  validateGuess(answer);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new AccountError('invalid_request');
  if (now >= run.roundDeadlineAt || revision <= (run.roundDraft?.revision || 0)) return { saved: false };
  run.roundDraft = { answer, revision };
  return { saved: true };
}

export function dailyAnswer(run, answer, now) {
  if (!run.roundDeadlineAt) throw new AccountError('round_not_started', 409);
  validateGuess(answer);
  // Only a draft received before the deadline can score after expiry. A blank
  // or invalid current field still counts as a missed guess, never an old bid.
  if (now < run.roundDeadlineAt) return answer;
  return answer === null ? null : run.roundDraft?.answer ?? null;
}

export function publicDailySummary(game) {
  return { date: game.date, gameNumber: game.gameNumber, generatedAt: game.generatedAt,
    auctionCount: game.auctions.length };
}
