// kaminos-test: node
import assert from 'node:assert/strict';
import {mlsConfig} from '../mls-juice-contract.mjs';
import {createMlsGoinPile,GOIN_IMPULSE_SCALE} from '../mls-goin-pile.mjs';

const config=mlsConfig({gridSize:[192,80,256],goinPile:{count:24,mass:.25}});
assert.equal(config.goinPile?.count,24,'requested physical goin pile was silently ignored');
assert.equal(config.goinPile.mass,.25);
assert.throws(()=>mlsConfig({goinPile:{count:0}}),/goin/i);
assert.throws(()=>mlsConfig({goinPile:{mass:NaN}}),/goin/i);
assert.equal(mlsConfig().goinPile,null,'existing runway must remain unchanged');
console.log('Goin pile request retained and validated');
const pile=createMlsGoinPile(config),empty=new Int32Array(24*8);
const initial=pile.read();assert.equal(initial.bodies.length,24);
for(let i=0;i<720;i++)pile.complete(empty);
const settled=pile.read();
assert(settled.bodies.every(b=>b.position[1]>.04&&b.position[1]<.65),'dry pile escaped floor or launched itself');
assert(settled.bodies.every(b=>Math.hypot(...b.velocity)<.05),'dry pile did not settle');
assert.deepEqual(settled.impulse,[0,0,0]);
const target=20,impulse=new Int32Array(24*8);impulse[target*8+2]=Math.round(-.3*GOIN_IMPULSE_SCALE);impulse[target*8+3]=1;impulse[target*8+4]=Math.round(.01*GOIN_IMPULSE_SCALE);
pile.complete(impulse);
const hit=pile.read();assert(hit.bodies[target].velocity[2]<-.05,'received impulse did not move goin');
assert(Math.abs(hit.bodies[target].angularVelocity[0])>.01,'off-center impulse did not turn goin');
assert.equal(hit.contacts,1);assert(Math.abs(hit.impulse[2]+.3)<1/GOIN_IMPULSE_SCALE);
assert.throws(()=>pile.complete(new Int32Array(8)),/Incomplete/);
for(let i=0;i<720;i++)pile.complete(empty);
assert(pile.read().bodies.every(b=>Math.hypot(...b.velocity)<.05),'disturbed pile did not settle');
pile.dispose();assert.throws(()=>pile.complete(empty),/disposed/);
console.log('24 dry goins settle; actual impulse and torque disturb them; they settle again');
