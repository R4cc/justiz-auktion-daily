import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';

export const LOAN_DAY_MS = 86400000;
const DENOMINATOR = BigInt(LOAN_DAY_MS) * 10000n;
const exists = db => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='player_loans'").get());
const safe = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new AccountError('token_balance_limit',409);
  return result;
};
export function ensureLoanSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS player_loans (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), offer_id TEXT NOT NULL,
    principal INTEGER NOT NULL CHECK(principal>0), remaining INTEGER NOT NULL CHECK(remaining>=0),
    fee INTEGER NOT NULL CHECK(fee>=0), interest_due INTEGER NOT NULL CHECK(interest_due>=0),
    interest_fraction INTEGER NOT NULL DEFAULT 0 CHECK(interest_fraction>=0),
    daily_bps INTEGER NOT NULL, overdue_bps INTEGER NOT NULL,
    created_at INTEGER NOT NULL, due_at INTEGER NOT NULL, accrued_at INTEGER NOT NULL,
    paid_at INTEGER, repaid INTEGER NOT NULL DEFAULT 0 CHECK(repaid>=0)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS player_loans_active ON player_loans(user_id) WHERE paid_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_loans_due ON player_loans(due_at) WHERE paid_at IS NULL;
  CREATE TABLE IF NOT EXISTS loan_receipts (
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    operation TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(user_id,request_id)
  ) STRICT`);
}
// Simple interest on remaining principal, split exactly at maturity. Fractional
// tokens carry across ticks; read cadence cannot compound or erase interest.
export function loanBalance(row, now = Date.now()) {
  if (row.paid_at !== null) return {principal:0,interest:0,total:0,fraction:0,accruedAt:row.accrued_at};
  const until = Math.max(now,row.accrued_at);
  const regular = Math.max(0,Math.min(until,row.due_at)-row.accrued_at);
  const overdue = Math.max(0,until-Math.max(row.accrued_at,row.due_at));
  const numerator = BigInt(row.interest_fraction) + BigInt(row.remaining) *
    (BigInt(regular)*BigInt(row.daily_bps)+BigInt(overdue)*BigInt(row.overdue_bps));
  const whole = safe(BigInt(row.interest_due)+numerator/DENOMINATOR);
  const fraction = safe(numerator%DENOMINATOR), interest = whole + Number(fraction>0);
  return {principal:row.remaining,interest,total:safe(BigInt(row.remaining)+BigInt(interest)),
    fraction,wholeInterest:whole,accruedAt:until};
}
export function loanDebt(db,userId,now=Date.now()) {
  if (!exists(db)) return 0;
  const row=db.prepare('SELECT * FROM player_loans WHERE user_id=? AND paid_at IS NULL').get(userId);
  return row ? loanBalance(row,now).total : 0;
}
// Call inside the same transaction as the debit. Interest/fees are paid first;
// partial payments reduce future interest only once they reduce principal.
export function payLoan(db,row,amount,now) {
  const balance=loanBalance(row,now),paid=Math.min(amount,balance.total);
  if (!paid) return 0;
  const interest=Math.max(0,balance.interest-paid);
  const remaining=balance.principal-Math.max(0,paid-balance.interest);
  const paidAt=remaining+interest===0 ? now : null;
  // Preserve sub-token precision until the interest balance is fully paid.
  // Settling its final fractional token rounds up to one whole token.
  const fraction=interest && balance.fraction ? balance.fraction : 0;
  const whole=interest-Number(fraction>0);
  db.prepare(`UPDATE player_loans SET remaining=?,interest_due=?,interest_fraction=?,accrued_at=?,paid_at=?,repaid=repaid+? WHERE id=?`)
    .run(remaining,whole,fraction,balance.accruedAt,paidAt,paid,row.id);
  return paid;
}
export function collectOverdueLoan(db,userId,now=Date.now()) {
  if (!exists(db)) return 0;
  const row=db.prepare('SELECT * FROM player_loans WHERE user_id=? AND paid_at IS NULL AND due_at<=?').get(userId,now);
  if (!row) return 0;
  const tokens=db.prepare('SELECT tokens FROM users WHERE id=?').get(userId)?.tokens||0;
  const paid=payLoan(db,row,tokens,now);
  if (paid) db.prepare('UPDATE users SET tokens=tokens-? WHERE id=?').run(paid,userId);
  return paid;
}
export function tickLoans(dataDir,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    if (!exists(db)) return null;
    let collected=0;
    for(const row of db.prepare('SELECT user_id FROM player_loans WHERE paid_at IS NULL AND due_at<=?').all(now))
      collected+=collectOverdueLoan(db,row.user_id,now);
    return {collected};
  }));
}
