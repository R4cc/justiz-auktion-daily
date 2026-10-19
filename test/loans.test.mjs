import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tickEconomy } from '../src/economy-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { loanDashboard,borrowLoan,repayLoan,LOAN_TERMS_VERSION,LOAN_OFFERS } from '../src/loans.mjs';
import { loanBalance,loanDebt,tickLoans,LOAN_DAY_MS as DAY } from '../src/loan-ledger.mjs';
import { currentNetWorth } from '../src/net-worth.mjs';
import { prestigeState,prestigeAccount } from '../src/prestige.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { userStatistics } from '../src/user-statistics.mjs';
const now=Date.parse('2026-10-19T12:00:00Z');
async function fixture(t){
 const dir=await mkdtemp('/tmp/jg-loans-'),accounts=new Accounts(dir,{now:()=>now});
 const user={id:'borrower',admin:true},other={id:'other'};
 accounts.db(db=>{for(const id of [user.id,other.id])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at,admin) VALUES(?,?,'disabled',300000,36100,?,?)").run(id,id,now,Number(id===user.id));});
 t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
 const balance=()=>accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(user.id).tokens);
 const set=(tokens,xp=36100)=>accounts.db(db=>db.prepare('UPDATE users SET tokens=?,xp=? WHERE id=?').run(tokens,xp,user.id));
 const borrow=(offerId='starter',requestId=randomUUID(),at=now)=>borrowLoan(dir,user,{offerId,requestId,termsVersion:LOAN_TERMS_VERSION},{now:at});
 const repay=(loanId,amount,requestId=randomUUID(),at=now)=>repayLoan(dir,user,{loanId,amount,requestId},{now:at});
 return {dir,accounts,user,other,balance,set,borrow,repay,view:(at=now)=>loanDashboard(dir,user,{now:at}),worth:(at=now)=>accounts.db(db=>currentNetWorth(db,user.id,{now:at}))};
}
test('all four offers require both real level and net worth; borrowed cash cannot inflate equity',async t=>{
 const f=await fixture(t);assert.equal(f.view().offers.length,4);
 for(const offer of LOAN_OFFERS){
  f.set(offer.requiredNetWorth,(offer.requiredLevel-1)**2*100-1);
  assert.throws(()=>f.borrow(offer.id),/loan_level_required/);
  f.set(offer.requiredNetWorth-1);
  assert.throws(()=>f.borrow(offer.id),/loan_net_worth_required/);
  f.set(offer.requiredNetWorth);assert.equal(f.view().offers.find(o=>o.id===offer.id).available,true);
 }
 f.set(2000);const before=f.worth().total,result=f.borrow();
 assert.equal(f.balance(),2500);assert.equal(result.loans.active.total,600);
 assert.equal(f.worth().total,before-100);assert.equal(f.worth().loanDebt,600);
 assert.equal(f.view().offers.find(o=>o.id==='trader').unlocked,false);
 assert.throws(()=>f.borrow('enterprise'),/loan_active/);
});
test('borrowing checks frozen terms, isolates actors and is receipt-protected across repayment and restart',async t=>{
 const f=await fixture(t),requestId=randomUUID();
 assert.throws(()=>borrowLoan(f.dir,f.user,{offerId:'starter',termsVersion:'stale',requestId},{now}),/loan_terms_changed/);
 const result=f.borrow('starter',requestId),tokens=f.balance();
 assert.deepEqual(f.borrow('starter',requestId).receipt,result.receipt);assert.equal(f.balance(),tokens);
 assert.throws(()=>f.borrow('trader',requestId),/request_conflict/);
 assert.equal(loanDashboard(f.dir,f.other,{now}).active,null);
 assert.throws(()=>repayLoan(f.dir,f.other,{loanId:result.receipt.loanId,amount:1,requestId:randomUUID()},{now}),/loan_not_found/);
 f.repay(result.receipt.loanId,600);closeDataStore(f.dir);
 assert.deepEqual(f.borrow('starter',requestId).receipt,result.receipt);assert.equal(f.view().active,null);
 assert.equal(f.balance(),299900);
});
test('interest accrues continuously offline at 24 percent daily, then 36 percent overdue, with no fee compounding',async t=>{
 const f=await fixture(t);f.borrow();
 assert.equal(f.view().active.total,600);
 assert.equal(f.view(now+DAY/24).active.total,605);
 assert.equal(f.view(now+DAY).active.total,720);
 // Read the pure ledger: the dashboard deliberately collects overdue cash.
 const row=f.accounts.db(db=>db.prepare('SELECT * FROM player_loans').get());
 assert.equal(loanBalance(row,now+3*DAY).total,960);
 assert.equal(loanBalance(row,now+4*DAY).total,1140);
 closeDataStore(f.dir);
 assert.equal(f.accounts.db(db=>loanDebt(db,f.user.id,now+2*DAY)),840);
 assert.equal(f.worth(now+2*DAY).total,299660);
});
test('read cadence and zero-cash collection do not change interest or round it away',async t=>{
 const f=await fixture(t);f.borrow();f.set(0);
 for(let i=0;i<100;i++)f.view(now+DAY*i/100);
 const before=f.accounts.db(db=>db.prepare('SELECT * FROM player_loans').get());
 assert.equal(loanBalance(before,now+DAY).total,720);
 assert.equal(tickLoans(f.dir,{now:now+4*DAY}).collected,0);
 const after=f.accounts.db(db=>db.prepare('SELECT * FROM player_loans').get());
 assert.deepEqual(after,before);
 assert.equal(loanBalance(after,now-1000).total,600);
});
test('partial repayments pay interest first and lower future interest only after reducing principal',async t=>{
 const f=await fixture(t),{receipt}=f.borrow(),id=receipt.loanId;
 const a=f.repay(id,50,randomUUID(),now+DAY);assert.equal(a.loans.active.interest,170);assert.equal(a.loans.active.principal,500);
 const b=f.repay(id,270,randomUUID(),now+DAY);assert.equal(b.loans.active.interest,0);assert.equal(b.loans.active.principal,400);
 const c=f.view(now+2*DAY);assert.equal(c.active.total,496);assert.equal(c.active.interest,96);
 const paymentId=randomUUID(),paid=f.repay(id,1000,paymentId,now+2*DAY),tokens=f.balance();
 assert.equal(paid.receipt.paid,496);assert.equal(paid.loans.active,null);assert.equal(paid.loans.history[0].repaid,816);
 assert.deepEqual(f.repay(id,1000,paymentId,now+2*DAY).receipt,paid.receipt);assert.equal(f.balance(),tokens);
 assert.throws(()=>f.repay(id,999,paymentId),/request_conflict/);
});
test('repayments reject invalid amounts, insufficient cash, foreign ids and duplicate terminal loans atomically',async t=>{
 const f=await fixture(t),id=f.borrow().receipt.loanId;
 for(const amount of [0,-1,1.1,'500',null,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>f.repay(id,amount),/invalid_loan_payment/);
 f.set(100);assert.throws(()=>f.repay(id,200),/insufficient_tokens/);assert.equal(f.balance(),100);assert.equal(f.view().active.total,600);
 assert.throws(()=>f.repay('not-found',1),/loan_not_found/);
 f.set(600);f.repay(id,600);assert.throws(()=>f.repay(id,1),/loan_not_found/);
});
test('a failed loan or repayment ledger write rolls back the wallet and permits a safe retry',async t=>{
 const f=await fixture(t);f.view();const requestId=randomUUID();
 f.accounts.db(db=>db.exec("CREATE TRIGGER fail_loan_receipt BEFORE INSERT ON loan_receipts BEGIN SELECT RAISE(ABORT,'receipt_failed'); END"));
 assert.throws(()=>f.borrow('starter',requestId),/receipt_failed/);assert.equal(f.balance(),300000);assert.equal(f.view().active,null);
 f.accounts.db(db=>db.exec('DROP TRIGGER fail_loan_receipt'));const id=f.borrow('starter',requestId).receipt.loanId;
 f.accounts.db(db=>db.exec("CREATE TRIGGER fail_loan_receipt BEFORE INSERT ON loan_receipts BEGIN SELECT RAISE(ABORT,'receipt_failed'); END"));
 assert.throws(()=>f.repay(id,600,requestId+'repay'),/receipt_failed/);assert.equal(f.balance(),300500);assert.equal(f.view().active.total,600);
 f.accounts.db(db=>db.exec('DROP TRIGGER fail_loan_receipt'));f.repay(id,600,requestId+'repay');assert.equal(f.view().active,null);
});
test('maturity collects wallet cash once and repeatedly collects later income without stealing escrow or items',async t=>{
 const f=await fixture(t);f.borrow();f.set(200);
 assert.equal(tickLoans(f.dir,{now:now+3*DAY-1}).collected,0);
 assert.equal(tickLoans(f.dir,{now:now+3*DAY}).collected,200);assert.equal(f.balance(),0);
 assert.equal(tickLoans(f.dir,{now:now+3*DAY}).collected,0);
 assert.equal(f.view(now+3*DAY).active.total,760);
 f.set(1000);assert.equal(tickLoans(f.dir,{now:now+3*DAY}).collected,760);assert.equal(f.balance(),240);
 assert.equal(f.view(now+3*DAY).active,null);assert.equal(f.view(now+3*DAY).history[0].repaid,960);
});
test('one day borrowing cooldown survives early repayment and Prestige; active debt blocks Prestige',async t=>{
 const f=await fixture(t),id=f.borrow().receipt.loanId;
 assert.equal(f.accounts.db(db=>prestigeState(db,f.user.id,36100,now)).blocked,'prestige_loan_pending');
 assert.throws(()=>prestigeAccount(f.dir,f.user,{buffId:'profit',expectedCount:0,requestId:randomUUID(),confirmation:'PRESTIGE'},{now}),/prestige_loan_pending/);
 f.repay(id,600);assert.throws(()=>f.borrow('starter',randomUUID(),now+DAY-1),/loan_cooldown/);
 assert.equal(f.view(now+DAY).offers[0].available,true);
 prestigeAccount(f.dir,f.user,{buffId:'profit',expectedCount:0,requestId:randomUUID(),confirmation:'PRESTIGE'},{now});
 assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM player_loans').get().n),1);
 f.set(300000);assert.throws(()=>f.borrow(),/loan_cooldown/);
});
test('borrowing principal never counts as earned income; economy reset removes all liabilities and receipts',async t=>{
 const f=await fixture(t),before=userStatistics(f.dir,f.user,{now});f.borrow();
 const after=userStatistics(f.dir,f.user,{now});assert.deepEqual(after,before);
 assert.equal(f.accounts.profile(f.user).loanDebt,600);
 f.accounts.resetEconomy(f.user,'RESET ECONOMY');assert.equal(f.worth().loanDebt,0);
 for(const table of ['player_loans','loan_receipts'])assert.equal(f.accounts.db(db=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),0);
});
test('fresh authentication state, NPC rejection and justice debts guard every borrow and repayment',async t=>{
 const f=await fixture(t);f.view();
 for(const [setting,message] of [['banned=1','login_required'],['banned=0,npc=1','login_required'],['npc=0,must_change_password=1','password_change_required']]){
  f.accounts.db(db=>db.prepare(`UPDATE users SET ${setting} WHERE id=?`).run(f.user.id));
  assert.throws(()=>f.borrow(),new RegExp(message));assert.throws(()=>f.view(),new RegExp(message));
 }
 f.accounts.db(db=>{db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(f.user.id);db.prepare('INSERT INTO player_justice(user_id,fine_due,jailed_until) VALUES(?,100,0)').run(f.user.id);});
 assert.throws(()=>f.borrow(),/loan_justice_pending/);
});
test('loan HTTP routes require session and CSRF, return private balances, and replay exact receipts',async t=>{
 const f=await fixture(t),env={COOKIE_SECURE:'false'};
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const api=await createAccountApi({dataDir:f.dir,env,json,dailyPayload:async()=>({auctions:[]})});
 const token=f.accounts.atomic(db=>f.accounts.session(db,f.user.id));
 const server=createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost')))json(res,404,{error:'not_found'});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/api/account/`,headers={cookie:`jg_session=${token}`,'x-requested-with':'JUSTIZGUESSR','content-type':'application/json'};
 assert.equal((await fetch(base+'loans')).status,401);
 assert.equal((await fetch(base+'loans/borrow',{method:'POST',headers:{cookie:headers.cookie},body:'{}'})).status,403);
 const state=await(await fetch(base+'loans',{headers})).json();assert.equal(state.offers.length,4);
 const payload={offerId:'starter',termsVersion:state.termsVersion,requestId:randomUUID()};
 const first=await(await fetch(base+'loans/borrow',{method:'POST',headers,body:JSON.stringify(payload)})).json();
 assert.equal(first.receipt.borrowed,500);assert.equal(first.user.tokens,300500);
 const repeat=await(await fetch(base+'loans/borrow',{method:'POST',headers,body:JSON.stringify(payload)})).json();assert.deepEqual(repeat.receipt,first.receipt);assert.equal(repeat.user.tokens,first.user.tokens);
 const repayment=await fetch(base+'loans/repay',{method:'POST',headers,body:JSON.stringify({loanId:first.receipt.loanId,amount:1000,requestId:randomUUID()})});
 assert.equal(repayment.status,200);assert.equal((await repayment.json()).loans.active,null);
});


test('independent concurrent borrowers cannot open two loans for the same player',async t=>{
 const f=await fixture(t);f.view();const run=promisify(execFile),url=new URL('../src/loans.mjs',import.meta.url).href;
 const results=await Promise.all([0,1].map(()=>run(process.execPath,['--input-type=module','-e',
  `import {borrowLoan} from ${JSON.stringify(url)};try{borrowLoan(${JSON.stringify(f.dir)},{id:'borrower'},${JSON.stringify({offerId:'starter',termsVersion:LOAN_TERMS_VERSION,requestId:randomUUID()})},{now:${now}});console.log('borrowed');}catch(error){console.log(error.message);}`
 ])));
 assert.deepEqual(results.map(result=>result.stdout.trim()).sort(),['borrowed','loan_active']);
 assert.equal(f.balance(),300500);assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) n FROM player_loans').get().n),1);
});
test('runtime with trading flags off and the next profile read both enforce overdue collection',async t=>{
 const f=await fixture(t);f.borrow();f.set(100);
 const tick=tickEconomy(f.dir,{now:now+3*DAY,flags:{}});assert.deepEqual(tick.failures,[]);assert.equal(tick.loans.collected,100);
 f.set(100);const later=new Accounts(f.dir,{now:()=>now+3*DAY});
 assert.equal(later.profile(f.user).tokens,0);assert.equal(later.profile(f.user).loanDebt,760);
});
