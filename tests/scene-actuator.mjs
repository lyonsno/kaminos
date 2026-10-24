// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from '../lib/three.core.js';
import {checkedActuator,checkedActuators,solveActuator,actuatorReach,driveLength,createActuatorController} from '../scene-actuator.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const pose=position=>({position,rotation:[0,0,0],scale:[1,1,1]});
const fixture=()=>({id:'p',label:'Piston',fixedId:'base',followerId:'boom',barrelId:'barrel',rodId:'rod',baseMount:[0,0,0],movingMount:[1,1,0],hinge:[0,1,0],axis:[0,0,1],reference:{base:pose([0,0,0]),boom:pose([0,1,0]),barrel:pose([0,0,0]),rod:pose([1,1,0])},carried:[],length:Math.sqrt(2),drive:{min:1,max:1.8,period:2,outward:.6}});
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('distance determines hinge motion and rigid barrel/rod poses, without stretching geometry',()=>{
 const r=fixture(),rest=solveActuator(r);near(rest.angle,0);
 for(const length of [1,1.2,Math.sqrt(2),1.8]){const s=solveActuator(r,length);near(new Vector3(...s.base).distanceTo(new Vector3(...s.end)),length);near(new Vector3(...s.end).distanceTo(new Vector3(...r.hinge)),1);assert.deepEqual(s.poses.rod.scale,[1,1,1]);near(s.poses.boom.position[0],0);near(s.poses.boom.position[1],1);}
});
test('same attachments work in another 3D orientation and translated/scaled base',()=>{
 const r=fixture();for(const key of ['baseMount','movingMount','hinge','axis'])r[key]=[r[key][2],r[key][0],r[key][1]];
 const out=solveActuator(r,1.3,{position:[3,-1,4],rotation:[.4,.5,.3],scale:[2,2,2]});near(new Vector3(...out.base).distanceTo(new Vector3(...out.end)),2.6);
});
test('unreachable and degenerate mechanisms refuse instead of inventing a pose',()=>{
 const r=fixture();assert.throws(()=>solveActuator(r,3),/reach/);assert.throws(()=>checkedActuator({...r,axis:[0,0,0]}),/axis/);assert.throws(()=>checkedActuator({...r,hinge:[0,0,0]}),/leverage/);assert.throws(()=>checkedActuator({...r,rodId:'barrel'}),/distinct/);assert.throws(()=>checkedActuator({...r,reference:{...r.reference,base:{...r.reference.base,scale:[1,2,1]}}}),/uniform/);
 assert.throws(()=>checkedActuators([r,{...r,id:'other'}]),/already driven/);
});
test('asymmetric drive reaches authored extrema and repeats without time truncation',()=>{
 const r=fixture();near(driveLength(r,0),1);near(driveLength(r,1.2),1.8);near(driveLength(r,2),1);near(driveLength(r,20001.2),1.8,1e-8);assert.deepEqual(actuatorReach(r),{min:0,max:2,rest:Math.sqrt(2)});
});
test('installation, hand crank, detach and saved restoration use ordinary history',async()=>{
 const r=fixture(),poses=structuredClone(r.reference);let writes=0;
 const edits=createSceneEdits({read:id=>poses[id],write:(id,p)=>poses[id]=p});
 const c=createActuatorController({edits,readPose:id=>poses[id],writePoses:out=>{Object.assign(poses,out);writes++;}});
 c.install(r);c.configure('p',{length:1.1});near(c.read()[0].length,1.1);await edits.undo();near(c.read()[0].length,r.length);await edits.redo();near(c.read()[0].length,1.1);
 const before=structuredClone(poses);assert.throws(()=>c.configure('p',{length:3}),/reach/);assert.deepEqual(poses,before);
 c.play('p');c.tick(0);near(c.state().actuators[0].length,1.1);c.tick(.4);assert.equal(c.state().running,'p');const stoppedLength=c.state().actuators[0].length;c.pause();assert.equal(c.state().running,null);near(c.read()[0].length,stoppedLength);
 const saved=c.read();c.detach('p');assert.equal(c.read().length,0);await edits.undo();assert.equal(c.read().length,1);c.restore(saved);assert.ok(writes>0);
 delete poses.rod;c.play.bind(c);assert.throws(()=>c.play('p'),/missing/);assert.equal(c.state().actuators[0].available,false);
});
function setup(){const r=fixture(),poses=structuredClone(r.reference),edits=createSceneEdits({read:id=>poses[id],write:(id,p)=>poses[id]=p});const c=createActuatorController({edits,readPose:id=>poses[id],writePoses:p=>Object.assign(poses,p)});c.install(r);return {r,poses,edits,c};}
test('an ordinary synchronous edit stops the motor before it can overwrite the accepted pose',async()=>{
 const {c,edits,poses}=setup();c.play('p');c.tick(.2);const length=c.state().actuators[0].length;
 edits.apply('boom',{position:[9,9,9]});assert.equal(c.state().running,null);c.tick(.1);assert.deepEqual(poses.boom.position,[9,9,9]);near(c.read()[0].length,length);
 await edits.undo();assert.notDeepEqual(poses.boom.position,[9,9,9]);assert.equal(edits.state().active,null);
});
test('unavailable independent mechanism does not block accepting the healthy mechanism Stop',()=>{
 const {r,c,poses}=setup(),other=structuredClone(r);other.id='p2';for(const k of ['fixedId','followerId','barrelId','rodId'])other[k]+='2';other.reference=Object.fromEntries(Object.entries(other.reference).map(([id,p])=>[id+'2',p]));Object.assign(poses,other.reference);c.install(other);delete poses.rod;
 c.play('p2');c.tick(.25);const length=c.state().actuators[1].length;c.pause();near(c.read()[1].length,length);assert.equal(c.state().running,null);assert.equal(c.state().actuators[0].available,false);c.configure('p2',{length:1.3});near(c.read()[1].length,1.3);
});
test('invalid live base refuses before opening a gesture, leaving cancellation and Undo usable',async()=>{
 const {c,edits,poses}=setup();edits.apply('base',{scale:[1,2,1]});assert.throws(()=>c.configure('p',{length:1.2}),/uniform/);assert.equal(edits.state().active,null);assert.equal(edits.cancel(),false);await edits.undo();assert.deepEqual(poses.base.scale,[1,1,1]);c.configure('p',{length:1.2});
});
test('clearing an active crank cannot resurrect the recipe through gesture cancellation',()=>{
 const {c,edits}=setup();c.scrub('p',1.2);c.clear();edits.clear();assert.deepEqual(c.read(),[]);assert.equal(edits.state().active,null);assert.equal(edits.state().undoCount,0);
});
test('provider refusal is preflighted before a crank or configuration owns history',()=>{
 const r=fixture(),poses=structuredClone(r.reference),edits=createSceneEdits({read:id=>poses[id],write:(id,p)=>poses[id]=p});let refused=false;
 const validatePoses=()=>{if(refused)throw Error('Unsupported provider');};
 const c=createActuatorController({edits,readPose:id=>poses[id],validatePoses,writePoses:p=>{validatePoses();Object.assign(poses,p);}});c.install(r);refused=true;
 assert.throws(()=>c.scrub('p',1.2),/Unsupported provider/);assert.equal(edits.state().active,null);
 assert.throws(()=>c.configure('p',{length:1.2}),/Unsupported provider/);assert.equal(edits.state().active,null);near(c.read()[0].length,r.length);
});
test('Undo during playback stops without erasing the ordinary edit Redo',async()=>{
 const {c,edits,poses}=setup();edits.apply('base',{position:[3,0,0]});c.play('p');c.tick(.2);const length=c.state().actuators[0].length;
 await edits.undo();assert.equal(c.state().running,null);near(c.read()[0].length,length);assert.equal(edits.state().redoCount,1);c.tick(.1);assert.deepEqual(poses.base.position,[0,0,0]);
 await edits.redo();assert.deepEqual(poses.base.position,[3,0,0]);assert.equal(edits.state().redoCount,0);
});
function pair(){const s=setup(),other=structuredClone(s.r);other.id='p2';for(const k of ['fixedId','followerId','barrelId','rodId'])other[k]+='2';other.reference=Object.fromEntries(Object.entries(other.reference).map(([id,p])=>[id+'2',p]));Object.assign(s.poses,other.reference);s.c.install(other);return s;}
test('Run transfer accepts the previous visible position with its own reversible Stop',async()=>{
 const {c,edits,poses,r}=pair();c.play('p');c.tick(.25);const length=c.state().actuators[0].length,live=structuredClone(poses.boom),count=edits.state().undoCount;
 c.play('p2');near(c.read()[0].length,length);assert.equal(edits.state().undoCount,count+1);c.tick(.25);c.pause();assert.deepEqual(poses.boom,live);
 await edits.undo();near(c.read()[0].length,length);await edits.undo();near(c.read()[0].length,r.length);await edits.redo();near(c.read()[0].length,length);
});
test('crank transfer settles the previous motor before the gesture, including cancel and Undo',async()=>{
 const {c,edits,poses,r}=pair();c.play('p');c.tick(.25);const length=c.state().actuators[0].length,live=structuredClone(poses.boom),count=edits.state().undoCount;
 c.scrub('p2',1.3);c.cancelScrub();assert.equal(c.state().running,null);near(c.read()[0].length,length);near(c.read()[1].length,r.length);assert.deepEqual(poses.boom,live);assert.equal(edits.state().undoCount,count+1);
 c.scrub('p2',1.3);c.finishScrub();await edits.undo();near(c.read()[0].length,length);near(c.read()[1].length,r.length);await edits.undo();near(c.read()[0].length,r.length);await edits.redo();near(c.read()[0].length,length);
});
