import { createHash, randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { currentNetWorth, recordNetWorth } from './net-worth.mjs';
import { levelForXp } from './progression.mjs';
import { justiceStatus } from './justice.mjs';
import { AccountError } from './errors.mjs';
import { ensureLoanSchema, loanBalance, payLoan, collectOverdueLoan, LOAN_DAY_MS } from './loan-ledger.mjs';

export const LOAN_OFFERS=Object.freeze([
  {id:'starter',name:'Starter loan',nameDe:'Startkredit',principal:500,requiredLevel:2,requiredNetWorth:2000,dailyInterestPercent:3},
  {id:'trader',name:'Trader loan',nameDe:'Händlerkredit',principal:2500,requiredLevel:4,requiredNetWorth:10000,dailyInterestPercent:4},
  {id:'business',name:'Business loan',nameDe:'Geschäftskredit',principal:10000,requiredLevel:7,requiredNetWorth:25000,dailyInterestPercent:5},
  {id:'enterprise',name:'Enterprise loan',nameDe:'Unternehmenskredit',principal:50000,requiredLevel:10,requiredNetWorth:125000,dailyInterestPercent:6}
].map(offer=>Object.freeze({...offer,feePercent:0,overdueInterestPercent:30,termDays:5})));
export const LOAN_COOLDOWN_MS=LOAN_DAY_MS;
export const LOAN_TERMS_VERSION=createHash('sha256').update(JSON.stringify([LOAN_OFFERS,LOAN_COOLDOWN_MS])).digest('hex');
const fail=(code,status=409)=>{throw new AccountError(code,status);};
function player(db,user){
  const row=db.prepare('SELECT id,xp,tokens,must_change_password FROM users WHERE id=? AND npc=0 AND banned=0').get(user?.id||'');
  if(!row)fail('login_required',401);
  if(row.must_change_password)fail('password_change_required',403);
  return row;
}
function serialize(row,now){
  const balance=loanBalance(row,now),offer=LOAN_OFFERS.find(offer=>offer.id===row.offer_id);
  return {id:row.id,offerId:row.offer_id,name:offer?.name||row.offer_id,nameDe:offer?.nameDe||row.offer_id,
    borrowed:row.principal,principal:balance.principal,interest:balance.interest,total:balance.total,
    fee:row.fee,dailyInterestPercent:row.daily_bps/100,overdueInterestPercent:row.overdue_bps/100,
    createdAt:row.created_at,dueAt:row.due_at,paidAt:row.paid_at,repaid:row.repaid,
    status:row.paid_at!==null?'paid':now>=row.due_at?'overdue':'active'};
}
function view(db,row,now){
  const netWorth=currentNetWorth(db,row.id,{now}).total,level=levelForXp(row.xp);
  const active=db.prepare('SELECT * FROM player_loans WHERE user_id=? AND paid_at IS NULL').get(row.id);
  const last=db.prepare('SELECT MAX(created_at) at FROM player_loans WHERE user_id=?').get(row.id).at;
  const availableAt=last===null?null:last+LOAN_COOLDOWN_MS;
  const justice=justiceStatus(db,row.id,now);
  const blocked=active?'loan_active':justice.jailed||justice.fineDue?'loan_justice_pending':availableAt>now?'loan_cooldown':null;
  return {termsVersion:LOAN_TERMS_VERSION,level,netWorth,tokens:db.prepare('SELECT tokens FROM users WHERE id=?').get(row.id).tokens,
    availableAt,blocked,cooldownHours:24,active:active?serialize(active,now):null,
    offers:LOAN_OFFERS.map(offer=>({...offer,fee:Math.ceil(offer.principal*offer.feePercent/100),
      interestPerDay:offer.principal*offer.dailyInterestPercent/100,
      unlocked:level>=offer.requiredLevel&&netWorth>=offer.requiredNetWorth,
      available:!blocked&&level>=offer.requiredLevel&&netWorth>=offer.requiredNetWorth})),
    history:db.prepare('SELECT * FROM player_loans WHERE user_id=? AND paid_at IS NOT NULL ORDER BY created_at DESC,id LIMIT 10').all(row.id).map(row=>serialize(row,now))};
}
function receipt(db,row,requestId,operation,payload){
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))fail('invalid_request',400);
  const prior=db.prepare('SELECT * FROM loan_receipts WHERE user_id=? AND request_id=?').get(row.id,requestId);
  if(prior){if(prior.operation!==operation||prior.payload!==JSON.stringify(payload))fail('request_conflict');return JSON.parse(prior.result);}
  return null;
}
function saveReceipt(db,userId,requestId,operation,payload,result){
  db.prepare('INSERT INTO loan_receipts VALUES(?,?,?,?,?)').run(userId,requestId,operation,JSON.stringify(payload),JSON.stringify(result));
}
export function loanDashboard(dataDir,user,{now=Date.now()}={}){
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureLoanSchema(db);const row=player(db,user);collectOverdueLoan(db,row.id,now);return view(db,row,now);
  }));
}
export function borrowLoan(dataDir,user,{offerId,termsVersion,requestId}={}, {now=Date.now()}={}){
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureLoanSchema(db);const row=player(db,user),payload={offerId,termsVersion};
    const prior=receipt(db,row,requestId,'borrow',payload);
    if(prior)return {receipt:prior,loans:view(db,row,now)};
    const state=view(db,row,now),offer=state.offers.find(offer=>offer.id===offerId);
    if(termsVersion!==LOAN_TERMS_VERSION)fail('loan_terms_changed');
    if(!offer)fail('invalid_loan',400);
    if(state.blocked)fail(state.blocked);
    if(state.level<offer.requiredLevel)fail('loan_level_required');
    if(state.netWorth<offer.requiredNetWorth)fail('loan_net_worth_required');
    if(!Number.isSafeInteger(row.tokens+offer.principal))fail('token_balance_limit');
    const id=randomUUID(),dueAt=now+offer.termDays*LOAN_DAY_MS;
    db.prepare(`INSERT INTO player_loans(id,user_id,offer_id,principal,remaining,fee,interest_due,daily_bps,overdue_bps,created_at,due_at,accrued_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,row.id,offer.id,offer.principal,offer.principal,offer.fee,offer.fee,
        offer.dailyInterestPercent*100,offer.overdueInterestPercent*100,now,dueAt,now);
    db.prepare('UPDATE users SET tokens=tokens+? WHERE id=?').run(offer.principal,row.id);
    const result={loanId:id,borrowed:offer.principal,fee:offer.fee,createdAt:now,dueAt};
    saveReceipt(db,row.id,requestId,'borrow',payload,result);recordNetWorth(db,row.id,{now});
    return {receipt:result,loans:view(db,row,now)};
  }));
}
export function repayLoan(dataDir,user,{loanId,amount,requestId}={}, {now=Date.now()}={}){
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureLoanSchema(db);const row=player(db,user),payload={loanId,amount};
    const prior=receipt(db,row,requestId,'repay',payload);
    if(prior)return {receipt:prior,loans:view(db,row,now)};
    if(!Number.isSafeInteger(amount)||amount<1)fail('invalid_loan_payment',400);
    const loan=db.prepare('SELECT * FROM player_loans WHERE id=? AND user_id=? AND paid_at IS NULL').get(loanId,row.id);
    if(!loan)fail('loan_not_found',404);
    const payment=Math.min(amount,loanBalance(loan,now).total);
    if(row.tokens<payment)fail('insufficient_tokens');
    const paid=payLoan(db,loan,payment,now);
    db.prepare('UPDATE users SET tokens=tokens-? WHERE id=?').run(paid,row.id);
    const result={loanId,paid,createdAt:now};saveReceipt(db,row.id,requestId,'repay',payload,result);
    recordNetWorth(db,row.id,{now});return {receipt:result,loans:view(db,row,now)};
  }));
}
