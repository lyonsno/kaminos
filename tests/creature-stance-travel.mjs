// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWanderMotion} from '../experiments/creature-motion/wander-motion.mjs';
import {createWalkingPoseAdapter} from '../experiments/creature-motion/walking-pose.mjs';

const names=['pelvis','head','hindlimb-left-toe','hindlimb-right-toe','forelimb-left-toe','forelimb-right-toe'];
function fixture({drift=.001,scale=1,yaw=0,feet=true}={}){
 const jointNames=feet?names:names.slice(0,2),rotation=new THREE.Matrix4().makeRotationY(yaw);
 return {frames:21,fps:10,jointNames,frame(i){
  const root=[0,.8,i*drift],points=[root,[0,1,i*drift+1]];
  for(let k=0;k<4;k++){const phase=(i+(k%2)*10)%20;points.push([k<2?-.2:.2,phase<10?0:.4,i*drift+(phase<10?.5-.1*phase:-.5+.1*(phase-10))]);}
  const bones=jointNames.map((name,k)=>{const m=new THREE.Matrix4().makeTranslation(...points[k].map(v=>v*scale)).premultiply(rotation).toArray();return {name,parent:k?'pelvis':null,worldMatrix:m,localMatrix:m};});
  return {frame:i,actorMatrix:new THREE.Matrix4().toArray(),bones};
 }};
}
const area={center:[0,0],radii:[100,100],yaw:0};
function make(adapter,options={}){return createWanderMotion({THREE,adapter,walking:createWalkingPoseAdapter({THREE,adapter,blendFrames:0}),sourceKey:'observed-test-fixture',area,position:[0,0],direction:[0,1],travel:'stance',...options});}
const adapter=fixture(),motion=make(adapter);motion.advance(.5);
assert.ok(Math.abs(motion.read().path.distance-.5)<1e-10,'In-place feet moving backward at 1 unit/s must produce 1 unit/s travel, not tiny pelvis drift');
assert.equal(motion.read().travel.kind,'derived-low-foot-backward-speed');
assert.ok(Math.abs(motion.read().sourceDistance-.02)<1e-10,'Keep the measured source drift distinct from derived travel');
const restored=make(adapter,{snapshot:motion.snapshot()});assert.deepEqual(restored.read(),motion.read());
motion.advance(4);assert.ok(Math.abs(motion.read().path.distance-4.5)<1e-9,'Delayed frames retain all derived travel');
assert.deepEqual(make(adapter,{snapshot:motion.snapshot()}).frame(motion.read().frame),motion.frame(motion.read().frame));
assert.throws(()=>make(adapter,{travel:'source',snapshot:motion.snapshot()}),/travel|policy/i,'Restoration must not silently change travel policy');
const scaled=make(fixture({scale:3,yaw:1.2}));scaled.advance(.5);assert.ok(Math.abs(scaled.read().path.distance-1.5)<1e-9,'Speed follows source scale, not world-specific constants');
assert.throws(()=>make(fixture({feet:false})),/feet|toe|stance/i,'Missing anatomical support cannot silently fall back to pelvis drift');
const original=make(adapter,{travel:'source'});original.advance(.5);assert.ok(Math.abs(original.read().path.distance-.005)<1e-10,'Original source-paced policy stays available');
const noDrift=fixture({drift:0}),stationaryWalking={frame:i=>noDrift.frame(i)};
const inPlace=createWanderMotion({THREE,adapter:noDrift,walking:stationaryWalking,sourceKey:'true-in-place',area,position:[0,0],direction:[0,1],travel:'stance'});inPlace.advance(.5);assert.ok(Math.abs(inPlace.read().path.distance-.5)<1e-10,'A real in-place gait need not invent root drift');
console.log('Stance-derived travel matches foot speed; preserves source policy, scale, continuation and explicit support failure');
