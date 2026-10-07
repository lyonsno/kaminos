import assert from 'node:assert/strict';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {buildSparseBlockPlan,sparseBlockWeightShapes} from '../sparse-block.js';
import {createTrellisSLatFlowAdapter} from '../slat-flow.js';
import {createTrellisSLatSamplerAdapter,createTrellisSLatScaleAdapter} from '../slat-sampler.js';
import {buildSLatDecoderPlan,slatDecoderWeightShapes,createTrellisSLatDecoderAdapter} from '../sparse-decoder.js';

// This exercises the checked-in consumer interfaces, not replacement consumer
// callbacks. The fake device exposes ownership and traffic, not GPU numerics.
const config={tokenRows:5,channels:24,heads:3,contextRows:7,contextChannels:5,
  hidden:20,frequencyDim:6,numBlocks:1,steps:3},allocations=[],uploads=[],runs=[],reads=[];
const arrays=shapes=>Object.fromEntries(Object.entries(shapes).map(([key,shape])=>
  [key,new Float32Array(shape.reduce((a,b)=>a*b,1))]));
function flowWeights(mode){
  const p=buildSparseBlockPlan(config),c=p.channels;
  return {prefix:arrays({'input.weight':[c,mode==='texture'?64:32],'input.bias':[c],
    'time0.weight':[c,6],'time0.bias':[c],'time2.weight':[c,c],'time2.bias':[c],
    'mod.weight':[6*c,c],'mod.bias':[6*c]}),
    blocks:[arrays({...sparseBlockWeightShapes(p),gelu:[65536]})],
    terminal:{weight:new Float32Array(32*c),bias:new Float32Array(32)}};
}
const runtime={device:{limits:{maxStorageBufferBindingSize:134217728,maxComputeWorkgroupsPerDimension:65535},
  queue:{async onSubmittedWorkDone(){}}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),
    buffer:{destroy(){t.destroyed=true;}}};allocations.push(t);return t;},
  uploadTensor(t,values){uploads.push({t,values});},defineComputeKernel(spec){return spec;},
  async runKernel(kernel,options){
    assert.ok(kernel.bindings.every(b=>!b.resource.destroyed),'Every consumer must exercise live producer buffers.');
    runs.push({kernel,options});
  },async readTensor(t){
    reads.push(t);assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4,
      'Only decoder status/count words may cross CPU during this serving composition.');
    return new Uint32Array([t.name.includes('hash-status')?0:5]);
  }};
const route={runtime,routeId:'resident-slat-scale-consumers'},invocation={id:'one-serving-composition'},
  coordinates=runtime.createTensor({name:'coordinate-producer',shape:[5,3],dtype:'i32',usage:U.storage}),
  noise=runtime.createTensor({name:'shape-noise-producer',shape:[5,32],dtype:'f32',usage:U.storage}),
  textureNoise=runtime.createTensor({name:'texture-noise-producer',shape:[5,32],dtype:'f32',usage:U.storage});
const flow=createTrellisSLatFlowAdapter({route,config,weights:flowWeights('shape'),
  sampleTensor:noise,coordinateTensor:coordinates,conditioning:new Float32Array(35)}),
  sampler=createTrellisSLatSamplerAdapter({route,flow,config,conditioning:new Float32Array(35),initialSampleTensor:noise});
const sampled=await sampler.run({},invocation);
const denormalize=createTrellisSLatScaleAdapter({route,tokenRows:5,sampleTensor:sampled.sample});
const decoderCodes=await denormalize.run(invocation);
assert.strictEqual(denormalize.inputs.sample,sampled.sample);
const decoderConfig={tokenRows:5,latentChannels:32,resolution:4,channels:[16,8],numBlocks:[1,0]},
  shapePlan=buildSLatDecoderPlan(decoderConfig),
  decoder=createTrellisSLatDecoderAdapter({route,config:decoderConfig,
    weights:arrays(slatDecoderWeightShapes(shapePlan)),siluTable:new Float32Array(65536),
    sampleTensor:decoderCodes,coordinateTensor:coordinates});
assert.strictEqual(decoder.inputs.sample,denormalize.outputs.sample);
const shape=await decoder.run(invocation);
assert.deepEqual(shape.features.shape,[5,7]);assert.equal(shape.subdivisions.length,1);
// The source deliberately re-normalizes the denormalized shape, rather than
// bypassing its F32 rounding by reusing the original sampler result.
const normalize=createTrellisSLatScaleAdapter({route,tokenRows:5,direction:'normalize',sampleTensor:decoderCodes}),
  textureConditioning=await normalize.run(invocation);
assert.notStrictEqual(textureConditioning,sampled.sample);
const textureFlow=createTrellisSLatFlowAdapter({route,config:{...config,mode:'texture'},weights:flowWeights('texture'),
  sampleTensor:textureNoise,coordinateTensor:coordinates,concatTensor:textureConditioning,conditioning:new Float32Array(35)}),
  textureSampler=createTrellisSLatSamplerAdapter({route,flow:textureFlow,config:{...config,mode:'texture'},
    conditioning:new Float32Array(35),initialSampleTensor:textureNoise}),
  textureSample=await textureSampler.run({},invocation),
  textureScale=createTrellisSLatScaleAdapter({route,tokenRows:5,mode:'texture',sampleTensor:textureSample.sample}),
  textureCodes=await textureScale.run(invocation),textureConfig={...decoderConfig,mode:'texture'},
  textureDecoder=createTrellisSLatDecoderAdapter({route,config:textureConfig,
    weights:arrays(slatDecoderWeightShapes(buildSLatDecoderPlan(textureConfig))),siluTable:new Float32Array(65536),
    sampleTensor:textureCodes,coordinateTensor:coordinates,guideSubdivisions:shape.subdivisions});
const material=await textureDecoder.run(invocation);
assert.deepEqual(material.features.shape,[5,6]);assert.strictEqual(textureDecoder.inputs.sample,textureScale.outputs.sample);
for(const {kernel} of runs.filter(r=>r.options.stage==='slat-texture-concat')){
  assert.strictEqual(kernel.bindings[0].resource,textureNoise);
  assert.strictEqual(kernel.bindings[1].resource,normalize.outputs.sample);
}
assert.ok(runs.every(r=>r.options.schedulerInvocation===invocation));
const borrowed=[noise,coordinates,textureNoise,decoderCodes,textureConditioning,textureCodes];
assert.ok(!uploads.some(u=>borrowed.includes(u.t)),'No sample, transformed code or coordinate bytes are reuploaded.');
assert.ok(!reads.some(t=>borrowed.includes(t)),'No sampled/transformed code bytes are read back.');
assert.strictEqual(textureFlow.inputs.coordinates,decoder.inputs.coordinates);
textureDecoder.dispose();textureSampler.dispose();textureFlow.dispose();
assert.ok(!textureConditioning.destroyed&&!textureCodes.destroyed);
normalize.dispose();textureScale.dispose();
assert.ok(!decoderCodes.destroyed,'Shape-code producer lives through both consumers.');
decoder.dispose();denormalize.dispose();sampler.dispose();flow.dispose();
assert.ok([noise,coordinates,textureNoise].every(t=>!t.destroyed));
assert.ok(allocations.filter(t=>![noise,coordinates,textureNoise].includes(t)).every(t=>t.destroyed));
console.log('Actual shape sampler → denormalization → decoder, shape renormalization → texture sampler → texture denormalization → guided decoder compose in one runtime without code readback; local interface evidence only.');
