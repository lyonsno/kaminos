import assert from 'node:assert/strict';
import * as api from '../sparse-flow-witness-checks.js';
import { buildSparseFlowPlan } from '../sparse-flow.js';
import { sparseBlockWeightShapes } from '../sparse-block.js';
assert.equal(typeof api.validateFlowFixture,'function','Missing full-stack reference admission with actual sampler clock.');
const p=buildSparseFlowPlan(),sha='a'.repeat(64);
const descriptor=shape=>({shape,dtype:'float32',byteLength:shape.reduce((a,b)=>a*b,4),sha256:sha,file:'tensor.f32'});
const tensors={sample:descriptor(p.prefix.inputShape),timestep:descriptor([1]),conditioning:descriptor([1029,1024]),
  phases:descriptor([4096,64,2]),gelu:descriptor([65536]),'terminal.weight':descriptor([8,1536]),'terminal.bias':descriptor([8]),
  'expected.projected':descriptor([4096,1536]),'expected.modulation':descriptor([1,9216]),
  'expected.hidden':descriptor([4096,1536]),'expected.normalized':descriptor([4096,1536]),'expected.prediction':descriptor(p.outputShape)};
const prefixShapes={'input.weight':[1536,8],'input.bias':[1536],'time0.weight':[1536,256],'time0.bias':[1536],
  'time2.weight':[1536,1536],'time2.bias':[1536],'mod.weight':[9216,1536],'mod.bias':[9216]};
for(const [k,shape] of Object.entries(prefixShapes))tensors[`prefix.${k}`]=descriptor(shape);
for(let i=0;i<30;i++)for(const [k,shape] of Object.entries(sparseBlockWeightShapes(p.block))){
  tensors[`block${i}.${k}`]={...descriptor(shape),checkpointKey:`blocks.${i}.${api.FLOW_BLOCK_KEYS[k]}`,
    checkpointDtype:'BF16',checkpointTensorSha256:sha};
}
const fixture={schema:'trellis2.sparse-flow-reference.v0',status:'succeeded',config:{},source:{commit:'b'.repeat(40),dirty:''},
  checkpoint:{sha256:sha},sample:{sha256:sha},conditioning:{sha256:sha},referenceRoute:api.FLOW_REFERENCE_ROUTE,
  fullModelExecutions:1,blocksExecuted:30,timeConvention:{captureSpace:'normalized-sampler-time',captureValue:1,modelMultiplier:1000,modelValue:1000,modelDtype:'float32'},
  effectiveBackend:{device:'Device(gpu, 0)',attention:'fast',qk:{backend:'mlx-sum'},layernorm:{backend:'mlx-two-pass'},rope:{backend:'inherit'},terminal:{backend:'mlx-native-linear'}},tensors};
assert.equal(api.validateFlowFixture(fixture).numBlocks,30);
for(const mutate of [f=>f.config.numBlocks=2,f=>delete f.tensors['block29.mlp.out.weight'],
  f=>f.tensors['block29.mlp.out.weight'].checkpointKey='blocks.28.mlp.mlp.2.weight',
  f=>f.timeConvention.modelValue=1,f=>f.timeConvention.modelMultiplier=1,f=>f.source.dirty=' M source',
  f=>f.effectiveBackend.device='Device(cpu, 0)',f=>f.referenceRoute='fixture-callback',
  f=>f.fullModelExecutions=0,f=>delete f.tensors['expected.prediction'],f=>f.tensors['expected.hidden'].byteLength=4,
  f=>f.tensors['terminal.weight'].dtype='float16',f=>f.tensors.phases.sha256='',f=>f.blocksExecuted=2]){
  const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>api.validateFlowFixture(bad));
}
assert.equal(api.validateFlowFixture({...fixture,extra:'additive-compatible'}).numBlocks,30);
assert.equal(api.compareFlowTensor(new Float32Array(4),new Float32Array([1,2,3,4])).passed,false);
assert.throws(()=>api.compareFlowTensor(new Float32Array(),new Float32Array()),/empty/);
assert.throws(()=>api.compareFlowTensor(new Float32Array([NaN]),new Float32Array([1])),/finite/);
assert.equal(api.compareFlowTensor(new Float32Array([1,2]),new Float32Array([1,2])).passed,true);
console.log('Full-stack fixture admission rejects wrong clock/source/backend/block count/weights, partial output and changed precision; comparison refuses blank/nonfinite proof. Synthetic policy test only.');
