import assert from 'node:assert/strict';
import {DISTRIBUTED_SMOKE_WGSL} from '../scene-smoke-reconstruction.mjs';

// Fail first on the old camera shader: no amount of camera coverage or optical
// depth may multiply triangle traversal after static lighting preparation.
assert.doesNotMatch(DISTRIBUTED_SMOKE_WGSL,/Triangle|smokeReceiverVisible|count;i\+\+/,
  'camera reconstruction must contain no geometry traversal');
const {preparedSmokePlan}=await import('../scene-prepared-smoke.mjs');
const limits={maxTextureDimension3D:256,maxStorageBufferBindingSize:128*1024*1024};
const plan=preparedSmokePlan([16,32,16],4,limits);
assert.deepEqual(plan.dimensions,[64,128,64]);
assert.equal(plan.sampleCount,524288);
assert.equal(plan.weightBytes,16777216);
assert.equal(plan.cameraTriangleTests,0);
assert.throws(()=>preparedSmokePlan([16,32,16],0,limits),/positive integer/);
assert.throws(()=>preparedSmokePlan([16,32,16],4,{...limits,maxTextureDimension3D:64}),/3D texture/);
assert.throws(()=>preparedSmokePlan([16,32,16],4,{...limits,maxStorageBufferBindingSize:1024}),/weights/);
console.log('prepared smoke: geometry-free camera lookup and explicit uncapped allocation plan pass');
