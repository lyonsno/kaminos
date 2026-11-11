// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import workshop from '../experiments/earth-material.experiment.mjs';
import transport from '../experiments/earth-surface-teacher.experiment.mjs';
function fakeHost(){
 const roots=[],doc={activeElement:null,createElement:tag=>({tag,ownerDocument:doc,value:'',children:[],append(...a){this.children.push(...a);},setAttribute(k,v){this[k]=v;},addEventListener(){}})};
 let view={position:[1,1,1],target:[0,0,0],fov:40};const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
 const session={attach:async root=>{roots.push(root);scene.add(root);return {id:`object-${roots.length}`,root};},redraw(){},readView:()=>view,setView:v=>view=v,onFrame:()=>()=>{},dispose:async()=>{for(const r of roots)scene.remove(r);}};
 return {roots,doc,host:{scene:{open:async()=>session,refreshPresentation(){},isVisible:()=>true,rendering:()=>({scene,camera,renderer:{getDrawingBufferSize:v=>v.set(64,48),backend:{device:{limits:{maxTextureDimension2D:4096},addEventListener(){},removeEventListener(){}}}}})},controls:{installNumberDrag:({input})=>{input.readOnly=true;return {dispose(){}};}}}};
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
 const frozen=await app.operations.freeze();assert.equal(frozen.source.halo,1);assert.deepEqual(frozen.source.snapshot,app.operations.snapshot().snapshot);await app.dispose();
});
