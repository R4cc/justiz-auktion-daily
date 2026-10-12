import { randomInt } from 'node:crypto';

export function shuffledDeck(draw = randomInt) {
  const deck = Array.from({ length: 52 }, (_, card) => card);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = draw(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('invalid_card_draw');
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) { const rank = card % 13; total += rank === 0 ? 11 : Math.min(rank + 1, 10); if (rank === 0) aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0, natural: cards.length === 2 && total === 21 };
}
export function dealBlackjack(draw = randomInt) {
  const deck = shuffledDeck(draw), player = [deck.shift()], dealer = [deck.shift()];
  player.push(deck.shift()); dealer.push(deck.shift());
  const game = { deck, player, dealer, turn: 0, outcome: 'active' };
  if (handValue(player).natural || handValue(dealer).natural) game.outcome = handValue(player).natural && handValue(dealer).natural ? 'push' : handValue(player).natural ? 'win' : 'lose';
  return game;
}
export function playBlackjack(game, action) {
  if (game.outcome !== 'active') return game;
  if (!['hit', 'stand'].includes(action)) throw new Error('invalid_blackjack_action');
  game.turn++;
  if (action === 'hit') {
    game.player.push(game.deck.shift());
    if (handValue(game.player).total > 21) { game.outcome = 'lose'; return game; }
    if (handValue(game.player).total < 21) return game;
  }
  // Dealer stands on all 17s, including soft 17. Neither security nor item
  // value changes the deck, card order, dealer decisions or comparisons.
  while (handValue(game.dealer).total < 17) game.dealer.push(game.deck.shift());
  const player = handValue(game.player).total, dealer = handValue(game.dealer).total;
  game.outcome = dealer > 21 || player > dealer ? 'win' : player === dealer ? 'push' : 'lose';
  return game;
}
export function publicBlackjack(game) {
  const active = game.outcome === 'active';
  return { player: game.player, dealer: active ? [game.dealer[0], null] : game.dealer,
    playerTotal: handValue(game.player).total, dealerTotal: active ? null : handValue(game.dealer).total,
    turn: game.turn, outcome: game.outcome };
}
