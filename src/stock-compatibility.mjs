import { marketCategoryForItem } from './market.mjs';
import { auctionSelectionCategory, isToyAuction, isCarAuction } from './auction-selection.mjs';

export function businessTypeForItem(item) {
  if (['review-pack','case'].includes(item.kind)) return null;
  if (['wine', 'toys', 'electronics', 'cars', 'jeweler', 'hardware'].includes(item.businessCategory)) return item.businessCategory;
  if (isToyAuction(item)) return 'toys';
  const category = marketCategoryForItem(item);
  // The wine market also covers drinks. Use the same category rule for
  // supplier units and individual finds; older generic categories can use
  // the shared title/description classifier without rewriting their values.
  if (category === 'wine' || (category === 'other' && auctionSelectionCategory(item) === 'Getränke')) return 'wine';
  if (category === 'vehicles' && isCarAuction(item)) return 'cars';
  if (category === 'watches_jewelry' || (category === 'other' && auctionSelectionCategory(item) === 'Schmuck & Uhren')) return 'jeweler';
  if (['tools','other'].includes(category)) return 'hardware';
  if (category === 'electronics') return 'electronics';
  return null;
}
