// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
import {attachGivenPalettePlayback} from '../experiments/creature-motion/given-palette-playback.mjs';

// A per-actor pose modifier runs after the source pose is on the Bones and
// before deformation: the skin shows the modified pose, the modifier sees the
// unmodified one, and restoring the starting pose bypasses it.
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const skin={manifest:{bones:[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}],channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])};
const runtime=createFullBodyRuntime({THREE,...skin}),scene=new THREE.Scene();scene.add(runtime.group);
class Element{constructor(){this.children=[];}append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element()};
const adapter={frames:3,fps:30,jointNames:['pelvis'],frame(i){return {actorMatrix:new THREE.Matrix4().makeTranslation(i,0,0).toArray(),bones:[{name:'pelvis',parent:null,localMatrix:new THREE.Matrix4().toArray()}]};}};
const calls=[];let clock=0,fail=false;
const turn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
const poseModifier=({bones,group,time})=>{
 const bone=bones.get('pelvis');calls.push({time,base:bone.quaternion.clone(),groupX:group.matrixWorld.elements[12]});
 if(fail)throw Error('modifier failed');
 bone.quaternion.copy(turn);
};
const player=attachGivenPalettePlayback({THREE,runtime,adapter,source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)},document,mountRoot:new Element(),dirty:()=>{},now:()=>clock,poseModifier});
assert.equal(calls.length,1,'the initial source pose is offered to the modifier');
clock=500;player.seek(1);
const last=calls.at(-1);
assert.equal(last.time,.5,'modifier receives the playback clock in seconds');
assert.ok(last.base.angleTo(new THREE.Quaternion())<1e-9,'modifier sees the unmodified source pose');
assert.equal(last.groupX,1,'world matrices are current before the modifier runs');
const vertex=Array.from((runtime.syncCpuGeometry?.()??runtime.mesh.geometry).attributes.position.array.slice(3,6));
assert.ok(Math.abs(vertex[0])<1e-6&&Math.abs(vertex[1]-1)<1e-6,`deformation consumes the modified pose in the body frame (${vertex})`);
const count=calls.length;player.restore();
assert.equal(calls.length,count,'restoring the starting pose bypasses the modifier');
fail=true;assert.throws(()=>player.seek(2),/modifier failed/);
assert.ok(runtime.bones.get('pelvis').quaternion.angleTo(new THREE.Quaternion())<1e-9,'a failed modifier rolls back to the prior pose');
player.dispose();runtime.dispose();
console.log('Pose modifier runs between source pose and deformation, sees the base pose, and is bypassed by restore');
