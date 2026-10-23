import { randomUUID } from 'node:crypto';
import { withDatabase, transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { STORE_CASES } from './case-store.mjs';

const fail = (code, status = 400) => { throw new AccountError(code, status); };
export function ensureCaseRebateSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS case_rebates (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    case_id TEXT NOT NULL, percent INTEGER NOT NULL CHECK(percent BETWEEN 1 AND 100),
    starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
    created_at INTEGER NOT NULL, cancelled_at INTEGER, UNIQUE(admin_id,request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS case_rebates_expiry ON case_rebates(ends_at) WHERE cancelled_at IS NULL`);
}
const publicRow = row => ({ id:row.id, caseId:row.case_id, percent:row.percent, startsAt:row.starts_at,
  endsAt:row.ends_at, cancelledAt:row.cancelled_at });
export function activeCaseRebates(db, now = Date.now()) {
  ensureCaseRebateSchema(db);
  return db.prepare(`SELECT * FROM case_rebates WHERE cancelled_at IS NULL AND starts_at<=? AND ends_at>?
    ORDER BY percent DESC,ends_at DESC,id`).all(now,now).map(publicRow);
}
function admin(db,user) {
  if (!user?.id) fail('login_required',401);
  const row=db.prepare('SELECT admin,banned,npc,must_change_password FROM users WHERE id=?').get(user.id);
  if (!row?.admin || row.banned || row.npc || row.must_change_password) fail('forbidden',403);
}
export function caseRebateDashboard(dataDir,user,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>{
    admin(db,user);ensureCaseRebateSchema(db);
    const rows=db.prepare(`SELECT * FROM case_rebates WHERE (cancelled_at IS NULL AND ends_at>?)
      OR id IN (SELECT id FROM case_rebates ORDER BY created_at DESC,id DESC LIMIT 20)
      ORDER BY created_at DESC,id DESC`).all(now);
    return { cases:STORE_CASES.map(({id,name,nameDe})=>({id,name,nameDe})),rebates:rows.map(publicRow),now };
  });
}
export function createCaseRebate(dataDir,user,payload,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    admin(db,user);ensureCaseRebateSchema(db);
    const {caseId,percent,startsAt,endsAt,requestId}=payload || {};
    if (typeof requestId!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('invalid_request');
    if (caseId!=='all' && !STORE_CASES.some(box=>box.id===caseId)) fail('invalid_case');
    if (!Number.isInteger(percent) || percent<1 || percent>100 || !Number.isSafeInteger(startsAt) || startsAt<0
      || !Number.isSafeInteger(endsAt) || endsAt>8640000000000000 || endsAt<=startsAt) fail('invalid_case_rebate');
    const prior=db.prepare('SELECT * FROM case_rebates WHERE admin_id=? AND request_id=?').get(user.id,requestId);
    if (prior) {
      if (prior.case_id!==caseId || prior.percent!==percent || prior.starts_at!==startsAt || prior.ends_at!==endsAt) fail('request_conflict',409);
      return publicRow(prior);
    }
    if (endsAt<=now) fail('invalid_case_rebate');
    const id=randomUUID();
    db.prepare('INSERT INTO case_rebates VALUES(?,?,?,?,?,?,?,?,NULL)').run(id,user.id,requestId,caseId,percent,startsAt,endsAt,now);
    return publicRow(db.prepare('SELECT * FROM case_rebates WHERE id=?').get(id));
  }));
}
export function cancelCaseRebate(dataDir,user,id,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    admin(db,user);ensureCaseRebateSchema(db);
    if (typeof id!=='string' || !db.prepare('SELECT 1 FROM case_rebates WHERE id=?').get(id)) fail('case_rebate_not_found',404);
    db.prepare('UPDATE case_rebates SET cancelled_at=COALESCE(cancelled_at,?) WHERE id=?').run(now,id);
    return publicRow(db.prepare('SELECT * FROM case_rebates WHERE id=?').get(id));
  }));
}
