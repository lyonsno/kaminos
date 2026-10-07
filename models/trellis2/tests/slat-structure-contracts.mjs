import assert from 'node:assert/strict';
import {buildSLatDecoderPlan,slatDecoderWeightShapes,createTrellisSLatDecoderAdapter} from '../sparse-decoder.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
const config={tokenRows:3,latentChannels:2,resolution:2,channels:[16,8],numBlocks:[1,2],structureOnly:true},
  p=buildSLatDecoderPlan(config);
assert.equal(p.structureOnly,true,'The cascade support pass must stop after subdivision, before the final feature level and endpoint head.');
assert.ok(!('output_layer.weight' in slatDecoderWeightShapes(p)));
assert.ok(!Object.keys(slatDecoderWeightShapes(p)).some(k=>k.startsWith('blocks.1.')));
const allocated=[],runs=[],runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
  uploadTensor(){},defineComputeKernel(k){return k;},async runKernel(k,o){runs.push({k,o});},
  async readTensor(t){assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4);return new Uint32Array([t.name.includes('hash-status')?0:5]);}},
  route={runtime,routeId:'source-structure-only'},sample=runtime.createTensor({shape:[3,2],dtype:'f32',usage:U.storage}),
  coordinates=runtime.createTensor({shape:[3,3],dtype:'i32',usage:U.storage}),
  weights=Object.fromEntries(Object.entries(slatDecoderWeightShapes(p)).map(([name,shape])=>[name,new Float32Array(shape.reduce((a,b)=>a*b,1))])),
  a=createTrellisSLatDecoderAdapter({route,config,weights,siluTable:new Float32Array(65536),sampleTensor:sample,coordinateTensor:coordinates}),
  result=await a.run({id:'cascade-structure'});
assert.deepEqual(result.coordinates.shape,[5,3]);assert.equal(result.features,undefined);
assert.equal(result.resolution,4);assert.equal(result.convNeXtBlocksExecuted,1);assert.equal(result.convolutionsExecuted,3);
assert.equal(result.structureOnly,true);assert.equal(result.featureBytesToCPUDuringServing,0);
assert.ok(!runs.some(v=>v.k.bindings.some(b=>b.resource.name?.includes('terminal-normalized')||b.resource.name?.includes('decoded-features'))));
a.dispose();assert.ok(!sample.destroyed&&!coordinates.destroyed);
assert.ok(allocated.filter(t=>t!==sample&&t!==coordinates).every(t=>t.destroyed));
assert.throws(()=>buildSLatDecoderPlan({...config,mode:'texture'}),/shape|structure/);
console.log('Production learned shape decoder support-only mode matches source stop-after-subdivision without a terminal feature head; fake runtime is not numerical proof.');
