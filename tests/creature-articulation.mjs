// kaminos-test: node
import assert from 'node:assert/strict';import * as THREE from 'three';
import {createCreatureArticulation} from '../experiments/creature-motion/articulation.mjs';
const group=new THREE.Group(),shoulder=new THREE.Bone(),elbow=new THREE.Bone();shoulder.name='shoulder';elbow.name='elbow';group.add(shoulder);shoulder.add(elbow);elbow.position.set(0,1,0);const bones=new Map([['shoulder',shoulder],['elbow',elbow]]);let updates=0;
const a=createCreatureArticulation({THREE,group,bones,caseSha256:'a'.repeat(64),update:()=>updates++});
a.rotate('shoulder',[0,0,90]);group.updateMatrixWorld(true);assert(elbow.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(-1,0,0))<1e-8);assert.deepEqual(elbow.position.toArray(),[0,1,0]);
const q=shoulder.quaternion.clone();a.rotate('shoulder',[0,0,90]);assert(q.angleTo(shoulder.quaternion)<1e-8,'absolute edits cannot accumulate');a.rotate('elbow',[30,0,0]);assert.deepEqual(a.read().rotations.elbow,[30,0,0]);
const saved=a.snapshot();a.neutral();assert(shoulder.quaternion.angleTo(new THREE.Quaternion())<1e-8);a.restore(saved);assert(q.angleTo(shoulder.quaternion)<1e-8);assert.deepEqual(a.snapshot(),saved);
for(const mutate of [s=>s.caseSha256='b'.repeat(64),s=>s.pose.bones.pop(),s=>s.rotations.shoulder=[NaN,0,0],s=>s.pose.bones[0].matrix[0]=2,s=>s.rotations.unknown=[0,0,0]]){const bad=structuredClone(saved);mutate(bad);assert.throws(()=>a.restore(bad));assert.deepEqual(a.snapshot(),saved,'invalid input must leave actual pose intact');}
a.captureBase('held animation frame');a.rotate('shoulder',[0,0,30]);a.resetJoint('shoulder');assert(q.angleTo(shoulder.quaternion)<1e-8,'reset returns to held source pose');assert.equal(a.read().base,'held animation frame');assert(updates>0);
console.log('Local articulation preserves offsets, follows hierarchy, resets exactly and validates snapshots transactionally');
