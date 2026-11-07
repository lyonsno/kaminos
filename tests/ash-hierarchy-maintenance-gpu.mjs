// kaminos-test: node
// kaminos-test: node
import {refinementArena} from '../ash/refinement-shader.mjs';
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createGpuRefinedAsh} from '../ash/refinement-gpu.mjs';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {refinementCell,refinementIndex} from '../ash/refinement-plan.mjs';

await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U}=ctx,attributes=new Map();
 const renderer={backend:{isWebGPUBackend:true,device,createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|U.INDIRECT});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute(a){attributes.get(a)?.buffer.destroy();attributes.delete(a);}}};


 const rail=new Mesh(new BoxGeometry(.12,.015,.03),new MeshBasicMaterial());rail.position.set(.13,.13,.13);let patch;
 try{await withGpuErrorScopes(device,'complete brick face balance',async()=>{
  patch=await createGpuRefinedAsh({renderer,cellSize:.00125,bounds:{min:[0,0,0],max:[.32,.32,.32]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:2},sceneRecords:()=>[{id:'rail',object:rail}]});patch.syncScene();

  const arena=refinementArena(patch.layout),entry=[...attributes].filter(([a])=>a.array instanceof Uint32Array&&a.array.length===arena.words.length);assert.equal(entry.length,1);
  const read=device.createBuffer({size:64,usage:U.COPY_DST|U.MAP_READ});
  const sample=async()=>{const e=device.createCommandEncoder();e.copyBufferToBuffer(entry[0][1].buffer,patch.layout.hierarchyArena.state*4,read,0,64);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const words=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();return words;};
  try{const cold=await sample();console.log(JSON.stringify({phase:'cold',state:cold}));assert.notEqual(cold[8],1,'allocation must not masquerade as newly emptied material and wake another planning episode');for(let n=0;n<4;n++)patch.step();const state=await sample();console.log(JSON.stringify({phase:'stationary',state}));assert.equal(state[7],0,'topology must sleep once a static pressure episode has finished');device.queue.writeBuffer(entry[0][1].buffer,(patch.layout.hierarchyArena.state+8)*4,new Uint32Array([1]));patch.step();const cleanup=await sample();assert.equal(cleanup[7],2,'an emptied-cell wake performs release-only maintenance');assert.equal(cleanup[2],0,'release-only maintenance cannot allocate');}finally{read.destroy();}

 });}finally{patch?.dispose();rail.geometry.dispose();rail.material.dispose();}

});