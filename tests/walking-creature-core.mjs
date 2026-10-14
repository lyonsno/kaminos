// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let body={},walking={};
try{body=await import('../experiments/creature-motion/full-body-runtime.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof body.createFullBodyRuntime,'function','shared owner scene lacks the existing full-body deformer constructor');
try{walking=await import('../experiments/creature-motion/walking-pose.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof walking.createWalkingPoseAdapter,'function','generated body motion has no route-distance/heading composition');
const identity=new THREE.Matrix4().toArray();
const manifest={bones:[{name:'pelvis',parent:null,restMatrix:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],tail:[0,1,0]}],channels:['fixed','pelvis'],vertices:3,triangles:1};
const runtime=body.createFullBodyRuntime({THREE,manifest,rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])});
assert.equal(runtime.group.parent,null,'the owner host, not the deformer, mounts the scene');
runtime.bones.get('pelvis').position.x=2;runtime.update();
assert.deepEqual(Array.from(runtime.mesh.geometry.attributes.position.array),[2,0,0,3,0,0,2,1,0]);
const geometry=Array.from(runtime.mesh.geometry.attributes.position.array);
runtime.group.position.z=4;runtime.update();assert.deepEqual(Array.from(runtime.mesh.geometry.attributes.position.array),geometry,'actor travel is not duplicated into skin geometry');
const adapter={frames:3,fps:30,jointNames:['pelvis'],frame(i){const actor=new THREE.Matrix4().makeTranslation(0,.2,i).toArray();return {frame:i,actorMatrix:actor,bones:[{name:'pelvis',parent:null,localMatrix:identity,worldMatrix:actor,skinMatrix:identity}]};}};
const walk=walking.createWalkingPoseAdapter({THREE,adapter,radius:4,blendFrames:0});
assert.deepEqual(walk.frame(2,{mode:'source'}),adapter.frame(2),'raw comparator remains exact');
const pose=walk.frame(2,{mode:'path',cycle:1});
assert.ok(Math.abs(pose.actorMatrix[12]-4*(1-Math.cos(1)))<1e-9);
assert.ok(Math.abs(pose.actorMatrix[14]-4*Math.sin(1))<1e-9);
assert.equal(pose.actorMatrix[13],.2,'path steering preserves vertical body action');
assert.deepEqual(pose.bones[0].localMatrix,identity,'path placement does not alter the local articulation');
const end=walk.frame(2,{mode:'path',cycle:0}),next=walk.frame(0,{mode:'path',cycle:1});
assert.ok(end.actorMatrix.every((v,i)=>Math.abs(v-next.actorMatrix[i])<1e-9),'route travel remains continuous at repeat boundary');
assert.throws(()=>walk.frame(0,{mode:'unknown'}),/mode/);
assert.throws(()=>walking.createWalkingPoseAdapter({THREE,adapter,radius:0}),/radius/);
const blended=walking.createWalkingPoseAdapter({THREE,adapter,radius:4,blendFrames:2});
assert.equal(blended.identity.seam.kind,'derived-pose-crossfade');
assert.deepEqual(blended.frame(2,{mode:'source'}),adapter.frame(2),'enabling seam experiment does not rewrite the raw source');
console.log('Owned full-body transport and source-paced route composition preserve actor/articulation separation');
