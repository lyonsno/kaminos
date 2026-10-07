import assert from 'node:assert/strict';
import * as existing from '../sparse-flow-witness-checks.js';
assert.equal(existing.FLOW_REFERENCE_ROUTE.includes('full-sparse-flow'),true);
const imported = await import('../sparse-flow-witness-checks.js');
assert.equal(typeof imported.validateSLatFlowFixture,'function','Source-identified variable-row SLat forward must have complete reference admission.');
const { validateSLatFlowFixture, SLAT_REFERENCE_ROUTE } = imported;
const { buildSLatFlowPlan } = await import('../slat-flow.js');
assert.equal(typeof imported.slatWitnessRequiredLimits, 'function',
 'SLat witness capacity must follow actual reusable per-head buffers, not twelve simultaneous score buffers.');
const largePlan = buildSLatFlowPlan({ tokenRows: 10000 });
const adapterLimits = { maxStorageBufferBindingSize: 4294967292, maxBufferSize: 4294967292 };
assert.ok(largePlan.tokenRows ** 2 * 12 * 4 > adapterLimits.maxStorageBufferBindingSize,
 'Regression must expose the old false rejection.');
assert.deepEqual(imported.slatWitnessRequiredLimits(largePlan, adapterLimits),
 { maxStorageBufferBindingSize: 400000000, maxBufferSize: 400000000 });
assert.throws(() => imported.slatWitnessRequiredLimits(largePlan,
 { ...adapterLimits, maxStorageBufferBindingSize: 399999996 }), /storage binding capacity/);
assert.throws(() => imported.slatWitnessRequiredLimits(largePlan,
 { ...adapterLimits, maxBufferSize: 399999996 }), /buffer capacity/);
assert.deepEqual(imported.slatWitnessRequiredLimits(buildSLatFlowPlan({ tokenRows: 1728 }), adapterLimits),
 { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456 });
assert.equal(imported.slatWitnessRequiredLimits(buildSLatFlowPlan({ tokenRows: 10000, contextRows: 12000 }), adapterLimits)
 .maxStorageBufferBindingSize, 480000000, 'Cross attention may be wider than self attention.');
const { sparseBlockWeightShapes } = await import('../sparse-block.js');
const hash='a'.repeat(64), shape={tokenRows:1728,mode:'shape',channels:1536,heads:12,contextChannels:1024,contextRows:1029,
 hidden:8192,frequencyDim:256,numBlocks:30};
function fixture(config=shape){
 const p=buildSLatFlowPlan(config), c=p.flow.block.channels,r=p.tokenRows;
 const m={schema:'trellis2.slat-flow-reference.v0',status:'succeeded',referenceRoute:SLAT_REFERENCE_ROUTE,config,
 source:{commit:'b'.repeat(40),dirty:''},producer:{commit:'c'.repeat(40),dirty:''},checkpoint:{sha256:hash},conditioning:{sha256:hash},
 coordinates:{manifestSha256:hash,coordinateOrder:'z-y-x-lexicographic',sourceCommit:'b'.repeat(40)},
 sample:{generator:'numpy-PCG64-standard-normal-f32',seed:42,sha256:hash},fullModelExecutions:1,blocksExecuted:30,
 effectiveBackend:{device:'Device(gpu, 0)',attention:'fast',qk:{backend:'mlx-sum'},layernorm:{backend:'mlx-two-pass'},
 rope:{backend:'mlx-real'},terminal:{backend:'mlx-native-linear'}},
 timeConvention:{captureSpace:'normalized-sampler-time',captureValue:1,modelMultiplier:1000,modelValue:1000,modelDtype:'float32'},tensors:{}};
 const tensor=(name,s,dtype='float32')=>m.tensors[name]={file:name+'.bin',shape:s,dtype,byteLength:s.reduce((a,b)=>a*b,4),sha256:hash};
 tensor('sample',[r,32]);tensor('coordinates',[r,3],'int32');tensor('timestep',[1]);tensor('conditioning',[1029,1024]);
 tensor('logits',[1,1,64,64,64]);tensor('rope.frequencies',[21]);tensor('gelu',[65536]);
 tensor('terminal.weight',[32,c]);tensor('terminal.bias',[32]);
 for(const [k,s]of Object.entries({'input.weight':[c,p.mode==='texture'?64:32],'input.bias':[c],'time0.weight':[c,256],'time0.bias':[c],
 'time2.weight':[c,c],'time2.bias':[c],'mod.weight':[6*c,c],'mod.bias':[6*c]}))tensor('prefix.'+k,s);
 for(let i=0;i<30;i++)for(const [k,s]of Object.entries(sparseBlockWeightShapes(p.flow.block))){
  tensor(`block${i}.${k}`,s);Object.assign(m.tensors[`block${i}.${k}`],{checkpointKey:`blocks.${i}.${existing.FLOW_BLOCK_KEYS[k]}`,
   checkpointDtype:'BF16',checkpointTensorSha256:hash});}
 for(const [k,s]of Object.entries({phases:[r,64,2],projected:[r,c],modulation:[1,6*c],hidden:[r,c],normalized:[r,c],prediction:[r,32]}))tensor('expected.'+k,s);
 m.coordinates.logitsSha256=m.tensors.logits.sha256;m.coordinates.tensorSha256=m.tensors.coordinates.sha256;
 if(p.mode==='texture'){tensor('concatConditioning',[r,32]);m.concatConditioning={sha256:hash,coordinateTensorSha256:hash,arithmetic:'normalized-shape-latent-f32'};}
 return m;
}
const m=fixture();assert.equal(validateSLatFlowFixture(m).tokenRows,1728);
assert.equal(validateSLatFlowFixture({...m,additive:{allowed:true}}).tokenRows,1728);
for(const mutate of [x=>x.effectiveBackend.device='Device(cpu, 0)',x=>x.effectiveBackend.rope.backend='source-complex',
 x=>x.source.dirty=' M ignored',x=>x.blocksExecuted=29,x=>x.timeConvention.modelValue=1,x=>x.coordinates.coordinateOrder='row-shuffled',
 x=>x.sample.generator='unspecified',x=>x.tensors.coordinates.dtype='float32',x=>x.tensors['expected.prediction'].shape=[1,32],
 x=>x.tensors['expected.phases'].byteLength-=4,x=>delete x.tensors['block29.mlp.out.weight'],x=>x.config.tokenRows=0]){
 const wrong=structuredClone(m);mutate(wrong);assert.throws(()=>validateSLatFlowFixture(wrong));}
const texture=fixture({...shape,mode:'texture'});assert.equal(validateSLatFlowFixture(texture).mode,'texture');
assert.throws(()=>validateSLatFlowFixture({...texture,concatConditioning:undefined}));
const mismatch=structuredClone(texture);mismatch.concatConditioning.coordinateTensorSha256='d'.repeat(64);assert.throws(()=>validateSLatFlowFixture(mismatch));
console.log('Complete source-identified SLat references reject route/time/order/precision/partial evidence and texture coordinate mismatch; metadata fixtures are not live conformance.');
