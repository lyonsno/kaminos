// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createLookPoseModifier} from '../experiments/creature-motion/look-pose.mjs';

const matrix = (position, rotation=[0,0,0]) => new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1));
const rows = m => Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>m.elements[c*4+r]));
const names=['chest','neck','head','head-end','leg'],parents=[null,'chest','neck','head','chest'];
function fixture(rotated=false){
 const locals=[matrix([0,0,0]),matrix([0,1,0],rotated?[.3,.2,.8]:[0,0,0]),matrix([0,1,0],rotated?[-.1,.4,-.6]:[0,0,0]),matrix([0,.4,0]),matrix([1,-1,0])];
 const actor=matrix([3,0,-2],[0,.35,0]),world=new Map();
 const bones=names.map((name,i)=>{const m=(parents[i]?world.get(parents[i]):actor).clone().multiply(locals[i]);world.set(name,m);return {name,parent:parents[i],localMatrix:locals[i].toArray(),worldMatrix:m.toArray(),skinMatrix:new THREE.Matrix4().toArray()};});
 return {pose:{actorMatrix:actor.toArray(),bones},rigFrame:{bones:names.map((name,i)=>({name,parent:parents[i],restMatrix:rows(world.get(name))}))}};
}
let placement;
const full=(pose,name)=>placement.clone().multiply(new THREE.Matrix4().fromArray(pose.bones.find(b=>b.name===name).worldMatrix));
const axis=(pose,name,v)=>new THREE.Vector3(...v).transformDirection(full(pose,name));
const position=(pose,name)=>new THREE.Vector3().setFromMatrixPosition(full(pose,name));
const alignment=(pose,target)=>axis(pose,'head',[0,0,1]).dot(target.clone().sub(position(pose,'head')).normalize());

for(const mount of [new THREE.Matrix4(),matrix([10,2,-4],[.1,.7,0]).scale(new THREE.Vector3(2,2,2))]){
placement=mount;
for(const rotated of [false,true])for(const share of [0,.4,1])for(const [right,up] of [[3,0],[-3,0],[0,3],[0,-3]]){
 const {pose,rigFrame}=fixture(rotated),before=structuredClone(pose);
 const target=position(pose,'head').add(axis(pose,'head',[0,0,1]).multiplyScalar(8)).add(axis(pose,'head',[1,0,0]).multiplyScalar(right)).add(axis(pose,'head',[0,1,0]).multiplyScalar(up));
 const look=createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:[0,0,1],up:[0,1,0],maxYaw:1,maxPitch:.7,neckShare:share});
 const out=look.apply(pose,{target:target.toArray(),placementMatrix:placement.toArray(),strength:1});
 assert.ok(alignment(out.pose,target)>alignment(pose,target)+.025,`actual muzzle direction must improve, not just report a signed angle (rotated=${rotated}, neckShare=${share})`);
 if(share===0)assert.ok(alignment(out.pose,target)>1-1e-9,'Unclamped head-only aim must actually point along the supplied direction');
 assert.deepEqual(pose,before,'aiming cannot mutate the baseline');
 for(const name of ['chest','leg'])assert.deepEqual(out.pose.bones.find(b=>b.name===name),pose.bones.find(b=>b.name===name),'chest and limb stay exactly unchanged');
 const head=out.pose.bones.find(b=>b.name==='head'),tip=out.pose.bones.find(b=>b.name==='head-end');
 const expectedTip=new THREE.Matrix4().fromArray(head.worldMatrix).multiply(new THREE.Matrix4().fromArray(tip.localMatrix));
 assert.ok(tip.worldMatrix.every((v,i)=>Math.abs(v-expectedTip.elements[i])<1e-9),'head descendants must follow the corrected head in cached world matrices');
}
}
console.log('Actual muzzle direction improves through distinct neck/head frames and all descendant world transforms stay coherent');
