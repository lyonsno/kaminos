import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BURN_TABLE_STATES, evaluateBurnState, checkedBurnControls} from '../burn-table-core.mjs';

test('held states separate present heat, accumulated damage and reaction',()=>{
  assert.deepEqual(BURN_TABLE_STATES.map(s=>s.id),['original','scorched','active','cooled']);
  const cold=evaluateBurnState(BURN_TABLE_STATES[3],1);
  assert.ok(cold.char>.7);assert.equal(cold.glow,0);assert.equal(cold.reaction,0);
  const active=evaluateBurnState(BURN_TABLE_STATES[2],1);
  assert.ok(active.glow>.5);assert.ok(active.reaction>.5);
  assert.equal(evaluateBurnState(BURN_TABLE_STATES[0],1).char,0);
});
test('local exposure retains an untouched side in every damaged fixture',()=>{
  for(const state of BURN_TABLE_STATES){
    assert.deepEqual(evaluateBurnState(state,0),{heat:0,char:0,reaction:0,glow:0});
  }
});
test('material controls reject invalid authority-bearing values',()=>{
  assert.throws(()=>checkedBurnControls({heat:NaN}),/heat/);
  assert.throws(()=>checkedBurnControls({char:1.1}),/char/);
  assert.throws(()=>checkedBurnControls({profile:'volatile'}),/profile/);
  assert.equal(checkedBurnControls({profile:'metal',heat:.7}).profile,'metal');
});
test('hot metal can glow without acquiring wood char or fuel reaction',()=>{
  const metal=evaluateBurnState({heat:1,char:1,reaction:1,profile:'metal'},1);
  assert.equal(metal.char,0);assert.equal(metal.reaction,0);assert.ok(metal.glow>0);
});
