// kaminos-test: node
import assert from 'node:assert/strict';
import {consumeLogReserve,LOG_RESIDUE} from '../log-consumption.mjs';
let fuel=1,gas=0,debris=0,events=0;
for(let i=0;i<10000;i++){
 const next=consumeLogReserve(fuel,1,.02);fuel=next.fuel;gas+=next.gas;debris+=next.detached;if(next.detached)events++;
 assert.ok(Math.abs(gas+fuel-1)<1e-10);
}
assert.equal(events,1);assert.equal(debris,LOG_RESIDUE);assert.equal(fuel,LOG_RESIDUE);
assert.ok(Math.abs(gas+debris-1)<1e-10);
assert.deepEqual(consumeLogReserve(1,0,10),{fuel:1,gas:0,detached:0,present:true});
assert.equal(consumeLogReserve(1,1,100).detached,LOG_RESIDUE);
assert.throws(()=>consumeLogReserve(1,1,0),/Invalid/);
console.log('Finite gas/residue accounting and one-shot detachment pass');
