// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';

test('existing dense runtime articulates a toe with a zero-influence endpoint',()=>{
 const matrix=x=>new THREE.Matrix4().makeTranslation(x,0,0).toArray();
 const rows=x=>{const a=matrix(x);return [0,1,2,3].map(i=>[a[i],a[i+4],a[i+8],a[i+12]]);};
 const bones=[{name:'wrist',parent:null,restMatrix:rows(0)},{name:'toe',parent:'wrist',restMatrix:rows(1)},{name:'toe-end',parent:'toe',restMatrix:rows(2)}];
 const rest=new Float32Array([1,0,0,2,0,0,2,1,0]);
 const runtime=createFullBodyRuntime({THREE,manifest:{vertices:3,triangles:1,bones,channels:['fixed','wrist','toe','toe-end']},rest,triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,0,1,0,0,0,1,0,0,0,1,0])});
 const read=()=>Array.from(runtime.mesh.geometry.attributes.position.array);
 assert.deepEqual(read(),Array.from(rest));
 runtime.bones.get('toe').quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);runtime.update();
 const expected=[1,0,0,1,1,0,0,1,0];read().forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-6));
 const before=read();runtime.bones.get('toe-end').quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),.4);runtime.update();assert.deepEqual(read(),before);
 runtime.dispose();
});
