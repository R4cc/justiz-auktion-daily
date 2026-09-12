import { auctionGallery } from './auction-images.mjs';
import { buildAuctionFamilies, chooseVariedAuctions, auctionSelectionCategory } from './auction-selection.mjs';

export function higherLowerDeck(archive, random = Math.random, now = Date.now()) {
  const eligible = archive.filter(item => Number.isFinite(item.finalPrice) && item.finalPrice > 0 &&
    Date.parse(item.endAt) <= now && Date.parse(item.capturedAt) >= Date.parse(item.endAt) &&
    item.title && auctionGallery(item).length);
  let remaining = buildAuctionFamilies(eligible).map(family => family[Math.floor(random() * family.length)]);
  const deck = [];
  // Each five-lot block has four categories and at most one drinks lot.
  while (deck.length < 20) {
    const ranks = new Map(remaining.map(item => [item.id, random()]));
    let block;
    try { block = chooseVariedAuctions(remaining, 5, item => ranks.get(item.id)); }
    catch (error) { if (error.code !== 'insufficient_variety' || !deck.length) throw error; break; }
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    deck.push(...block);
    const selected = new Set(block.map(item => item.id));
    remaining = remaining.filter(item => !selected.has(item.id));
  }
  return { auctions: deck.map(item => ({ id: item.id, title: item.title,
    category: auctionSelectionCategory(item), images: auctionGallery(item),
    image: auctionGallery(item)[0], actualBid: item.finalPrice })) };
}
