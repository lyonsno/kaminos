import assert from 'node:assert/strict';
import {models} from './generation-composition-contracts.mjs';
import {createTrellisGenerationFromConditioningAdapter} from '../trellis-generation.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
const requested=[],loaded=[],allocated=[],roles=['sparseFlow','lowResolutionShape','highResolutionShape','textureFlow'];
let phase,marked=false;
const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:spec.buffer??{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
  uploadTensor(){},defineComputeKernel(k){return k;},
  async runKernel(k,o){if(o.stage==='slat-regrid-mark')marked=true;},
  async readTensor(t){return new Uint32Array([t.name.includes('hash-status')?0:t.name.includes('occupancy.count')?3:
    phase==='learned-cascade-support'&&marked?4:5]);}},
  conditioning=runtime.createTensor({name:'borrowed-context',shape:[1,7,5],dtype:'f32',usage:U.storage}),
  options={route:{runtime,routeId:'streamed-composition-contract'},conditioningTensor:conditioning,
    models:Object.fromEntries(Object.entries(models).map(([role,model])=>[role,{config:model.config}])),meshResolution:128,
    onPhase(e){phase=e.phase;if(phase==='learned-cascade-support')marked=false;
      if(['occupancy-decoding','learned-cascade-support','learned-geometry-decoding','shape-guided-material-decoding'].includes(phase))
        assert.equal(allocated.filter(t=>t.name.startsWith('trellis.block.')&&!t.destroyed).length,0,
          'Completed flow weights/scratch must not overlap decoder loading: '+phase);},
    async loadModel(role,selection){
      requested.push(role);
      if(!roles.includes(role))return{role,...models[role]};
      assert.equal(selection?.streamBlocks,true,'The production consumer must explicitly request sequential flow checkpoint loading.');
      const {blocks,...weights}=models[role].weights;
      return{role,weights,phases:models[role].phases,async loadBlockWeights(i){loaded.push([role,i]);return blocks[i];}};
    }},adapter=createTrellisGenerationFromConditioningAdapter(options);
try{
  const out=await adapter.run({id:'same-generation'});
  assert.equal(adapter.state,'completed');assert.deepEqual(out.geometry.features.shape,[5,7]);
  assert.deepEqual(loaded,roles.map(role=>[role,0]));
  assert.deepEqual(requested,['sparseFlow','occupancyDecoder','lowResolutionShape','shapeDecoder','highResolutionShape','shapeDecoder','textureFlow','textureDecoder']);
}finally{adapter.dispose();}
assert.ok(!conditioning.destroyed);
assert.ok(allocated.filter(t=>t!==conditioning&&t.name!=='trellis.occupancy.occupied-view').every(t=>t.destroyed));
const failed=createTrellisGenerationFromConditioningAdapter({...options,async loadModel(role,selection){
  const checkpoint=await options.loadModel(role,selection);
  if(role==='lowResolutionShape')checkpoint.loadBlockWeights=async()=>{throw Error('streamed consumer fetch failed');};
  return checkpoint;
}});
await assert.rejects(failed.run({id:'failure-generation'}),/streamed consumer fetch failed/);
assert.equal(failed.state,'failed');assert.equal(failed.outputs,undefined);failed.dispose();
assert.ok(allocated.filter(t=>t!==conditioning&&t.name!=='trellis.occupancy.occupied-view').every(t=>t.destroyed));
console.log('The actual generation consumer selects and exercises sequential flow loading through cascade/texture and preserves failure cleanup; fake kernels are not native acceptance.');
