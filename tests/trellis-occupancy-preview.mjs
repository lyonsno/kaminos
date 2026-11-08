// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as occupancy from '../models/trellis2/occupancy-coordinates.js';
import {createTrellisGenerationFromConditioningAdapter} from '../models/trellis2/trellis-generation.js';
import {models} from '../models/trellis2/tests/generation-composition-contracts.mjs';
import {WEBGPU_BUFFER_USAGE as U} from '../webgpu-inference-kit/src/core.js';
import {encodeTrellisGeometryGLB} from '../models/trellis2/trellis-mesh.js';

const invocation={jobId:'observed-preview-job',invocationId:'observed-preview-invocation'};
function snapshotInput(){
 const values=new Int32Array([0,0,1,1,2,3]);let reads=0;
 const tensor={buffer:{},shape:[2,3],dtype:'i32',byteLength:24,usage:U.storage|U.copySrc};
 return {values,tensor,reads:()=>reads,options:{coordinates:tensor,plan:occupancy.buildOccupancyCoordinatesPlan({resolution:8}),
  runId:'preview-run',routeId:'preview-route',steps:12,invocation,
  runtime:{async readTensor(t,options){reads++;assert.equal(t,tensor);assert.equal(options.schedulerInvocation,invocation);return values.buffer;}}}};
}
test('completed occupancy snapshot owns all coordinates and declares its exact source frame',async()=>{
 assert.equal(typeof occupancy.readTrellisOccupancyPreview,'function','completed GPU support needs an opt-in preview consumer');
 const f=snapshotInput(),p=await occupancy.readTrellisOccupancyPreview(f.options);
 assert.equal(p.kind,'sparse-occupancy');assert.equal(p.stage,'occupancy-coordinates');assert.equal(p.status,'completed');
 assert.equal(p.runId,'preview-run');assert.equal(p.jobId,invocation.jobId);assert.equal(p.invocationId,invocation.invocationId);
 assert.deepEqual(p.grid.dimensions,[4,4,4]);assert.deepEqual(p.grid.sourceDimensions,[8,8,8]);assert.deepEqual(p.grid.downsample,[2,2,2]);assert.equal(p.grid.threshold,0);
 assert.equal(p.count,2);assert.deepEqual(p.layout.shape,[2,3]);assert.deepEqual(p.layout.componentOrder,['source-z','source-y','source-x']);
 assert.deepEqual(p.spatial.gridToSource,{scale:[.25,.25,.25],offset:[-.5,-.5,-.5]});assert.deepEqual(p.spatial.cellCenterOffset,[.5,.5,.5]);
 assert.equal(p.steps,12);assert.equal(p.step,12);assert.equal(p.coordinateBytesToCPU,24);assert.equal(p.additionalDecoderExecutions,0);
 assert.equal(p.lifetime,'owned-cpu-snapshot');assert.notEqual(p.coordinates.buffer,f.values.buffer);assert.deepEqual([...p.coordinates],[0,0,1,1,2,3]);
 f.values.fill(0);assert.deepEqual([...p.coordinates],[0,0,1,1,2,3],'later producer reuse cannot change a retained preview');assert.equal(f.reads(),1);
});
test('missing identity, partial data, invalid grid coordinates and duplicate rows cannot look like occupancy',async()=>{
 assert.equal(typeof occupancy.readTrellisOccupancyPreview,'function');
 for(const change of [o=>o.runId='',o=>o.invocation={},o=>o.coordinates={...o.coordinates,dtype:'f32'},
  o=>o.runtime.readTensor=async()=>new ArrayBuffer(12),o=>o.runtime.readTensor=async()=>new Int32Array([0,0,1,1,2,4]).buffer,
  o=>o.runtime.readTensor=async()=>new Int32Array([0,0,1,0,0,1]).buffer]){
  const f=snapshotInput();change(f.options);await assert.rejects(occupancy.readTrellisOccupancyPreview(f.options));
 }
});
test('preview declares the same source-to-GLTF frame as the ordinary geometry exporter',async()=>{
 const f=snapshotInput(),p=await occupancy.readTrellisOccupancyPreview(f.options);
 const glb=encodeTrellisGeometryGLB({vertices:new Float32Array([.1,.2,.3,.2,.2,.3,.1,.3,.3]),triangles:new Uint32Array([0,1,2])});
 const length=new DataView(glb).getUint32(12,true),document=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,length)));
 assert.deepEqual(p.spatial.sourceToGltf,document.nodes[0].matrix,'the preview must not make consumers guess the source export axis convention');
});
test('a different threshold policy or non-copyable tensor is refused before readback',async()=>{
 for(const change of [o=>o.plan={...o.plan,threshold:1},o=>o.coordinates={...o.coordinates,usage:0}]){
  const f=snapshotInput();change(f.options);await assert.rejects(occupancy.readTrellisOccupancyPreview(f.options));assert.equal(f.reads(),0);
 }
});
function composition(onPreview,{hangReadback=false}={}){
 let phase,marked=false;const phases=[],reads=[];
 const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
  createTensor(s){const t={...s,byteLength:s.shape.reduce((a,b)=>a*b,4)};t.buffer=s.buffer??{destroy(){t.destroyed=true;}};return t;},
  uploadTensor(){},defineComputeKernel:k=>k,async runKernel(k,o){if(o.stage==='slat-regrid-mark')marked=true;},
  async readTensor(t,o){reads.push({t,o});if(t.dtype==='i32')return hangReadback?new Promise(()=>{}):new Int32Array([0,0,0,0,1,2,1,0,0]);
   assert.equal(t.byteLength,4);return new Uint32Array([t.name.includes('hash-status')?0:t.name.includes('occupancy.count')?3:phase==='learned-cascade-support'&&marked?4:5]);}};
 const conditioning=runtime.createTensor({name:'conditioning',shape:[1,7,5],dtype:'f32',usage:U.storage});
 const adapter=createTrellisGenerationFromConditioningAdapter({route:{runtime,routeId:'resident-preview-composition'},conditioningTensor:conditioning,models,pipelineType:'512',meshResolution:64,
  runId:'resident-preview-run',onPreview,onPhase:e=>{phase=e.phase;phases.push(phase);}});
 return{adapter,reads,phases,runtime};
}
test('a never-settling LAST observer does not gate final model output',async()=>{
 let preview,completed=false,failure,validDuringDelivery;
 const f=composition(p=>{preview=p;validDuringDelivery=p.isCurrent();return new Promise(()=>{});});
 const pending=f.adapter.run(invocation).then(out=>{completed=true;return out;},error=>{failure=error;});
 // This finite controlled model uses only resolved microtask promises. One event-loop
 // turn is a deterministic sentinel, not a production timeout or preview deadline.
 await new Promise(setImmediate);
 assert.equal(failure,undefined);assert.equal(completed,true,'optional preview must not hold model or final decode');
 const out=await pending;assert.equal(validDuringDelivery,true);assert.equal(out.previewDelivery.status,'expired');assert.equal(f.adapter.previewDelivery.status,'expired');assert.equal(out.coordinateBytesToCPUDuringServing,0);assert.ok(f.reads.every(r=>r.t.dtype==='u32'),'live delivery must not launch a coordinate readback');
 assert.ok(preview.coordinates.buffer);assert.equal(preview.coordinates.dtype,'i32');assert.deepEqual(preview.coordinates.shape,[3,3]);
 assert.equal(preview.device,f.runtime.device);assert.equal(preview.isCurrent(),false,'completed generation invalidates a late preview');
 f.adapter.dispose();assert.equal(preview.isCurrent(),false);
});
test('unavailable optional coordinate readback does not gate final model output',async()=>{
 const f=composition(()=>{},{hangReadback:true});let completed=false;
 const pending=f.adapter.run(invocation).then(out=>{completed=true;return out;});
 await new Promise(setImmediate);assert.equal(completed,true,'live preview must not depend on optional CPU readback');
 await pending;assert.ok(f.reads.every(r=>r.t.dtype==='u32'));f.adapter.dispose();
});
test('a rejected LAST observer cannot fail final decoding or completion',async()=>{
 const f=composition(()=>Promise.reject(Error('optional display failed')));
 let completed=false,failure;const pending=f.adapter.run(invocation).then(out=>{completed=true;return out;},error=>{failure=error;});
 await new Promise(setImmediate);assert.equal(failure,undefined,'optional observer rejection must not fail the model');assert.equal(completed,true);
 const out=await pending;assert.ok(out.geometry);assert.equal(out.previewDelivery.status,'failed');assert.equal(out.previewDelivery.error.message,'optional display failed');assert.equal(f.adapter.state,'completed');f.adapter.dispose();
});

test('no observer retains scalar-only coordinate reads',async()=>{
 const f=composition();const out=await f.adapter.run(invocation);assert.equal(out.coordinateBytesToCPUDuringServing,0);assert.ok(f.reads.every(r=>r.t.dtype==='u32'));f.adapter.dispose();
});

test('a synchronous optional observer exception is diagnostic and cannot poison model output',async()=>{
 const f=composition(()=>{throw Error('sync display failed');});const out=await f.adapter.run(invocation);
 assert.ok(out.geometry);assert.equal(out.previewDelivery.status,'failed');assert.equal(f.adapter.previewDelivery.error.message,'sync display failed');f.adapter.dispose();
});

test('a preview becomes invalid when later shape generation fails',async()=>{
 let preview;const f=composition(p=>{preview=p;});const kernel=f.runtime.runKernel;
 f.runtime.runKernel=async(k,o)=>{if(preview)throw Error('later model failure');return kernel(k,o);};
 await assert.rejects(f.adapter.run(invocation),/later model failure/);assert.equal(preview.isCurrent(),false);assert.equal(f.adapter.state,'failed');f.adapter.dispose();
});
