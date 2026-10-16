// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module={};
try{module=await import('../experiments/creature-motion/look-pose.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof module.createLookPoseModifier,'function','neck/head aim modifier has no constructor to exercise');

// Synthetic three-Bone chain: pelvis (root) -> neck -> head. Rest frames carry
// a nontrivial rest rotation on neck, so a coherent implementation must not
// assume identity rest orientation. worldMatrix/localMatrix/skinMatrix follow
// the createGivenPaletteMotion/walking schema: worldMatrix already bakes in
// actorMatrix; placementMatrix is the remaining step to true world space.
const neckRestRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),0.05);
const restMatrices={
 pelvis:new THREE.Matrix4().identity(),
 neck:new THREE.Matrix4().compose(new THREE.Vector3(0,1,0),neckRestRotation,new THREE.Vector3(1,1,1)),
 head:new THREE.Matrix4().compose(new THREE.Vector3(0,0.5,0),new THREE.Quaternion(),new THREE.Vector3(1,1,1)),
};
const toRows=m=>{const e=m.elements;return [[e[0],e[4],e[8],e[12]],[e[1],e[5],e[9],e[13]],[e[2],e[6],e[10],e[14]],[e[3],e[7],e[11],e[15]]];};
const rigFrame={bones:[
 {name:'pelvis',parent:null,restMatrix:toRows(restMatrices.pelvis)},
 {name:'neck',parent:'pelvis',restMatrix:toRows(restMatrices.neck)},
 {name:'head',parent:'neck',restMatrix:toRows(restMatrices.head)},
]};

const actorMatrix=new THREE.Matrix4().compose(new THREE.Vector3(3,0,-2),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),0.4),new THREE.Vector3(1,1,1));
const placementMatrix=new THREE.Matrix4().compose(new THREE.Vector3(10,0,10),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2),new THREE.Vector3(2,2,2));

function buildPose({neckLocalRotation=new THREE.Quaternion(),headLocalRotation=new THREE.Quaternion()}={}) {
 const pelvisLocal=restMatrices.pelvis.clone();
 const neckLocal=restMatrices.neck.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(neckLocalRotation));
 const headLocal=restMatrices.head.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(headLocalRotation));
 const pelvisWorld=actorMatrix.clone().multiply(pelvisLocal);
 const neckWorld=pelvisWorld.clone().multiply(neckLocal);
 const headWorld=neckWorld.clone().multiply(headLocal);
 const inverseActor=actorMatrix.clone().invert();
 const skin=(world,restName)=>inverseActor.clone().multiply(world).multiply(restMatrices[restName].clone().invert());
 return {
  actorMatrix:actorMatrix.toArray(),
  bones:[
   {name:'pelvis',parent:null,localMatrix:pelvisLocal.toArray(),worldMatrix:pelvisWorld.toArray(),skinMatrix:skin(pelvisWorld,'pelvis').toArray()},
   {name:'neck',parent:'pelvis',localMatrix:neckLocal.toArray(),worldMatrix:neckWorld.toArray(),skinMatrix:skin(neckWorld,'neck').toArray()},
   {name:'head',parent:'neck',localMatrix:headLocal.toArray(),worldMatrix:headWorld.toArray(),skinMatrix:skin(headWorld,'head').toArray()},
  ],
 };
}

// pose.bones[*].worldMatrix is already actor-inclusive; only placementMatrix
// remains to reach true world space.
function fullWorldOf(pose,name){
 const bone=pose.bones.find(b=>b.name===name);
 return placementMatrix.clone().multiply(new THREE.Matrix4().fromArray(bone.worldMatrix));
}
function worldPointOf(pose,name){return new THREE.Vector3().setFromMatrixPosition(fullWorldOf(pose,name));}
function headForwardOf(pose){return new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(fullWorldOf(pose,'head'))).normalize();}
function headRightOf(pose){return new THREE.Vector3(1,0,0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(fullWorldOf(pose,'head'))).normalize();}
function headUpOf(pose){return new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(fullWorldOf(pose,'head'))).normalize();}

function makeModifier(overrides={}){
 return module.createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:[0,0,1],up:[0,1,0],maxYaw:0.6,maxPitch:0.5,neckShare:0.4,...overrides});
}

// --- target on the animated forward baseline: no correction needed ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headForwardOf(pose).multiplyScalar(5));
 const result=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.equal(result.applied,true,'an on-axis target should still be a successful, bounded application');
 assert.ok(Math.abs(result.requestedYaw)<1e-3,`requested yaw should be near zero on-axis, got ${result.requestedYaw}`);
 assert.ok(Math.abs(result.requestedPitch)<1e-3,`requested pitch should be near zero on-axis, got ${result.requestedPitch}`);
 const neckOut=result.pose.bones.find(b=>b.name==='neck'),headOut=result.pose.bones.find(b=>b.name==='head');
 assert.ok(neckOut.localMatrix.every((v,i)=>Math.abs(v-pose.bones[1].localMatrix[i])<1e-6),'on-axis target leaves neck local pose effectively unchanged');
 assert.ok(headOut.localMatrix.every((v,i)=>Math.abs(v-pose.bones[2].localMatrix[i])<1e-6),'on-axis target leaves head local pose effectively unchanged');
}

// --- baseline identity check: unmodified pose does not already turn toward a lateral target ---
{
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const sideTarget=headPoint.clone().add(headRightOf(pose).multiplyScalar(5));
 const headForward=headForwardOf(pose);
 const toSide=sideTarget.clone().sub(headPoint).normalize();
 assert.ok(headForward.dot(toSide)<0.9,'baseline fixture check: the unmodified head is not already pointed at the lateral target');
}

// --- lateral target: yaw bends toward it, within limits ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headRightOf(pose).multiplyScalar(6)).add(headForwardOf(pose).multiplyScalar(2));
 const result=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.equal(result.applied,true);
 assert.ok(Math.abs(result.requestedYaw)>0.1,`expected a material requested yaw toward the lateral target, got ${result.requestedYaw}`);
 assert.ok(Math.abs(result.appliedYaw)<=0.6+1e-6,'applied yaw must respect maxYaw');
 assert.ok(result.appliedYaw*result.requestedYaw>=0,'applied yaw should bend the same direction as the request');
}

// --- up/down target: pitch bends toward it, within limits ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const upTarget=headPoint.clone().add(headUpOf(pose).multiplyScalar(6)).add(headForwardOf(pose).multiplyScalar(2));
 const result=modifier.apply(pose,{target:upTarget.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.equal(result.applied,true);
 assert.ok(Math.abs(result.requestedPitch)>0.1,`expected a material requested pitch toward the upward target, got ${result.requestedPitch}`);
 assert.ok(Math.abs(result.appliedPitch)<=0.5+1e-6,'applied pitch must respect maxPitch');

 const downTarget=headPoint.clone().add(headUpOf(pose).multiplyScalar(-6)).add(headForwardOf(pose).multiplyScalar(2));
 const downResult=modifier.apply(pose,{target:downTarget.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.ok(downResult.requestedPitch*result.requestedPitch<0,'opposite vertical targets request opposite-signed pitch');
}

// --- comfortable-range limiting: an extreme target clamps to maxYaw/maxPitch ---
{
 const modifier=makeModifier({maxYaw:0.2,maxPitch:0.15});
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const extremeTarget=headPoint.clone().add(headRightOf(pose).multiplyScalar(50));
 const result=modifier.apply(pose,{target:extremeTarget.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.ok(Math.abs(result.requestedYaw)>0.5,'the requested yaw for a near-perpendicular target should exceed the tight limit');
 assert.ok(Math.abs(result.appliedYaw)<=0.2+1e-6,'applied yaw clamps to the configured maxYaw');
}

// --- partial strength scales the applied correction, zero strength is a no-op ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headRightOf(pose).multiplyScalar(6)).add(headForwardOf(pose).multiplyScalar(2));
 const full=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 const half=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:0.5});
 assert.ok(Math.abs(half.appliedYaw)<Math.abs(full.appliedYaw)-1e-6,'half strength must apply materially less correction than full strength');
 assert.ok(Math.abs(half.appliedYaw-full.appliedYaw*0.5)<1e-3,'strength scales the applied angle approximately linearly in this unclamped regime');

 const zero=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:0});
 assert.equal(zero.applied,false,'zero strength is a no-op, not an applied correction');
 const neckOut=zero.pose.bones.find(b=>b.name==='neck'),headOut=zero.pose.bones.find(b=>b.name==='head');
 assert.deepEqual(neckOut.localMatrix,pose.bones[1].localMatrix,'zero strength preserves the original neck local matrix exactly');
 assert.deepEqual(headOut.localMatrix,pose.bones[2].localMatrix,'zero strength preserves the original head local matrix exactly');
}

// --- null target preserves the original pose values exactly ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const result=modifier.apply(pose,{target:null,placementMatrix:placementMatrix.toArray(),strength:1});
 assert.equal(result.applied,false);
 assert.deepEqual(result.pose,pose,'a null target returns the pose unmodified');
}

// --- degenerate target too near the head: explicit non-destructive outcome ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const tooClose=headPoint.clone().add(new THREE.Vector3(1e-7,0,0));
 const result=modifier.apply(pose,{target:tooClose.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.equal(result.applied,false,'a target essentially coincident with the head must not apply an arbitrary direction');
 assert.equal(typeof result.reason,'string');
 assert.ok(result.reason.length>0);
 assert.deepEqual(result.pose,pose,'the degenerate case leaves the pose untouched');
 assert.equal(result.requestedYaw,0,'degenerate aim must not report a fabricated nonzero requested angle');
}

// --- directly-behind target (near-opposite direction) stays finite with no roll flip ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const behindTarget=headPoint.clone().add(headForwardOf(pose).multiplyScalar(-5));
 const result=modifier.apply(pose,{target:behindTarget.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.ok(Number.isFinite(result.requestedYaw)&&Number.isFinite(result.requestedPitch),'a directly-behind target must still produce finite requested angles');
 assert.ok(Number.isFinite(result.appliedYaw)&&Number.isFinite(result.appliedPitch),'a directly-behind target must still produce finite applied angles');
 for(const bone of result.pose.bones)for(const field of ['localMatrix','worldMatrix','skinMatrix'])assert.ok(bone[field].every(Number.isFinite),`${bone.name}.${field} must stay finite for a near-opposite target`);
}

// --- straight-up/down (near-parallel to up axis) target stays finite, no arbitrary roll ---
{
 const modifier=makeModifier({forward:[0,0,1],up:[0,1,0]});
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const straightUp=headPoint.clone().add(new THREE.Vector3(0,1,0).multiplyScalar(5));
 const result=modifier.apply(pose,{target:straightUp.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.ok(Number.isFinite(result.requestedYaw)&&Number.isFinite(result.requestedPitch),'a target along the up axis must still produce finite requested angles');
 for(const bone of result.pose.bones)for(const field of ['localMatrix','worldMatrix','skinMatrix'])assert.ok(bone[field].every(Number.isFinite),`${bone.name}.${field} must stay finite for a near-vertical target`);
}

// --- repeat calls with identical inputs produce identical output: no accumulated rotation ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headRightOf(pose).multiplyScalar(4));
 const first=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:0.7});
 const second=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:0.7});
 assert.deepEqual(first.pose,second.pose,'identical inputs on the pristine pose must produce identical output, not accumulation');
 // Re-aiming from the already-corrected pose recomputes a fresh bounded
 // correction relative to its own (now different) baseline; it must not
 // exceed the configured limits, which a naive additive accumulation would.
 const third=modifier.apply(first.pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:0.7});
 assert.ok(Math.abs(third.appliedYaw)<=0.6+1e-6,'repeated re-aim must stay within maxYaw rather than stacking additively past it');
}

// --- preservation of actor matrix, chest/limb-equivalent (pelvis) local transform, and hierarchy ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headRightOf(pose).multiplyScalar(4));
 const result=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 assert.deepEqual(result.pose.actorMatrix,pose.actorMatrix,'actorMatrix must be preserved exactly');
 const pelvisOut=result.pose.bones.find(b=>b.name==='pelvis');
 assert.deepEqual(pelvisOut.localMatrix,pose.bones[0].localMatrix,'the non-neck/head (chest/limb-equivalent) local transform must be preserved exactly');
 assert.deepEqual(pelvisOut.worldMatrix,pose.bones[0].worldMatrix,'the non-neck/head world matrix must be preserved exactly');
 assert.deepEqual(result.pose.bones.map(b=>b.name),pose.bones.map(b=>b.name),'bone roster/order must be preserved');
 assert.deepEqual(result.pose.bones.map(b=>b.parent),pose.bones.map(b=>b.parent),'hierarchy must be preserved');
}

// --- coherence: head's modified world/skin matrices stay consistent with its new local matrix and the neck's new world matrix ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headRightOf(pose).multiplyScalar(4));
 const result=modifier.apply(pose,{target:target.toArray(),placementMatrix:placementMatrix.toArray(),strength:1});
 const neckOut=result.pose.bones.find(b=>b.name==='neck'),headOut=result.pose.bones.find(b=>b.name==='head'),pelvisOut=result.pose.bones.find(b=>b.name==='pelvis');
 const expectedNeckWorld=new THREE.Matrix4().fromArray(pelvisOut.worldMatrix).multiply(new THREE.Matrix4().fromArray(neckOut.localMatrix));
 assert.ok(neckOut.worldMatrix.every((v,i)=>Math.abs(v-expectedNeckWorld.toArray()[i])<1e-6),'neck worldMatrix must recompose from pelvis worldMatrix and the new neck localMatrix');
 const expectedHeadWorld=new THREE.Matrix4().fromArray(neckOut.worldMatrix).multiply(new THREE.Matrix4().fromArray(headOut.localMatrix));
 assert.ok(headOut.worldMatrix.every((v,i)=>Math.abs(v-expectedHeadWorld.toArray()[i])<1e-6),'head worldMatrix must recompose from the new neck worldMatrix and the new head localMatrix');
 const inverseActor=new THREE.Matrix4().fromArray(result.pose.actorMatrix).invert();
 const expectedNeckSkin=inverseActor.clone().multiply(new THREE.Matrix4().fromArray(neckOut.worldMatrix)).multiply(restMatrices.neck.clone().invert());
 assert.ok(neckOut.skinMatrix.every((v,i)=>Math.abs(v-expectedNeckSkin.toArray()[i])<1e-5),'neck skinMatrix must stay coherent with its new worldMatrix and rest frame');
 const expectedHeadSkin=inverseActor.clone().multiply(new THREE.Matrix4().fromArray(headOut.worldMatrix)).multiply(restMatrices.head.clone().invert());
 assert.ok(headOut.skinMatrix.every((v,i)=>Math.abs(v-expectedHeadSkin.toArray()[i])<1e-5),'head skinMatrix must stay coherent with its new worldMatrix and rest frame');
}

// --- caller rig calibration mismatch: unsupported rig is reported, not silently admitted ---
{
 assert.throws(()=>module.createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'thorax',forward:[0,0,1],up:[0,1,0],maxYaw:0.5,maxPitch:0.5,neckShare:0.5}),/head|thorax|bone/i,'an unknown head Bone name must be reported, not silently admitted');
 assert.throws(()=>module.createLookPoseModifier({THREE,rigFrame,neck:'head',head:'neck',forward:[0,0,1],up:[0,1,0],maxYaw:0.5,maxPitch:0.5,neckShare:0.5}),/descend|parent|hierarchy/i,'a head Bone that does not descend from the named neck must be reported');
 assert.throws(()=>module.createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:[0,0,1],up:[0,1,0],maxYaw:-0.1,maxPitch:0.5,neckShare:0.5}),/maxYaw|nonnegative/i,'a negative yaw limit must be rejected, not clamped silently');
}

// --- Parent consumption correction (October16): retained regression cases from
// cc/mushfinger-attention-1016@5973c4772's tests/creature-look-aim-geometry.mjs.
// A richer chest -> neck -> head -> head-end / chest -> leg fixture, with
// distinct rotated neck/head local rest axes, so a shared-basis correction or
// a fix that only patches neck+head (ignoring further descendants or a true
// leg sibling) cannot pass by accident.
{
 const rows=m=>{const e=m.elements;return [[e[0],e[4],e[8],e[12]],[e[1],e[5],e[9],e[13]],[e[2],e[6],e[10],e[14]],[e[3],e[7],e[11],e[15]]];};
 const names=['chest','neck','head','head-end','leg'],parents=[null,'chest','neck','head','chest'];
 function fixture(rotated){
  const matrix=(position,rotation=[0,0,0])=>new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1));
  const locals=[matrix([0,0,0]),matrix([0,1,0],rotated?[.3,.2,.8]:[0,0,0]),matrix([0,1,0],rotated?[-.1,.4,-.6]:[0,0,0]),matrix([0,.4,0]),matrix([1,-1,0])];
  const actor=matrix([3,0,-2],[0,.35,0]),world=new Map();
  const bones=names.map((name,i)=>{const m=(parents[i]?world.get(parents[i]):actor).clone().multiply(locals[i]);world.set(name,m);return {name,parent:parents[i],localMatrix:locals[i].toArray(),worldMatrix:m.toArray(),skinMatrix:new THREE.Matrix4().toArray()};});
  return {pose:{actorMatrix:actor.toArray(),bones},rigFrame:{bones:names.map((name,i)=>({name,parent:parents[i],restMatrix:rows(world.get(name))}))}};
 }
 const placement=new THREE.Matrix4().compose(new THREE.Vector3(10,2,-4),new THREE.Quaternion().setFromEuler(new THREE.Euler(.1,.7,0)),new THREE.Vector3(1,1,1)).scale(new THREE.Vector3(2,2,2));
 const full=(pose,name)=>placement.clone().multiply(new THREE.Matrix4().fromArray(pose.bones.find(b=>b.name===name).worldMatrix));
 const axis=(pose,name,v)=>new THREE.Vector3(...v).transformDirection(full(pose,name));
 const position=(pose,name)=>new THREE.Vector3().setFromMatrixPosition(full(pose,name));
 const alignment=(pose,target)=>axis(pose,'head',[0,0,1]).dot(target.clone().sub(position(pose,'head')).normalize());

 for(const rotated of [false,true])for(const share of [0,.4,1]){
  const {pose,rigFrame}=fixture(rotated),before=structuredClone(pose);
  const target=position(pose,'head').add(axis(pose,'head',[0,0,1]).multiplyScalar(8)).add(axis(pose,'head',[1,0,0]).multiplyScalar(3));
  const look=module.createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:[0,0,1],up:[0,1,0],maxYaw:1,maxPitch:.7,neckShare:share});
  const out=look.apply(pose,{target:target.toArray(),placementMatrix:placement.toArray(),strength:1});
  assert.ok(alignment(out.pose,target)>alignment(pose,target)+.025,`actual muzzle direction must improve, not just report a signed angle (rotated=${rotated}, neckShare=${share})`);
  assert.deepEqual(pose,before,'aiming cannot mutate the baseline');
  for(const name of ['chest','leg'])assert.deepEqual(out.pose.bones.find(b=>b.name===name),pose.bones.find(b=>b.name===name),'chest and limb stay exactly unchanged');
  const head=out.pose.bones.find(b=>b.name==='head'),tip=out.pose.bones.find(b=>b.name==='head-end');
  const expectedTip=new THREE.Matrix4().fromArray(head.worldMatrix).multiply(new THREE.Matrix4().fromArray(tip.localMatrix));
  assert.ok(tip.worldMatrix.every((v,i)=>Math.abs(v-expectedTip.elements[i])<1e-9),'head descendants must follow the corrected head in cached world matrices');
 }
}

// --- reject nonfinite target and out-of-range strength rather than manufacturing finite-looking metadata ---
{
 const modifier=makeModifier();
 const pose=buildPose();
 const headPoint=worldPointOf(pose,'head');
 const target=headPoint.clone().add(headRightOf(pose).multiplyScalar(4)).toArray();
 assert.throws(()=>modifier.apply(pose,{target:[NaN,0,0],placementMatrix:placementMatrix.toArray(),strength:1}),/finite|target/i,'a nonfinite target component must be rejected, not silently coerced');
 assert.throws(()=>modifier.apply(pose,{target:[0,Infinity,0],placementMatrix:placementMatrix.toArray(),strength:1}),/finite|target/i,'an infinite target component must be rejected');
 assert.throws(()=>modifier.apply(pose,{target,placementMatrix:placementMatrix.toArray(),strength:NaN}),/finite|strength/i,'a nonfinite strength must be rejected');
 assert.throws(()=>modifier.apply(pose,{target,placementMatrix:placementMatrix.toArray(),strength:1.5}),/strength|range|\[0,\s*1\]/i,'a strength above 1 must be rejected rather than silently admitted');
 assert.throws(()=>modifier.apply(pose,{target,placementMatrix:placementMatrix.toArray(),strength:-0.1}),/strength|range|\[0,\s*1\]/i,'a negative strength must be rejected rather than silently admitted');
 const badPlacement=new Array(16).fill(0);badPlacement[0]=NaN;
 assert.throws(()=>modifier.apply(pose,{target,placementMatrix:badPlacement,strength:1}),/finite|placement/i,'a nonfinite placementMatrix must be rejected, not silently propagated into NaN geometry');
}

console.log('Look-pose aim correction stays bounded, coherent, degenerate-safe, and non-accumulating across the synthetic neck/head chain');
