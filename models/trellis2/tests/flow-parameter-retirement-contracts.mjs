import assert from 'node:assert/strict';
import {config,weights,harness} from './flow-upload-staging-contracts.mjs';
import {createTrellisSparseFlowAdapter} from '../sparse-flow.js';
import {createTrellisSLatFlowAdapter} from '../slat-flow.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
for(const mode of ['sparse','shape','texture']){
  const h=harness(),c=mode==='sparse'?config:{...config,tokenRows:5,inChannels:mode==='texture'?64:32,outChannels:32,mode},
    create=mode==='sparse'?createTrellisSparseFlowAdapter:createTrellisSLatFlowAdapter,
    flow=create({route:{runtime:h.runtime},config:c,weights:weights(c),conditioning:new Float32Array(35),
      ...(mode==='sparse'?{phases:new Float32Array(32)}:{coordinates:new Int32Array(15),
        ...(mode==='texture'?{concatConditioning:new Float32Array(160)}:{})})});
  assert.equal(typeof flow.releaseParameters,'function','Completed denoising must release parameters without destroying the exact final sample.');
  const sample=flow.inputs.sample;
  const run=flow.run({timestep:1,sample:new Float32Array(sample.shape.reduce((a,b)=>a*b,1))});
  assert.throws(()=>flow.releaseParameters(),/in use/);assert.ok(!sample.destroyed);await run;
  flow.releaseParameters();flow.releaseParameters();
  assert.ok(!sample.destroyed);
  assert.ok(h.allocations.filter(t=>t!==sample).every(t=>t.destroyed),'Only the final sampler input should stay owned/resident.');
  await assert.rejects(flow.run({timestep:1}),/parameters.*retired/);
  flow.dispose();flow.dispose();assert.ok(sample.destroyed);
  const borrowed=h.runtime.createTensor({name:'consumer-owned-sample',shape:sample.shape,dtype:'f32',usage:U.storage}),
    borrowedFlow=create({route:{runtime:h.runtime},config:c,weights:weights(c),conditioning:new Float32Array(35),sampleTensor:borrowed,
      ...(mode==='sparse'?{phases:new Float32Array(32)}:{coordinates:new Int32Array(15),
        ...(mode==='texture'?{concatConditioning:new Float32Array(160)}:{})})});
  borrowedFlow.releaseParameters();borrowedFlow.dispose();assert.ok(!borrowed.destroyed);
  assert.ok(h.allocations.filter(t=>t!==borrowed).every(t=>t.destroyed));borrowed.buffer.destroy();
}
console.log('Explicit flow parameter retirement preserves only the exact sample until final disposal; retired flows reject further forwards.');
