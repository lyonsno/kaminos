// kaminos-test: node
// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createGpuRefinedAsh} from '../ash/refinement-gpu.mjs';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {refinementCell,refinementIndex} from '../ash/refinement-plan.mjs';

await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U}=ctx,attributes=new Map();
 const renderer={backend:{isWebGPUBackend:true,device,createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|U.INDIRECT});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute(a){attributes.get(a)?.buffer.destroy();attributes.delete(a);}}};

 const rail=new Mesh(new BoxGeometry(.12,.015,.03),new MeshBasicMaterial());rail.position.set(.13,.13,.13);let patch;
 try{await withGpuErrorScopes(device,'fine receiver impact locality',async()=>{
 patch=await createGpuRefinedAsh({renderer,cellSize:.005,bounds:{min:[0,0,0],max:[.32,.32,.32]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:4,airBudgetMiB:.25},sceneRecords:()=>[{id:'rail',object:rail}]});assert.ok(patch.read().falling.allocatedBytes<=.25*1048576,'airborne buffers fit their explicit allowance');patch.syncScene();for(let n=0;n<12;n++)patch.step();
 const diag=await patch.diagnostics({fields:true}),view={...patch.layout,residency:diag.residency};let hit;
 for(let i=0;i<patch.layout.count;i++){const c=refinementCell(view,i);if(!c.owned||c.size!==1||diag.solid[i])continue;const below=refinementIndex(view,[c.coord[0],c.coord[1]-1,c.coord[2]]);if(below<0||!diag.solid[below])continue;if(!hit||Math.hypot(c.coord[0]*.005-.13,c.coord[2]*.005-.13)<hit.distance)hit={i,c,distance:Math.hypot(c.coord[0]*.005-.13,c.coord[2]*.005-.13)};}
 assert.ok(hit,'actual finest receiver above rail');const q=hit.c.coord,cp=await patch.snapshot(),mass=128,volume=mass*.005**3;
 cp.falling.particles.fill(0);cp.falling.particles.splice(0,8,(q[0]+.5)*.005,(q[1]+1.5)*.005,(q[2]+.5)*.005,mass,0,-.8,0,0);cp.falling.requestedVolume=volume;cp.volume=volume;cp.retainedVolume=volume;patch.restore(cp);patch.step(null,{position:[0,.3,0],spread:0,rate:0,dt:1/30});
 const after=await patch.snapshot(),out={...patch.layout,residency:after.residency};let high=-Infinity;for(let i=0;i<after.values.length;i++)if(after.values[i]>1e-7){const c=refinementCell(out,i);high=Math.max(high,c.coord[1]+after.values[i]/c.size**2);}
 console.log(JSON.stringify({case:'fine impact locality',contactBottom:q[1],highestFill:high,retained:after.retainedVolume,supplied:volume}));assert.ok(Math.abs(after.retainedVolume-volume)<1e-7);assert.ok(high<=q[1]+2,'one contact must not dump a macroscopic parcel up a fine column');
 });}finally{patch?.dispose();rail.geometry.dispose();rail.material.dispose();}

});
