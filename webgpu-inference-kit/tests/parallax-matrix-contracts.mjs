// kaminos-test: node
import assert from 'node:assert/strict';
import {createParallaxPoses,captureParallaxMatrix,transformParallaxFrame} from '../src/parallax-matrix.js';
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

for(const bad of [[],[0],[0,0],[0,0,0,0],[0,NaN,0]]){
 let count=0;await failing('malformed actual vector must fail',{async read(){const s=await adapter.read();if(++count>1)s.view={...s.view,position:bad};return s;}},/view/);
}
reports.length=0;
await assert.rejects(captureParallaxMatrix({poses:poses.slice(0,1),variants:['source','learned'],adapter:{...adapter,async setView(next){if(next.position[0]===9)return;view=structuredClone(next);}}}),/restor/i);
assert.equal(reports.at(-1).status,'failed');view=structuredClone(initial);mode='source';
reports.length=0;
await assert.rejects(captureParallaxMatrix({poses:poses.slice(0,1),variants:['source','learned'],adapter:{...adapter,async setView(next){if(next.position[0]===9)throw Error('restore camera rejected');view=structuredClone(next);}}}),/restor/i);
assert.equal(mode,'source','variant restoration must still run after camera restoration throws');view=structuredClone(initial);

const world=transformParallaxFrame({center:[0,0,0],normal:[0,1,1],tangent:[1,0,0]},[1,0,0,0,0,2,0,0,0,0,1,0,4,5,6,1]);
assert.deepEqual(world.center,[4,5,6]);
const n=world.normal.map(x=>x/Math.hypot(...world.normal));
assert.ok(Math.abs(n[1]-1/Math.sqrt(5))<1e-10,'world normal must follow the transformed chart plane');
assert.ok(Math.abs(n[2]-2/Math.sqrt(5))<1e-10);

await assert.rejects(captureParallaxMatrix({poses:poses.slice(0,1),variants:['source','learned'],adapter:{...adapter,async setVariant(next){if(next==='source'&&mode==='learned')return;mode=next;}}}),/restor/i);mode='source';view=structuredClone(initial);
let captureFailed=false;
await assert.rejects(captureParallaxMatrix({poses:poses.slice(0,1),variants:['learned'],adapter:{...adapter,async capture(){captureFailed=true;throw Error('original capture failure');},async setView(next){if(captureFailed&&next.position[0]===9)throw Error('restore failure');view=structuredClone(next);}}}),/original capture failure/);
assert.match(reports.at(-1).error,/original capture failure/);assert.ok(reports.at(-1).restoreErrors.length>0);assert.equal(mode,'source');view=structuredClone(initial);
assert.throws(()=>transformParallaxFrame({center:[0,0,0],normal:[0,1,0],tangent:[1,0,0]},Array(16).fill(0)),/matrix|Singular/);
for(const key of ['position','target','up'])for(const bad of [new Array(3),[0,,0]]){
 let reads=0;await failing(`sparse ${key} must fail`,{async read(){const s=await adapter.read();if(++reads>1&&reads<4)s.view={...s.view,[key]:bad};return s;}},/view/);
}

console.log('parallax matrix contracts passed');
const {createLocalParallaxPoses}=await import('../src/parallax-matrix.js');
const local=createLocalParallaxPoses({...setup,distances:[2,4],anchors:[{id:'above',label:'Above',azimuth:90,elevation:20},{id:'below',label:'Below',azimuth:270,elevation:20}],yawOffsets:[-10,0,10],pitchOffsets:[-5,0,5]});
assert.equal(local.length,36);
assert.equal(new Set(local.map(p=>p.id)).size,36);
assert.equal(local.filter(p=>p.anchorId==='below'&&p.yawOffset===0&&p.pitchOffset===0)[0].azimuth,270);
assert.ok(local.every(p=>p.view.position.every(Number.isFinite)));
assert.throws(()=>createLocalParallaxPoses({...setup,anchors:[{id:'bad',azimuth:0,elevation:5}],yawOffsets:[0],pitchOffsets:[-10]}),/elevation/);
