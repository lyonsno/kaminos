// kaminos-test: node
import assert from 'node:assert/strict';
import {authoredDropSetup} from '../authored-water-host.mjs';
const source={id:'drop',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.2,samplesPerUnit:60}}};
const setup=authoredDropSetup([source]);
assert.equal(setup.route,'kaminos/mls-mpm-finger-juice-v1','authored release must allocate the rebuilt engine, without a PBF fallback');
assert.equal(setup.initialParticles.length,1728*20);
assert.equal(setup.solver.particleCount,1728);
assert.equal(setup.solver.pressureSolver,undefined);
console.log('Authored drop uses MLS native layout');
