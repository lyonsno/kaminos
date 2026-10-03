import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {unwrapTrellisMesh,createTrellisAssetAdapter} from '../trellis-material.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
const workerPath=new URL('../../../lib/sf3d/assets/uv_unwrap_worker-29CGZ7RB.js',import.meta.url),
  source=await readFile(workerPath,'utf8'),workers=[];
class BundleWorker {
  constructor(url){
    assert.equal(url.href,workerPath.href);this.terminated=false;workers.push(this);
    this.self={postMessage:(data,transfer)=>{const reply=structuredClone(data,{transfer});
      this.onmessage?.({data:this.change?this.change(reply):reply});}};
    vm.runInNewContext(source,{self:this.self,Float32Array,Float64Array,Int32Array,Uint32Array,Uint8Array,ArrayBuffer,Math,console});
  }
  postMessage(data,transfer){const request=structuredClone(data,{transfer});
    queueMicrotask(()=>{try{this.self.onmessage({data:request});}catch(e){this.onerror?.({message:e.message});}});}
  terminate(){this.terminated=true;}
}
const coordinates=new Int32Array([0,0,0,0,0,1,0,1,1,0,1,0]),features=new Float32Array(28);features[3]=1;
const mesh={vertices:new Float32Array([-.25,-.25,-.25,-.25,-.25,.25,-.25,.25,.25,-.25,.25,-.25]),
  triangles:new Uint32Array([0,1,3,3,1,2])},original=mesh.vertices.slice();
const uv=await unwrapTrellisMesh(mesh,{WorkerClass:BundleWorker});
assert.equal(uv.triangles.length,mesh.triangles.length);assert.deepEqual(mesh.vertices,original,'Only copied inputs transfer to worker.');
for(let i=0;i<mesh.triangles.length;i++)for(let a=0;a<3;a++)
  assert.equal(uv.vertices[uv.triangles[i]*3+a],mesh.vertices[mesh.triangles[i]*3+a],'Actual shipped unwrap retains each triangle position.');
assert.equal(workers.at(-1).terminated,true);
for(const change of [
  reply=>({...reply,id:'wrong request'}),
  reply=>({...reply,ok:false,error:'actual failed unwrap'}),
  reply=>({...reply,newNumFaces:1}),
  reply=>({...reply,newNormals:new ArrayBuffer(0)}),
  reply=>{new Float32Array(reply.uvs)[0]=NaN;return reply;},
  reply=>{new Int32Array(reply.faceAssignment)[0]=13;return reply;},
  reply=>{new Float32Array(reply.newVertices)[0]+=.125;return reply;},
]){
  class BadWorker extends BundleWorker{constructor(url){super(url);this.change=change;}}
  await assert.rejects(unwrapTrellisMesh(mesh,{WorkerClass:BadWorker}),/identity|failed|complete|finite|range/);
  assert.equal(workers.at(-1).terminated,true);
}
const tensor=(values,shape,dtype)=>({buffer:{},usage:U.storage,byteLength:values.byteLength,shape,dtype}),
  gf=tensor(features,[4,7],'f32'),gc=tensor(coordinates,[4,3],'i32'),
  mf=tensor(new Float32Array(24).fill(.2),[4,6],'f32'),mc=tensor(coordinates.slice(),[4,3],'i32'),
  bytes=new Map([[gf,features.buffer],[gc,coordinates.buffer],[mf,new Float32Array(24).fill(.2).buffer],[mc,coordinates.slice().buffer]]),
  reads=[],phases=[],runtime={device:{queue:{async onSubmittedWorkDone(){}}},async readTensor(t){reads.push(t);return bytes.get(t).slice(0);}},
  geometry={features:gf,coordinates:gc,resolution:2},material={features:mf,coordinates:mc,resolution:2};
const consumer=createTrellisAssetAdapter({runtime,geometry,material,WorkerClass:BundleWorker,textureSize:8,onPhase:e=>phases.push(e.phase)});
const result=await consumer.run();assert.deepEqual(reads,[gf,gc,mf,mc]);
assert.equal(new DataView(result.glb).getUint32(0,true),0x46546c67);
assert.equal(result.handoff.featureBytesToCPU,208);assert.equal(result.handoff.coordinateBytesToCPU,96);
assert.deepEqual(phases,['post-model-mesh-extraction','post-model-material-readback','post-model-uv-unwrap','post-model-texture-bake','post-model-pbr-glb']);
assert.equal(consumer.phase,'completed');await assert.rejects(consumer.run(),/completed/);consumer.dispose();
assert.equal(gf.buffer.destroy,undefined,'Borrowed decoder tensors remain producer-owned.');
const failed=createTrellisAssetAdapter({runtime:{...runtime,async readTensor(t){return t===mf?new ArrayBuffer(4):bytes.get(t).slice(0);}},
  geometry,material,WorkerClass:BundleWorker,textureSize:8});
await assert.rejects(failed.run(),/complete material readback/);assert.equal(failed.output,undefined);
assert.equal(failed.phase,'post-model-material-readback');failed.dispose();
assert.throws(()=>createTrellisAssetAdapter({runtime,geometry,WorkerClass:BundleWorker,
  material:{features:tensor(new Float32Array(30),[5,6],'f32'),coordinates:tensor(new Int32Array(15),[5,3],'i32'),resolution:2}}),
  /complete borrowed guided material/,'The actual guided material output must retain the geometry decoder row count.');
console.log('Exact decoder tensors reach mesh/readback, observed shipped UV-worker protocol, learned bake and PBR GLB; fake GPU fields are not native generation. Wrong/partial worker output rejects without fallback and owned workers terminate.');
