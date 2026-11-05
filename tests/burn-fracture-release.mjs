// kaminos-test: node
import assert from 'node:assert/strict';
import * as contract from '../tools/burn-fracture-contract.mjs';

assert.equal(typeof contract.burnMassMotion,'function','The release comparison needs mass-weighted motion, not the most mobile fragment');
const before={state:{regionMasses:[100,.01,0],gravity:[0,-10,0],seconds:0},positions:[0,0,0,0,0,0,0,0,0,0,0,0],velocities:new Array(12).fill(0)};
const after={...before,state:{...before.state,seconds:1},positions:[0,-1,0,0,0,-100,0,0,0,-1000,0,0],velocities:[0,-10,0,0,0,-10,0,0,0,-1000,0,0]};
const motion=contract.burnMassMotion(before,after);
assert.ok(Math.abs(motion.displacement[1]+101/100.01)<1e-12);
assert.equal(motion.velocityChange[1],-10);
assert.equal(motion.gravityVelocityFraction,1);
assert.equal(motion.mass,100.01);
assert.equal(motion.seconds,1);
for(const bad of [
 {...after,positions:[]},
 {...after,velocities:after.velocities.map(()=>NaN)},
 {...after,state:{...after.state,seconds:0}},
 {...after,state:{...after.state,regionMasses:[100,.02,0]}},
 {...after,state:{...after.state,gravity:[0,-1,0]}},
])assert.throws(()=>contract.burnMassMotion(before,bad));
assert.throws(()=>contract.burnMassMotion({...before,state:{...before.state,regionMasses:[0,0,0]}},{...after,state:{...after.state,regionMasses:[0,0,0]}}));
