import assert from 'node:assert/strict';
import * as serving from '../slat-sampler.js';
assert.equal(typeof serving.createTrellisDinoV3ConditioningAdapter,'function',
  'The existing complete DINO kernels must supply a producer-owned resident tensor without the diagnostic readback/teardown route.');
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
const allocations=[],uploads=[],runs=[],loads=[];let failStage;
const runtime={device:{limits:{maxComputeWorkgroupsPerDimension:65535},queue:{async onSubmittedWorkDone(){}}},
  createManagedBuffer(d){const b={...d,destroy(){b.destroyed=true;}};allocations.push(b);return b;},
  createTensor(d){return{...d,byteLength:d.shape.reduce((n,x)=>n*x,4)};},
  createUniformBuffer(d){const b={...d,destroy(){b.destroyed=true;}};allocations.push(b);return{buffer:b};},
  uploadTensor(t,data){uploads.push({t,data});},defineComputeKernel(d){return d;},
  async runKernel(k,o){runs.push({k,o});if(o.stage===failStage)throw Error('injected DINO failure');},
  async readTensor(){throw Error('serving DINO must not read features to CPU');}},route={routeId:'one-generation-session',runtime},
  c=1024,h=4096,weights={norm1Weight:new Float32Array(c),norm1Bias:new Float32Array(c),
    qWeight:new Float32Array(c*c),qBias:new Float32Array(c),kWeight:new Float32Array(c*c),
    vWeight:new Float32Array(c*c),vBias:new Float32Array(c),oWeight:new Float32Array(c*c),oBias:new Float32Array(c),
    layerScale1:new Float32Array(c),norm2Weight:new Float32Array(c),norm2Bias:new Float32Array(c),
    mlpUpWeight:new Float32Array(h*c),mlpUpBias:new Float32Array(h),
    mlpDownWeight:new Float32Array(c*h),mlpDownBias:new Float32Array(c),layerScale2:new Float32Array(c)},
  pixelValues=new Float32Array(512*512*3),prefixWeights={patchProjection:new Float32Array(c*16*16*3),patchBias:new Float32Array(c),
    classToken:new Float32Array(c),registerTokens:new Float32Array(4*c),ropeCos:new Float32Array(1024*64),ropeSin:new Float32Array(1024*64)},
  options={route,pixelValues,prefixWeights,async loadLayerWeights(i){loads.push(i);return weights;}},
  a=serving.createTrellisDinoV3ConditioningAdapter(options),invocation={id:'exact-generation-owner'},result=await a.run(invocation);
assert.equal(a.state,'completed');assert.equal(result.blocksExecuted,24);
assert.deepEqual(loads,Array.from({length:24},(_,i)=>i));
assert.deepEqual(result.conditioning.shape,[1,1029,1024]);assert.equal(result.conditioning.dtype,'f32');
assert.strictEqual(a.outputs.conditioning,result.conditioning);assert.strictEqual(a.runtime,runtime);
assert.ok(runs.every(x=>x.o.schedulerInvocation===invocation));
assert.equal(result.featureBytesToCPUDuringServing,0);assert.ok(!runs.some(x=>/readback|probe|oracle/.test(x.o.stage)));
assert.ok(!result.conditioning.buffer.destroyed);await assert.rejects(a.run(invocation),/completed/);
a.dispose();assert.ok(allocations.every(x=>x.destroyed));
assert.throws(()=>serving.createTrellisDinoV3ConditioningAdapter({...options,pixelValues:new Float32Array(3)}),/complete.*pixels/);
failStage='dinov3-block1-global-attention-resident';const b=serving.createTrellisDinoV3ConditioningAdapter(options);
await assert.rejects(b.run(invocation),/injected DINO failure/);assert.equal(b.state,'failed');assert.equal(b.outputs,undefined);
await assert.rejects(b.run(invocation),/failed/);b.dispose();assert.ok(allocations.every(x=>x.destroyed));
console.log('Actual complete DINO kernels provide resident conditioning without host readback; exact invocation, producer lifetime and failed-construction cleanup. Fake runtime is not new native DINO conformance.');
export {route,pixelValues,prefixWeights,weights as dinoLayerWeights};
