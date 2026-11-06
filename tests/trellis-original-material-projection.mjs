// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {bakeTrellisMaterialTextures} from '../models/trellis2/trellis-material.js';
import {finishTrellisMesh} from '../models/trellis2/trellis-material.js';
import {createBrowserMaterialBaker} from '../models/trellis2/material-bake.js';
import {createWasmXatlasUnwrapper} from '../models/trellis2/wasm-xatlas.js';
import {NodeTrellisUVWorker} from '../models/trellis2/node-uv-worker.mjs';
const input={vertices:new Float32Array([-.25,-.25,-.25,.25,-.25,-.25,-.25,.25,-.25]),triangles:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1]),textureSize:2,
 coordinates:new Int32Array([0,0,0,1,1,1]),features:new Float32Array([1,-1,-1,-1,1,1,-1,-1,1,-1,1,1]),resolution:2};
test('texture transfer rejects a partial projected position set',()=>{
 assert.throws(()=>bakeTrellisMaterialTextures({...input,samplePositions:new Float32Array(3)}),/complete.*sample positions/i);
});
test('texture transfer samples supplied original-surface positions',()=>{
 const raw=bakeTrellisMaterialTextures(input),projected=new Float32Array(raw.coveredPixels*3).fill(.25);
 const transferred=bakeTrellisMaterialTextures({...input,samplePositions:projected});
 assert.equal(transferred.baseColor[0],0);assert.equal(transferred.baseColor[2],255);
 assert.notDeepEqual(transferred.baseColor,raw.baseColor);
 assert.equal(transferred.metadata.positionTransfer,'caller-projected original surface');
});
for(const value of [undefined,null])for(const WorkerClass of [undefined,NodeTrellisUVWorker]){
 test(`configured missing projection (${value}) rejects in ${WorkerClass?'worker':'caller'} bake`,async()=>{
  const baker=createBrowserMaterialBaker({WorkerClass,projectPositions:async()=>value});
  await assert.rejects(baker(input),/complete finite original-surface sample positions/);
 });
 test(`configured missing projection (${value}) cannot become a successful ${WorkerClass?'worker':'caller'} GLB`,async()=>{
  const {coordinates,features,resolution,textureSize}=input;
  await assert.rejects(finishTrellisMesh(input,{textureSize,materialFields:{coordinates,features,resolution},
   unwrapMesh:createWasmXatlasUnwrapper(),bakeMaterial:createBrowserMaterialBaker({WorkerClass,projectPositions:async()=>value})}),
   /complete finite original-surface sample positions/);
 });
}
test('Stop during async caller projection prevents the subsequent CPU bake',async()=>{
 const controller=new AbortController();
 const guarded={...input,get features(){throw Error('CPU bake read material after Stop');}};
 const baker=createBrowserMaterialBaker({signal:controller.signal,projectPositions:async positions=>{controller.abort();return positions;}});
 await assert.rejects(baker(guarded),{name:'AbortError'});
});
