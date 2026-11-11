// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import * as THREE from '../lib/three.webgpu.js';
import {installSceneWorkerHost} from '../scene-worker-handoff.mjs';
import {createSceneWorkerPage,captureSceneWorkerCamera,applySceneWorkerSurfaces,mergeSceneWorkerUi} from '../scene-worker-page.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{holdFrame=null,retire=()=>true,commandsOverride={}}={}){
 const {port1,port2}=new MessageChannel(),frames=[],commands=[],raf=new Map(),surfaces=[],progress=[];let serial=0,terminated=0,x=1;
 const worker=port1;worker.terminate=()=>terminated++;
 const host=installSceneWorkerHost({port:port2,createRuntime:({payload})=>({initialize:async ctx=>{ctx.report({ui:{surfaces:{volume:{active:true,transparent:true}}}});assert.equal(payload.flameControls.resolution,16);},
  commands:{read:()=>({value:x}),load:(_,ctx)=>{ctx.advanceEpoch('load');ctx.activate();return {loaded:true};},...commandsOverride},
  foregroundCommands:{'flame.controls':patch=>{commands.push(patch);return {acceptedControls:{resolution:16,...patch}};}},
  requestMutation:async(_,payload,ctx,apply)=>apply(),requestFrame:async(_,ctx,draw)=>{if(holdFrame)await holdFrame.promise;return draw();},
  frame:input=>{frames.push(input);return {ui:{surfaces:{volume:{active:true,transparent:true}}},drawn:true};},retire,
 })});
 const canvas=()=>({transferControlToOffscreen:()=>new ArrayBuffer(8)});
 const page=createSceneWorkerPage({entryUrl:'/scene-worker.entry.bundle.mjs',createWorker:()=>worker,sceneCanvas:canvas(),volumeCanvas:canvas(),
  readViewport:()=>({width:32,height:24,pixelRatio:2}),readCamera:()=>({value:x}),readFlameControls:()=>({resolution:16}),
  requestAnimationFrame:run=>{raf.set(++serial,run);return serial;},cancelAnimationFrame:id=>raf.delete(id),
  now:()=>12,timeOrigin:1000,applyUi:(ui,meta)=>surfaces.push({ui,meta}),onProgress:event=>progress.push(event)});
 t.after(()=>{page.disconnect();host.disconnect();port1.close();port2.close();});
 async function step(){const callbacks=[...raf.values()];raf.clear();for(const fn of callbacks)fn(15);await tick();await tick();}
 return {page,host,frames,commands,surfaces,progress,step,setX:value=>x=value,terminated:()=>terminated,raf};
}
test('page bridge transfers once, observes actual initialization/progress, and sends camera/viewport time without RAF settings replay',async t=>{
 const f=await fixture(t);await f.page.start();await f.step();
 assert.equal(f.page.read().phase,'active');assert.equal(f.frames.length,1);
 assert.deepEqual(f.frames[0],{now:12,timeOrigin:1000,viewport:{width:32,height:24,pixelRatio:2},camera:{value:1}});
 assert.equal(Object.hasOwn(f.frames[0],'flameControls'),false);assert.equal(f.progress.length,1);
 assert.equal(f.surfaces[0].ui.surfaces.volume.active,true);
 await f.page.start();assert.equal(f.page.read().initializations,1);
 const edit=await f.page.request('flame.controls',{strength:2}).completion;assert.deepEqual(edit.output.acceptedControls,{resolution:16,strength:2});
 assert.deepEqual(f.commands,[{strength:2}]);await f.page.retire();assert.equal(f.terminated(),1);assert.equal(f.raf.size,0);
});
test('one outstanding frame preserves responsive input updates and samples the latest view next',async t=>{
 const held=gate(),f=await fixture(t,{holdFrame:held});await f.page.start();await f.step();f.setX(7);await f.step();await f.step();
 assert.equal(f.page.read().frameRequests,1);held.resolve();await tick();await tick();await f.step();
 assert.equal(f.frames.length,2);assert.equal(f.frames[1].camera.value,7);await f.page.retire();
});
test('device invalidation holds page frame requests until explicit resume after a fresh recovery command',async t=>{
 const f=await fixture(t);await f.page.start();f.host.invalidate('device');await tick();await tick();
 assert.equal(f.page.read().phase,'held');await f.step();assert.equal(f.frames.length,0);
 // No page API is authority to activate the GPU: this command's context does it.
 await f.page.request('load').completion;f.page.resumeFrames();await f.step();assert.equal(f.frames.length,1);
 await f.page.retire();
});
test('failed retirement keeps the actual worker and same retryable runtime alive',async t=>{
 let attempts=0;const f=await fixture(t,{retire:()=>{if(++attempts===1)throw Error('held cleanup');return true;}});await f.page.start();
 await assert.rejects(f.page.retire(),error=>error.gpuRouteHeld===true);assert.equal(f.terminated(),0);assert.equal(f.page.read().phase,'held');
 await f.page.retire();assert.equal(attempts,2);assert.equal(f.terminated(),1);
});
test('camera capture preserves exact projection, pose and controls target as plain data',()=>{
 const camera=new THREE.PerspectiveCamera(43,1.7,.1,80);camera.position.set(1,2,3);camera.lookAt(0,0,0);camera.zoom=1.2;camera.filmOffset=2;camera.updateProjectionMatrix();
 const target=new THREE.Vector3(0,.4,0),snapshot=captureSceneWorkerCamera(camera,target);
 assert.equal(snapshot.type,'PerspectiveCamera');assert.deepEqual(snapshot.position,[1,2,3]);assert.deepEqual(snapshot.target,[0,.4,0]);
 assert.deepEqual(snapshot.projectionMatrix,camera.projectionMatrix.toArray());assert.equal(snapshot.filmOffset,2);assert.equal(snapshot.zoom,1.2);
 assert.doesNotThrow(()=>structuredClone(snapshot));
});
test('surface projection requires actual booleans and leaves absent surface state unreported',()=>{
 const changes=[],volume={classList:{toggle:(name,value)=>changes.push([name,value])},style:{}};
 applySceneWorkerSurfaces({volume},{volume:{active:true,transparent:true}});
 assert.deepEqual(changes,[['active',true]]);assert.equal(volume.style.background,'transparent');
 applySceneWorkerSurfaces({volume},{});assert.equal(changes.length,1);
 assert.throws(()=>applySceneWorkerSurfaces({volume},{volume:{active:'yes',transparent:false}}),/boolean/);
});
test('invalid viewport fails before creating or transferring a worker canvas',async()=>{
 let created=0,transferred=0;
 const page=createSceneWorkerPage({createWorker:()=>{created++;},sceneCanvas:{transferControlToOffscreen(){transferred++;}},volumeCanvas:{transferControlToOffscreen(){transferred++;}},
  readViewport:()=>({width:0,height:24,pixelRatio:1}),readCamera:()=>({}),readFlameControls:()=>({})});
 await assert.rejects(page.start(),/positive finite/);assert.equal(created,0);assert.equal(transferred,0);assert.equal(page.read().phase,'held');
 assert.throws(()=>page.request('read'),/not initialized/);
});
test('disconnect removes page ownership without claiming GPU resource settlement',async t=>{
 const f=await fixture(t);await f.page.start();f.page.disconnect();
 assert.equal(f.page.read().phase,'closed');assert.equal(f.terminated(),0,'disconnect does not claim resource settlement');
});
test('malformed surface flags cannot partially publish another canvas state',()=>{
 const changes=[],canvas={classList:{toggle:(...args)=>changes.push(args)},style:{}};
 assert.throws(()=>applySceneWorkerSurfaces({scene:canvas,volume:canvas},{scene:{active:true},volume:{active:'false'}}),/boolean/);
 assert.deepEqual(changes,[]);
});
test('successful retirement cannot be relabeled as a held reusable page by late frame-hold callbacks',async t=>{
 const f=await fixture(t);await f.page.start();await f.page.retire();f.page.holdFrames('Late pagehide');
 assert.equal(f.page.read().phase,'retired');assert.equal(f.page.read().initialized,false);assert.equal(f.raf.size,0);
});

test('new-epoch progress clears old UI before adopting the actual new projection',async t=>{
 const f=await fixture(t,{commandsOverride:{replace:(_,ctx)=>{ctx.advanceEpoch('scene');ctx.activate();ctx.report({ui:{bounds:{min:[1,2,3],max:[4,5,6]}}});return {applied:true};}}});
 await f.page.start();assert.equal(f.page.read().ui.surfaces.volume.active,true);
 await f.page.request('replace').completion;
 assert.deepEqual(f.page.read().ui.bounds,{min:[1,2,3],max:[4,5,6]});
 assert.equal(f.page.read().ui.surfaces,undefined,'old epoch surface projection must not leak into new state');
 f.page.resumeFrames();await f.step();assert.deepEqual(f.page.read().ui.bounds,{min:[1,2,3],max:[4,5,6]});await f.page.retire();
});
test('partial UI merges preserve actual flags and additive metadata, and explicit null clears bounds',()=>{
 const first=mergeSceneWorkerUi(null,{bounds:{min:[0,0,0],max:[1,1,1]},surfaces:{volume:{active:true,transparent:false}},extra:{actual:true}});
 const next=mergeSceneWorkerUi(first,{surfaces:{volume:{transparent:true}}});
 assert.equal(next.surfaces.volume.active,true);assert.equal(next.surfaces.volume.transparent,true);assert.deepEqual(next.bounds,first.bounds);assert.equal(next.extra.actual,true);
 assert.equal(mergeSceneWorkerUi(next,{bounds:null}).bounds,null);assert.equal(Object.hasOwn(next.surfaces,'scene'),false);
 assert.throws(()=>mergeSceneWorkerUi(next,{surfaces:{volume:null}}),/state must be an object/);
});

test('transport visibility hides stale canvas pixels without changing simulation activity',()=>{
 const changes=[],volume={hidden:false,classList:{toggle:(...args)=>changes.push(args)},style:{background:'transparent',visibility:''}};
 applySceneWorkerSurfaces({volume},{volume:{active:true,visible:false}});
 assert.equal(volume.hidden,false);assert.equal(volume.style.visibility,'hidden');assert.deepEqual(changes,[['active',true]]);
 applySceneWorkerSurfaces({volume},{volume:{transparent:true}});assert.equal(volume.style.visibility,'hidden');
 applySceneWorkerSurfaces({volume},{volume:{visible:true}});assert.equal(volume.style.visibility,'');assert.equal(volume.hidden,false);
 const before=structuredClone(volume.style);
 assert.throws(()=>applySceneWorkerSurfaces({volume},{volume:{transparent:false,visible:'false'}}),/boolean/);assert.deepEqual(volume.style,before);
});
