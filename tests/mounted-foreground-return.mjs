// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundHandoff} from '../authoring-image-generation.mjs';
import {createAppFrameSource} from '../app-frame-source.mjs';
import {createAppGpuHost} from '../app-gpu-host.mjs';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';
import {createWebGpuForegroundService} from '../webgpu-inference-kit/src/core.js';
const settle=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const frames=[],device={queue:{submit(){},async onSubmittedWorkDone(){}}};
 const source=()=>createAppFrameSource({device,queue:device.queue,requestAnimationFrame:fn=>frames.push(fn)});
 const flame=source(),ordinary=source();let owner=flame,count=0;
 // volume-core's native IDs are ordinary-flame-frame-N, disjoint from app-frame-N.
 const installFlame=flame.setForegroundOpportunityRequester;
 flame.setForegroundOpportunityRequester=r=>installFlame(r?request=>r({...request,requestId:request.requestId.replace('app-frame','ordinary-flame-frame')}):null);
 const host=createSceneFrameComposition({readInputs:()=>({}),draw:()=>count++,frameCount:()=>count});
 const handoff=createForegroundHandoff({prototype:flame,host,waitFrame:settle});
 const app=createAppGpuHost({sharedGpu:{device},host,kit:{createWebGpuForegroundService},frameOwner:()=>owner,
  install:async requester=>{handoff.install('app',requester);await handoff.activate('app');}});
 return {flame,ordinary,host,handoff,app,count:()=>count,setOwner:v=>owner=v,async step(){for(const fn of frames.splice(0))fn();await settle();}};
}
test('stopping mounted fire transfers real scene frames to ordinary owner during an admitted model run',async()=>{
 const f=fixture(),run=await f.app.beginRun('image',{routeId:'fixture-image'});
 await f.step();await run.withForeground("test-boundary",async()=>{});await settle();assert.ok(f.count()>0);
 const before=f.count();f.setOwner(f.ordinary);
 // Physical renderer has stopped; the app still uses this same model service.
 await f.handoff.moveTo(f.ordinary);
 assert.equal(f.flame.debugState().active,false,'old owner must stop asking for frames');
 assert.equal(f.ordinary.debugState().active,true,'ordinary scene must take the requester');
 await f.step();await run.withForeground("test-boundary",async()=>{});await settle();assert.ok(f.count()>before,'Return must render new scene frames');
 assert.equal(f.handoff.owner(),'app');assert.equal(f.host.state().serviceActive,true);
 await run.finish();await f.handoff.release();assert.equal(f.host.renderOrdinary(),true);
});
test('handoff drains a pending frame and retains a different model owner across Return and re-entry',async()=>{
 const f=fixture();let finish;
 f.handoff.install('sf3d',request=>({completion:new Promise(r=>{finish=()=>r(request.run({device:f.app.device,queue:f.app.queue}));})}));
 await f.handoff.activate('sf3d');await f.step();assert.equal(f.flame.debugState().pending,true);
 let moved=false;const transfer=f.handoff.moveTo(f.ordinary).then(()=>{moved=true;});await settle();assert.equal(moved,false);
 finish();await transfer;assert.equal(f.handoff.owner(),'sf3d');assert.equal(f.flame.debugState().active,false);
 await f.handoff.moveTo(f.flame);assert.equal(f.ordinary.debugState().active,false);assert.equal(f.flame.debugState().active,true);
 await f.handoff.release();
});
