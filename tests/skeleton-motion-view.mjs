// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
let mod={};try{mod=await import('../experiments/creature-motion/skeleton.experiment.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(mod.default?.id,'marionette/skeleton-motion','retained source motions need a discoverable shared Workbench viewer');
const motion={status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',textEncoder:'browser T5',assetCondSha256:'a'.repeat(64),prompt:'A cat walks forward.',seed:1,cfgScale:3,frames:3,joints:2,skeleton:{fps:30,parents:[-1,0],jointNames:['root','hand']},positions:[0,1,0,0,0,0,0,1,1,0,0,1,0,1,2,0,0,2]};
mod.validateSkeletonMotion(motion);
assert.throws(()=>mod.validateSkeletonMotion({...motion,positions:[1]}),/positions/);
assert.throws(()=>mod.validateSkeletonMotion({...motion,skeleton:{...motion.skeleton,parents:[1,0]}}),/cycle/);
assert.equal(mod.resolveMotionURL('00/motion.json','http://local/api/read?root=caller&path=batch/view.json'),'http://local/api/read?root=caller&path=batch%2F00%2Fmotion.json');
const bytes=new TextEncoder().encode(JSON.stringify(motion)),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const fetchImpl=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer});
await assert.rejects(mod.loadSkeletonMotion({motion:'/motion',motion_sha256:'0'.repeat(64)},{fetchImpl}),/digest/);
assert.equal((await mod.loadSkeletonMotion({motion:'/motion',motion_sha256:hash},{fetchImpl})).frames,3);
class El{constructor(){this.children=[];this.style={};}append(...a){this.children.push(...a);}setAttribute(k,v){this[k]=v;}remove(){this.removed=true;}getContext(){return {fillRect(){},fillText(){}};}}
const document={createElement:()=>new El()};
function fixture(){const scene=new THREE.Scene();let cb=null;const seats=[];const session={attach:async(root,metadata)=>{scene.add(root);return {id:root.uuid,root,...metadata};},onFrame:f=>{assert.equal(cb,null);cb=f;return()=>cb=null;},redraw(){},setView(){},readView:()=>({}),dispose:async()=>{scene.clear();cb=null;}};return {scene,seats,host:{scene:{open:async()=>session,refreshPresentation(){}},controls:{document,mountObject:s=>{seats.push(s);return {dispose(){s.disposed=true;}};}}},tick:dt=>cb?.({deltaSeconds:dt}),active:()=>Boolean(cb)};}
const inputs={entries:[0,1,2].map(i=>({id:String(i),label:'Motion '+i,motion:'/m'+i,motion_sha256:hash})),play:true};
const f=fixture(),v=await mod.createSkeletonComparison({host:f.host,inputs},{loadMotion:async()=>structuredClone(motion),makeLabel:()=>null});
assert.equal(f.scene.children.length,3);f.tick(1/30);assert.deepEqual(v.read().entries.map(e=>e.frame),[1,1,1]);
v.operations.pause();assert.equal(f.active(),false);v.operations.seek({seconds:2/30});assert.equal(v.read().entries[0].frame,2);
assert.equal(v.read().entries[0].root[2],0,'in-place viewing must remove root travel without rewriting source arrays');
v.operations.presentation({mode:'raw'});assert.equal(v.read().entries[0].root[2],2);
v.operations.replay();f.tick(1);assert.equal(v.read().status,'held');assert.equal(f.active(),false);
v.mount({root:new El(),document,invoke:(name,input)=>v.operations[name](input)});assert.equal(f.seats.length,3);
const root=f.scene.children[0];root.position.x+=4;v.operations.seek({seconds:1/30});assert.equal(v.operations.setup().entries[0].position[0],root.position.x);
const saved=v.operations.setup(),g=fixture(),restored=await mod.createSkeletonComparison({host:g.host,inputs:saved},{loadMotion:async()=>structuredClone(motion),makeLabel:()=>null});assert.equal(restored.read().seconds,v.read().seconds);assert.deepEqual(restored.operations.setup().entries,saved.entries);
await restored.dispose();await v.dispose();assert.equal(f.scene.children.length,0);assert.equal(f.active(),false);assert.ok(f.seats.every(s=>s.disposed));
const rejected=fixture();await assert.rejects(mod.createSkeletonComparison({host:rejected.host,inputs},{loadMotion:async()=>({...motion,positions:[]}),makeLabel:()=>null}),/positions/);assert.equal(rejected.scene.children.length,0);
console.log('Source motion viewing: authenticated sources, all joints, shared clock/controls, placement, raw/loop, reconstruction and cleanup');
