// kaminos-test: node
import assert from 'node:assert/strict';
import {compareAshCornerCache} from './helpers/ash-corner-cache.mjs';
import {pathToFileURL} from 'node:url';
const source=process.env.ASH_TEST_ROOT??process.cwd(),load=p=>import(pathToFileURL(source+'/'+p));
const {withKaminosGpu,withGpuErrorScopes}=await load('tools/shader-herder.mjs');
const {createGpuRefinedAsh}=await load('ash/refinement-gpu.mjs');
const {Mesh,BoxGeometry,MeshBasicMaterial}=await load('lib/three.core.js');
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U}=ctx,attributes=new Map();let passes=0;
 const counted=new Proxy(device,{get(t,k){if(k==='createCommandEncoder')return (...args)=>{const encoder=t.createCommandEncoder(...args);return new Proxy(encoder,{get(e,n){if(n==='beginComputePass')return (...v)=>{passes++;return e.beginComputePass(...v);};const f=e[n];return typeof f==='function'?f.bind(e):f;}});};const f=t[k];return typeof f==='function'?f.bind(t):f;}});
 const renderer={backend:{isWebGPUBackend:true,device:counted,createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|U.INDIRECT});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute(a){attributes.get(a)?.buffer.destroy();attributes.delete(a);}}};
 const rail=new Mesh(new BoxGeometry(.12,.015,.03),new MeshBasicMaterial());rail.position.set(.13,.13,.13);let patch;
 try{await withGpuErrorScopes(device,'ash bounded work and independent activity',async()=>{
  patch=await createGpuRefinedAsh({renderer,cellSize:.0025,bounds:{min:[0,0,0],max:[.32,.32,.32]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:2,airBudgetMiB:.25},sceneRecords:()=>[{id:'rail',object:rail}]});patch.syncScene();
  passes=0;patch.step();await device.queue.onSubmittedWorkDone();assert.ok(passes<=24,`stationary tick records ${passes} compute passes; bounded planning must not submit the cold cascade`);
  assert.equal(patch.read().surfaceCache.lighting,'cached-finest-corners','settled surface lighting must reuse GPU derived data');
  patch.setActivity({moveAirborne:false,settleDeposited:false,showAirborne:true,showDeposited:false});const before=await patch.snapshot();patch.step(null,{position:[.13,.3,.13],spread:.02,rate:.00001,dt:1/30});const frozen=await patch.snapshot();assert.equal(frozen.falling.requestedVolume,before.falling.requestedVolume,'paused airborne transport cannot silently bank new emission');assert.deepEqual(frozen.values,before.values,'disabled settling and transport preserve physical material');assert.equal(patch.root.getObjectByName('Airborne ash').visible,true,'air remains drawable independently of the deposit');
  patch.setActivity({moveAirborne:true,settleDeposited:true,showAirborne:false,showDeposited:true});patch.step(null,{position:[.13,.3,.13],spread:.02,rate:.00001,dt:1/30});const live=await patch.snapshot();assert.ok(live.falling.requestedVolume>before.falling.requestedVolume);assert.ok(Math.abs(live.retainedVolume-live.volume)<1e-9);
  await compareAshCornerCache({ctx,patch,attributes,source});const coated=await patch.snapshot();
  patch.setRefinementPolicy({...patch.layout.refinement,maxDepth:0,depthBudgetMiB:[0],planningRounds:1});for(let n=0;n<3;n++)patch.step();const history=await patch.snapshot();assert.ok(Math.abs(history.retainedVolume-coated.retainedVolume)<1e-9,'lowering new-detail limits preserves material history');
  console.log(JSON.stringify({source,stationaryPassBound:24,allocation:patch.read().allocatedBytes,conserved:history.retainedVolume}));
 });}finally{patch?.dispose();rail.geometry.dispose();rail.material.dispose();}
});
