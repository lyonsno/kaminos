// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTrellisAssetAdapter} from '../models/trellis2/trellis-material.js';
import {WEBGPU_BUFFER_USAGE as U} from '../webgpu-inference-kit/src/core.js';

function inputs(){
  const coordinates=new Int32Array([0,0,0,0,0,1,0,1,1,0,1,0]);
  const features=new Float32Array(28);features[3]=1;
  const tensor=(values,shape,dtype)=>({buffer:{},usage:U.storage,byteLength:values.byteLength,shape,dtype});
  const gf=tensor(features,[4,7],'f32'),gc=tensor(coordinates,[4,3],'i32');
  const materialValues=new Float32Array(24).fill(.2);
  const mf=tensor(materialValues,[4,6],'f32'),mc=tensor(coordinates.slice(),[4,3],'i32');
  const bytes=new Map([[gf,features.buffer],[gc,coordinates.buffer],[mf,materialValues.buffer],[mc,coordinates.slice().buffer]]);
  const reads=[];
  const runtime={device:{queue:{async onSubmittedWorkDone(){}}},
    async readTensor(t){reads.push(t);return bytes.get(t).slice(0);}};
  return {runtime,geometry:{features:gf,coordinates:gc,resolution:2},
    material:{features:mf,coordinates:mc,resolution:2},reads,tensors:[gf,gc,mf,mc]};
}
class ForbiddenWorker{constructor(){throw Error('explicit UV provider was ignored for the legacy worker');}}

test('asset adapter rejects an invalid explicit UV provider before any decoder readback',()=>{
  for(const unwrapMesh of [null,{},false]){
    const data=inputs();
    assert.throws(()=>createTrellisAssetAdapter({...data,unwrapMesh}),/explicit UV provider must be a function/);
    assert.equal(data.reads.length,0);
  }
});

test('asset adapter forwards the caller provider after cleanup and preserves its failure without fallback',async()=>{
  const data=inputs(),failure=new Error('selected finishing provider failed'),order=[];
  let cleaned,uvCalls=0;
  const consumer=createTrellisAssetAdapter({...data,WorkerClass:ForbiddenWorker,textureSize:8,
    postprocessMesh:async mesh=>{
      order.push('cleanup');cleaned=mesh;
      return {...mesh,metadata:{...mesh.metadata,postprocess:{schema:'trellis2.mesh-postprocess.v0',
        status:'succeeded',effectiveRoute:'synthetic-consumer-forwarding-test',
        inputVertices:mesh.vertices.length/3,inputFaces:mesh.triangles.length/3,
        outputVertices:mesh.vertices.length/3,outputFaces:mesh.triangles.length/3}}};
    },
    unwrapMesh:async mesh=>{
      order.push('uv');uvCalls++;
      assert.equal(mesh.vertices!==cleaned.vertices,true,'UV provider owns a copy of cleaned positions.');
      assert.equal(mesh.triangles!==cleaned.triangles,true,'UV provider owns a copy of cleaned faces.');
      assert.deepEqual(mesh.vertices,cleaned.vertices);
      assert.deepEqual(mesh.triangles,cleaned.triangles);
      throw failure;
    }});
  await assert.rejects(consumer.run(),error=>error===failure);
  assert.equal(uvCalls,1);assert.deepEqual(order,['cleanup','uv']);
  assert.deepEqual(data.reads,data.tensors);
  assert.equal(consumer.output,undefined);assert.equal(consumer.phase,'post-model-uv-unwrap');
  await assert.rejects(consumer.run(),/failed/);
  consumer.dispose();
  for(const tensor of data.tensors)assert.equal(tensor.buffer.destroy,undefined,'Borrowed fields remain producer-owned.');
});
