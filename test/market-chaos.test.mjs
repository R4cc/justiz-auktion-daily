import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDataStore, getState, withDatabase } from '../src/database.mjs';
import { ensureMarketChaos, marketChaosEvent, marketChaosHistoryTimes, marketChaosMultiplier,
  MARKET_CHAOS_MARKER, MARKET_CHAOS_WEEK_MS, MARKET_CHAOS_DURATION_MS } from '../src/market-chaos.mjs';
import { MANUAL_ADJUSTMENTS_RETIRED_MARKER, MARKET_CATEGORIES, marketMultiplierAt, estimatedValueTokens, marketHistory, marketIndexes, marketState, tickMarketDrift } from '../src/market.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';

const day=Date.parse('2026-10-13T12:00:00Z'),minute=60_000;
async function fixture(t, seed='chaos-regression-seed') {
  const dir=await mkdtemp(join(tmpdir(),'jg-market-chaos-'));
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  withDatabase(dir,db=>ensureMarketChaos(db,day,{seed}));
  tickMarketDrift(dir,{now:day});
  return dir;
}
const times=(dir,from=day,to=day+MARKET_CHAOS_WEEK_MS)=>withDatabase(dir,db=>marketChaosHistoryTimes(db,from,to));

test('one private random full-hour event per seven-day window, no overlap or history before activation',async t=>{
  const dir=await fixture(t),other=await fixture(t,'other-private-seed');
  assert.notEqual(times(dir)[0],times(other)[0]);
  const saved=withDatabase(dir,db=>getState(db,MARKET_CHAOS_MARKER));
  for(let week=0;week<6;week++){
    const start=day+week*MARKET_CHAOS_WEEK_MS,points=times(dir,start,start+MARKET_CHAOS_WEEK_MS-1);
    assert.equal(points.length,13);
    assert.ok(points[0]>=start+(week===0?6*3600_000:0));
    assert.ok(points.at(-1)<=start+MARKET_CHAOS_WEEK_MS);
    assert.equal(points.at(-1)-points[0],MARKET_CHAOS_DURATION_MS);
    assert.equal(points[0]%minute,0);
    const event=withDatabase(dir,db=>marketChaosEvent(db,points[0]+minute));
    assert.equal(event.startsAt,points[0]);assert.equal(event.endsAt,points.at(-1));
    assert.equal(event.minMultiplier,.25);assert.equal(event.maxMultiplier,3);
    assert.equal(withDatabase(dir,db=>marketChaosEvent(db,points.at(-1))),null);
    assert.equal(withDatabase(dir,db=>marketChaosMultiplier(db,'wine',points.at(-1))),1);
  }
  assert.deepEqual(times(dir,day-30*86400_000,day-1),[]);
  assert.equal(withDatabase(dir,db=>marketChaosMultiplier(db,'wine',day-1)),1);
  const at=times(dir)[0]+10*minute;
  tickMarketDrift(dir,{now:at});
  const state=marketState(dir,{now:at});
  assert.ok(state.chaosEvent);
  assert.doesNotMatch(JSON.stringify(state),/seed|activatedAtMs|nextEvent/);
  withDatabase(dir,db=>ensureMarketChaos(db,at,{seed:'must-not-reroll'}));
  closeDataStore(dir);
  assert.deepEqual(marketState(dir,{now:at}),state);
  assert.deepEqual(withDatabase(dir,db=>getState(db,MARKET_CHAOS_MARKER)),saved);
});

test('every category has huge minute-level pumps and crashes, shared quotes and a normal-price return',async t=>{
  const dir=await fixture(t),start=times(dir)[0],end=start+MARKET_CHAOS_DURATION_MS;
  tickMarketDrift(dir,{now:end});
  for(const {id} of MARKET_CATEGORIES){
    const factors=Array.from({length:61},(_,n)=>withDatabase(dir,db=>marketChaosMultiplier(db,id,start+n*minute)));
    assert.equal(factors[0],1);assert.equal(factors.at(-1),1);
    assert.ok(factors.every(factor=>factor>=.25&&factor<=3));
    assert.ok(Math.min(...factors)<.4&&Math.max(...factors)>2);
    assert.ok(factors.some((factor,n)=>n&&factor>factors[n-1])&&factors.some((factor,n)=>n&&factor<factors[n-1]));
    const history=marketHistory(dir,id,{now:end,range:'1h'});
    assert.equal(history.length,61);
    for(const point of history){
      const at=Date.parse(point.capturedAt),index=withDatabase(dir,db=>marketIndexes(db,at)[id]);
      assert.equal(point.indexValue,Math.round(index*100)/100);
      assert.equal(estimatedValueTokens({price:1000,marketCategory:id},{[id]:index}),Math.round(index*10));
    }
    const normal=withDatabase(dir,db=>marketIndexes(db,end)[id]);
    assert.ok(normal>=50&&normal<=150);
    const at=start+5*minute,index=withDatabase(dir,db=>marketIndexes(db,at)[id]);
    assert.equal(withDatabase(dir,db=>marketChaosMultiplier(db,id,at+59999)),factors[5]);
    assert.equal(marketState(dir,{now:at}).categories.find(c=>c.category===id).currentIndex,Math.round(index*100)/100);
  }
  const at=start+5*minute,quotes=withDatabase(dir,db=>marketIndexes(db,at));
  assert.ok(Object.values(quotes).some(index=>index>150)&&Object.values(quotes).some(index=>index<50));
  assert.equal(marketState(dir,{now:end}).chaosEvent,null);
});

test('frequent reads and ticks, sparse recovery and restart reconstruct identical events, charts and snapshots',async t=>{
  const frequent=await fixture(t),sparse=await fixture(t),end=day+8*86400_000;
  for(let now=day;now<=end;now+=2*3600_000){tickMarketDrift(frequent,{now});marketState(frequent,{now});}
  tickMarketDrift(sparse,{now:end});
  const expected=marketHistory(frequent,'electronics',{now:end,range:'1w'});
  assert.deepEqual(marketHistory(sparse,'electronics',{now:end,range:'1w'}),expected);
  assert.deepEqual(marketState(sparse,{now:end}),marketState(frequent,{now:end}));
  const stored=dir=>withDatabase(dir,db=>db.prepare("SELECT * FROM market_snapshots WHERE category='electronics' ORDER BY captured_at").all());
  assert.deepEqual(stored(sparse),stored(frequent));
  closeDataStore(sparse);
  assert.deepEqual(marketHistory(sparse,'electronics',{now:end,range:'1w'}),expected);
});

test('event turning points survive all chart ranges and incremental hourly snapshot caching after expiry',async t=>{
  const dir=await fixture(t),points=times(dir),end=points.at(-1),firstHour=Math.floor(points[0]/3600_000)*3600_000;
  tickMarketDrift(dir,{now:end+2*3600_000});
  marketState(dir,{now:firstHour});
  marketState(dir,{now:firstHour+3600_000});
  marketState(dir,{now:firstHour+2*3600_000});
  const stored=marketHistory(dir,'wine',{now:end+2*3600_000,limit:1000});
  for(const at of points){
    const snapshot=stored.find(point=>Date.parse(point.capturedAt)===at);
    assert.ok(snapshot,`missing cached event point ${new Date(at).toISOString()}`);
    assert.equal(snapshot.indexValue,Math.round(withDatabase(dir,db=>marketIndexes(db,at).wine)*100)/100);
  }
  for(const range of ['1h','1d','1w','1m']){
    const history=marketHistory(dir,'wine',{now:end,range});
    assert.ok(history.length<=800);
    for(const at of points)assert.ok(history.some(point=>Date.parse(point.capturedAt)===at),`${range} dropped turning point`);
  }
});

test('historical admin multipliers compose with the frenzy until automatic retirement',async t=>{
  const dir=await fixture(t),start=times(dir)[0],at=start+10*minute;
  tickMarketDrift(dir,{now:at});
  // Simulate the previous release, which had not retired manual overrides.
  withDatabase(dir,db=>db.prepare('DELETE FROM app_state WHERE key = ?').run(MANUAL_ADJUSTMENTS_RETIRED_MARKER));
  const before=withDatabase(dir,db=>marketIndexes(db,at).electronics);
  withDatabase(dir,db=>db.prepare(`INSERT INTO admin_market_adjustments
    (admin_id,request_id,category,action,percent,multiplier,before_index,after_index,created_at)
    VALUES ('admin','chaos-admin-adjust','electronics','adjust',100,2,?,?,?)`).run(before,before*2,at));
  assert.equal(withDatabase(dir,db=>marketIndexes(db,at).electronics),before*2);
  const state=marketState(dir,{now:at});
  assert.equal(state.categories[0].currentIndex,Math.round(before*200)/100);
  assert.equal(marketHistory(dir,'electronics',{now:at,range:'1h'})[0].indexValue,state.categories[0].currentIndex);
  const end=start+MARKET_CHAOS_DURATION_MS;tickMarketDrift(dir,{now:end});
  const normal=withDatabase(dir,db=>marketIndexes(db,end).electronics);
  assert.ok(normal>=50&&normal<=150);
  assert.equal(withDatabase(dir,db=>marketMultiplierAt(db,'electronics',end)),1);
  assert.equal(withDatabase(dir,db=>marketIndexes(db,at).electronics),before*2);
});

test('public market API exposes only the active event, shares history quotes and removes the banner state at expiry',async t=>{
  const dir=await fixture(t),start=times(dir)[0];let now=start+5*minute;
  tickMarketDrift(dir,{now});t.mock.method(Date,'now',()=>now);
  let result;
  const api=createEconomyApi({dataDir:dir,flags:{market:true},json:(_,status,body)=>{result={status,body};}});
  const get=path=>{assert.equal(api({method:'GET'},null,new URL(path,'http://localhost')),true);assert.equal(result.status,200);return result.body;};
  const market=get('/api/market');
  assert.equal(market.chaosEvent.startsAt,start);assert.equal(market.chaosEvent.endsAt,start+3600_000);
  assert.doesNotMatch(JSON.stringify(market),/seed|activatedAtMs|nextEvent/);
  const history=get('/api/market/electronics/history?range=1h');
  assert.equal(history.history[0].indexValue,market.categories[0].currentIndex);
  now=start+3600_000;assert.equal(get('/api/market').chaosEvent,null);
  const disabled=createEconomyApi({dataDir:dir,flags:{market:false},json:()=>assert.fail('disabled market responded')});
  assert.equal(disabled({method:'GET'},null,new URL('/api/market','http://localhost')),false);
});
