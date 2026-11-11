// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import workshop from '../experiments/earth-material.experiment.mjs';
import {createEarthDynamicsKernel} from '../earth-dynamics.mjs';
import {createEarthTeacherSource} from '../earth-surface.mjs';
import transport from '../experiments/earth-surface-teacher.experiment.mjs';
import {createOwnerSceneSession} from '../owner-scene-session.mjs';
function fakeHost({strict=false}={}){
 const frames=new Set(),roots=[];let doc;
 const make=tag=>({tag,ownerDocument:doc,value:'',children:[],style:{},dataset:{},classList:{add(){},remove(){}},append(...a){this.children.push(...a);},insertBefore(a,b){this.children=this.children.filter(x=>x!==a);this.children.splice(Math.max(0,this.children.indexOf(b)),0,a);},setAttribute(k,v){this[k]=v;},addEventListener(){},removeEventListener(){},remove(){},contains(){return false;},getBoundingClientRect:()=>({left:0,top:0,width:640,height:480})});
 doc={activeElement:null,createElement:make,addEventListener(){},removeEventListener(){}};const viewport=make('viewport');doc.getElementById=id=>id==='viewport'?viewport:null;doc.head=make('head');doc.body=make('body');
 let view={position:[1,1,1],target:[0,0,0],fov:40};const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
 const session={attach:async root=>{roots.push(root);scene.add(root);return {id:`object-${roots.length}`,root};},redraw(){},readView:()=>view,setView:v=>view=v,onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);}};
 return {roots,doc,frame:(deltaSeconds=1/60)=>{for(const fn of frames)fn({deltaSeconds,timestampMs:performance.now()});},host:{scene:{open:async()=>{if(strict)return createOwnerSceneSession({...session,loadAsset:async()=>{throw Error('No asset fixture');},attach:async(root,options)=>({...await session.attach(root),owned:options.owned}),remove:async handle=>scene.remove(handle.root)});const owned=[];return {...session,attach:async root=>{const handle=await session.attach(root);owned.push(root);return handle;},dispose:async()=>{for(const root of owned)scene.remove(root);}};},refreshPresentation(){},isVisible:()=>true,rendering:()=>({scene,camera,renderer:{domElement:viewport,getDrawingBufferSize:v=>v.set(64,48),backend:{device:{limits:{maxTextureDimension2D:4096},addEventListener(){},removeEventListener(){}}}}})},controls:{document:doc,installNumberDrag:({input})=>{input.readOnly=true;return {dispose(){}};}}}};
}
test('closing the workshop disposes its final geometry and materials',async()=>{
 const {host,roots}=fakeHost();const app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});
 const resources=new Set();for(const root of roots)root.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)resources.add(m);});
 const disposed=new Set();for(const r of resources)r.addEventListener('dispose',()=>disposed.add(r));await app.dispose();
 assert.equal(disposed.size,resources.size,'every feature-owned geometry/material must dispose');
});
test('standalone transport selection seeds an explicit source and can return that current source',async()=>{
 const {host}=fakeHost();const app=await transport.create({host,inputs:{paused:true,scale:.02},record:()=>{}});
 const read=app.read();assert.equal(read.sourceSchema,'kaminos.earth-teacher.v1');assert.ok(read.source.snapshot.particles.length>0);await app.dispose();
});
test('a press returns the tool and advances a separate unforced release interval',async()=>{
 const {host,roots}=fakeHost();const app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,pressSeconds:.03,releaseSeconds:.04}},record:()=>{}});
 const pose=roots[1].position.toArray();await app.operations.press();assert.deepEqual(roots[1].position.toArray(),pose);assert.ok(Math.abs(app.read().physics.time-.07)<1e-10,'displayed press result must include unforced release, not end at peak tool contact');await app.dispose();
});
test('capture retains the training neighborhood and exact physical snapshot',async()=>{
 const {host}=fakeHost();const app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 const frozen=await app.operations.freeze();assert.equal(frozen.source.halo,1);assert.deepEqual(frozen.source.snapshot,(await app.operations.snapshot()).snapshot);await app.dispose();
});
test('failed reconstruction during load retains the existing physical specimen',async()=>{
 const {host}=fakeHost();const device=host.scene.rendering().renderer.backend.device;
 const original=host.scene.rendering;host.scene.rendering=()=>{const context=original();context.renderer.backend.device=device;return context;};
 const app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 const before=await app.operations.snapshot(),incoming=structuredClone(before);incoming.snapshot.time=123;
 device.limits.maxBufferSize=1;await assert.rejects(app.operations.load(incoming),/storage/);assert.deepEqual(await app.operations.snapshot(),before,'failed load must not replace physical state or settings');await app.dispose();
});

test('native tool motion continuously works earth and never resets the hand pose',async()=>{
 const {host,roots,frame}=fakeHost();const app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 try{
  const before=app.read().physics.time;roots[1].position.y=.035;const hand=roots[1].position.toArray();frame();
  // Wait for asynchronous work triggered by the real host frame path.
  for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(app.read().physics.time>before,'ordinary tool motion must enter physics without a press operation');
  assert.deepEqual(roots[1].position.toArray(),hand,'the hand controls the sphere continuously');
  roots[1].position.x=.06;frame();for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(app.read().physics.time>before+1/60,'second hand movement also advances the same specimen');
 }finally{await app.dispose();}
});
test('pausing allows native repositioning without deforming the specimen',async()=>{
 const {host,roots,frame}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});
 try{await app.operations.live(false);const before=await app.operations.snapshot();roots[1].position.x=.1;frame();await new Promise(r=>setTimeout(r,10));assert.deepEqual((await app.operations.snapshot()).snapshot,before.snapshot);await app.operations.live(true);frame();assert.equal(app.read().physics.time,before.snapshot.time,'resume starts from the repositioned tool');}finally{await app.dispose();}
});
test('refined preview converges to the same evolved state and survives a new motion',async()=>{
 const {host,roots,frame}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:14,captureResolution:16}},record:()=>{}});
 try{roots[1].position.y=.04;frame();await new Promise(r=>setTimeout(r,550));assert.equal(app.read().surface.resolution,14);assert.equal(app.read().live.surfaceRevision,app.read().live.revision);const time=app.read().physics.time;roots[1].position.x=.04;frame();await new Promise(r=>setTimeout(r,550));assert.ok(app.read().physics.time>time);assert.equal(app.read().surface.resolution,14);assert.equal(app.read().live.surfaceRevision,app.read().live.revision);const frozen=await app.operations.freeze();assert.deepEqual(frozen.source.snapshot,(await app.operations.snapshot()).snapshot);}finally{await app.dispose();}
});

function simulatedWorker(){
 class Worker{
  static instances=[];static failSweep=false;static holdSurface=false;
  constructor(url){this.physics=String(url).includes('earth-dynamics-worker');this.kernel=this.physics?createEarthDynamicsKernel():null;this.messages=[];Worker.instances.push(this);}
  postMessage(data){this.messages.push(data);if(!this.physics&&Worker.holdSurface)return;queueMicrotask(()=>{if(this.closed)return;try{if(this.physics&&data.kind==='sweep'&&Worker.failSweep){Worker.failSweep=false;throw Error('injected physics failure');}this.onmessage({data:this.physics?{id:data.id,result:this.kernel.apply(data)}:{id:data.id,source:createEarthTeacherSource(data)}});}catch(e){this.onmessage({data:{id:data.id,error:e.message}});}});}
  terminate(){this.closed=true;this.kernel?.dispose();}
 }
 return Worker;
}
test('Stop ends queued execution while preserving observed hand samples',async()=>{
 const Saved=globalThis.Worker,Worker=simulatedWorker();globalThis.Worker=Worker;
 const {host,roots,frame}=fakeHost();let app;
 try{app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});
  for(let i=0;i<4;i++){roots[1].position.x+=.01;frame();}app.operations.stop();await new Promise(r=>setTimeout(r,60));
  const worker=Worker.instances.find(w=>w.physics);assert.equal(worker.messages.filter(m=>m.kind==='sweep').length,1,'only the in-flight physical chunk may complete');
  const saved=await app.operations.snapshot();assert.equal(saved.forming.samples.length,4);assert.equal(saved.forming.samples.filter(s=>s.disposition==='stopped').length,3);assert.equal(app.read().live.enabled,false);
 }finally{await app?.dispose();globalThis.Worker=Saved;}
});
test('New specimen recovers a failed physics worker and releases the old worker',async()=>{
 const Saved=globalThis.Worker,Worker=simulatedWorker();globalThis.Worker=Worker;
 const {host,roots,frame}=fakeHost();let app;
 try{app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});
  const old=Worker.instances.find(w=>w.physics);Worker.failSweep=true;roots[1].position.x=.02;frame();await new Promise(r=>setTimeout(r,30));assert.match(app.read().failure,/injected/);
  await app.operations.reset();assert.equal(app.read().failure,null);assert.equal(app.read().live.enabled,true);assert.equal(app.read().live.pendingSamples,0);assert.equal(old.closed,true);
  roots[1].position.x=.03;frame();await new Promise(r=>setTimeout(r,30));assert.ok(app.read().physics.time>0);
 }finally{await app?.dispose();globalThis.Worker=Saved;}assert.ok(Worker.instances.every(w=>w.closed));
});
test('Save and material edits do not strand the coarse preview',async()=>{
 const {host,roots,frame}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:18}},record:()=>{}});
 try{roots[1].position.y=.05;frame();await app.operations.snapshot();await app.operations.material({friction:.3});await new Promise(r=>setTimeout(r,100));assert.equal(app.read().surface.resolution,18);assert.equal(app.read().live.surfaceRevision,app.read().live.revision);}finally{await app.dispose();}
});
test('invalid settings and pose allocate no physics worker; failed host opening releases one',async()=>{
 const Saved=globalThis.Worker,Worker=simulatedWorker();globalThis.Worker=Worker;
 const {host}=fakeHost();
 try{await assert.rejects(workshop.create({host,inputs:{settings:{previewResolution:0}},record:()=>{}}),/Invalid/);await assert.rejects(workshop.create({host,inputs:{pose:{position:[0]}},record:()=>{}}),/Invalid/);assert.equal(Worker.instances.length,0);host.scene.open=async()=>{throw Error('host unavailable');};await assert.rejects(workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0}},record:()=>{}}),/host unavailable/);assert.ok(Worker.instances.every(w=>w.closed));}finally{globalThis.Worker=Saved;}
});

test('background time is excluded when the live tool resumes',async()=>{
 const {host,roots,frame,doc}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});
 try{doc.hidden=true;roots[1].position.x=.04;frame(60);doc.hidden=false;frame(60);assert.equal(app.read().physics.time,0);roots[1].position.x=.05;frame(1/60);await new Promise(r=>setTimeout(r,20));assert.ok(app.read().physics.time>0&&app.read().physics.time<.1,'resume must not turn the hidden interval into a long physical stroke');}finally{await app.dispose();}
});
test('a refused replacement resumes the retained healthy input queue',async()=>{
 const Saved=globalThis.Worker,Worker=simulatedWorker();globalThis.Worker=Worker;
 const {host,roots,frame}=fakeHost();let app;
 try{app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});const invalid=await app.operations.snapshot();invalid.snapshot.schema='bad';for(let i=0;i<4;i++){roots[1].position.x+=.01;frame();}await assert.rejects(app.operations.load(invalid),/schema/);await new Promise(r=>setTimeout(r,80));assert.equal(app.read().live.pendingSamples,0,'a refused load must not strand healthy prior movement');assert.equal(app.read().live.inFlight,false);}finally{await app?.dispose();globalThis.Worker=Saved;}
});


test('render inspection returns to the same retained specimen and a failed opening loses no work',async()=>{
 const {host,roots}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 try{await app.operations.advance({seconds:.02});const before=await app.operations.snapshot(),root=roots[0],open=host.scene.open;
 host.scene.open=async()=>{throw Error('injected transport opening failure');};await assert.rejects(app.operations.render({paused:true,scale:.02}),/transport opening/);assert.equal(root.visible,true);assert.deepEqual((await app.operations.snapshot()).snapshot,before.snapshot);
 host.scene.open=open;await app.operations.render({paused:true,scale:.02});assert.equal(app.read().renderPreview.active,true);assert.equal(root.visible,false);const released=new Set(),resources=new Set();for(const r of roots.slice(2))r.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)resources.add(m);});for(const r of resources)r.addEventListener('dispose',()=>released.add(r));await app.operations.returnToEarth();assert.equal(released.size,resources.size,'preview geometry and materials must release');assert.ok(root.parent,'closing inspection must not remove the retained workshop');assert.equal(root.visible,true);assert.equal(app.read().renderPreview.active,false);assert.deepEqual((await app.operations.snapshot()).snapshot,before.snapshot);
 }finally{await app.dispose();}
});


test('mounted controls do not read the disposed scene after pending surface cancellation',async()=>{
 const Saved=globalThis.Worker,Worker=simulatedWorker();globalThis.Worker=Worker;let app;
 try{const {host,roots,frame,doc}=fakeHost({strict:true});app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});await app.mount({document:doc,invoke:(name,input)=>app.operations[name](input)});Worker.holdSurface=true;roots[1].position.y=.04;frame();await app.operations.snapshot();await app.dispose();await new Promise(setImmediate);assert.ok(Worker.instances.every(w=>w.closed));
 }finally{await app?.dispose();globalThis.Worker=Saved;}
});

test('render opening rejects overlap, preserves cheap mesh and saved live intent, and return keeps the inspection camera',async()=>{
 const {host,roots}=fakeHost(),updates=[],app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:12}},record:()=>{},updateInputs:value=>updates.push(value)});
 try{const advancing=app.operations.advance({seconds:.04}),live=app.read().live.enabled;const overlapping=app.operations.render({paused:true,scale:.02});overlapping.catch(()=>{});assert.equal(app.read().live.enabled,live,'refused preview must not mutate live mode');await assert.rejects(overlapping,/worked|forming/);await advancing;const detail=app.read().surface.resolution;await app.operations.render({paused:true,scale:.02});assert.equal(app.read().surface.resolution,detail);assert.equal(updates.at(-1).live,true,'ephemeral preview pause must not become saved author intent');const session=await host.scene.open(),view={position:[2,1,3],target:[0,.1,0],fov:40};session.setView(view);await app.operations.returnToEarth();assert.deepEqual(app.read().view,view);assert.ok(roots[0].parent);await session.dispose();
 }finally{await app.dispose();}
});

test('closing waits for preview cleanup and opening cannot publish after workshop disposal',async()=>{
 const {host,roots}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}}),open=host.scene.open;
 let releaseClose,closingStarted;const closingGate=new Promise(r=>{releaseClose=r;}),started=new Promise(r=>{closingStarted=r;});host.scene.open=async()=>{const session=await open();return {...session,dispose:async()=>{closingStarted();await closingGate;await session.dispose();}};};
 try{await app.operations.render({paused:true,scale:.02});const closing=app.operations.returnToEarth();await started;assert.equal(app.read().renderPreview.active,true,'closing preview is still active until restoration');await assert.rejects(app.operations.live(true),/Return|preview/);releaseClose();await closing;
 let releaseOpen,openingStarted;const openingGate=new Promise(r=>{releaseOpen=r;}),begun=new Promise(r=>{openingStarted=r;});host.scene.open=async()=>{openingStarted();await openingGate;return open();};const opening=app.operations.render({paused:true,scale:.02});await begun;const disposal=app.dispose();releaseOpen();await disposal;await assert.rejects(opening,/disposed/);assert.ok(roots.every(root=>!root.parent),'late preview roots must be released');
 }finally{releaseClose();await app.dispose();}
});

test('frozen transport uses the authored specimen placement',async()=>{
 const {host,roots}=fakeHost(),placement={position:[.2,.1,-.1],quaternion:[0,Math.sin(.2),0,Math.cos(.2)],scale:[1.2,1.2,1.2]},app=await workshop.create({host,inputs:{pose:placement,config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 try{await app.operations.render({paused:true,scale:.02});const frozen=roots.find(r=>r.name==='Frozen worked earth');assert.deepEqual(frozen.position.toArray(),placement.position);assert.deepEqual(frozen.quaternion.toArray(),placement.quaternion);assert.deepEqual(frozen.scale.toArray(),placement.scale);await app.operations.returnToEarth();}finally{await app.dispose();}
});

test('saved authoring program includes material changes and each completed advance as well as tool input',async()=>{
 const {host,roots,frame}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 try{roots[1].position.y=.05;frame(.01);await app.operations.live(false);await app.operations.material({friction:.31});await app.operations.advance({seconds:.035});const saved=await app.operations.snapshot();assert.ok(saved.forming.program,'a complete self-contained applied program is required');assert.deepEqual(saved.forming.program.actions.map(a=>a.kind),['sweep','material','advance','advance']);assert.equal(saved.forming.program.actions[1].values.friction,.31);assert.ok(Math.abs(saved.forming.program.actions.filter(a=>a.kind==='advance').reduce((n,a)=>n+a.seconds,0)-.035)<1e-12);
 }finally{await app.dispose();}
});

test('finer replay retains the live bed and full raw history; edits invalidate its result',async()=>{
 const {host,roots,frame}=fakeHost(),app=await workshop.create({host,admitReplay:async(options,run)=>({result:await run({status:'test-admission'}),lease:{status:'test-admission'}}),inputs:{config:{columns:3,layers:2,grains:1},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 try{roots[1].position.y=.05;frame(.01);await app.operations.live(false);await app.operations.material({friction:.31});await app.operations.advance({seconds:.01});const before=await app.operations.snapshot();await app.operations.replay({columns:4,layers:3});const fine=app.operations.replayResult();assert.equal(fine.snapshot.particles.length,48);assert.deepEqual(fine.snapshot.grit.map(g=>g.radii),before.snapshot.grit.map(g=>g.radii));const after=await app.operations.snapshot();assert.deepEqual(after.snapshot,before.snapshot);assert.deepEqual(after.forming,before.forming);assert.deepEqual(fine.program,before.forming.program);assert.equal(app.read().replay.hasResult,true);await app.operations.material({friction:.4});assert.equal(app.read().replay.hasResult,false);assert.throws(()=>app.operations.replayResult(),/No current/);
 }finally{await app.dispose();}
});
test('legacy saved states remain usable without inventing a complete replay program',async()=>{
 const {host}=fakeHost(),app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{}});
 try{await app.operations.advance({seconds:.01});const saved=await app.operations.snapshot();delete saved.forming.program;await app.operations.load(saved);assert.equal(app.read().replay.available,false);await assert.rejects(app.operations.replay(),/older specimen/);await app.operations.advance({seconds:.01});assert.ok(app.read().physics.time>.019);}finally{await app.dispose();}
});

test('queued replay waits without a second physics worker and cancellation retains live authoring',async()=>{
 const {host}=fakeHost();let admitted=false;
 const app=await workshop.create({host,inputs:{config:{columns:3,layers:2,grains:0},settings:{previewResolution:8}},record:()=>{},admitReplay:async(options,run)=>{options.onWait({position:3});await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('stopped'),{name:'AbortError'})),{once:true}));admitted=true;return {result:await run({status:'test-admission'}),lease:{}};}});
 try{const before=await app.operations.snapshot();const pending=app.operations.replay();for(let i=0;i<20&&app.read().replay.status!=='waiting';i++)await new Promise(r=>setTimeout(r,5));assert.equal(app.read().replay.queuePosition,3);await assert.rejects(app.operations.material({friction:.2}),/cancel.*replay/);app.operations.replayCancel();await pending;assert.equal(admitted,false);assert.equal(app.read().replay.status,'cancelled');assert.deepEqual((await app.operations.snapshot()).snapshot,before.snapshot);await app.operations.live(true);await app.operations.advance({seconds:.01});assert.ok(app.read().physics.time>.009);}finally{await app.dispose();}
});

test('finer result has a normal viewport and teacher export while live geometry and history survive return',async()=>{
 const {host,roots}=fakeHost(),app=await workshop.create({host,admitReplay:async(options,run)=>({result:await run({status:'test-admission'}),lease:{status:'test-admission'}}),inputs:{config:{columns:3,layers:2,grains:1},settings:{previewResolution:8,captureResolution:10}},record:()=>{}});
 try{await app.operations.live(false);await app.operations.advance({seconds:.01});const before=await app.operations.snapshot();await app.operations.replay({columns:4,layers:3});await app.operations.viewReplay();assert.equal(app.read().replay.viewing,true);assert.equal(roots[1].visible,false);assert.equal(app.operations.source().config.snapshot.particles.length,48);const teacher=await app.operations.freeze();assert.equal(teacher.source.snapshot.particles.length,48);assert.equal(teacher.source.halo,1);assert.deepEqual(teacher.replay.program,before.forming.program);await app.operations.returnToLive();assert.equal(roots[1].visible,true);assert.equal(app.read().replay.viewing,false);assert.deepEqual((await app.operations.snapshot()).snapshot,before.snapshot);assert.equal(app.operations.source().config.snapshot.particles.length,18);}finally{await app.dispose();}
});
