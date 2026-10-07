import assert from 'node:assert/strict';
import * as sampler from '../sparse-sampler.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';

assert.equal(typeof sampler.createTrellisSparseSamplerAdapter, 'function',
  'Missing resident prediction-to-CFG/Euler consumer, including source timestep schedule.');
const plan = sampler.buildSparseSamplerPlan();
assert.equal(plan.steps.length,12);
assert.equal(plan.steps[0].modelTime,1000);
assert.equal(plan.steps[0].dt,Math.fround(1-55/56));
assert.equal(plan.steps.at(-1).previousTime,0);
assert.equal(plan.steps.filter(s=>s.guided).length,10);
assert.equal(plan.stdLogicalThreads,512,'preserve source logical reduction, not a 256-thread substitute');
assert.equal(plan.stdHardwareThreads,256);
assert.equal(plan.elements,32768,'preserve complete source latent');
assert.throws(()=>sampler.buildSparseSamplerPlan({steps:0}),/steps/);
assert.throws(()=>sampler.buildSparseSamplerPlan({guidanceInterval:[1,0]}),/interval/);
assert.throws(()=>sampler.buildSparseSamplerPlan({sigmaMin:1}),/sigma/);

const allocations=[],uploads=[],runs=[],calls=[];
const runtime={device:{limits:{maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupStorageSize:16384}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocations.push(t);return t;},
  uploadTensor(t,values){uploads.push({t,values});},defineComputeKernel(spec){return spec;},
  async runKernel(kernel,options){runs.push({kernel,options});},
  readTensor(){assert.fail('resident sampling must not read predictions or latent back');}};
const state=runtime.createTensor({name:'model.state',shape:[1,8,16,16,16],dtype:'f32',usage:U.storage|U.copyDst|U.copySrc});
const prediction=runtime.createTensor({name:'model.prediction',shape:state.shape,dtype:'f32',usage:state.usage});
const flow={runtime,routeId:'model-route',plan:{outputShape:state.shape,prefix:{inputShape:state.shape},block:{contextRows:3,contextChannels:2}},
  inputs:{sample:state},outputs:{prediction},async run(input,invocation){calls.push({input,invocation});return{prediction,blocksExecuted:30};},
  dispose(){assert.fail('sampler must not dispose caller-owned model');}};
const positive=new Float32Array(6).fill(1),negative=new Float32Array(6),noise=new Float32Array(32768);
const adapter=sampler.createTrellisSparseSamplerAdapter({route:{runtime,routeId:'model-route'},flow,conditioning:positive,negativeConditioning:negative});
const invocation={id:'one-sampler-job'};
const result=await adapter.step({sample:noise,stepIndex:0},invocation);
assert.strictEqual(result.sample,state,'Euler writes the latent the next model call consumes');
assert.equal(result.modelCalls,2);assert.equal(result.stepIndex,0);
assert.strictEqual(calls[0].input.sample,noise);assert.equal(calls[1].input.sample,undefined);
assert.strictEqual(calls[0].input.conditioning,positive);assert.strictEqual(calls[1].input.conditioning,negative);
assert.equal(calls[0].input.timestep,1000);assert.equal(calls[1].input.timestep,1000);
assert.ok(calls.every(c=>c.invocation===invocation));assert.ok(runs.every(r=>r.options.schedulerInvocation===invocation));
const stages=runs.map(r=>r.options.stage);
assert.ok(stages.indexOf('sampler-positive-snapshot')<stages.indexOf('sampler-guidance'));
assert.ok(stages.indexOf('sampler-euler-delta')<stages.indexOf('sampler-euler-update'),'source delta materialization is separate from subtraction');
const std=runs.find(r=>r.options.stage==='sampler-guidance-std');
assert.deepEqual(std.options.dispatch,[2,1,1]);
assert.match(std.kernel.code,/array<f32,512>/);assert.match(std.kernel.code,/fma\(delta,new_delta,current\.m2\)/);
assert.match(std.kernel.code,/vector_index\+=512u/);
assert.equal(uploads.filter(r=>r.t===state||r.t===prediction).length,0,'sampler itself never reuploads model tensors');
await assert.rejects(adapter.step({stepIndex:0},invocation),/next step/);
await adapter.step({stepIndex:1},invocation);
assert.equal(calls.at(-1).input.sample,undefined,'following step consumes resident updated latent');
const active=adapter.step({stepIndex:2},invocation);
await assert.rejects(adapter.step({stepIndex:2},invocation),/in use/);
assert.throws(()=>adapter.dispose(),/in use/);await active;
const execute=runtime.runKernel;runtime.runKernel=async()=>{throw new Error('sampler dispatch failure');};
await assert.rejects(adapter.step({stepIndex:3},invocation),/dispatch failure/);
runtime.runKernel=execute;await assert.rejects(adapter.step({stepIndex:3},invocation),/fresh sample/);
await adapter.step({sample:noise,stepIndex:0},invocation);
adapter.dispose();adapter.dispose();assert.ok(!state.destroyed&&!prediction.destroyed);
assert.ok(allocations.filter(t=>t!==state&&t!==prediction).every(t=>t.destroyed));
await assert.rejects(adapter.step({sample:noise,stepIndex:0},invocation),/disposed/);
assert.throws(()=>sampler.createTrellisSparseSamplerAdapter({route:{runtime:{...runtime}},flow,conditioning:positive}),/same runtime/);
const whole=sampler.createTrellisSparseSamplerAdapter({route:{runtime,routeId:'model-route'},flow,conditioning:positive,negativeConditioning:negative});
calls.length=0;const completed=await whole.run({sample:noise},invocation);
assert.equal(completed.stepsExecuted,12);assert.equal(calls.length,22,'complete schedule; no hidden first-step cap');
assert.equal(calls.filter(c=>c.input.sample!==undefined).length,1);
whole.dispose();
console.log('Resident CFG/Euler composition, complete schedule, exact clock/delta, logical512 std, state ownership and failure recovery contracts pass; fake runtime is not numeric evidence.');
