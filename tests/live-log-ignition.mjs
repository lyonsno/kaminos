// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepLiveLogThermal} from '../live-log-heat-core.mjs';

test('briefly hot wood can scorch but cannot immediately ignite or emit fuel',()=>{
  let state=[1.2,0,0,0,0,1,0,0];
  for(let i=0;i<5;i++)state=stepLiveLogThermal(state,0,1/60);
  assert.equal(state[2],0,'burning must wait for sustained exposure');
  assert.equal(state[6],0,'unignited wood must not supply gas');
  assert.equal(state[7],0);
  assert.ok(state[1]>0,'thermal scorching need not imply ignition');
});

test('sustained local heat ignites finite fuel and cooling stops gas supply',()=>{
  let state=[0,0,0,0,0,1,0,0];
  for(let i=0;i<300;i++)state=stepLiveLogThermal(state,1,1/60);
  assert.equal(state[7],1);assert.ok(state[5]<1&&state[5]>0);
  assert.ok(state[6]>0);assert.ok(state[2]>0);
  const retained=state[1];
  for(let i=0;i<3600;i++)state=stepLiveLogThermal(state,0,1/60);
  assert.equal(state[6],0);assert.equal(state[2],0);assert.ok(state[1]>=retained);
  let depleted=[2,1,0,0,1,0,0,1];depleted=stepLiveLogThermal(depleted,2,1/60);
  assert.equal(depleted[6],0);assert.equal(depleted[2],0);
});
