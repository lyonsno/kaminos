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
 assert.ok(alignment(out.pose,target)>1-1e-9,`Unclamped aim must actually point along the supplied direction (rotated=${rotated}, neckShare=${share})`);
 assert.deepEqual(pose,before,'aiming cannot mutate the baseline');
 for(const name of ['chest','leg'])assert.deepEqual(out.pose.bones.find(b=>b.name===name),pose.bones.find(b=>b.name===name),'chest and limb stay exactly unchanged');
 const head=out.pose.bones.find(b=>b.name==='head'),tip=out.pose.bones.find(b=>b.name==='head-end');
 const expectedTip=new THREE.Matrix4().fromArray(head.worldMatrix).multiply(new THREE.Matrix4().fromArray(tip.localMatrix));
 assert.ok(tip.worldMatrix.every((v,i)=>Math.abs(v-expectedTip.elements[i])<1e-9),'head descendants must follow the corrected head in cached world matrices');
}
}
// Nearby targets: rotating the neck displaces the head, so the head's share of
// the turn must aim from where the head actually ends up (review F1 fixture).
{
 const near=[matrix([0,0,0]),matrix([0,1,0]),matrix([0,0,1])],nearNames=['chest','neck','head'],nearParents=[null,'chest','neck'];
 const world=new Map(),actor=new THREE.Matrix4();
 const bones=nearNames.map((name,i)=>{const m=(nearParents[i]?world.get(nearParents[i]):actor).clone().multiply(near[i]);world.set(name,m);return {name,parent:nearParents[i],localMatrix:near[i].toArray(),worldMatrix:m.toArray(),skinMatrix:actor.toArray()};});
 const pose={actorMatrix:actor.toArray(),bones},rigFrame={bones:nearNames.map((name,i)=>({name,parent:nearParents[i],restMatrix:rows(world.get(name))}))};
 placement=new THREE.Matrix4();
 for(const target of [[.1,1,1.1],[-.1,1,1.1],[.3,1.2,1.4],[.2,.9,1.5]].map(p=>new THREE.Vector3(...p)))for(const share of [.2,.4,.7]){
  const look=createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:[0,0,1],up:[0,1,0],maxYaw:1,maxPitch:.7,neckShare:share});
  const out=look.apply(pose,{target:target.toArray(),strength:1});
  assert.ok(alignment(out.pose,target)>alignment(pose,target),`a nearby unclamped target must not turn the muzzle away (target=${target.toArray()}, neckShare=${share}, after=${alignment(out.pose,target)})`);
  assert.ok(alignment(out.pose,target)>1-1e-9,`an unclamped nearby target is reached exactly from the displaced head (target=${target.toArray()}, neckShare=${share}, after=${alignment(out.pose,target)})`);
 }
}
console.log('Actual muzzle direction improves through distinct neck/head frames and all descendant world transforms stay coherent');
// Craning recruits more neck as pitch leaves the comfortable range, while
// preserving the hard total budget and a coherent displaced-head solution.
{
 placement=new THREE.Matrix4();const {pose,rigFrame}=fixture();
 const look=createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:[0,0,1],up:[0,1,0],maxYaw:1,maxPitch:1.15,comfortablePitch:.55,neckShare:.4,craningNeckShare:.75});
 const at=pitch=>look.apply(pose,{target:position(pose,'head').add(axis(pose,'head',[0,0,1]).multiplyScalar(12*Math.cos(pitch))).add(axis(pose,'head',[0,1,0]).multiplyScalar(12*Math.sin(pitch))).toArray(),strength:1});
 const low=at(.2),high=at(.95),limit=at(1.5);
 assert.ok(high.neckShare>low.neckShare+.1,'higher aim recruits progressively more neck');
 assert.ok(high.residualAngle<.03,'reachable high aim aligns from the displaced head');
 assert.ok(limit.residualAngle>.2,'hard limit reports remaining error');
 assert.ok(Math.abs(limit.appliedPitch)<=1.15,'hard pitch budget remains bounded');
}
