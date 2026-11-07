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



 const rail=new Mesh(new BoxGeometry(.12,.015,.03),new MeshBasicMaterial());rail.position.set(.13,.13,.13);const other=new Mesh(new BoxGeometry(.015,.015,.015),new MeshBasicMaterial());other.position.set(.27,.15,.27);let patch;
 try{await withGpuErrorScopes(device,'resident receiving demand refresh',async()=>{
 patch=await createGpuRefinedAsh({renderer,cellSize:.0025,bounds:{min:[0,0,0],max:[.32,.32,.32]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:8},sceneRecords:()=>[{id:'rail',object:rail},{id:'other',object:other}]});patch.syncScene();const before=await patch.diagnostics({fields:true}),view={...patch.layout,residency:before.residency};
 const arena=refinementArena(patch.layout),entry=[...attributes].filter(([a])=>a.array instanceof Uint32Array&&a.array.length===arena.words.length);assert.equal(entry.length,1);const count=view.tiles.count*8,read=device.createBuffer({size:count*4,usage:U.COPY_DST|U.MAP_READ});let demand;
 try{const e=device.createCommandEncoder();e.copyBufferToBuffer(entry[0][1].buffer,view.hierarchyArena.demand*4,read,0,count*4);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);demand=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();}finally{read.destroy();}
 const receivers=[];for(let t=view.hierarchy.roots;t<view.tiles.count;t++){const n=before.residency.nodes.slice(t*8,t*8+8);if(!n[7]||n[4]!==view.hierarchy.depth||demand[(n[5]-1)*8+n[6]]!==2)continue;const point=n.slice(0,3).map(v=>v+4*n[3]);if(point[0]*view.cellSize>.22||point[2]*view.cellSize>.18||point[1]*view.cellSize<.14)continue;const start=view.regions[0].layout.count+(t-view.hierarchy.roots)*512;if(before.solid.slice(start,start+512).some(Boolean))continue;receivers.push(point);}
 console.log(JSON.stringify({beforeReceivers:receivers}));assert.ok(receivers.length>0,'cold geometry must create distinct empty finest receiving bricks');
 other.position.x+=.001;patch.step();const after=await patch.diagnostics(),next={...patch.layout,residency:after.residency};const missing=receivers.filter(q=>refinementCell(next,refinementIndex(next,q)).size!==1);console.log(JSON.stringify({missing}));assert.equal(missing.length,0,'moving another collider must retain unchanged finest receiving space');
 });}finally{patch?.dispose();for(const mesh of [rail,other]){mesh.geometry.dispose();mesh.material.dispose();}}

});
