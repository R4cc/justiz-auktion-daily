import { publicCaseCatalog } from './cases.mjs';
import { marketCategoryForItem, marketCategoryForTheme } from './market.mjs';

// AuctionPalette domain view over the legacy case system.
//
// cases.mjs stays the single source of truth for building daily editions
// (stock selection, rarity tiers, weights, pricing). This module only renames
// and enriches the public shape so future code can speak in palette terms
// without the case-opening flow changing at all:
//   case            -> palette (same id, name, badge, cost, items)
//   case.category   -> palette.type (the seizure-story theme)
//   availability    -> 'available' | 'restocking'
//   new             -> marketCategory per palette and per item
// Nothing here mutates the catalog or its balancing.
export function paletteFromCase(box) {
  return {
    id: box.id, name: box.name, nameDe: box.nameDe || box.name,
    type: box.category, marketCategory: marketCategoryForTheme(box.category),
    badge: box.badge, cost: box.cost, available: box.available,
    availability: box.available ? 'available' : 'restocking',
    items: (box.items || []).map(item => ({ ...item, marketCategory: marketCategoryForItem(item) }))
  };
}

export function publicPaletteCatalog(catalog) {
  const base = publicCaseCatalog(catalog);
  return {
    revision: base.revision, rotationDate: base.rotationDate, rotatesAt: base.rotatesAt,
    rarities: base.rarities, rewards: base.rewards,
    palettes: base.cases.map(paletteFromCase)
  };
}
