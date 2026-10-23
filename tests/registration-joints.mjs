// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {sourceJoints,jointWorldFrame,snapSourceJoint,createJointMarker} from '../registration-joints.mjs';
const joints=sourceJoints({actuators:[{id:'lift',hinge:[0,1,0],axis:[1,0,0],baseMount:[0,0,0],movingMount:[0,1,1]}]});
assert.equal(joints.length,4);assert.equal(joints[0].kind,'hinge');
const source=new T.Group();source.position.set(2,3,4);source.rotation.y=.3;source.scale.set(2,3,4);
const guess=createJointMarker({color:'#ff9933',radius:.08});guess.position.set(4,5,6);guess.rotation.set(.2,.6,.4);
const before=source.scale.toArray(),pose=snapSourceJoint(source,joints[0],guess);
source.position.fromArray(pose.position);source.rotation.set(...pose.rotation);source.scale.fromArray(pose.scale);
const actual=jointWorldFrame(source,joints[0]);
assert.ok(new T.Vector3(...actual.center).distanceTo(guess.position)<1e-10);
assert.ok(new T.Vector3(...actual.axis).dot(new T.Vector3(0,0,1).applyQuaternion(guess.quaternion))>1-1e-10);
assert.deepEqual(pose.scale,before,'snap preserves authored source scale');
assert.equal(guess.children.some(n=>n.isMesh),true,'guess has pickable geometry, not just a line');
assert.throws(()=>sourceJoints({actuators:[{id:'bad',hinge:[0,0,0],axis:[0,0,0],baseMount:[0,0,0],movingMount:[0,1,0]}]}),/axis/);
console.log('joint centers, axes, selectable markers and rigid joint snap pass');
