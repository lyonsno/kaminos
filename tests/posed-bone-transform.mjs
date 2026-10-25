// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {boneWorldPose,applyBoneWorldPose} from '../experiments/creature-motion/posed-bone-transform.mjs';
const actor=new T.Group(),parent=new T.Bone(),joint=new T.Bone(),child=new T.Bone();actor.position.set(4,2,-1);actor.rotation.set(.2,.4,.1);actor.scale.setScalar(2);parent.position.set(1,2,0);parent.rotation.set(.3,-.5,.1);joint.position.set(0,1,0);child.position.set(0,1,0);actor.add(parent);parent.add(joint);joint.add(child);actor.updateMatrixWorld(true);
const original=boneWorldPose(joint),childLocal=child.position.clone(),next={...original,position:original.position.map((v,k)=>v+(k===0?.5:0)),rotation:[.3,.2,-.4]};
applyBoneWorldPose(joint,next);let actual=boneWorldPose(joint);assert(new T.Vector3(...actual.position).distanceTo(new T.Vector3(...next.position))<1e-8,'native world-space joint editing must resolve its rotated/scaled parent');assert(new T.Quaternion().setFromEuler(new T.Euler(...actual.rotation)).angleTo(new T.Quaternion().setFromEuler(new T.Euler(...next.rotation)))<1e-7);assert.deepEqual(child.position.toArray(),childLocal.toArray());assert(joint.scale.distanceTo(new T.Vector3(1,1,1))<1e-8);
applyBoneWorldPose(joint,original);actual=boneWorldPose(joint);assert(new T.Vector3(...actual.position).distanceTo(new T.Vector3(...original.position))<1e-8);
const before=joint.matrix.clone();assert.throws(()=>applyBoneWorldPose(joint,{...original,scale:original.scale.map(v=>v*2)}),/rigid|scale/i);joint.updateMatrix();assert.deepEqual(joint.matrix.toArray(),before.toArray(),'unsupported scale leaves prior pose intact');
console.log('Native posed joint transforms resolve world orientation/position through parent, preserve rigid descendants and reject scale transactionally');
