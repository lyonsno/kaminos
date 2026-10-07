import assert from 'node:assert/strict';
import * as witness from '../sparse-sampler-witness.js';
import {buildSparseSamplerPlan} from '../sparse-sampler.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
assert.equal(typeof witness.createSparseSamplerTrajectoryCapture,'function','Missing complete recurrent sampler observation with GPU-only snapshots before overwrite.');
const tensors=[],copies=[],calls=[];
const runtime={createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),values:[],buffer:{destroy(){t.destroyed=true;}}};t.buffer.tensor=t;tensors.push(t);return t;},
  device:{createCommandEncoder(){return{copyBufferToBuffer(source,_a,target,_b,bytes){copies.push({source:source.tensor,target:target.tensor,bytes});target.tensor.values=[...source.tensor.values];},finish(){return{};}};}},
  queue:{submit(){}},readTensor(){assert.fail('no CPU crossing during recurrence');}};
const state=runtime.createTensor({shape:[1,8,16,16,16],dtype:'f32',usage:U.copySrc|U.copyDst}),stds=runtime.createTensor({shape:[2],dtype:'f32',usage:U.copySrc|U.copyDst});
const plan=buildSparseSamplerPlan(),sampler={plan,outputs:{sample:state},diagnostics:{positive:state,negative:state,guided:state,x0Positive:state,x0Guided:state,stds,rescaled:state,mixed:state,final:state},
  async step(input,invocation){calls.push({input,invocation});state.values=[input.stepIndex+1];return{sample:state,stepIndex:input.stepIndex,clock:plan.steps[input.stepIndex],modelCalls:plan.steps[input.stepIndex].guided?2:1};}};
const capture=witness.createSparseSamplerTrajectoryCapture(runtime,sampler),noise=new Float32Array(32768),invocation={job:'complete-schedule'};
const result=await capture.run(noise,invocation);
assert.equal(result.stepsExecuted,12);assert.equal(result.modelCalls,22);assert.equal(capture.steps.length,12);
assert.equal(calls.filter(c=>c.input.sample!==undefined).length,1);assert.ok(calls.every(c=>c.invocation===invocation));
assert.strictEqual(result.sample,state);assert.deepEqual(capture.first.sample.values,[1]);
assert.deepEqual(capture.steps.map(row=>row.tensor.values[0]),Array.from({length:12},(_,i)=>i+1),'every saved state survives later overwrites');
assert.ok(copies.every(c=>c.bytes===c.source.byteLength));assert.ok(copies.some(c=>c.bytes===8),'complete two-scalar std snapshot');
await assert.rejects(capture.run(noise,invocation),/once/);
capture.dispose();capture.dispose();assert.ok(!state.destroyed&&!stds.destroyed);assert.ok(tensors.slice(2).every(t=>t.destroyed));
const partial=witness.createSparseSamplerTrajectoryCapture(runtime,{...sampler,async step(input,job){if(input.stepIndex===3)throw Error('observed step failure');return sampler.step(input,job);}});
await assert.rejects(partial.run(noise,invocation),/observed step failure/);assert.equal(partial.steps.length,3);assert.equal(partial.completedSteps,3);partial.dispose();
console.log('Complete recurrent schedule, single initial CPU upload, one invocation, GPU snapshot preservation and partial failure retention pass; fake runtime only.');
