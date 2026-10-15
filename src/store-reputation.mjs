import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { storeRatingWeights, PURCHASED_REVIEW_WEIGHT, PURCHASED_REVIEW_WEIGHT_CAP } from './skill-effects.mjs';

export const MAX_STORE_POPULARITY = 1.5;
export const REVIEW_TRAFFIC_MAX_BONUS = ECONOMY_BALANCE.reviewTrafficMaxBonus;
// Shelf space only reduces appeal below 30% of capacity; fuller shelves
// are neutral. Keep the existing maximum 35% reduction near empty.
export const shelfFillFactor = (count, capacity) => .65 + .35 * Math.min(1, Math.max(0, count) / (capacity * .3));
export const assortmentPopularity = (count, varietyFactor, valueFactor, fillFactor) =>
  count ? Math.round(Math.min(MAX_STORE_POPULARITY, Math.max(.3, varietyFactor * valueFactor * fillFactor)) * 100) / 100 : 0;
const PRIOR_REVIEWS = 20, PRIOR_STARS = 3;

function multiplierForRating(rating) {
  // Neutral prior prevents a single five-star review from transforming sales.
  const confidenceRating = (rating.stars + PRIOR_REVIEWS * PRIOR_STARS) / (rating.weight + PRIOR_REVIEWS);
  return 1 + (confidenceRating - PRIOR_STARS) / 2 * REVIEW_TRAFFIC_MAX_BONUS;
}
export function reviewTrafficMultiplier(db, shopId, now) {
  return multiplierForRating(storeRatingWeights(db, shopId, now));
}
export function storePopularity(db, shop, now) {
  const multiplier = reviewTrafficMultiplier(db, shop.id, now);
  return Math.min(MAX_STORE_POPULARITY, Math.max(0, shop.traffic_popularity * multiplier));
}
export function storeReputation(db, shop, now) {
  const rating = storeRatingWeights(db, shop.id, now);
  const distribution = [1, 2, 3, 4, 5].map(stars => ({ stars, count: 0 }));
  for (const row of db.prepare(`SELECT r.stars,COUNT(*) AS count FROM store_reviews r JOIN users u ON u.id=r.user_id
    WHERE r.business_id=? AND u.banned=0 AND r.updated_at<=? GROUP BY r.stars`).all(shop.id,now)) distribution[row.stars - 1].count = row.count;
  for (const row of db.prepare('SELECT stars,SUM(review_count) AS count FROM store_review_packs WHERE business_id=? AND redeemed_at<=? GROUP BY stars').all(shop.id,now)) distribution[row.stars - 1].count += row.count;
  const multiplier = multiplierForRating(rating);
  const popularity = Math.min(MAX_STORE_POPULARITY, Math.max(0, shop.traffic_popularity * multiplier));
  return { popularity, popularityPercent: Math.round(popularity / MAX_STORE_POPULARITY * 100),
    rating: rating.weight ? Math.round(rating.stars / rating.weight * 10) / 10 : null,
    reviewCount: rating.count, purchasedReviewCount: rating.purchasedCount,
    purchasedReviewInfluenceCapped: rating.purchasedCount * PURCHASED_REVIEW_WEIGHT >= PURCHASED_REVIEW_WEIGHT_CAP, reviewDistribution: distribution,
    reviewTrafficBonusPercent: Math.round((multiplier - 1) * 1000) / 10 };
}

// Explain the stored assortment score, rather than inventing a new score from
// shelves that may have changed through sales since the last stock transfer.
export function storePopularityBreakdown(db, shop, location, now) {
  const percent=value=>Math.round(value/MAX_STORE_POPULARITY*100);
  const stockPercent=percent(shop.traffic_popularity);
  let snapshot=null;
  try {snapshot=JSON.parse(shop.popularity_factors||'null');}catch{}
  const recorded=[1,2].includes(snapshot?.version)&&snapshot.basePopularity===shop.traffic_popularity;
  const factors=[];
  let basePercent=stockPercent;
  if(recorded){
    basePercent=percent(.65);
    if(!snapshot.count)factors.push({id:'empty_shelves',points:-basePercent});
    else {
      const varietyPercent=percent(snapshot.varietyFactor),valuePercent=percent(Math.round(snapshot.varietyFactor*snapshot.valueFactor*100)/100);
      factors.push({id:'variety',points:varietyPercent-basePercent,count:snapshot.variety},
        {id:'stock_value',points:valuePercent-varietyPercent},
        {id:'shelf_fill',points:stockPercent-valuePercent,count:snapshot.count,capacity:snapshot.capacity});
    }
  }
  const multiplier=reviewTrafficMultiplier(db,shop.id,now);
  const totalPercent=percent(Math.min(MAX_STORE_POPULARITY,Math.max(0,shop.traffic_popularity*multiplier)));
  factors.push({id:'reviews',points:totalPercent-stockPercent,direction:Math.sign(multiplier-1)});
  const trafficMultiplier=location?.trafficMultiplier??1;
  return {basePercent,baseLabel:recorded?'base':'recorded_stock',factors,totalPercent,
    recordedAt:recorded?snapshot.updatedAt:null,trafficMultiplier,visitorEffectPercent:Math.round((trafficMultiplier-1)*100)};
}
