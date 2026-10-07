import assert from 'node:assert/strict';
import * as api from '../sparse-sampler-witness-checks.js';
import {buildSparseSamplerPlan} from '../sparse-sampler.js';
assert.equal(typeof api.validateSamplerFixture,'function','Missing source sampler-step admission with unbroken model/input identity.');
const sha='a'.repeat(64),commit='b'.repeat(40),config={steps:12,guidanceStrength:7.5,guidanceRescale:0.7,guidanceInterval:[0.6,1],rescaleT:5,sigmaMin:1e-5};
const plan=buildSparseSamplerPlan(config),base={source:{commit,dirty:''},sample:{sha256:sha},conditioning:{sha256:sha},checkpoint:{sha256:sha}};
const tensors=Object.fromEntries(api.SAMPLER_OBSERVATIONS.map(name=>{const shape=name==='stds'?[2]:plan.shape;return[name,{file:`${name}.f32`,shape,dtype:'float32',byteLength:shape.reduce((a,b)=>a*b,4),sha256:sha}];}));
const fixture={schema:'trellis2.sparse-sampler-reference.v0',status:'succeeded',source:{commit,dirty:''},producer:{commit,dirty:''},
  flowFixture:{sha256:sha},sample:{sha256:sha},conditioning:{sha256:sha},checkpoint:{sha256:sha},config,stepIndex:0,stepsExecuted:1,
  modelCalls:2,blocksExecuted:60,clock:plan.steps[0],referenceRoute:api.SAMPLER_REFERENCE_ROUTE,
  effectiveBackend:{device:'Device(gpu, 0)',attention:'fast',qk:{backend:'mlx-sum'},layernorm:{backend:'mlx-two-pass'},
    rope:{backend:'inherit'},terminal:{backend:'mlx-native-linear'},std:{backend:'source-cuda-t4-welford-metal',algorithm:'pytorch-2.10-cuda-welford-vt2-block512'}},tensors};
assert.equal(api.validateSamplerFixture(fixture,base,sha).steps.length,12);
for(const mutate of [f=>f.flowFixture.sha256='c'.repeat(64),f=>f.source.commit='c'.repeat(40),f=>f.conditioning.sha256='c'.repeat(64),
  f=>f.source.dirty=' M source',f=>f.modelCalls=0,f=>f.blocksExecuted=2,f=>f.stepsExecuted=12,f=>f.stepIndex=1,
  f=>f.effectiveBackend.attention='math',f=>f.effectiveBackend.device='Device(cpu, 0)',f=>f.effectiveBackend.std.backend='mlx-native-var',
  f=>f.clock.modelTime=1,f=>f.clock.dt=Math.fround(1-Math.fround(55/56)),f=>delete f.tensors.sample,
  f=>f.tensors.stds.byteLength=4,f=>f.tensors.positive.dtype='float16',f=>f.tensors.negative.file='../negative.f32']){
  const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>api.validateSamplerFixture(bad,base,sha));
}
assert.equal(api.validateSamplerFixture({...fixture,extra:{future:true}},base,sha).steps.length,12);
assert.throws(()=>api.compareSamplerTensor('sample',new Float32Array(),new Float32Array()),/empty/);
assert.throws(()=>api.compareSamplerTensor('sample',new Float32Array([NaN]),new Float32Array([1])),/finite/);
assert.equal(api.compareSamplerTensor('sample',new Float32Array([0,0]),new Float32Array([1,2])).passed,false);
assert.equal(api.compareSamplerTensor('sample',new Float32Array([1,2]),new Float32Array([1,2])).passed,true);
console.log('Sampler source/input/time/backend/count, complete output and nonfinite/blank false closure admission contracts pass.');
