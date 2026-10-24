// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
class Element {constructor(){this.children=[];this.style={};}append(...xs){this.children.push(...xs);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element(),getElementById:()=>null};
const scene=new THREE.Scene();let tick=null,calls=0,hold=true,invalid=false,received;
const session={async attach(root){scene.add(root);return {id:root.uuid,root,owned:true};},onFrame(fn){assert.equal(tick,null);tick=fn;return ()=>tick=null;},redraw(){},readView:()=>({}),async dispose(){scene.clear();tick=null;}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
let destination=[6,0,4];
const steering={update(context){calls++;received=context;return invalid?{hold:false,destination:[NaN,0,0]}:{source:'game-test',hold,destination};},read:()=>({source:'game-test',hold})};
const entry=await createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{blend_frames:1,radius:20,transform:{position:[4,0,0],quaternion:[0,0,0,1],scale:[2,2,2]}}},{loadSources:async()=>data,steering});
await entry.operations.action({kind:'wander'});
const before=entry.read().action.motion.path.position;
tick({deltaSeconds:1/30});
assert.ok(calls>0,'The walking owner ignores game steering instead of consuming it on its shared clock');
assert.deepEqual(entry.read().action.motion.path.position,before,'A held game task must hold locomotion');
assert.deepEqual(received.position,[4,0,0],'Steering position must use the authored world frame');
assert.deepEqual(entry.read().recipe.wander.motion.path.destination,[1,2],'World goal must be transformed once into actor placement');
hold=false;tick({deltaSeconds:1/30});assert.ok(entry.read().action.motion.path.distance>0);
destination=[3.9,0,4];tick({deltaSeconds:1/30});assert.deepEqual(entry.read().recipe.wander.motion.path.destination,[-.05,2].map((v,i)=>i===0?(3.9-4)/2:v));
invalid=true;assert.throws(()=>tick({deltaSeconds:1/30}),/steering/i);assert.equal(tick,null,'Malformed intent must stop the owner clock');
assert.equal(entry.read().playback.status,'paused');
await entry.dispose();assert.equal(scene.children.length,0);
console.log('Game steering uses the actual shared clock, world frame, gait hold and failure cleanup');
