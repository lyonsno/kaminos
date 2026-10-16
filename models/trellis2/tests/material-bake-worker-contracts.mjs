// kaminos-test: node
// The texture bake can leave the page thread: createBrowserMaterialBaker runs
// bakeTrellisMaterialTextures in a module worker with the same bytes as the
// calling thread, honours Stop, and finishTrellisMesh / the asset adapter take
// it as the bakeMaterial provider and record where the bake ran.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cleanupAndSimplifyPreservingSurface} from '../mesh-cleanup.js';
import {createWasmXatlasUnwrapper} from '../wasm-xatlas.js';
import {bakeTrellisMaterialTextures,finishTrellisMesh} from '../trellis-material.js';
import {createBrowserMaterialBaker} from '../material-bake.js';
import {NodeTrellisUVWorker as NodeModuleWorker} from '../node-uv-worker.mjs';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

// Hash typed-array views and raw ArrayBuffers (the GLB is an ArrayBuffer).
const bytes=a=>a instanceof ArrayBuffer?new Uint8Array(a):new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const sha=a=>createHash('sha256').update(bytes(a)).digest('hex');
const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build();
const clean=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:spec.targetFaces});
const surface={vertices:clean.vertices,triangles:clean.faces,metadata:{}};
const uv=await createWasmXatlasUnwrapper()(surface);
// A full 8^3 material grid with deterministic features.
const resolution=8,coordinates=new Int32Array(resolution**3*3),features=new Float32Array(resolution**3*6);
for(let i=0,z=0;z<resolution;z++)for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++,i++){
  coordinates.set([z,y,x],i*3);for(let c=0;c<6;c++)features[i*6+c]=Math.sin(i*7.1+c*1.3);}
const materialFields={coordinates,features,resolution};
const textureSize=64,input={vertices:uv.vertices,triangles:uv.triangles,uvs:uv.uvs,...materialFields,textureSize};
const here=bakeTrellisMaterialTextures(input);

for(const [label,WorkerClass,execution] of [['caller-thread',undefined,'caller-thread'],['module-worker',NodeModuleWorker,'module-worker']]){
  const out=await createBrowserMaterialBaker({WorkerClass})(input);
  for(const key of ['baseColor','metallicRoughness'])assert.equal(sha(out[key]),sha(here[key]),`${label}: ${key} equals the calling-thread bake`);
  assert.deepEqual([out.width,out.height,out.coveredPixels],[here.width,here.height,here.coveredPixels],label);
  assert.equal(out.metadata.execution,execution,`${label}: bake records where it ran`);
  assert.equal(input.features.length,features.length,`${label}: caller arrays stay attached`);
}

// Stop: an aborted signal starts no worker; Stop during a run terminates it.
let constructed=0,terminated=0;
class SilentWorker{constructor(){constructed++;}postMessage(){}terminate(){terminated++;}}
await assert.rejects(createBrowserMaterialBaker({WorkerClass:SilentWorker,signal:AbortSignal.abort()})(input),e=>e.name==='AbortError');
assert.equal(constructed,0);
const stop=new AbortController(),running=createBrowserMaterialBaker({WorkerClass:SilentWorker,signal:stop.signal})(input);
setTimeout(()=>stop.abort(),20);
await assert.rejects(running,e=>e.name==='AbortError');assert.equal(terminated,1,'Stop terminates the bake worker');
assert.throws(()=>createBrowserMaterialBaker({WorkerClass:'Worker'}),/WorkerClass/);

// finishTrellisMesh uses the bakeMaterial provider when given, with the same textures.
let calls=0;const baker=createBrowserMaterialBaker({WorkerClass:NodeModuleWorker}),counted=async x=>{calls++;return baker(x);};
const unwrapMesh=createWasmXatlasUnwrapper();
const viaProvider=await finishTrellisMesh(surface,{materialFields,textureSize,unwrapMesh,bakeMaterial:counted});
const inThread=await finishTrellisMesh(surface,{materialFields,textureSize,unwrapMesh});
assert.equal(calls,1,'finishTrellisMesh calls the bakeMaterial provider');
assert.equal(sha(viaProvider.textures.baseColor),sha(inThread.textures.baseColor),'provider bake equals the built-in bake');
// The GLB binary chunk (geometry and textures) is identical; its JSON records
// where the bake ran (and run timings, which differ every run).
const glb=g=>{const d=new DataView(g),jl=d.getUint32(12,true);
  return {json:JSON.parse(new TextDecoder().decode(new Uint8Array(g,20,jl))),bin:new Uint8Array(g,20+jl+8)};};
const a=glb(viaProvider.glb),b=glb(inThread.glb);
assert.ok(a.bin.length>1000&&b.bin.length>1000,'both exports carry a real binary chunk');
assert.equal(sha(a.bin),sha(b.bin),'same GLB geometry and texture bytes either way');
assert.equal(a.json.extras.trellis.materialPostprocess.execution,'module-worker','the GLB records the worker bake');
await assert.rejects(finishTrellisMesh(surface,{materialFields,textureSize,unwrapMesh,bakeMaterial:async()=>({width:textureSize})}),/bake/);
assert.rejects(finishTrellisMesh(surface,{materialFields,textureSize,unwrapMesh,bakeMaterial:'bake'}),/bake/);
