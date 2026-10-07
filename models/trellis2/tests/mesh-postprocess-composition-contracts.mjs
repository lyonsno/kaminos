import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createTrellisAssetAdapter} from '../trellis-material.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
const workerPath=new URL('../../../lib/sf3d/assets/uv_unwrap_worker-29CGZ7RB.js',import.meta.url);
const source=await fs.readFile(workerPath,'utf8');
class BundleWorker {
  constructor(url){assert.equal(url.href,workerPath.href);this.self={postMessage:data=>this.onmessage?.({data})};
    vm.runInNewContext(source,{self:this.self,Float32Array,Float64Array,Int32Array,Uint32Array,Uint8Array,ArrayBuffer,Math,console});}
  postMessage(data){queueMicrotask(()=>{try{this.self.onmessage({data});}catch(e){this.onerror?.({message:e.message});}});}
  terminate(){}
}
const coords=new Int32Array([0,0,0,0,0,1,0,1,1,0,1,0]),features=new Float32Array(28);features[3]=1;
const tensor=(values,shape,dtype)=>({buffer:{},usage:U.storage,byteLength:values.byteLength,shape,dtype});
const gf=tensor(features,[4,7],'f32'),gc=tensor(coords,[4,3],'i32');
const values=new Float32Array(24).fill(.2),mf=tensor(values,[4,6],'f32'),mc=tensor(coords,[4,3],'i32');
const data=new Map([[gf,features.buffer],[gc,coords.buffer],[mf,values.buffer],[mc,coords.buffer]]);
const runtime={device:{queue:{async onSubmittedWorkDone(){}}},async readTensor(t){return data.get(t).slice(0);}};
const base={runtime,geometry:{features:gf,coordinates:gc,resolution:2},material:{features:mf,coordinates:mc,resolution:2},
  WorkerClass:BundleWorker,textureSize:8};
let calls=0;const phases=[];
const consumer=createTrellisAssetAdapter({...base,onPhase:e=>phases.push(e.phase),postprocessMesh:async mesh=>{
  calls++;assert.equal(mesh.triangles.length,6);
  return {...mesh,triangles:mesh.triangles.slice(0,3),metadata:{...mesh.metadata,postprocess:{
    schema:'trellis2.mesh-postprocess.v0',status:'succeeded',effectiveRoute:'synthetic-composition-test',
    inputVertices:4,inputFaces:2,outputVertices:4,outputFaces:1}}};
}});
const result=await consumer.run();
assert.equal(calls,1,'requested mesh postprocessing must execute before UV/bake/export');
assert.equal(result.mesh.triangles.length,3,'GLB must contain the processed surface, not the original raw mesh');
assert.ok(phases.indexOf('post-model-mesh-postprocess')<phases.indexOf('post-model-uv-unwrap'));
assert.equal(result.mesh.metadata.postprocess.outputFaces,1);
consumer.dispose();
for(const postprocessMesh of [async()=>{throw Error('backend failed');},async mesh=>({...mesh,triangles:new Uint32Array()}),
  async mesh=>({...mesh,metadata:{}})]){
  const failed=createTrellisAssetAdapter({...base,postprocessMesh});
  await assert.rejects(failed.run(),/backend failed|surface|postprocess/);
  assert.equal(failed.output,undefined,'failed postprocessing cannot fall back to raw export');failed.dispose();
}
assert.throws(()=>createTrellisAssetAdapter({...base,postprocessMesh:true}),/postprocess/);
console.log('Requested finishing executes before UV/export; processed geometry and provenance compose, and failure cannot silently export raw geometry.');
