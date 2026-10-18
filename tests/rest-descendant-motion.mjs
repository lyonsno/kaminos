// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {extendRestDescendantMotion} from '../experiments/creature-motion/rest-descendant-motion.mjs';

const rows=m=>Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>m.elements[c*4+r]));
const root=new THREE.Matrix4(),child=new THREE.Matrix4().makeTranslation(0,1,0),tip=new THREE.Matrix4().makeTranslation(0,2,0);
const original={bones:[{name:'root',parent:null,restMatrix:rows(root)},{name:'toe',parent:'root',restMatrix:rows(child)}]};
const extended={bones:[...structuredClone(original.bones),{name:'tip',parent:'toe',restMatrix:rows(tip)}]};
const actor=new THREE.Matrix4().makeTranslation(5,0,0),world=actor.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI/2));
const worldToe=world.clone().multiply(child);
const pose={frame:0,time:0,actorMatrix:actor.toArray(),bones:[{name:'root',parent:null,worldMatrix:world.toArray(),localMatrix:actor.clone().invert().multiply(world).toArray(),skinMatrix:new THREE.Matrix4().makeRotationZ(Math.PI/2).toArray()},
 {name:'toe',parent:'root',worldMatrix:worldToe.toArray(),localMatrix:child.toArray(),skinMatrix:new THREE.Matrix4().makeRotationZ(Math.PI/2).toArray()}]};
const adapter={frames:2,fps:30,jointNames:['root','toe'],frame:i=>({...structuredClone(pose),frame:i,time:i/30})};
const result=extendRestDescendantMotion({THREE,adapter,sourceFrame:original,targetFrame:extended});
assert.deepEqual(result.jointNames,['root','toe','tip']);
assert.deepEqual(result.frame(0).bones.slice(0,2),pose.bones,'all original motion matrices are preserved exactly');
const output=result.frame(0),extra=output.bones[2];
assert.deepEqual(extra.localMatrix,child.toArray());
assert.deepEqual(extra.worldMatrix,worldToe.clone().multiply(child).toArray());
assert.deepEqual(extra.skinMatrix,actor.clone().invert().multiply(worldToe).multiply(child).multiply(tip.clone().invert()).toArray());
assert.equal(result.frame(1).time,1/30);
assert.deepEqual(adapter.frame(0),pose,'source adapter is unmodified');
const changed=structuredClone(extended);changed.bones[1].restMatrix[0][3]=.1;
assert.throws(()=>extendRestDescendantMotion({THREE,adapter,sourceFrame:original,targetFrame:changed}),/base.*rest/);
const wrong=structuredClone(extended);wrong.bones[2].parent='missing';
assert.throws(()=>extendRestDescendantMotion({THREE,adapter,sourceFrame:original,targetFrame:wrong}),/descendant/);
assert.throws(()=>result.frame(2),/frame/);
console.log('rest descendants: base identity, fixed local offsets, FK and refusal checks pass');
