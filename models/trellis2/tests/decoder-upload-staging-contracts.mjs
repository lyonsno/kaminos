import assert from 'node:assert/strict';
import * as decoder from '../slat-decoder.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
assert.equal(typeof decoder.createTrellisSLatDecoderAdapterAsync,'function',
  'Learned decoder parameters must support sequential fetch and drained upload.');
const config={tokenRows:3,latentChannels:2,resolution:2,channels:[16,8],numBlocks:[1,0]};
function harness(){
  const allocated=[],uploaded=[],drains=[],runs=[];
  const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){drains.push(uploaded.length);}}},
    createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
    uploadTensor(t,data){uploaded.push({name:t.name,data:Array.from(data)});},defineComputeKernel(k){return k;},
    async runKernel(k,o){runs.push({code:k.code,bindings:k.bindings.map(b=>[b.resource.name,b.access]),stage:o.stage,dispatch:o.dispatch});},
    async readTensor(t){return new Uint32Array([t.name.includes('hash-status')?0:5]);}};
  const sample=runtime.createTensor({name:'borrowed-codes',shape:[3,2],dtype:'f32',usage:U.storage}),
    coordinates=runtime.createTensor({name:'borrowed-coordinates',shape:[3,3],dtype:'i32',usage:U.storage});
  return {runtime,allocated,uploaded,drains,runs,base:{route:{runtime,routeId:'decoder-upload-contract'},
    sampleTensor:sample,coordinateTensor:coordinates,siluTable:new Float32Array(65536)},sample,coordinates};
}
for(const extra of [{},{structureOnly:true},{mode:'texture'}]){
  const c={...config,...extra},shapes=decoder.slatDecoderWeightShapes(decoder.buildSLatDecoderPlan(c)),keys=Object.keys(shapes),
    weights=Object.fromEntries(Object.entries(shapes).map(([k,s],i)=>[k,new Float32Array(s.reduce((a,b)=>a*b,1)).fill(i+1)])),
    a=harness(),b=harness();
  if(c.mode==='texture')for(const h of [a,b])h.base.guideSubdivisions=[h.runtime.createTensor({name:'borrowed-guide',shape:[3,8],dtype:'f32',usage:U.storage})];
  const eager=decoder.createTrellisSLatDecoderAdapter({...a.base,config:c,weights});let fetched=0;
  const streamed=await decoder.createTrellisSLatDecoderAdapterAsync({...b.base,config:c,async loadWeight(name){
    assert.equal(name,keys[fetched]);assert.equal(b.drains.length,fetched++,'Previous upload drains before another parameter fetch.');
    return weights[name];}});
  assert.equal(fetched,keys.length);assert.equal(b.drains.length,keys.length);
  assert.equal(b.drains.at(-1),b.uploaded.length,'Last parameter and activation table uploads both drain before return.');
  assert.deepEqual(b.uploaded,a.uploaded,'Identical complete checkpoint upload bytes/order.');
  const eagerOutput=await eager.run({id:'same-decode'}),streamedOutput=await streamed.run({id:'same-decode'});
  assert.deepEqual(b.runs,a.runs,'Identical shader, binding, dispatch and operation graph.');
  assert.deepEqual(streamedOutput.coordinates.shape,eagerOutput.coordinates.shape);
  assert.deepEqual(streamedOutput.features?.shape,eagerOutput.features?.shape);
  eager.dispose();streamed.dispose();
  assert.ok(!b.sample.destroyed&&!b.coordinates.destroyed);
  assert.ok(b.allocated.filter(t=>!t.name.startsWith('borrowed-')).every(t=>t.destroyed));
  for(const failure of ['fetch','invalid','upload','drain','final-drain']){
    const h=harness();let n=0;
    if(failure==='upload')h.runtime.uploadTensor=()=>{throw Error('injected upload failure');};
    const shapeKeys=Object.keys(decoder.slatDecoderWeightShapes(decoder.buildSLatDecoderPlan(config)));
    if(failure==='drain'||failure==='final-drain')h.runtime.device.queue.onSubmittedWorkDone=async()=>{
      if(failure==='drain'||++n===shapeKeys.length)throw Error('injected drain failure');};
    await assert.rejects(decoder.createTrellisSLatDecoderAdapterAsync({...h.base,config:{...config},
      async loadWeight(name){
        if(failure==='fetch'&&name===keys[1])throw Error('injected fetch failure');
        if(failure==='invalid'&&name===keys[1])return new Float32Array(0);
        // Use shape configuration here, independent of outer texture/support mode.
        const s=decoder.slatDecoderWeightShapes(decoder.buildSLatDecoderPlan(config))[name];
        return new Float32Array(s.reduce((a,b)=>a*b,1));
      }}),/injected|complete finite/);
    assert.ok(h.allocated.filter(t=>!t.name.startsWith('borrowed-')).every(t=>t.destroyed),failure+' cleans partial parameters');
    assert.ok(!h.sample.destroyed&&!h.coordinates.destroyed);
  }
}
console.log('Complete geometry/support/material parameters stream with upload backpressure and failure cleanup; fake runtime is not physical-memory evidence.');
