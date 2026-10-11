import { marketCategoryForItem } from './market.mjs';
import { auctionSelectionCategory } from './auction-selection.mjs';

export function businessTypeForItem(item) {
  if (['wine', 'toys', 'electronics', 'cars'].includes(item.businessCategory)) return item.businessCategory;
  const category = marketCategoryForItem(item);
  // The wine market also covers drinks. Use the same category rule for
  // supplier units and individual finds; older generic categories can use
  // the shared title/description classifier without rewriting their values.
  if (category === 'wine' || (category === 'other' && auctionSelectionCategory(item) === 'Getränke')) return 'wine';
  if (category === 'vehicles' && /\b(auto|car|pkw|limousine|kombi|sedan|volkswagen|vw|bmw|audi|opel|ford|toyota)\b/i.test(item.title || '') && !/\b(modell|reifen|motor|teil|felge)\b/i.test(item.title || '')) return 'cars';
  if (category === 'electronics') return 'electronics';
  if (['collectibles', 'sport_leisure'].includes(category) && /\b(spielzeug|toy|puzzle|lego|baukasten|building set|board game|brettspiel|puppe)\b/i.test(item.title || '')) return 'toys';
  return null;
}
