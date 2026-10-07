import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSparseDecoderPlan,sparseDecoderWeightShapes} from '../sparse-decoder.js';
const path=new URL('../sparse-decoder-witness-checks.js',import.meta.url);
assert.ok(fs.existsSync(path),'Missing source decoder admission and concrete complete-volume numerical predicates.');
const {validateDecoderFixture,compareDecoderTensor,decoderObservationShapes}=await import(path);
const config={resolution:2,latentChannels:2,outChannels:1,channels:[4,2],numResBlocks:1,numResBlocksMiddle:1},plan=buildSparseDecoderPlan(config),sha='a'.repeat(64),commit='b'.repeat(40);
const desc=(name,shape)=>({file:name+'.f32',shape,dtype:'float32',byteLength:shape.reduce((a,b)=>a*b,4),sha256:sha});
const shapes=sparseDecoderWeightShapes(plan);
const tensors={sample:desc('sample',plan.inputShape),...Object.fromEntries(Object.entries(shapes).map(([k,s])=>['weight.'+k,desc('weight.'+k,s)])),
  ...Object.fromEntries(Object.entries(decoderObservationShapes(plan)).map(([k,s])=>['expected.'+k,desc('expected.'+k,s)]))};
const fixture={schema:'trellis2.sparse-decoder-reference.v0',status:'succeeded',config,fixtureKind:'synthetic-operation-conformance',
  referenceRoute:'pinned-MLX-GPU-source-sparse-decoder/F32',source:{commit,dirty:''},producer:{commit,dirty:''},modelCalls:1,
  convolutionsExecuted:plan.convolutions,parameterCount:Object.values(shapes).reduce((n,s)=>n+s.reduce((a,b)=>a*b,1),0),
  effectiveBackend:{device:'Device(gpu, 0)',arithmetic:plan.arithmetic,normEpsilon:1e-6,weightLayout:plan.weightLayout},tensors};
assert.deepEqual(validateDecoderFixture(fixture).outputShape,[1,1,4,4,4]);
for(const mutate of [r=>r.status='failed',r=>r.modelCalls=0,r=>r.convolutionsExecuted=1,r=>r.parameterCount=0,
  r=>r.fixtureKind='checkpoint-decoder',r=>r.effectiveBackend.device='Device(cpu, 0)',r=>r.effectiveBackend.arithmetic='fp16',
  r=>r.effectiveBackend.normEpsilon=1e-5,r=>r.source.dirty=' M source',r=>r.producer.commit='bad',
  r=>delete r.tensors['weight.blocks.1.conv.weight'],r=>r.tensors['expected.level1'].shape=[1],r=>r.tensors['expected.logits'].byteLength=4,
  r=>r.tensors.sample.file='../elsewhere.f32']){const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>validateDecoderFixture(bad));}
assert.deepEqual(validateDecoderFixture({...fixture,unknownFutureField:true}).outputShape,plan.outputShape);
assert.ok(compareDecoderTensor(new Float32Array([1,2]),new Float32Array([1,2])).passed);
assert.ok(!compareDecoderTensor(new Float32Array([1,2]),new Float32Array([1,3])).passed);
assert.throws(()=>compareDecoderTensor(new Float32Array(),new Float32Array()),/empty/);
assert.throws(()=>compareDecoderTensor(new Float32Array([NaN]),new Float32Array([1])),/non.?finite/);
console.log('Complete source decoder, effective F32/GPU geometry, all weights/output bytes and synthetic claim separation admission pass.');
