// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import workshop from '../experiments/earth-material.experiment.mjs';
import transport from '../experiments/earth-surface-teacher.experiment.mjs';
function fakeHost(){
 const frames=new Set(),roots=[],doc={activeElement:null,createElement:tag=>({tag,ownerDocument:doc,value:'',children:[],append(...a){this.children.push(...a);},setAttribute(k,v){this[k]=v;},addEventListener(){}})};
 let view={position:[1,1,1],target:[0,0,0],fov:40};const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
 const session={attach:async root=>{roots.push(root);scene.add(root);return {id:`object-${roots.length}`,root};},redraw(){},readView:()=>view,setView:v=>view=v,onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);},dispose:async()=>{for(const r of roots)scene.remove(r);}};
 return {roots,doc,frame:(deltaSeconds=1/60)=>{for(const fn of frames)fn({deltaSeconds,timestampMs:performance.now()});},host:{scene:{open:async()=>session,refreshPresentation(){},isVisible:()=>true,rendering:()=>({scene,camera,renderer:{getDrawingBufferSize:v=>v.set(64,48),backend:{device:{limits:{maxTextureDimension2D:4096},addEventListener(){},removeEventListener(){}}}}})},controls:{installNumberDrag:({input})=>{input.readOnly=true;return {dispose(){}};}}}};
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
