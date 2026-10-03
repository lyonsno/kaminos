import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {unwrapTrellisMesh,createTrellisAssetAdapter,bakeTrellisMaterialTextures,encodeTrellisPbrGLB} from '../trellis-material.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';

// Replay the real shipped external worker, not a matching replacement atlas.
const workerPath=new URL('../../../lib/sf3d/assets/uv_unwrap_worker-29CGZ7RB.js',import.meta.url),
  source=await readFile(workerPath,'utf8'),workers=[];
class BundleWorker {
  constructor(url){
    assert.equal(url.href,workerPath.href);workers.push(this);this.terminated=false;
    this.self={postMessage:(data,transfer)=>{const reply=structuredClone(data,{transfer});
      this.onmessage?.({data:this.change?this.change(reply):reply});}};
    vm.runInNewContext(source,{self:this.self,Float32Array,Float64Array,Int32Array,Uint32Array,Uint8Array,ArrayBuffer,Math,
      console:{log(){}}});
  }
  postMessage(data,transfer){const request=structuredClone(data,{transfer});
    queueMicrotask(()=>{try{this.self.onmessage({data:request});}catch(e){this.onerror?.({message:e.message});}});}
  terminate(){this.terminated=true;}
}
function area(mesh,face){const ids=mesh.triangles.subarray(face*3,face*3+3),uv=mesh.uvs;
  return (uv[ids[1]*2]-uv[ids[0]*2])*(uv[ids[2]*2+1]-uv[ids[0]*2+1])-
    (uv[ids[2]*2]-uv[ids[0]*2])*(uv[ids[1]*2+1]-uv[ids[0]*2+1]);}
const small={vertices:new Float32Array([-.25,-.25,-.25,-.25,-.25,.25,-.25,.25,.25,-.25,.25,-.25]),
  triangles:new Uint32Array([0,1,3,3,1,2])};
class CollapsedWorker extends BundleWorker {
  constructor(url){super(url);this.change=reply=>{
    const uv=new Float32Array(reply.uvs),faces=new Uint32Array(reply.newFaces),a=faces[3];
    // A finite in-range collapsed face mixed with a valid one; not the known remaining tier.
    for(let k=1;k<3;k++)uv.set(uv.subarray(a*2,a*2+2),faces[3+k]*2);
    new Int32Array(reply.faceAssignment)[1]=0;return reply;
  };}
}

test('actual dense worker output retains nonzero area for every nondegenerate source face',async()=>{
  const n=1604,vertices=new Float32Array(n*9),triangles=new Uint32Array(n*3);
  for(let i=0;i<n;i++){const z=(i/n-.5)*.02;
    vertices.set([-.25,-.25,z,.25,-.25,z,-.25,.25,z],i*9);triangles.set([i*3,i*3+1,i*3+2],i*3);}
  const output=await unwrapTrellisMesh({vertices,triangles},{WorkerClass:BundleWorker});
  let collapsed=0;for(let face=0;face<n;face++)if(area(output,face)===0)collapsed++;
  assert.equal(collapsed,0,'UV unwrap must not collapse world-nondegenerate faces and return success');
  assert.equal(output.triangles.length,triangles.length);assert.equal(workers.at(-1).terminated,true);
  const remaining=[...output.faceAssignment].map((chart,face)=>chart===12?face:-1).filter(face=>face>=0),
    {grid,padding}=output.uvMetadata.remainingPacking;
  assert.equal(remaining.length,1602);assert.ok(padding>0&&2*padding<Math.min(.5/grid[0],(1/3)/grid[1]));
  for(let i=0;i<remaining.length;i++)for(let k=0;k<3;k++){
    const row=output.triangles[remaining[i]*3+k],x=.5+(i%grid[0])*.5/grid[0],y=2/3+Math.floor(i/grid[0])*(1/3)/grid[1];
    assert.ok(output.uvs[row*2]>x&&output.uvs[row*2]<x+.5/grid[0]);
    assert.ok(output.uvs[row*2+1]>y&&output.uvs[row*2+1]<y+(1/3)/grid[1]);
  }
  for(let i=0;i<triangles.length;i++)for(let a=0;a<3;a++)
    assert.equal(output.vertices[output.triangles[i]*3+a],vertices[triangles[i]*3+a]);
});

test('mixed valid/collapsed external UV reply rejects and terminates its worker',async()=>{
  await assert.rejects(unwrapTrellisMesh(small,{WorkerClass:CollapsedWorker}),/collapsed|nonzero UV area/);
  assert.equal(workers.at(-1).terminated,true);
});

test('UV acceptance failure poisons the actual asset consumer before texture/GLB publication',async()=>{
  const coordinates=new Int32Array([0,0,0,0,0,1,0,1,1,0,1,0]),features=new Float32Array(28);features[3]=1;
  const tensor=(values,shape,dtype)=>({buffer:{},usage:U.storage,byteLength:values.byteLength,shape,dtype}),
    gf=tensor(features,[4,7],'f32'),gc=tensor(coordinates,[4,3],'i32'),raw=new Float32Array(24).fill(.2),
    mf=tensor(raw,[4,6],'f32'),mc=tensor(coordinates.slice(),[4,3],'i32'),
    bytes=new Map([[gf,features.buffer],[gc,coordinates.buffer],[mf,raw.buffer],[mc,coordinates.slice().buffer]]),
    phases=[],runtime={device:{queue:{async onSubmittedWorkDone(){}}},async readTensor(t){return bytes.get(t).slice(0);}},
    consumer=createTrellisAssetAdapter({runtime,geometry:{features:gf,coordinates:gc,resolution:2},
      material:{features:mf,coordinates:mc,resolution:2},WorkerClass:CollapsedWorker,textureSize:8,onPhase:e=>phases.push(e.phase)});
  await assert.rejects(consumer.run(),/collapsed|nonzero UV area/);
  assert.equal(consumer.phase,'post-model-uv-unwrap');assert.equal(consumer.output,undefined);
  assert.ok(!phases.includes('post-model-texture-bake'));await assert.rejects(consumer.run(),/failed/);
  assert.equal(workers.at(-1).terminated,true);consumer.dispose();
  assert.equal(gf.buffer.destroy,undefined,'Failed postprocessing leaves decoder fields producer-owned for retry.');
});

test('direct bake and encoding cannot publish a nondegenerate surface with collapsed UVs',async()=>{
  const mesh={...small,uvs:new Float32Array([0,0,1,0,.5,.5,0,1])},
    coordinates=new Int32Array([0,0,0]),features=new Float32Array(6),
    textures={alphaMode:'OPAQUE',width:1,height:1,baseColor:new Uint8Array(4),metallicRoughness:new Uint8Array(4)};
  assert.throws(()=>bakeTrellisMaterialTextures({...mesh,coordinates,features,resolution:1,textureSize:4}),/collapsed|nonzero UV area/);
  await assert.rejects(encodeTrellisPbrGLB(mesh,{textures}),/collapsed|nonzero UV area/);
});
