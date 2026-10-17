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
