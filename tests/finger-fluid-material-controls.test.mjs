import assert from 'node:assert/strict';
import {createWebGPUFingerFluidSolver} from '../finger-fluid-webgpu-core.js';

// Invalid tuning must be rejected before a missing GPU can disguise it as an
// unavailable route. The pre-control implementation silently ignores this input.
for (const particleRepulsionStrength of [NaN, Infinity, -1]) {
  await assert.rejects(
    createWebGPUFingerFluidSolver({canvas:{getContext:()=>null}, particleRepulsionStrength}),
    /repulsion strength/i,
  );
}
console.log('Invalid repulsion input rejects before GPU admission');

import {createMaterialControlState,readMaterialControlsURL,materialControlsURL,decodeMaterialInputs} from '../finger-fluid-material-controls.mjs';
const original={particleRepulsionStrength:1,densityIterations:3,capillaryStrength:.72,freeFlightViscosityBoost:.17};
const state=createMaterialControlState(original);assert.equal(state.read().effective,null);
state.submit(20);state.request({particleRepulsionStrength:.25});
assert.equal(state.read().effective.particleRepulsionStrength,1);
state.submit(20);assert.equal(state.read().effective.particleRepulsionStrength,.25);
const accepted=state.read();
for(const patch of [{particleRepulsionStrength:NaN},{particleRepulsionStrength:-1},{densityIterations:0},{densityIterations:2.5},{capillaryStrength:3},{freeFlightViscosityBoost:.4},{unknownControl:1}]){
 assert.throws(()=>state.request(patch));assert.deepEqual(state.read(),accepted);
}
state.request({particleRepulsionStrength:10,densityIterations:20});state.submit(21);
assert.equal(state.read().effective.particleRepulsionStrength,10);assert.equal(state.read().effective.densityIterations,20);
assert.throws(()=>state.submit(19));
const url=materialControlsURL('http://localhost/?finger_fluid_artificial_pressure=off&scene=retained#authoring=1',state.read().effective);
assert.equal(new URL(url).searchParams.has('finger_fluid_artificial_pressure'),false);assert.equal(new URL(url).hash,'#authoring=1');
assert.deepEqual(readMaterialControlsURL(url,original),state.read().effective);
assert.equal(readMaterialControlsURL('http://localhost/?finger_fluid_artificial_pressure=off',original).particleRepulsionStrength,0);
for(const value of ['','NaN','-1','Infinity'])assert.throws(()=>readMaterialControlsURL('http://localhost/?finger_fluid_repulsion_strength='+value,original));
const buffer=new ArrayBuffer(224),view=new DataView(buffer);view.setUint32(4,36864,true);view.setFloat32(200,-.0003,true);view.setFloat32(116,.4,true);view.setFloat32(124,.1,true);
const words=Array.from(new Uint32Array(buffer));assert.ok(Math.abs(decodeMaterialInputs(words).repulsionCoefficient+.0003)<1e-9);
assert.throws(()=>decodeMaterialInputs(words.slice(1)));assert.throws(()=>decodeMaterialInputs(words.map((v,i)=>i===50?0x7fc00000:v)));
console.log('Live material state: atomic validation, submitted identity, unbounded numeric strength/pass entry, replay and full raw GPU packet checks passed');
