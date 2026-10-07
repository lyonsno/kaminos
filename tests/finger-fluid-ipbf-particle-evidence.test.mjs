import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';
const identity={stepCount:120,pressureSolver:'ipbf',boundaryPressureContract:'ipbf-cubic-tangent-plane-density-v1'};
test('raw particle evidence preserves every f32 bit and the effective pressure identity',()=>{
 assert.equal(typeof core.captureFingerFluidParticleWordsForWitness,'function','full particle diagnostic capture is missing');
 const input=new Float32Array(32);input[0]=.1;input[15]=Infinity;input[31]=NaN;
 const snapshot=core.captureFingerFluidParticleWordsForWitness(input,2,identity);
 assert.equal(snapshot.particleCount,2);assert.equal(snapshot.stepCount,120);assert.equal(snapshot.recordWords,16);
 assert.deepEqual(snapshot.words,Array.from(new Uint32Array(input.buffer)));
 assert.equal(snapshot.boundaryPressureContract,identity.boundaryPressureContract);
 assert.equal(snapshot.pressureSolver,'ipbf');
});
test('partial, stale or substituted raw particle evidence fails visibly',()=>{
 const input=new Float32Array(32);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,3,identity),/particle.*shape/);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,2,{...identity,stepCount:-1}),/step/);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,2,{...identity,pressureSolver:'pbf'}),/boundary/);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,2,{...identity,boundaryPressureContract:'unknown'}),/boundary/);
});
