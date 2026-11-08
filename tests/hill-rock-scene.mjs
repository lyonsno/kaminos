// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRockScene} from '../experiments/hill-terrain/rock-scene.mjs';
import {readFile} from 'node:fs/promises';
import definition from '../experiments/hill-geology.experiment.mjs';
test('rendered rock vertices and normals come from the query solids, with deterministic rebuilds',()=>{
 const scene=createRockScene(),source=scene.source();
 assert.equal(scene.root.children.length,source.solids.length);
 for(let i=0;i<source.solids.length;i++){
  assert.deepEqual(scene.root.children[i].geometry.attributes.position.array,Float32Array.from(source.solids[i].positions));
  assert.deepEqual(scene.root.children[i].geometry.attributes.normal.array,Float32Array.from(source.solids[i].normals));
 }
 const original=scene.source();assert.throws(()=>scene.rebuild({gap:Infinity}),/dimensions/);assert.equal(scene.source(),original);
 const old=[...scene.root.children],disposed=[];old.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed.push(m)));
 scene.rebuild({gap:.04});assert.equal(disposed.length,old.length);assert.equal(scene.read().gap,.04);
 assert.notDeepEqual(scene.source(),original);
 const children=[...scene.root.children];children.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed.push(m)));
 scene.dispose();assert.equal(disposed.length,old.length+children.length);
});
test('closing the enclosing experiment destroys the exported rock buffers',async()=>{
 // Accounting doubles exercise ownership, not shader execution. The browser
 // regression separately observes real-device writes after enclosing close.
 const original={fetch:globalThis.fetch,window:globalThis.window,usage:globalThis.GPUBufferUsage},allocated=[];
 let root,view,instance;
 globalThis.window={};globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8};
 globalThis.fetch=async url=>{const bytes=await readFile(url);return{ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
 const device={limits:{maxStorageBufferBindingSize:1e9,maxBufferSize:1e9,maxComputeWorkgroupsPerDimension:65535,maxComputeWorkgroupsPerDimension:65535},addEventListener(){},removeEventListener(){},lost:new Promise(()=>{}),queue:{writeBuffer(){}},createBuffer({size}){const b={size,destroyed:false,destroy(){this.destroyed=true;}};allocated.push(b);return b;}};
 const renderer={_attributes:{delete(){}},backend:{isWebGPUBackend:true,device,get:a=>({buffer:{size:a.array.byteLength}})},compute(){}};
 const session={attach:async value=>(root=value,{id:root.uuid,root}),setView:v=>(view=v),readView:()=>view,redraw(){},onFrame:()=>()=>{},dispose:async()=>{root=null;}};
 try{
  instance=await definition.create({host:{scene:{open:async()=>session}},inputs:{rock:{enabled:true}},record(){}});
  root.children.find(m=>m.name==='Weathered hillside').onBeforeRender(renderer,{children:[]},null);
  const exported=window.kaminosHillGeology.gpu().explicitRock;assert.equal(allocated.length,2);assert.equal(exported.blockCount,9);assert.ok(allocated.every(b=>!b.destroyed));
  await instance.dispose();assert.equal(root,null);assert.equal(window.kaminosHillGeology,undefined);
  assert.ok(allocated.every(b=>b.destroyed),'Enclosing experiment must release both exported rock buffers');
 }finally{
  await instance?.dispose();globalThis.fetch=original.fetch;
  if(original.window===undefined)delete globalThis.window;else globalThis.window=original.window;
  if(original.usage===undefined)delete globalThis.GPUBufferUsage;else globalThis.GPUBufferUsage=original.usage;
 }
});
