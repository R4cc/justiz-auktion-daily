import { ECONOMY_BALANCE } from './economy-balance.mjs';
import { storeRatingWeights, PURCHASED_REVIEW_WEIGHT, PURCHASED_REVIEW_WEIGHT_CAP } from './skill-effects.mjs';

export const MAX_STORE_POPULARITY = 1.5;
export const REVIEW_TRAFFIC_MAX_BONUS = ECONOMY_BALANCE.reviewTrafficMaxBonus;
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
  distribution[4].count += rating.purchasedCount;
  const multiplier = multiplierForRating(rating);
  const popularity = Math.min(MAX_STORE_POPULARITY, Math.max(0, shop.traffic_popularity * multiplier));
  return { popularity, popularityPercent: Math.round(popularity / MAX_STORE_POPULARITY * 100),
    rating: rating.weight ? Math.round(rating.stars / rating.weight * 10) / 10 : null,
    reviewCount: rating.count, purchasedReviewCount: rating.purchasedCount,
    purchasedReviewInfluenceCapped: rating.purchasedCount * PURCHASED_REVIEW_WEIGHT >= PURCHASED_REVIEW_WEIGHT_CAP, reviewDistribution: distribution,
    reviewTrafficBonusPercent: Math.round((multiplier - 1) * 1000) / 10 };
}
