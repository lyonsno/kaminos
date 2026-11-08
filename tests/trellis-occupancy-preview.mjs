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
function composition(onPreview){
 let phase,marked=false;const phases=[],reads=[],values=new Int32Array([0,0,0,0,1,2,1,0,0]);
 const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
  createTensor(s){const t={...s,byteLength:s.shape.reduce((a,b)=>a*b,4)};t.buffer=s.buffer??{destroy(){t.destroyed=true;}};return t;},
  uploadTensor(){},defineComputeKernel:k=>k,async runKernel(k,o){if(o.stage==='slat-regrid-mark')marked=true;},
  async readTensor(t,o){reads.push({t,o});if(t.dtype==='i32')return values.buffer;assert.equal(t.byteLength,4);
   return new Uint32Array([t.name.includes('hash-status')?0:t.name.includes('occupancy.count')?3:phase==='learned-cascade-support'&&marked?4:5]);}};
 const conditioning=runtime.createTensor({name:'conditioning',shape:[1,7,5],dtype:'f32',usage:U.storage});
 const adapter=createTrellisGenerationFromConditioningAdapter({route:{runtime,routeId:'preview-composition'},conditioningTensor:conditioning,models,pipelineType:'512',meshResolution:64,
  runId:'actual-preview-run',onPreview,onPhase:e=>{phase=e.phase;phases.push(phase);}});
 return{adapter,reads,phases,values};
}
test('the production composition delivers completed occupancy before shape generation and accounts for the optional copy',async()=>{
 let delivered,release,seen;const gate=new Promise(r=>release=r),observed=new Promise(r=>seen=r);
 const f=composition(p=>{delivered=p;seen();return gate;}),pending=f.adapter.run(invocation);
 // A missing callback must fail this test, rather than leave an unresolved wait.
 const first=await Promise.race([observed.then(()=> 'preview'),pending.then(()=> 'completed')]);assert.equal(first,'preview','preview is delivered before continuing to shape');
 assert.ok(!f.phases.includes('low-resolution-shape-sampling'));assert.equal(delivered.count,3);assert.equal(delivered.step,1);
 assert.equal(delivered.runId,'actual-preview-run');assert.deepEqual(delivered.grid.dimensions,[8,8,8]);
 release();const out=await pending;assert.equal(out.coordinateBytesToCPUDuringServing,36);assert.equal(out.featureBytesToCPUDuringServing,0);
 assert.equal(f.reads.filter(r=>r.t.dtype==='i32').length,1);f.adapter.dispose();f.values.fill(7);
 assert.deepEqual([...delivered.coordinates],[0,0,0,0,1,2,1,0,0]);
});
test('no observer keeps zero coordinate readbacks; an awaited observer error keeps failure truth',async()=>{
 const off=composition();const out=await off.adapter.run(invocation);assert.equal(out.coordinateBytesToCPUDuringServing,0);assert.ok(off.reads.every(r=>r.t.dtype==='u32'));off.adapter.dispose();
 const broken=composition(()=>{throw Error('preview consumer failed');});await assert.rejects(broken.adapter.run(invocation),/preview consumer failed/);
 assert.equal(broken.adapter.state,'failed');assert.equal(broken.adapter.outputs,undefined);assert.ok(!broken.phases.includes('low-resolution-shape-sampling'));broken.adapter.dispose();
});
