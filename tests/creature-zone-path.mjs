// kaminos-test: node
import assert from 'node:assert/strict';
import {createWanderPath} from '../experiments/creature-motion/wander-path.mjs';
import * as api from '../experiments/creature-motion/wander-path.mjs';
const areas=[{id:'courtyard',area:{center:[0,0],radii:[3,2],yaw:0},preference:1},{id:'clearing',area:{center:[12,0],radii:[2,2],yaw:0},preference:3}];
assert.equal(typeof api.chooseWanderZone,'function','Weighted destination selection has no falsifiable distribution rule');
assert.equal(api.chooseWanderZone(areas,0).id,'courtyard');assert.equal(api.chooseWanderZone(areas,.249999).id,'courtyard');assert.equal(api.chooseWanderZone(areas,.25).id,'clearing');assert.equal(api.chooseWanderZone(areas,.999999).id,'clearing');
assert.equal(api.chooseWanderZone([{...areas[0],preference:0},areas[1]],0).id,'clearing');
const path=createWanderPath({area:areas[0].area,areas,position:[0,0],direction:[0,1],seed:123});
assert.equal(typeof path.setAreas,'function','Wander cannot consume authored zone references');
const seen=new Set();let prior=path.read().position;
for(let i=0;i<2500;i++){const next=path.advance(.1);seen.add(next.zoneId);assert.ok(Math.hypot(...next.position.map((v,j)=>v-prior[j]))<=.1001,'Zone selection teleported the creature');prior=next.position;}
assert.deepEqual([...seen].sort(),['clearing','courtyard']);
const snapshot=path.snapshot(),restored=createWanderPath({snapshot});assert.deepEqual(restored.advance(7),path.advance(7),'Zone/path/RNG continuation was not retained');
const before=path.read().position;path.setAreas([areas[0]]);assert.deepEqual(path.read().position,before,'Changing enabled places teleported the animal');
for(let i=0;i<100;i++)assert.equal(path.advance(.1).zoneId,'courtyard');
const state=path.snapshot();assert.throws(()=>path.setAreas([{...areas[0],preference:-1}]),/preference|zone/i);assert.deepEqual(path.snapshot(),state);
assert.throws(()=>path.setAreas([]),/zone|area/i);
console.log('Weighted authored places, continuous transitions, membership changes and exact reconstruction');
