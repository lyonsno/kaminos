// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
class Element{constructor(){this.children=[];this.style={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene();let tick;
const session={async attach(root){scene.add(root);return {id:'creature',root};},onFrame(f){tick=f;return()=>tick=null;},redraw(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),async dispose(){scene.clear();tick=null;}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I}];
const skin=()=>({manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])});
const motions=[{id:'travel',label:'Travel',motion:'travel',motion_sha256:'b'.repeat(64)},{id:'small',label:'Small travel',motion:'small',motion_sha256:'e'.repeat(64)}],choices=[{cast:'heavy',label:'Heavy',attachment:'distributed',case:'heavy',case_sha256:'a'.repeat(64)},{cast:'lean',label:'Lean',attachment:'distributed',case:'lean',case_sha256:'d'.repeat(64)}];
const loadSources=async input=>{const step=input.motion==='small'?.01:1;return {...skin(),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,step,0,.2,2*step],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:input.motion_sha256,frameSha256:'c'.repeat(64),caseSha256:input.case_sha256}};};
const entry=await createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{case:'heavy',case_sha256:'a'.repeat(64),motion:'travel',motion_sha256:'b'.repeat(64),choices,motions,blend_frames:0,radius:4,mode:'path'}},{loadSources,loadSkin:async input=>({...skin(),source:{caseSha256:input.case_sha256}})});
for(const id of ['small','travel','small']){
 await entry.operations.motion({id});assert.equal(entry.read().mode,'path');assert.equal(entry.read().source.presentation.mode,'path');assert.equal(entry.read().pathGuide.kind,'complete-circular-rail');assert.equal(entry.read().pathGuide.points,129);
 await entry.operations.skin({cast:id==='travel'?'heavy':'lean',attachment:'distributed'});assert.equal(entry.read().mode,'path');entry.operations.rate({rate:.5});entry.operations.replay();
 tick({deltaSeconds:2/30});tick({deltaSeconds:2/30});assert.equal(entry.read().cycle,1);assert.equal(entry.read().playback.status,'playing');
 entry.operations.pause();assert.equal(tick,null);entry.operations.seek({frame:1});assert.equal(entry.read().mode,'path');
}
assert.ok(entry.read().pathGuide.sourceDistance<.1,'small travel must stay source-paced, not acquire an invented speed');
await entry.dispose();assert.equal(scene.children.length,0);
console.log('Curved-path mode and full guide survive repeated motion/cast/rate/replay/seek switches, including tiny source travel');
