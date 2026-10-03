import assert from 'node:assert/strict';
import * as sampler from '../slat-sampler.js';
assert.equal(typeof sampler.createTrellisGenerationFromConditioningAdapter,'function',
  'The generation caller must run the actual sparse/cascade/shape/texture consumers, not leave support and conditioning as isolated exports.');
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {buildSparseBlockPlan,sparseBlockWeightShapes} from '../sparse-block.js';
import {buildSparseDecoderPlan,sparseDecoderWeightShapes,buildSLatDecoderPlan,slatDecoderWeightShapes} from '../sparse-decoder.js';
const create=sampler.createTrellisGenerationFromConditioningAdapter,allocated=[],uploads=[],runs=[],reads=[],observed=[];
let phase,marked=false,failStage;
const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),
    buffer:spec.buffer??{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
  uploadTensor(t,data){uploads.push({t,data});},defineComputeKernel(k){return k;},
  async runKernel(k,o){for(const b of k.bindings)assert.ok(!b.resource.destroyed&&!b.resource.buffer?.destroyed,'downstream GPU input must remain live: '+b.resource.name);
    runs.push({k,o});if(o.stage==='slat-regrid-mark')marked=true;
    if(o.stage===failStage)throw Error('injected generation failure');},
  async readTensor(t){reads.push(t);assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4);
    return new Uint32Array([t.name.includes('hash-status')?0:t.name.includes('occupancy.count')?3:
      phase==='learned-cascade-support'&&marked?4:5]);}},route={runtime,routeId:'actual-seven-model-composition'},
  conditioning=runtime.createTensor({name:'image-encoder-owned-features',shape:[1,7,5],dtype:'f32',usage:U.storage}),
  common={channels:24,heads:3,contextRows:7,contextChannels:5,hidden:20,frequencyDim:6,numBlocks:1,
    steps:1,guidanceStrength:1},
  arrays=shapes=>Object.fromEntries(Object.entries(shapes).map(([name,shape])=>[name,new Float32Array(shape.reduce((a,b)=>a*b,1))]));
function flowWeights(config,inChannels,outChannels){const p=buildSparseBlockPlan(config),c=p.channels;
  return{prefix:arrays({'input.weight':[c,inChannels],'input.bias':[c],'time0.weight':[c,6],'time0.bias':[c],
    'time2.weight':[c,c],'time2.bias':[c],'mod.weight':[6*c,c],'mod.bias':[6*c]}),
    blocks:[arrays({...sparseBlockWeightShapes(p),gelu:[65536]})],
    terminal:{weight:new Float32Array(outChannels*c),bias:new Float32Array(outChannels)}};
}
const shapeConfig={channels:[32,4],numBlocks:[0,0]},occupancyConfig={channels:[2],numResBlocks:0,numResBlocksMiddle:0},
  models={sparseFlow:{config:common,weights:flowWeights(common,8,8),phases:new Float32Array(4096*8)},
    occupancyDecoder:{config:occupancyConfig,weights:arrays(sparseDecoderWeightShapes(buildSparseDecoderPlan(occupancyConfig)))},
    lowResolutionShape:{config:common,weights:flowWeights({...common,tokenRows:3},32,32)},
    highResolutionShape:{config:common,weights:flowWeights({...common,tokenRows:4},32,32)},
    shapeDecoder:{config:shapeConfig,weights:arrays(slatDecoderWeightShapes(buildSLatDecoderPlan({...shapeConfig,tokenRows:3}))),siluTable:new Float32Array(65536)},
    textureFlow:{config:common,weights:flowWeights({...common,tokenRows:4},64,32)},
    textureDecoder:{config:shapeConfig,weights:arrays(slatDecoderWeightShapes(buildSLatDecoderPlan({...shapeConfig,tokenRows:4,mode:'texture'}))),siluTable:new Float32Array(65536)}},
  options={route,conditioningTensor:conditioning,models,meshResolution:128,seed:42,
    onPhase(e){phase=e.phase;if(phase==='learned-cascade-support')marked=false;
      if(['low-resolution-shape-sampling','high-resolution-shape-sampling','learned-geometry-decoding','shape-guided-material-decoding'].includes(phase))
        assert.equal(allocated.filter(t=>t.name.startsWith('trellis.block.')&&!t.destroyed).length,0,
          'consumed flow weights/workspace must be released before '+phase);
      if(['high-resolution-shape-sampling','shape-conditioned-texture-sampling'].includes(phase))
        assert.equal(uploads.filter(u=>u.t.name.startsWith('trellis.slat-decoder.')&&!u.t.destroyed).length,0,
          'consumed learned-decoder parameters must be released before '+phase);
      observed.push(e);}},
  a=create(options),invocation={id:'one-composed-generation'},result=await a.run(invocation);
assert.equal(a.state,'completed');assert.equal(a.phase,'completed');assert.strictEqual(a.outputs,result);
assert.deepEqual(result.geometry.features.shape,[5,7]);assert.deepEqual(result.material.features.shape,[5,6]);
for(const t of [result.geometry.features,result.geometry.coordinates,...result.geometry.subdivisions,
  result.material.features,result.material.coordinates,result.shapeCodes,result.textureCodes])
  assert.ok(!t.destroyed,'returned resident output lives until its consumer disposes generation: '+t.name);
assert.equal(uploads.filter(u=>u.t.name.startsWith('trellis.slat-decoder.')&&!u.t.destroyed).length,0,
  'completed material decoder retains outputs, not already-consumed parameters');
assert.equal(result.lowResolutionRows,3);assert.equal(result.highResolutionRows,4);
assert.deepEqual(Object.keys(result.initialNoise),['sparse','lowResolutionShape','highResolutionShape','texture']);
assert.deepEqual(result.initialNoise.sparse.shape,[1,8,16,16,16]);assert.equal(result.initialNoise.sparse.values.length,32768);
assert.equal(result.initialNoise.lowResolutionShape.values.length,96);assert.equal(result.initialNoise.highResolutionShape.values.length,128);
assert.ok(Object.values(result.initialNoise).every(n=>n.values.every(Number.isFinite)));
assert.match(result.comparison,/no assertion.*matched MLX/);assert.ok(Object.values(result.modelIdentities).every(v=>v===null));
assert.equal(result.featureBytesToCPUDuringServing,0);assert.equal(result.coordinateBytesToCPUDuringServing,0);
assert.deepEqual(observed.map(e=>e.phase),['sparse-structure-sampling','occupancy-decoding','low-resolution-shape-sampling',
  'learned-cascade-support','high-resolution-shape-sampling','learned-geometry-decoding',
  'shape-conditioned-texture-sampling','shape-guided-material-decoding']);
assert.ok(runs.every(v=>v.o.schedulerInvocation===invocation));
assert.ok(runs.filter(v=>v.o.stage==='flow-resident-conditioning-bf16').every(v=>v.k.bindings[0].resource===conditioning));
assert.ok(!uploads.some(v=>v.t===conditioning));assert.ok(reads.every(v=>v.dtype==='u32'&&v.byteLength===4));
await assert.rejects(a.run(invocation),/completed/);a.dispose();assert.ok(!conditioning.destroyed);
const b=create(options),again=await b.run(invocation);
for(const key of Object.keys(result.initialNoise))assert.deepEqual(again.initialNoise[key].values,result.initialNoise[key].values,'same seed and observed geometry replays complete initial noise');
b.dispose();
assert.throws(()=>create({...options,models:{...models,highResolutionShape:undefined}}),/highResolutionShape/);
assert.throws(()=>create({...options,models:{...models,highResolutionShape:models.lowResolutionShape}}),/separate.*model/);
const explicit=new Float32Array(32768),c=create({...options,initialNoise:{sparse:explicit}});
assert.strictEqual((await c.run(invocation)).initialNoise.sparse.values,explicit);c.dispose();
const failed=create(options);failStage='decoder-layernorm';
await assert.rejects(failed.run(invocation),/injected/);assert.equal(failed.state,'failed');assert.equal(failed.outputs,undefined);
assert.equal(failed.phase,'learned-cascade-support');assert.equal(failed.noiseInputs.sparse.values.length,32768);
assert.equal(failed.noiseInputs.lowResolutionShape.values.length,96);
await assert.rejects(failed.run(invocation),/failed/);failed.dispose();failStage=undefined;
const bad=create({...options,initialNoise:{highResolutionShape:new Float32Array(96)}});
await assert.rejects(bad.run(invocation),/complete.*highResolutionShape/);assert.equal(bad.outputs,undefined);bad.dispose();
assert.ok(allocated.filter(t=>t!==conditioning&&t.name!=='trellis.occupancy.occupied-view').every(t=>t.destroyed));
const retainedNoise=[],retention=create({...options,async onNoiseInput(input){
  retainedNoise.push(input.stage);assert.ok(input.values instanceof Float32Array);
  assert.ok(input.values.every(Number.isFinite));assert.equal(input.values.length,input.shape.reduce((a,b)=>a*b,1));
}});
await retention.run(invocation);
assert.deepEqual(retainedNoise,['sparse','lowResolutionShape','highResolutionShape','texture'],
  'Complete initial noise must be observable before its model runs, not only after a browser-dependent full completion.');
retention.dispose();
const retentionFailure=create({...options,onNoiseInput(){throw Error('noise retention failed');}});
await assert.rejects(retentionFailure.run(invocation),/noise retention failed/);
assert.equal(retentionFailure.state,'failed');assert.equal(retentionFailure.outputs,undefined);retentionFailure.dispose();
console.log('Production conditioning → sparse/occupancy → LR/cascade/HR shape → guided texture fields composition; replayable complete initial noise and poisoned failure. Fake runtime is not full-model/GPU or mesh/PBR acceptance.');
export {models};
