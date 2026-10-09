import assert from 'node:assert/strict';
import * as sparse from '../sparse-flow.js';
import * as slat from '../slat-flow.js';
import {buildSparseBlockPlan,sparseBlockWeightShapes} from '../sparse-block.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
assert.equal(typeof sparse.createTrellisSparseFlowAdapterAsync,'function',
  'Complete flow construction must accept sequential checkpoint blocks and drain uploads between blocks.');
assert.equal(typeof slat.createTrellisSLatFlowAdapterAsync,'function');
const config={resolution:2,inChannels:2,outChannels:3,channels:12,heads:3,contextRows:7,
  contextChannels:5,hidden:20,frequencyDim:6,numBlocks:3};
function weights(c){
  const p=buildSparseBlockPlan(c),n=p.channels;
  const sizes={'input.weight':n*c.inChannels,'input.bias':n,'time0.weight':n*c.frequencyDim,'time0.bias':n,
    'time2.weight':n*n,'time2.bias':n,'mod.weight':6*n*n,'mod.bias':6*n};
  return {prefix:Object.fromEntries(Object.entries(sizes).map(([k,n])=>[k,new Float32Array(n)])),
    blocks:Array.from({length:c.numBlocks},(_,i)=>Object.fromEntries(Object.entries({...sparseBlockWeightShapes(p),gelu:[65536]})
      .map(([k,s])=>[k,new Float32Array(s.reduce((a,b)=>a*b,1)).fill(i+1)]))),
    terminal:{weight:new Float32Array(c.outChannels*n),bias:new Float32Array(c.outChannels)}};
}
function harness(){
  const allocations=[],uploads=[],kernels=[],drains=[];
  const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){drains.push(uploads.length);}}},
    createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocations.push(t);return t;},
    uploadTensor(t,data){uploads.push({name:t.name,data:Array.from(data)});},
    defineComputeKernel(spec){kernels.push({name:spec.name,code:spec.code,bindings:spec.bindings.map(b=>[b.name,b.resource.name,b.access])});return spec;},
    async runKernel(){},readTensor(){assert.fail('checkpoint construction must not read model output');}};
  return {runtime,allocations,uploads,kernels,drains};
}
for(const kind of ['sparse','shape','texture']){
  const c=kind==='sparse'?config:{...config,tokenRows:5,inChannels:kind==='texture'?64:32,outChannels:32},w=weights(c);
  const eager=harness(),stream=harness(),base={config:{...c,...(kind==='sparse'?{}:{mode:kind})},conditioning:new Float32Array(35),
    ...(kind==='sparse'?{phases:new Float32Array(32)}:{coordinates:new Int32Array(15),...(kind==='texture'?{concatConditioning:new Float32Array(160)}:{})})};
  const sync=kind==='sparse'?sparse.createTrellisSparseFlowAdapter:slat.createTrellisSLatFlowAdapter;
  const asyncFactory=kind==='sparse'?sparse.createTrellisSparseFlowAdapterAsync:slat.createTrellisSLatFlowAdapterAsync;
  const a=sync({...base,route:{runtime:eager.runtime},weights:w});
  const {blocks,...light}=w;let loaded=0;
  const b=await asyncFactory({...base,route:{runtime:stream.runtime},weights:light,async loadBlockWeights(i){
    assert.equal(i,loaded++);assert.equal(stream.drains.length,i,'Previous source block uploads must drain before another checkpoint is fetched.');
    return blocks[i];}});
  assert.equal(loaded,3);assert.equal(stream.drains.length,3);
  assert.deepEqual(stream.uploads,eager.uploads,'Upload bytes/order must remain unchanged.');
  assert.deepEqual(stream.kernels,eager.kernels,'Complete shader and binding graph must remain unchanged.');
  assert.deepEqual(b.outputs.prediction.shape,a.outputs.prediction.shape);
  a.dispose();b.dispose();assert.ok(stream.allocations.every(t=>t.destroyed));
  const failed=harness();await assert.rejects(asyncFactory({...base,route:{runtime:failed.runtime},weights:light,
    async loadBlockWeights(i){if(i===1)throw Error('checkpoint fetch failure');return blocks[i];}}),/checkpoint fetch failure/);
  assert.ok(failed.allocations.every(t=>t.destroyed),'Partial staged construction must retire its own resources.');
  const drainFailed=harness();drainFailed.runtime.device.queue.onSubmittedWorkDone=async()=>{throw Error('upload drain failure');};
  await assert.rejects(asyncFactory({...base,route:{runtime:drainFailed.runtime},weights:light,loadBlockWeights:async i=>blocks[i]}),/upload drain failure/);
  assert.ok(drainFailed.allocations.every(t=>t.destroyed));
}
console.log('Sequential CPU staging/drained uploads preserve the full sparse/shape/texture shader graph and retire partial constructions on failure; fake runtime does not prove memory savings.');
