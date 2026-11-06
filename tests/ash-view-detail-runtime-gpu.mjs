// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createGpuRefinedAsh} from '../ash/refinement-gpu.mjs';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {refinementCell} from '../ash/refinement-plan.mjs';
await withKaminosGpu(async ctx=>{
 Object.assign(globalThis,{GPUBufferUsage:ctx.GPUBufferUsage,GPUTextureUsage:ctx.GPUTextureUsage,GPUShaderStage:ctx.GPUShaderStage,GPUMapMode:ctx.GPUMapMode});
 const {device,GPUBufferUsage:U}=ctx;
 await withGpuErrorScopes(device,'collider-driven third-level runtime',async()=>{
  const attributes=new Map();const renderer={backend:{isWebGPUBackend:true,device,
   createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|U.INDIRECT});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},
   createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute(a){attributes.get(a)?.buffer.destroy();attributes.delete(a);}}};
  const pipe=new Mesh(new BoxGeometry(.025,.29,.025),new MeshBasicMaterial());pipe.position.set(.17,.145,.18);
  const rail=new Mesh(new BoxGeometry(.35,.025,.025),new MeshBasicMaterial());rail.position.set(.28,.3,.18);
  const records=()=>[{id:'pipe',object:pipe},{id:'rail',object:rail}];
  let view={matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],viewport:[1000,1000],targetPixels:3};
  const options={renderer,cellSize:.04,bounds:{min:[0,0,0],max:[.64,.4,.64]},refinement:{ratio:2,mode:'adaptive',levels:3,fineCapacity:8,detailCapacity:16},sceneRecords:records,readView:()=>view};
  let patch,reopened;
  try{
   patch=await createGpuRefinedAsh(options);patch.syncScene();
   const initial=await patch.diagnostics({fields:true});
   const internal=await device.popErrorScope(),validation=await device.popErrorScope();device.pushErrorScope('validation');device.pushErrorScope('internal');
   assert.equal(internal,null,internal?.message);assert.equal(validation,null,validation?.message);
   console.log(JSON.stringify({allocation:initial.allocation,detail:initial.detailAllocation,solid:initial.solid.filter(Boolean).length,colliders:patch.read().sceneCollision}));
   assert.ok(initial.residency.slots.some(Boolean),'coarse collider discrepancy must allocate middle bricks');
   assert.ok(initial.residency.detail.slots.some(Boolean),'current cached collider detail must allocate actual finest bricks');
   const topology={...patch.layout,residency:initial.residency};let support=0;
   for(let i=patch.layout.detailPool.offset;i<patch.layout.count;i++)if(refinementCell(topology,i).owned&&initial.solid[i])support++;
   assert.ok(support>0,'finest collision stamp must contain real receiving geometry');
   await patch.deposit({blanketDepth:.04,groundOnly:true});
   patch.burst(.002);for(let i=0;i<32;i++)patch.step(null,{position:[.17,.5,.18],rate:0,spread:.035,dt:1/30});
   const saved=await patch.snapshot();assert.equal(saved.schema,'kaminos.adaptive-ash.v2');assert.ok(Math.abs(saved.volume-saved.retainedVolume)<1e-5);
   const pinned=saved.residency.detail.slots.flatMap((page,slot)=>page&&saved.values.slice(patch.layout.detailPool.offset+slot*512,patch.layout.detailPool.offset+(slot+1)*512).some(v=>v>0)?[page-1]:[]);
   assert.ok(pinned.length>0,'fixture must deposit fine history before moving geometry');
   pipe.position.x+=.24;rail.position.x+=.18;view={...view,viewport:[100,100]};patch.step();
   const moved=await patch.snapshot();for(const page of pinned)assert.ok(moved.residency.detail.map[page],'camera/collider movement must retain finest material');
   assert.ok(Math.abs(moved.retainedVolume-saved.retainedVolume)<1e-5);assert.equal(moved.volume,saved.volume);
   reopened=await createGpuRefinedAsh(options);reopened.restore(moved);const roundtrip=await reopened.snapshot();
   for(const key of ['layout','residency','values','falling','volume','retainedVolume','steps'])assert.deepEqual(roundtrip[key],moved[key],key);
   const bad=structuredClone(moved);bad.residency.map.fill(0);bad.residency.slots.fill(0);assert.throws(()=>reopened.restore(bad),/parent|balance/i);
   assert.equal((await patch.diagnostics()).stats.surfaceOverflow,0);
   console.log(JSON.stringify({route:'production shared-device runtime; compute and collision, no browser drawing',middle:initial.residency.slots.filter(Boolean).length,finest:initial.residency.detail.slots.filter(Boolean).length,fineSupport:support,preserved:pinned.length,allocatedBytes:patch.read().allocatedBytes,ledger:roundtrip.retainedVolume}));
  }finally{reopened?.dispose();patch?.dispose();for(const mesh of [pipe,rail]){mesh.geometry.dispose();mesh.material.dispose();}}
 });
});
