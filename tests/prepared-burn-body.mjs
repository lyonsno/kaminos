// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneBurnBody} from '../scene-burn-body.mjs';
import {createLiveLogHeatGpu} from '../live-log-heat-gpu.mjs';
import {createLogSurfaceMask} from '../live-log-surface-mask.mjs';
import {LIVE_LOG_GRID} from '../live-log-heat-core.mjs';
import {residentLightCoverage} from '../scene-resident-coverage.mjs';
function fixture(){
 globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64,MAP_READ:1};
 globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};
 const resources=[],writes=[],callbacks=new Set();
 const resource=spec=>{const r={...spec,destroyed:0,createView:()=>({}),destroy(){this.destroyed++;},mapAsync(){throw Error('Serving preparation must not read back GPU state');}};resources.push(r);return r;};
 const device={limits:{maxTextureDimension2D:2048},createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBuffer:resource,createTexture:resource,createBindGroup:x=>x,
  queue:{writeBuffer(buffer,offset,data){writes.push({buffer,data});},writeTexture(){}}};
 const renderer={backend:{device,get:()=>({})},library:{fromMaterial:source=>new THREE.MeshStandardNodeMaterial().copy(source)}};
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,.5,.1),new THREE.MeshStandardMaterial());mesh.geometry.computeBoundingBox();
 const mask=createLogSurfaceMask(mesh.geometry,mesh.geometry.boundingBox,LIVE_LOG_GRID,{filled:true});
 const scene=new THREE.Scene();scene.add(mesh);
 return {mesh,mask,scene,renderer,resources,writes,callbacks,onFrame:fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);}};
}
test('prepared thermal field retains supplied classification and resets without replacement allocation',async()=>{
 const f=fixture();const field=await createLiveLogHeatGpu({renderer:f.renderer,mesh:f.mesh,bounds:f.mesh.geometry.boundingBox,disintegrate:true,surfaceMask:f.mask});
 try{
  assert.equal(field.residentState().initial,f.mask,'supplied classification must reach the thermal field without recomputation');
  assert.equal(field.residentState().surface,f.mask.surface);
  assert.equal(f.writes.find(w=>w.buffer.label==='live log surface points and normals').data,f.mask.samples);
  const count=f.resources.length,texture=field.texture;field.reset();assert.equal(f.resources.length,count);assert.equal(field.texture,texture);assert.equal(field.read().steps,0);
 }finally{field.dispose();}
 assert.ok(f.resources.every(r=>r.destroyed===1));
});
test('actual burn body consumes prepared mask before any alternate LOD classification and keeps appearance/debris ownership',async()=>{
 const f=fixture(),original=f.mesh.material;
 const body=await createSceneBurnBody({entry:{id:'prompt',object:f.mesh,burnable:{enabled:true,material:'wood',appearance:{profile:'composed',glow:1}}},renderer:f.renderer,scene:f.scene,ground:()=>({center:[0,0,0],height:-1,radius:5}),onFrame:f.onFrame,surfaceMask:f.mask,
  resolveSurfaceGeometry:()=>{throw Error('prepared prompt must not classify an alternate surface');}});
 try{
  assert.equal(residentLightCoverage(f.mesh).read().initial,f.mask);
  assert.notEqual(f.mesh.material,original);assert.equal(body.read().fields[0].steps,0);
  const count=f.resources.length;body.reset();assert.equal(f.resources.length,count);assert.equal(body.read().elapsed,0);
 }finally{body.dispose();}
 assert.equal(f.mesh.material,original);assert.equal(f.callbacks.size,0);assert.equal(f.scene.children.length,1);assert.ok(f.resources.every(r=>r.destroyed===1));
});
test('malformed prepared masks reject before GPU allocation instead of silently classifying replacement geometry',async()=>{
 for(const damage of [m=>new Uint32Array(1),m=>{m.samples=new Float32Array(8);return m;},m=>{m.surface=undefined;return m;},m=>{m[0]=2;return m;},m=>{m.samples[0]=NaN;return m;}]){
  const f=fixture(),mask=damage(f.mask);
  await assert.rejects(createLiveLogHeatGpu({renderer:f.renderer,mesh:f.mesh,bounds:f.mesh.geometry.boundingBox,disintegrate:true,surfaceMask:mask}),/Invalid prepared thermal surface mask/);
  assert.equal(f.resources.length,0);
 }
});
