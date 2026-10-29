// kaminos-test: node
import assert from 'node:assert/strict';
import {authoredMlsInlets} from '../authored-mls-water.mjs';
import {authoredDropSetup} from '../authored-water-host.mjs';
const source={id:'drop',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.2,samplesPerUnit:60}}};
const setup=authoredDropSetup([source]);
assert.equal(setup.route,'kaminos/mls-mpm-finger-juice-v1','authored release must allocate the rebuilt engine, without a PBF fallback');
assert.equal(setup.initialParticles.length,1728*20);
assert.equal(setup.solver.particleCount,1728);
assert.equal(setup.solver.pressureSolver,undefined);
console.log('Authored drop uses MLS native layout');

const flows=Array.from({length:6},(_,i)=>({...source,id:'flow-'+i,localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'continuous',baseRadius:.08,strength:1.5,rate:240}}));
const packet=authoredMlsInlets(flows,100);assert.equal(packet.emitters.length,6);assert.equal(packet.emitters[0].strength,1.5);assert.equal(packet.emitters[0].radius,.08);
const moved=structuredClone(flows);moved[1].transform.position=[.5,1.2,.4];moved[1].localLiquidEmitter.rate=480;
const second=authoredMlsInlets(moved,101,2);assert.deepEqual(second.emitters[1].origin_world,[.5,1.2,.4]);assert.equal(second.emitters[1].source_flux_particles_per_second,480);assert.equal(second.emitters[0].source_flux_particles_per_second,240);
assert.throws(()=>authoredMlsInlets([...flows,flows[0]]),/duplicate/);
