import { skillEffects } from './skill-effects.mjs';
import { transaction, withDatabase } from './database.mjs';
import { levelForXp } from './progression.mjs';
import { AccountError } from './errors.mjs';
import { assertPlayerFree } from './justice.mjs';
import { ensureSkillsSchema, skillRanks, skillCosts, LUCK_BONUSES, SECURITY_BONUSES } from './skill-effects.mjs';

export const SKILL_DEFINITIONS = [
  { id:'luck', name:'Fortune finder', nameDe:'Glückspilz', available:true },
  { id:'security', name:'Store guardian', nameDe:'Ladenwächter', available:true },
  { id:'influence', name:'Trusted voice', nameDe:'Starke Stimme', available:true },
  { id:'market-intelligence', name:'Market Intelligence', nameDe:'Marktkenntnis', available:true },
  { id:'negotiation', name:'Negotiation', nameDe:'Verhandlung', available:false },
  { id:'logistics', name:'Logistics', nameDe:'Logistik', available:false },
  { id:'appraisal', name:'Appraisal', nameDe:'Wertermittlung', available:false },
  { id:'marketing', name:'Marketing', nameDe:'Marketing', available:false },
  { id:'connections', name:'Connections', nameDe:'Kontakte', available:false },
  { id:'enterprise', name:'Enterprise', nameDe:'Unternehmertum', available:false }
];
const fail=(code,status=409)=>{throw new AccountError(code,status);};
function player(db,user,now) {
  const row=db.prepare('SELECT id,xp,must_change_password FROM users WHERE id=? AND npc=0 AND banned=0').get(user?.id || '');
  if(!row)fail('login_required',401);
  if(row.must_change_password)fail('password_change_required',403);
  assertPlayerFree(db,row.id,now);
  return row;
}
export function skillSummary(db,userId,xp) {
  const ranks=skillRanks(db,userId),earned=levelForXp(xp),spent=Object.entries(ranks).reduce((sum,[id,rank])=>sum+skillCosts(id).slice(0,rank).reduce((a,b)=>a+b,0),0);
  return {earned,spent,available:Math.max(0,earned-spent),ranks,luckPercent:skillEffects(db,userId).luckPercent,securityPercent:SECURITY_BONUSES[ranks.security||0]};
}
function view(db,row) {
  return {...skillSummary(db,row.id,row.xp),level:levelForXp(row.xp),skills:SKILL_DEFINITIONS.map(skill=>({...skill,
    ranks:skillCosts(skill.id).map((cost,index)=>({rank:index+1,cost,available:skill.available && index<3,
      ...(skill.id==='luck'&&index<3?{bonus:LUCK_BONUSES[index+1]}:skill.id==='security'&&index<3?{bonus:SECURITY_BONUSES[index+1]}:{})}))}))};
}
export function skillTree(dataDir,user,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>view(db,player(db,user,now))));
}
export function upgradeSkill(dataDir,user,{skillId,rank,requestId}={}, {now=Date.now()}={}) {
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))fail('invalid_request',400);
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureSkillsSchema(db);const row=player(db,user,now);
    const previous=db.prepare('SELECT skill_id,rank FROM skill_purchases WHERE user_id=? AND request_id=?').get(row.id,requestId);
    if(previous){if(previous.skill_id!==skillId||previous.rank!==rank)fail('request_conflict');return view(db,row);}
    const skill=SKILL_DEFINITIONS.find(entry=>entry.id===skillId);
    if(!skill)fail('invalid_skill',400);
    if(!skill.available || rank===4)fail('skill_coming_soon');
    if(!Number.isSafeInteger(rank)||rank<1||rank>3)fail('invalid_skill_rank',400);
    if(rank>skillCosts(skillId).length)fail('skill_coming_soon');
    const summary=skillSummary(db,row.id,row.xp);
    if(rank!==(summary.ranks[skillId]||0)+1)fail('skill_rank_changed');
    const cost=skillCosts(skillId)[rank-1];if(summary.available<cost)fail('insufficient_skill_points');
    db.prepare(`INSERT INTO user_skills VALUES (?,?,?,?) ON CONFLICT(user_id,skill_id)
      DO UPDATE SET rank=excluded.rank,updated_at=excluded.updated_at`).run(row.id,skillId,rank,now);
    db.prepare('INSERT INTO skill_purchases VALUES (?,?,?,?,?,?)').run(row.id,requestId,skillId,rank,cost,now);
    return view(db,row);
  }));
}
