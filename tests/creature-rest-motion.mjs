// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRestMotion} from '../experiments/creature-motion/rest-motion.mjs';
const T=(x,y,z)=>new THREE.Matrix4().makeTranslation(x,y,z).toArray();
const adapter={frames:4,fps:30,frame(i){return {frame:i,actorMatrix:T(10+i,.7+.1*Math.sin(i),20+i),bones:[{name:'root',parent:null,localMatrix:T(0,0,0)},{name:'head',parent:'root',localMatrix:T(0,1+i*.02,0)}]};}};
const reference={frame:0,actorMatrix:T(2,.2,3),bones:[{name:'root',parent:null,localMatrix:T(0,0,0)},{name:'head',parent:'root',localMatrix:T(0,1,0)}]};
function mapped(x,z){const actor=new THREE.Matrix4().makeTranslation(x,0,z).multiply(new THREE.Matrix4().makeRotationY(Math.PI/2)).multiply(new THREE.Matrix4().makeTranslation(-2,0,-3)).multiply(new THREE.Matrix4().fromArray(reference.actorMatrix));return {...reference,actorMatrix:actor.toArray()};}
const rest=createRestMotion({THREE,adapter,sourceKey:'fixture',blendSeconds:.3,seamFrames:1}),source=mapped(5,-7);
assert.equal(rest.frame(source,reference),source,'An unused rest source must preserve the locomotion pose exactly');
rest.advance(.3,true);const a=rest.frame(source,reference);assert.equal(rest.read().weight,1);
assert.ok(Math.abs(a.bones[0].worldMatrix[12]-5)<1e-10);assert.ok(Math.abs(a.bones[0].worldMatrix[14]+7)<1e-10);
assert.ok(a.bones[0].worldMatrix[13]>.6,'Rest vertical posture must replace a held mid-gait height');
const candidate=rest.frame(mapped(9,4),reference);assert.ok(Math.abs(candidate.bones[0].worldMatrix[12]-9)<1e-10);assert.ok(Math.abs(candidate.bones[0].worldMatrix[14]-4)<1e-10,'A proposed contact pose must use its own journey placement');
assert.deepEqual(rest.frame(source,reference),a,'Repeated contact reads must not advance the rest clock');
rest.advance(.02,true);assert.notDeepEqual(rest.frame(source,reference).bones[1].localMatrix,a.bones[1].localMatrix,'Retained local Bone motion must continue during a hold');
rest.advance(.15,false);assert.ok(Math.abs(rest.read().weight-.5)<1e-10);rest.advance(.15,false);assert.equal(rest.frame(source,reference),source);
const seam=createRestMotion({THREE,adapter,sourceKey:'fixture',blendSeconds:.001,seamFrames:1});seam.advance(.1-1e-7,true);const left=seam.frame(source,reference);seam.advance(2e-7,true);const right=seam.frame(source,reference);
assert.ok(left.actorMatrix.every((v,i)=>Math.abs(v-right.actorMatrix[i])<1e-5),'Loop seam must not snap the actor');
assert.ok(left.bones.every((b,j)=>b.localMatrix.every((v,i)=>Math.abs(v-right.bones[j].localMatrix[i])<1e-5)),'Loop seam must not snap local Bones');
assert.throws(()=>rest.advance(-1,true),/elapsed/);assert.throws(()=>rest.advance(1,null),/hold/);
assert.throws(()=>createRestMotion({THREE,adapter,sourceKey:'fixture',blendSeconds:0}),/duration/);
assert.throws(()=>createRestMotion({THREE,adapter,sourceKey:'fixture',seamFrames:4}),/seam/);
const saved=rest.snapshot(),resume=()=>createRestMotion({THREE,adapter,sourceKey:'fixture',blendSeconds:.3,seamFrames:1,snapshot:saved});
assert.deepEqual(resume().read(),rest.read());
for(const patch of [{sourceKey:'other'},{weight:-.1},{weight:1.1},{elapsed:NaN},{resting:0},{blendSeconds:.4},{seamFrames:2},{schema:'other'}])assert.throws(()=>createRestMotion({THREE,adapter,sourceKey:'fixture',blendSeconds:.3,seamFrames:1,snapshot:{...saved,...patch}}),/snapshot/);
console.log('Rest uses retained local motion, continuous loops, actual journey placement and reversible blends');
