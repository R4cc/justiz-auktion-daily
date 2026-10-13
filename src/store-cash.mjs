import { AccountError } from './errors.mjs';

export function ensureStoreCashSchema(db) {
  if (!db.prepare('PRAGMA table_info(businesses)').all().some(column=>column.name==='cash_balance')) {
    // Historical revenue was already paid into wallets. Start tills at zero.
    db.exec('ALTER TABLE businesses ADD COLUMN cash_balance INTEGER NOT NULL DEFAULT 0 CHECK(cash_balance>=0)');
  }
}
export function creditStoreCash(db, shopId, amount) {
  const shop=db.prepare('SELECT cash_balance FROM businesses WHERE id=?').get(shopId);
  if (!shop) throw new AccountError('business_not_found',404);
  if (!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(shop.cash_balance+amount)) throw new AccountError('token_balance_limit',409);
  db.prepare('UPDATE businesses SET cash_balance=cash_balance+? WHERE id=?').run(amount,shopId);
}
function hasStoreCash(db) {
  return db.prepare('PRAGMA table_info(businesses)').all().some(column=>column.name==='cash_balance');
}
export function storeCashTotal(db,userId) {
  return hasStoreCash(db) ? db.prepare('SELECT COALESCE(SUM(cash_balance),0) AS amount FROM businesses WHERE user_id=?').get(userId).amount : 0;
}
// A till is an owned asset: bailiffs can take it directly without crediting
// spendable wallet cash or requiring a collection click.
export function seizeStoreCash(db,userId,due) {
  if (!due||!hasStoreCash(db)) return 0;
  let paid=0;
  for(const shop of db.prepare('SELECT id,cash_balance FROM businesses WHERE user_id=? AND cash_balance>0 ORDER BY bought_at,id').all(userId)){
    const amount=Math.min(due-paid,shop.cash_balance);
    db.prepare('UPDATE businesses SET cash_balance=cash_balance-? WHERE id=?').run(amount,shop.id);
    paid+=amount;if(paid===due)break;
  }
  return paid;
}
