// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingPoseAdapter} from '../experiments/creature-motion/walking-pose.mjs';
let feature={};try{feature=await import('../experiments/creature-motion/wander-motion.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof feature.createWanderMotion,'function','Wander must consume the actual retained pose and source root distance');
const identity=()=>new THREE.Matrix4().toArray();
const adapter={frames:4,fps:10,jointNames:['pelvis'],frame(i){const m=new THREE.Matrix4().makeTranslation(0,.3,i).toArray();return {actorMatrix:identity(),bones:[{name:'pelvis',parent:null,localMatrix:m,worldMatrix:m}],frame:i};}};
const walking=createWalkingPoseAdapter({THREE,adapter,blendFrames:1});
const area={center:[0,0],radii:[10,8],yaw:0};
const make=options=>feature.createWanderMotion({THREE,adapter,walking,sourceKey:'fixture-motion-v1',...options});
const motion=make({area,position:[2,3],direction:[0,1],seed:22});
const position=pose=>new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.actorMatrix).multiply(new THREE.Matrix4().fromArray(pose.bones[0].localMatrix))).toArray();
const start=position(motion.frame(0));assert.ok(Math.abs(start[0]-2)<1e-9&&Math.abs(start[2]-3)<1e-9);
motion.advance(.1);const first=motion.read();assert.equal(first.frame,1);assert.equal(first.path.distance,1);
assert.equal(position(motion.frame(first.frame))[1],.3,'Wander must preserve source vertical action');
motion.advance(2.3);assert.equal(motion.read().cycle,8,'A delayed host callback must not drop complete gait cycles');
assert.ok(Math.abs(motion.read().path.distance-24)<1e-8,'Movement must retain the source distance of all cycles');
const snapshot=motion.snapshot(),restored=make({snapshot});
assert.deepEqual(restored.frame(restored.read().frame),motion.frame(motion.read().frame));
const before=motion.read().path.position;motion.seek(2);assert.deepEqual(motion.read().path.position,before,'Pose scrubbing must not teleport the root');
const areaRoot=new THREE.Group();areaRoot.position.set(5,0,7);areaRoot.rotation.y=.7;areaRoot.scale.set(8,1,4);areaRoot.updateMatrixWorld(true);
const placement=new THREE.Group();placement.scale.set(2,1,3);placement.rotation.y=.3;placement.position.set(1,0,2);placement.updateMatrixWorld(true);
const projected=feature.wanderAreaInPlacement({THREE,areaRoot,placement});
for(let i=0;i<100;i++){const angle=i/100*Math.PI*2,p=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)).applyMatrix4(areaRoot.matrixWorld);placement.worldToLocal(p);const x=p.x-projected.center[0],z=p.z-projected.center[1],c=Math.cos(projected.yaw),s=Math.sin(projected.yaw);assert.ok(Math.abs(((c*x+s*z)/projected.radii[0])**2+((-s*x+c*z)/projected.radii[1])**2-1)<1e-8,'The editable scene area must preserve its actual projected footprint');}
assert.throws(()=>motion.advance(-1),/time|delta/i);
assert.throws(()=>feature.createWanderMotion({THREE,adapter,walking,sourceKey:'different-motion',snapshot}),/source/i);
const source30={...adapter,frames:260,fps:30},walking30=createWalkingPoseAdapter({THREE,adapter:source30,blendFrames:6});
const boundary=feature.createWanderMotion({THREE,adapter:source30,walking:walking30,sourceKey:'260x30-boundary',area,position:[0,0],direction:[0,1]});
boundary.advance(2*(259/30)-9/30);
for(let i=0;i<20;i++){assert.equal(boundary.read().frame,(250+i)%259,'Exact source-time steps skip or duplicate a source frame');if(i<19)boundary.advance(1/30);}
console.log('Wander transports source-paced actual poses, retains elapsed cycles and respects the editable area footprint');

const arriving=make({area,position:[0,0],direction:[0,1],seed:3});
arriving.setDestination([2,2]);arriving.advance(10);
assert.equal(arriving.read().path.status,'arrived');
const stopped=arriving.read();arriving.advance(5);
assert.ok(Math.abs(arriving.read().elapsed-stopped.elapsed)<1e-9,'Arrived root must hold the retained gait clock');
assert.equal(arriving.read().frame,stopped.frame);
arriving.setDestination(null);arriving.advance(.1);assert.ok(arriving.read().elapsed>stopped.elapsed);
const yielding=make({area,position:[0,0],direction:[0,1],seed:3});
yielding.advance(.1,{distanceScale:0});assert.equal(yielding.read().elapsed,0,'blocked travel must hold gait, not march in place');assert.equal(yielding.read().path.distance,0);
yielding.advance(.1,{distanceScale:.25});assert.ok(Math.abs(yielding.read().elapsed-.025)<1e-10);assert.ok(Math.abs(yielding.read().path.distance-.25)<1e-9);
const beforeSteer=yielding.read().path.position;yielding.advance(0,{direction:[1,0]});assert.deepEqual(yielding.read().path.position,beforeSteer,'steering cannot teleport the root');assert.ok(yielding.read().path.direction[0]>.999);
assert.throws(()=>yielding.advance(.1,{distanceScale:NaN}),/scale/);
const plain=make({area,position:[0,0],direction:[0,1],seed:1}),unchanged=make({snapshot:plain.snapshot()});
for(let i=0;i<30;i++){plain.advance(.003);unchanged.advance(.003,{direction:unchanged.read().path.direction});}
assert.deepEqual(unchanged.snapshot(),plain.snapshot(),'An unchanged steering heading must preserve curve, distance and RNG exactly');
const protectedMotion=make({area,position:[0,0],direction:[0,1],seed:4}),priorProtected=protectedMotion.snapshot();let checks=0;
protectedMotion.advance(.1,{direction:[1,0],admit:()=>{checks++;return 0;}});
assert.ok(checks>0,'Wander must submit proposed root motion before applying it');
assert.deepEqual(protectedMotion.snapshot(),priorProtected,'Refused motion preserves phase, placement, path and RNG');
const free=make({snapshot:priorProtected}),admitted=make({snapshot:priorProtected});
free.advance(.05,{direction:[1,0]});admitted.advance(.05,{direction:[1,0],admit:()=>1});assert.deepEqual(admitted.snapshot(),free.snapshot());
const rotating=make({snapshot:priorProtected});let proposedAngle;rotating.advance(.1,{direction:[1,0],admit:({from,to,turnOnly})=>{if(turnOnly)proposedAngle=Math.atan2(from.direction[0]*to.direction[1]-from.direction[1]*to.direction[0],from.direction[0]*to.direction[0]+from.direction[1]*to.direction[1]);return turnOnly?.5:0;}});
assert.equal(rotating.read().elapsed,priorProtected.elapsed,'Blocked travel holds gait while a safe partial turn remains possible');
assert.ok(Math.abs(rotating.read().path.direction[0]+Math.sin(proposedAngle*.5))<1e-9);assert.deepEqual(rotating.read().path.position,[0,0]);

const freePhysical=make({area,position:[0,0],direction:[0,1],seed:22}),identityPhysical=make({snapshot:freePhysical.snapshot()});
for(let i=0;i<90;i++){
 freePhysical.advance(.01);const before=identityPhysical.snapshot(),proposed=identityPhysical.advance(.01);
 identityPhysical.contact(before,{position:proposed.path.position,direction:proposed.path.direction});
 assert.deepEqual(identityPhysical.snapshot(),freePhysical.snapshot(),'Physical feedback reshaped an unobstructed source-paced route');
}

// Contact can stop or shove the root after the proposed path has arrived.
// Its exhausted subcurve has no tangent left, so the residual return journey
// must explicitly retain the accepted heading, including after restoration.
const endpoint=make({area,position:[0,0],direction:[0,1],seed:123});
endpoint.setDestination([2,2]);const beforeEndpoint=endpoint.snapshot();
endpoint.advance(1);assert.equal(endpoint.read().path.status,'arrived');
endpoint.contact(beforeEndpoint,{position:[2.02,2],direction:[0,1]});
const endpointSnapshot=endpoint.snapshot();
for(const continuation of [endpoint,make({snapshot:endpointSnapshot})]){
 const next=continuation.advance(.00001).path;
 assert.ok(next.direction[1]>.99,'Endpoint correction discarded accepted heading on next nonzero advance');
 assert.ok(next.position[1]>2,'Residual journey must initially move along the accepted heading');
 assert.deepEqual(next.target,[2,2],'Contact must preserve the selected destination');
 continuation.advance(1);assert.equal(continuation.read().path.status,'arrived');
}
