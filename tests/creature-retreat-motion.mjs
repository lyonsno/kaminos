// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingPoseAdapter} from '../experiments/creature-motion/walking-pose.mjs';
import {createWanderMotion} from '../experiments/creature-motion/wander-motion.mjs';
const identity=()=>new THREE.Matrix4().toArray();
// A retained stance: the pelvis travels +Z while this foot remains planted.
const adapter={frames:5,fps:10,jointNames:['pelvis','toe'],frame(i){
 const root=new THREE.Matrix4().makeTranslation(0,.3,i).toArray(),toe=new THREE.Matrix4().makeTranslation(0,-.3,-i).toArray();
 return {actorMatrix:identity(),bones:[{name:'pelvis',parent:null,localMatrix:root,worldMatrix:root},{name:'toe',parent:'pelvis',localMatrix:toe,worldMatrix:identity()}],frame:i};
}};
const walking=createWalkingPoseAdapter({THREE,adapter,blendFrames:0});
const make=options=>createWanderMotion({THREE,adapter,walking,sourceKey:'reversible-stance',area:{center:[0,0],radii:[20,20],yaw:0},position:[0,0],direction:[0,1],...options});
const pose=m=>m.frame(m.read().frame);
const forward=m=>new THREE.Vector3(0,0,1).transformDirection(new THREE.Matrix4().fromArray(pose(m).actorMatrix));
const toe=m=>{const p=pose(m);return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(p.actorMatrix).multiply(new THREE.Matrix4().fromArray(p.bones[0].localMatrix)).multiply(new THREE.Matrix4().fromArray(p.bones[1].localMatrix)));};
const m=make();m.setDestination([0,10]);m.advance(.2);
const before={state:m.read(),pose:pose(m),toe:toe(m),forward:forward(m)};
assert.equal(typeof m.setReverse,'function','withdrawal needs a gait direction distinct from gaze direction');
m.setReverse(true);m.setDestination([0,-5]);
assert.deepEqual(m.read().path.position,before.state.path.position,'reversal cannot teleport the root');
assert.ok(forward(m).distanceTo(before.forward)<1e-9,'reversal cannot flip the body');
assert.equal(m.read().frame,before.state.frame,'reversal begins at the existing retained pose');
m.advance(.1);
assert.equal(m.read().frame,1,'backward steps reverse retained phase rather than sliding a forward-playing walk');
assert.ok(m.read().path.position[1]<before.state.path.position[1]);
assert.ok(toe(m).distanceTo(before.toe)<2e-4,`the reversed stance foot remains planted through matching travel: ${toe(m).distanceTo(before.toe)}`);
// The path lookup uses area-relative 1e-5 chord/parameter tolerance.
const restored=make({snapshot:m.snapshot()});assert.deepEqual(pose(restored),pose(m),'snapshot restores backward direction and phase');
const at=m.read().path.position,facing=forward(m);m.setReverse(false);m.setDestination([0,10]);
assert.deepEqual(m.read().path.position,at);assert.ok(forward(m).distanceTo(facing)<1e-9,'return to forward travel also preserves facing');
m.advance(.1);assert.equal(m.read().frame,2);
const wrap=make();wrap.setReverse(true);wrap.setDestination([0,-10]);wrap.advance(.1);assert.equal(wrap.read().frame,3,'reverse phase wraps lawfully through zero');
wrap.advance(100);assert.equal(wrap.read().path.status,'arrived');const stopped=wrap.snapshot();wrap.advance(1);assert.deepEqual(wrap.snapshot(),stopped,'backward arrival holds both phase and root');
assert.throws(()=>m.setReverse(1),/boolean/);
console.log('Retained reverse steps preserve facing, phase, stance travel, snapshot and arrival');

// Body assistance remains bounded and carries through checkpoint/clip changes.
const turning=make();turning.setDestination([0,10]);
const start=forward(turning),position=turning.read().path.position,phase=turning.read().phase;
turning.face([1,-5],0);assert.ok(forward(turning).distanceTo(start)<1e-12,'zero time cannot rotate the body');
turning.face([1,-5],1/60);
assert.ok(forward(turning).angleTo(start)<=4/60+1e-9,'body reacquisition has a bounded angular speed');
assert.deepEqual(turning.read().path.position,position);assert.equal(turning.read().phase,phase,'facing alone cannot advance the source stride');
for(let i=0;i<60;i++)turning.face([1,-5],1/60);
assert.ok(forward(turning).angleTo(new THREE.Vector3(1,0,-5))<=.451,'body brings the target within comfortable head reach');
const beforeSwitch=forward(turning),direction=turning.read().path.direction;
turning.setReverse(true);
assert.ok(forward(turning).distanceTo(beforeSwitch)<1e-9,'switching gait preserves the assisted body turn');
assert.deepEqual(turning.read().path.direction,direction,'already-away travel stays away when the body turns to watch');
assert.deepEqual(pose(make({snapshot:turning.snapshot()})),pose(turning),'checkpoint retains assisted facing');
assert.ok(forward(make({pathSnapshot:turning.snapshot().path,pathReverse:true,pathFacing:turning.read().facing})).distanceTo(forward(turning))<1e-9,'clip replacement retains assisted facing');
const released=forward(turning);turning.face(null,1/60);assert.ok(forward(turning).angleTo(released)<=4/60+1e-9,'watch release cannot snap the body back');
const invalid=turning.snapshot();assert.throws(()=>turning.face([NaN,0],.1),/finite/);assert.deepEqual(turning.snapshot(),invalid);
