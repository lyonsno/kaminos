// kaminos-test: node
import assert from 'node:assert/strict';
import {createParallaxPoses,captureParallaxMatrix} from '../src/parallax-matrix.js';
const setup={center:[0,0,0],normal:[0,0,1],tangent:[1,0,0],distance:2,elevations:[30,60],azimuths:[0,90,180,270]};
const poses=createParallaxPoses(setup);
assert.equal(poses.length,8);
const scales=createParallaxPoses({...setup,distances:[1,2,4]});assert.equal(scales.length,24);assert.deepEqual([...new Set(scales.map(p=>p.distance))],[1,2,4]);
assert.ok(Math.abs(poses[0].view.position[0]-Math.sqrt(3))<1e-10);
assert.ok(Math.abs(poses[0].view.position[2]-1)<1e-10);
for(const pose of poses){assert.ok(Math.abs(Math.hypot(...pose.view.position)-2)<1e-10);assert.deepEqual(pose.view.target,[0,0,0]);}
assert.throws(()=>createParallaxPoses({...setup,normal:[0,0,0]}),/normal/);
assert.throws(()=>createParallaxPoses({...setup,tangent:[0,0,1]}),/tangent/);
assert.throws(()=>createParallaxPoses({...setup,elevations:[0]}),/elevation/);
assert.throws(()=>createParallaxPoses({...setup,azimuths:[]}),/azimuth/);
let view={position:[9,8,7],target:[0,0,0],up:[0,1,0]},mode='source',lights={id:'fixed'},effective=null;const initial=structuredClone(view),reports=[];
const adapter={
 async read(){return {view,variant:mode,effective:effective??mode,identity:{checkpoint:'sha256:model',source:'sha256:teacher',backend:'webgpu'},lighting:lights};},
 async setView(next){view=structuredClone(next);},async setVariant(next){mode=next;},
 async capture({pose,variant}){return {file:`${pose.id}-${variant}.png`,width:256,height:256,bytes:5};},
 async persist(report){reports.push(structuredClone(report));},
};
const result=await captureParallaxMatrix({poses,variants:['source','learned'],adapter});
assert.equal(result.status,'complete');assert.equal(result.captures.length,16);assert.deepEqual(view,initial);assert.equal(mode,'source');assert.equal(reports.at(-1).status,'complete');
const failing=async (name,changes,pattern)=>{reports.length=0;await assert.rejects(captureParallaxMatrix({poses:poses.slice(0,1),variants:['source','learned'],adapter:{...adapter,...changes}}),pattern,name);assert.equal(reports.at(-1).status,'failed',name);assert.deepEqual(view,initial,name);mode='source';lights={id:'fixed'};effective=null;};
await failing('effective fallback cannot look like learned',{async setVariant(next){mode=next;effective=next==='learned'?'source-fallback':next;}},/effective/);
await failing('camera setter must actually apply',{async setView(){}},/view/);
await failing('changing lights invalidates comparison',{async setVariant(next){mode=next;lights={id:next};}},/lighting/);
await failing('partial output must persist failure',{async capture(){throw Error('capture failure');}},/capture failure/);
await failing('blank output refused',{async capture(){return {file:'empty.png',width:0,height:0,bytes:0};}},/capture/);

await failing('identity drift between paired captures',{async read(){const state=await adapter.read();if(mode==='learned')state.identity={...state.identity,checkpoint:'other'};return state;}},/identity/);
console.log('parallax matrix contracts passed');
