// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
import {moveTorso} from '../experiments/creature-motion/encounters.mjs';
class Element{constructor(){this.children=[];this.style={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene();let callback,admissions=0,commits=0,allow=0;
const session={async attach(root){scene.add(root);return{id:'creature',root};},onFrame(fn){callback=fn;return()=>{callback=null;};},redraw(){},readView:()=>({}),async dispose(){scene.clear();}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const encounterContext={register:()=>()=>{},steer:()=>({direction:[1,0],distanceScale:1}),contacts:()=>[],limit({motion}){admissions++;assert.ok([...motion.pivot,...motion.translation,motion.angle].every(Number.isFinite));return{fraction:allow};},commit(){commits++;}};
const creature=await createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{blend_frames:0,action:'wander',play:false,actor_root:'live'}},{loadSources:async()=>data,encounterContext});
try{
 const before=creature.read();admissions=0;commits=0;
 creature.operations.advance({seconds:1/30});
 assert.ok(admissions>0,'The actual walking controller bypassed torso motion admission');assert.equal(commits,1);
 assert.deepEqual(creature.read().action.motion,before.action.motion,'Blocked actual controller consumed path or gait time');assert.deepEqual(creature.read().transform,before.transform,'Refused turn changed the live scene root');
 allow=1;creature.operations.advance({seconds:1/30});assert.ok(creature.read().action.motion.elapsed>before.action.motion.elapsed);
 allow=0;creature.operations.play();const held=creature.read();callback({deltaSeconds:1/30,timestampMs:200});assert.deepEqual(creature.read().action.motion,held.action.motion,'Live callback bypassed the same guard used by exact advance');
}finally{await creature.dispose();}
// Keep the source frame stationary so this observes only the commanded rigid
// root motion, including an authored tilt rather than articulated pose change.
const chest={name:'spine-chest',parent:'pelvis',restMatrix:I.map((r,i)=>r.map((v,j)=>j===3&&i===0?1:v)),tail:[1,1,0]},tilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/4);
const staticData={...data,manifest:{...data.manifest,bones:[bones[0],chest]},frame:{...data.frame,bones:[bones[0],chest]},motion:{...data.motion,joints:2,skeleton:{fps:30,jointNames:['pelvis','spine-chest'],parents:[-1,0]},positions:[0,.2,0,1,.2,0,0,.2,1,1,.2,1,0,.2,2,1,.2,2],localRotations:Array.from({length:6},()=>[1,0,0,0]).flat()}};
let predicted;
const tiltedCreature=await createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{blend_frames:0,action:'wander',play:false,actor_root:'live',transform:{position:[0,0,0],quaternion:tilt.toArray(),scale:[1,1,1]}}},{loadSources:async()=>staticData,encounterContext:{...encounterContext,steer:()=>({direction:[1,0],distanceScale:0}),limit({body,motion}){predicted=moveTorso(body,motion);return{fraction:1};}}});
try{
 tiltedCreature.operations.advance({seconds:1/30});
 const actual=tiltedCreature.operations.encounterBody();
 assert.ok(actual.capsules.length&&predicted.capsules.length);
 for(const key of ['a','b'])assert.ok(Math.hypot(...actual.capsules[0][key].map((v,i)=>v-predicted.capsules[0][key][i]))<1e-10,'Admitted support trajectory differs from the actual tilted root motion');
}finally{await tiltedCreature.dispose();}
