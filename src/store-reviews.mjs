import { createHash } from 'node:crypto';
import { NPC_BUYERS, ensureNpcBuyer } from './npc-roster.mjs';
import { ensureSkillsSchema } from './skill-effects.mjs';

// Influence represents a small simulated audience, distinct from likes earned
// from real purchases or other players. Existing reviews gain that audience too.
export const INFLUENCE_SUPPORT = [0, 3, 7, 12];
const FEEDBACK_COMMENTS = { bargain:'Great value. Very happy with my purchase!', fair:'A fair price. Happy with my purchase.', price_high:'Found what I wanted, but the price was too high.' };
const unit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;
const audiences = new Map();

export function ensureReviewSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS store_reviews (
    business_id TEXT NOT NULL REFERENCES businesses(id), user_id TEXT NOT NULL REFERENCES users(id),
    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5), comment TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(business_id,user_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_review_likes (
    business_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL, PRIMARY KEY(business_id,reviewer_id,user_id),
    FOREIGN KEY(business_id,reviewer_id) REFERENCES store_reviews(business_id,user_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS store_npc_feedback (
    sale_id TEXT PRIMARY KEY REFERENCES business_sales(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id), npc_id TEXT NOT NULL REFERENCES users(id),
    paid INTEGER NOT NULL, reference INTEGER NOT NULL, sentiment TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS store_npc_feedback_author ON store_npc_feedback(business_id,npc_id,created_at DESC);`);
}

export function priceFeedback(npc, paid, reference) {
  const ratio = paid / Math.max(1, reference), fair = 1.25 + (1 - npc.cheapness) * .15;
  if (ratio <= 1.08) return { stars: 5, sentiment: 'bargain', comment: FEEDBACK_COMMENTS.bargain };
  if (ratio <= fair) return { stars: 4, sentiment: 'fair', comment: FEEDBACK_COMMENTS.fair };
  return { stars: ratio <= fair + .2 ? 3 : ratio >= 1.8 ? 1 : 2,
    sentiment: 'price_high', comment: FEEDBACK_COMMENTS.price_high };
}

export function reviewPriceOpinion(stars, comment) {
  const text = comment.toLocaleLowerCase('de');
  const high = /\bexpensive\b|\boverpriced\b|price[sz]? (?:are |is |were |was )?too high|too pricey|teuer|überteuert|preise? (?:sind |ist |waren? )?zu hoch/.test(text);
  const good = /\b(?:cheap|affordable|inexpensive|(?:fair|good|great|reasonable) (?:prices?|value))\b|günstig|preiswert|faire?[nrsm]? preis|gutes? preis/.test(text);
  // A negated or contradictory price comment cannot support either complaint.
  if (/not (?:too )?(?:expensive|overpriced|cheap|affordable)|not (?:a )?(?:fair|good|great|reasonable) (?:price|value)|nicht (?:zu )?(?:teuer|günstig)|kein[en]? (?:fairer? |guter? )?preis/.test(text) || (high && good)) return null;
  if (high) return 'price_high';
  if (good) return 'fair';
  // Star-only reviews convey overall satisfaction. Unrelated written complaints
  // (staff, shipping, etc.) cannot be inferred from the NPC's purchase price.
  if (!text.trim()) return stars >= 4 ? 'fair' : stars <= 2 ? 'price_high' : null;
  return null;
}

export function recordNpcStoreFeedback(db, { saleId, shopId, category, paid, reference, now }) {
  ensureReviewSchema(db);
  if (db.prepare('SELECT 1 FROM store_npc_feedback WHERE sale_id=?').get(saleId)) return;
  const shop = db.prepare(`SELECT 1 FROM businesses b JOIN users u ON u.id=b.user_id
    WHERE b.id=? AND u.npc=0 AND u.banned=0`).get(shopId);
  const sale = db.prepare('SELECT 1 FROM business_sales WHERE id=? AND business_id=? AND price=? AND sold_at=?').get(saleId,shopId,paid,now);
  if (!shop || !sale || !saleId.startsWith('npc:')) return;
  if (!audiences.has(category)) audiences.set(category,NPC_BUYERS.filter(npc => npc.categories.includes(category)));
  const pool = audiences.get(category), available = pool.length ? pool : NPC_BUYERS;
  const npc = available[Math.floor(unit(`${shopId}:${saleId}:reviewer`) * available.length)];
  ensureNpcBuyer(db,npc,now);
  if (!db.prepare('SELECT 1 FROM users WHERE id=? AND npc=1 AND banned=0').get(npc.id)) return;
  const feedback = priceFeedback(npc,paid,reference);
  db.prepare('INSERT INTO store_npc_feedback VALUES(?,?,?,?,?,?,?)').run(saleId,shopId,npc.id,paid,reference,feedback.sentiment,now);
  const previous = db.prepare('SELECT stars,comment,updated_at FROM store_reviews WHERE business_id=? AND user_id=?').get(shopId,npc.id);
  if (previous && now >= previous.updated_at && (previous.stars !== feedback.stars || previous.comment !== feedback.comment)) {
    db.prepare('DELETE FROM store_review_likes WHERE business_id=? AND reviewer_id=?').run(shopId,npc.id);
  }
  // A recurring buyer updates their own review; catching up old hours never
  // overwrites newer feedback. No synthetic human purchase receipts are minted.
  db.prepare(`INSERT INTO store_reviews VALUES(?,?,?,?,?) ON CONFLICT(business_id,user_id)
    DO UPDATE SET stars=excluded.stars,comment=excluded.comment,updated_at=excluded.updated_at
    WHERE excluded.updated_at>=store_reviews.updated_at`).run(shopId,npc.id,feedback.stars,feedback.comment,now);
  const opinion = feedback.sentiment === 'price_high' ? 'price_high' : 'fair';
  const reviews = db.prepare(`SELECT r.user_id,r.stars,r.comment,r.updated_at FROM store_reviews r
    JOIN users u ON u.id=r.user_id WHERE r.business_id=? AND u.npc=0 AND u.banned=0 AND r.updated_at<=?`).all(shopId,now);
  for (const review of reviews) if (reviewPriceOpinion(review.stars,review.comment) === opinion) {
    db.prepare('INSERT OR IGNORE INTO store_review_likes VALUES(?,?,?,?)').run(shopId,review.user_id,npc.id,now);
  }
}

export function storeReviewList(db, shopId, viewerId = '') {
  ensureSkillsSchema(db);
  // Separate limits keep NPC activity from pushing players off the first page.
  const select = `SELECT r.stars,r.comment,r.updated_at AS updatedAt,u.username,r.user_id AS reviewerId,
    u.npc,COALESCE(s.rank,0) AS influenceRank,
    (SELECT COUNT(*) FROM store_review_likes l JOIN users lu ON lu.id=l.user_id
      WHERE l.business_id=r.business_id AND l.reviewer_id=r.user_id AND lu.banned=0) AS earnedLikes,
    EXISTS(SELECT 1 FROM store_review_likes l WHERE l.business_id=r.business_id
      AND l.reviewer_id=r.user_id AND l.user_id=?) AS liked
    FROM store_reviews r JOIN users u ON u.id=r.user_id
    LEFT JOIN user_skills s ON s.user_id=r.user_id AND s.skill_id='influence'
    WHERE r.business_id=? AND u.banned=0 AND u.npc=? ORDER BY r.updated_at DESC,r.user_id LIMIT ?`;
  const rows = [...db.prepare(select).all(viewerId,shopId,0,30),...db.prepare(select).all(viewerId,shopId,1,8)];
  return rows.map(({ earnedLikes, ...row }) => {
    const influenceLikes = row.npc ? 0 : INFLUENCE_SUPPORT[row.influenceRank];
    const feedback = row.npc ? Object.keys(FEEDBACK_COMMENTS).find(key => FEEDBACK_COMMENTS[key] === row.comment) || null : null;
    return { ...row, feedback, npc:Boolean(row.npc), liked:Boolean(row.liked), influenceLikes, likes:earnedLikes+influenceLikes,
      canLike:Boolean(viewerId && viewerId !== row.reviewerId) };
  });
}
