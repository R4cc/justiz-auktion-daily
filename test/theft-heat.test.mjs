import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { playerHeat, increasePlayerHeat, stolenItemHeat, HEAT_DECAY_INTERVAL as step } from '../src/theft-heat.mjs';

test('wanted stars cool offline in halves, preserve elapsed time, saturate at five and never drop below zero',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('one'),('two')");
    const now=1000000;
    assert.equal(playerHeat(db,'one',now).stars,0);
    assert.equal(increasePlayerHeat(db,'one',now).stars,.5);
    for(let n=1;n<6;n++) assert.equal(playerHeat(db,'one',now+step*n/6).stars,.5);
    const again=increasePlayerHeat(db,'one',now+step*.5,3);
    assert.equal(again.stars,2);
    assert.equal(again.nextDecayAt,now+step);
    assert.equal(playerHeat(db,'one',now+step).stars,1.5);
    assert.equal(playerHeat(db,'one',now+step*2).stars,1);
    for(let n=0;n<8;n++)increasePlayerHeat(db,'one',now+step*2);
    assert.equal(playerHeat(db,'one',now+step*2).stars,5);
    assert.equal(playerHeat(db,'one',now+step*3).stars,4.5);
    assert.equal(playerHeat(db,'one',now+step*12).stars,0);
    assert.equal(playerHeat(db,'one',now+step*200).stars,0);
    assert.equal(playerHeat(db,'two',now+step*200).stars,0);
    assert.equal(increasePlayerHeat(db,'one',now+step*200.5).nextDecayAt,now+step*201.5);
    assert.equal(playerHeat(db,'one',now+step*200).stars,.5);
  } finally {db.close();}
});

test('successful theft Heat scales with value and item count, bounded at five stars',()=>{
  for(const [value,gain] of [[1,1],[499,1],[500,2],[2499,2],[2500,3],[9999,3],[10000,4],[1000000,4]]) {
    assert.equal(stolenItemHeat(value),gain);
    assert.equal(stolenItemHeat(value,2),Math.min(10,gain*2));
  }
  assert.equal(stolenItemHeat(100,10),10);
});
