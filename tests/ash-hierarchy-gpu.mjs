// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createGpuRefinedAsh} from '../ash/refinement-gpu.mjs';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {refinementCell} from '../ash/refinement-plan.mjs';

await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U}=ctx,attributes=new Map();
 const renderer={backend:{isWebGPUBackend:true,device,createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|U.INDIRECT});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute(a){attributes.get(a)?.buffer.destroy();attributes.delete(a);}}};
 const rail=new Mesh(new BoxGeometry(.12,.015,.015),new MeshBasicMaterial());rail.position.set(.13,.13,.13);
 const options={renderer,cellSize:.00125,bounds:{min:[0,0,0],max:[.32,.32,.32]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:8,airBudgetMiB:1},sceneRecords:()=>[{id:'rail',object:rail}]};
 let patch,reopened;
 try{await withGpuErrorScopes(device,'arbitrary-depth physical ash',async()=>{
  patch=await createGpuRefinedAsh(options);patch.syncScene();
  const initial=await patch.diagnostics({fields:true});
  console.log(JSON.stringify({hierarchy:initial.hierarchy}));
  assert.equal(patch.read().backend,'webgpu-hierarchical-ash');
  assert.ok(initial.hierarchy.resident>0,'real cached collider geometry must allocate children');
  assert.ok(initial.hierarchy.deepest===patch.layout.hierarchy.depth,'allocation must reach the requested six refinement steps');
  const view={...patch.layout,residency:initial.residency};let finestSupport=0;
  for(let i=0;i<patch.layout.count;i++){const c=refinementCell(view,i);if(c.owned&&c.size===1&&initial.solid[i])finestSupport++;}
  assert.ok(finestSupport>0,'deepest cells must receive actual collision support');
  await patch.deposit({blanketDepth:.02,groundOnly:true});
  patch.burst(.0002);for(let n=0;n<96;n++)patch.step(null,{position:[.13,.25,.13],spread:.015,rate:0,dt:1/30});
  const saved=await patch.snapshot();assert.equal(saved.schema,'kaminos.hierarchical-ash.v1');
  const depositedView={...patch.layout,residency:saved.residency};
  assert.ok(saved.values.some((v,i)=>{const c=refinementCell(depositedView,i);return v>0&&c.owned&&c.size===1&&c.coord[1]*patch.layout.cellSize>.13;}),'fallout must deposit real ash above the finest rail support');
  assert.ok(Math.abs(saved.volume-saved.retainedVolume)<1e-7);
  rail.position.x+=.04;patch.step();const moved=await patch.snapshot();
  assert.ok(Math.abs(moved.retainedVolume-saved.retainedVolume)<1e-7,'motion preserves physical ash');
  assert.equal(patch.read().runtimeReadbacks,0);
  reopened=await createGpuRefinedAsh(options);reopened.restore(moved);const roundtrip=await reopened.snapshot();
  for(const key of ['residency','values','volume','steps','falling'])assert.deepEqual(roundtrip[key],moved[key],key);
  rail.position.x=2;for(let n=0;n<8;n++){patch.step();const history=await patch.snapshot();assert.ok(Math.abs(history.retainedVolume-saved.retainedVolume)<1e-7,'departed geometry retains balanced material history');}
  console.log(JSON.stringify({route:'production shared-device hierarchy',...initial.hierarchy,finestSupport,retained:moved.retainedVolume}));
 });}finally{reopened?.dispose();patch?.dispose();rail.geometry.dispose();rail.material.dispose();}
});
