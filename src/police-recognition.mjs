import {randomInt,randomUUID,createHash} from 'node:crypto';
import {withDatabase,transaction} from './database.mjs';
import {AccountError} from './errors.mjs';
import {playerHeat,recognitionChance,heatFineMultiplier,heatScaledFine,POLICE_CHECK_INTERVAL} from './theft-heat.mjs';
import {ensureJusticeSchema,justiceStatus} from './justice.mjs';
import {currentNetWorth} from './net-worth.mjs';
import {ensurePoliceSchema,pendingPoliceEncounter} from './police-state.mjs';
import {statisticEvent} from './statistics-ledger.mjs';
import {pushNotification} from './notifications.mjs';
const fail=(code,status=400)=>{throw new AccountError(code,status);};
const actor=(db,user)=>{
  const row=db.prepare('SELECT id,tokens FROM users WHERE id=? AND npc=0 AND banned=0 AND must_change_password=0').get(user?.id||'');
  if(!row)fail('login_required',401);return row;
};
export const recognitionSentence=(heat,offences=0)=>Math.min(24*60,({8:15,9:30,10:60}[heat]||0)*2**Math.min(7,offences))*60000;

// Only completed, meaningful mutations qualify. Semantic receipt/item keys
// stop retries from creating new checks, even after the time limit expires.
export function policeActivityKey(route,payload,result) {
  let identity;
  if(route==='cases/buy')identity=['case-buy',result.item?.id];
  else if(['cases/open','inventory/case/open'].includes(route))identity=['case-open',result.item?.id];
  else if(route==='stock-palettes/reveal')identity=['palette-open',payload.id];
  else if(route==='resale/listings')identity=['listing',result.listing?.id];
  else if(['resale/bid','palette-auctions/bid'].includes(route))identity=[route,payload.id,payload.amount];
  else if(route==='stores/buy')identity=['store-buy',result.receipt?.id];
  else if(route==='businesses/collect'&&result.collection?.amount>0)identity=['collect',result.collection.id];
  else if(['inventory/sell','inventory/sell-all'].includes(route))identity=['sale',result.sold];
  if(!identity||identity[1]==null||Array.isArray(identity[1])&&!identity[1].length)return null;
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function checkPoliceRecognition(dataDir,user,eventKey,{now=Date.now(),random=randomInt}={}) {
  if(!eventKey)return null;
  return withDatabase(dataDir,db=>transaction(db,()=>{
    const player=actor(db,user);ensureJusticeSchema(db);
    const pending=pendingPoliceEncounter(db,player.id);if(pending)return pending;
    if(db.prepare('SELECT 1 FROM police_activity_checks WHERE user_id=? AND event_key=?').get(player.id,eventKey))return null;
    const heat=playerHeat(db,player.id,now),chance=recognitionChance(heat.value),justice=justiceStatus(db,player.id,now);
    const last=db.prepare('SELECT MAX(checked_at) AS at FROM police_activity_checks WHERE user_id=? AND performed=1').get(player.id).at;
    const heist=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='store_heists'").get()
      &&db.prepare("SELECT 1 FROM store_heists WHERE user_id=? AND status IN ('active','police')").get(player.id);
    const performed=Boolean(chance&&!justice.jailed&&!justice.fineDue&&!heist&&(last===null||now-last>=POLICE_CHECK_INTERVAL));
    db.prepare('INSERT INTO police_activity_checks VALUES(?,?,?,?,?,?)').run(player.id,eventKey,now,heat.value,chance,Number(performed));
    if(!performed)return null;
    const roll=random(1000000);if(!Number.isInteger(roll)||roll<0||roll>=1000000)throw Error('invalid_police_draw');
    if(roll>=chance*10000)return null;
    const worth=currentNetWorth(db,player.id,{now});
    const baseFine=Math.max(250,Math.ceil(Math.max(0,worth.total)*.02)),fine=heatScaledFine(baseFine,heat.value);
    const id=randomUUID(),duration=recognitionSentence(heat.value,justice.offences);
    db.prepare('INSERT INTO police_encounters(id,user_id,event_key,heat,chance,base_fine,fine,fine_multiplier,jail_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id,player.id,eventKey,heat.value,chance,baseFine,fine,heatFineMultiplier(heat.value),duration,now);
    db.prepare(`INSERT INTO player_justice(user_id,offences) VALUES(?,1)
      ON CONFLICT(user_id) DO UPDATE SET offences=offences+1`).run(player.id);
    pushNotification(db,player.id,{type:'store',sourceKey:`police:${id}`,titleEn:'Police recognized you',titleDe:'Polizei hat dich erkannt',
      bodyEn:'Officers matched you to a wanted suspect. Your completed activity is saved. Pay the fine or serve the sentence.',
      bodyDe:'Beamte haben dich als gesuchte Person erkannt. Deine abgeschlossene Aktion ist gespeichert. Bezahle das Bußgeld oder verbüße die Haftstrafe.',href:'/profile?tab=record'},now);
    return pendingPoliceEncounter(db,player.id);
  }));
}

export function resolvePoliceEncounter(dataDir,user,{id,choice}={}, {now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    const player=actor(db,user);ensureJusticeSchema(db);ensurePoliceSchema(db);
    if(!['pay','jail'].includes(choice))fail('invalid_police_choice');
    const row=db.prepare('SELECT * FROM police_encounters WHERE id=? AND user_id=?').get(typeof id==='string'?id:'',player.id);
    if(!row)fail('police_encounter_not_found',404);
    if(row.resolved_at!==null){if(row.resolution!==choice)fail('request_conflict',409);return JSON.parse(row.result);}
    if(choice==='pay'&&!db.prepare('UPDATE users SET tokens=tokens-? WHERE id=? AND tokens>=?').run(row.fine,player.id,row.fine).changes)fail('insufficient_tokens',409);
    const jailedUntil=choice==='jail'?now+row.jail_ms:0;
    const result={reason:'police_recognition',resolution:choice,fine:row.fine,paidCash:choice==='pay'?row.fine:0,
      seized:[],remainingFine:0,jailedUntil,convertedToSentence:choice==='jail'?row.fine:0,
      offences:justiceStatus(db,player.id,now).offences};
    db.prepare('UPDATE player_justice SET jailed_until=?,last_result=? WHERE user_id=?').run(jailedUntil,JSON.stringify(result),player.id);
    if(choice==='pay')statisticEvent(db,player.id,`police-fine:${row.id}`,'out:fine',{amount:row.fine,at:now});
    db.prepare('UPDATE police_encounters SET resolved_at=?,resolution=?,result=? WHERE id=?').run(now,choice,JSON.stringify(result),row.id);
    const heat=playerHeat(db,player.id,now);
    db.prepare('UPDATE player_heat SET value=?,updated_at=? WHERE user_id=?').run(Math.min(6,heat.value),now,player.id);
    return result;
  }));
}
