// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
import {attachGivenPalettePlayback} from '../experiments/creature-motion/given-palette-playback.mjs';

const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const small={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])};
const large={manifest:{bones:structuredClone(bones),channels:['fixed','pelvis'],vertices:4,triangles:2},rest:new Float32Array([0,0,0,2,0,0,0,2,0,2,2,0]),triangles:new Uint32Array([0,1,2,1,3,2]),weights:new Float32Array([0,1,0,1,0,1,0,1])};
const runtime=createFullBodyRuntime({THREE,...small});
assert.equal(typeof runtime.replaceSkin,'function','shared body cannot exchange a cast without replacing its actual rig and held pose');
const scene=new THREE.Scene();scene.add(runtime.group);
const group=runtime.group,mesh=runtime.mesh,bone=runtime.bones.get('pelvis'),material=mesh.material,update=runtime.update;
group.position.set(9,2,-3);group.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.3);group.scale.setScalar(1.2);
bone.position.x=2;bone.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);runtime.update();
const pose=()=>({group:[...group.position,...group.quaternion,...group.scale],bone:[...bone.position,...bone.quaternion,...bone.scale],children:group.children.map(o=>o.uuid),parent:group.parent?.uuid});
const held=pose(),old=mesh.geometry;let released=0;old.addEventListener('dispose',()=>released++);
runtime.replaceSkin(large);
assert.deepEqual(pose(),held,'cast switching must not reset actor placement or actual Bone pose');
assert.equal(runtime.group,group);assert.equal(runtime.mesh,mesh);assert.equal(runtime.bones.get('pelvis'),bone);assert.equal(mesh.material,material);assert.equal(runtime.update,update);
assert.equal(released,1,'only superseded skin geometry is released');
assert.equal(runtime.read().vertices,4);assert.equal(runtime.read().skinRevision,1);assert.equal(mesh.geometry.index.count,6);
const expected=[2,0,0,2,2,0,0,0,0,0,2,0];
assert.ok(Array.from(mesh.geometry.attributes.position.array).every((v,i)=>Math.abs(v-expected[i])<1e-6),'new topology must deform at the held pose, not show its neutral surface');
const snapshot=()=>({geometry:mesh.geometry,vertices:Array.from(mesh.geometry.attributes.position.array),state:runtime.read(),pose:pose()});
for(const [name,mutate,error] of [
 ['rest frame',d=>d.manifest.bones[0].restMatrix[0][3]=.01,/rig|frame/i],
 ['hierarchy',d=>d.manifest.bones[0].parent='other',/rig|parent/i],
 ['channel order',d=>d.manifest.channels.reverse(),/channel/i],
 ['count',d=>d.manifest.vertices=5,/array|incomplete/i],
 ['nonfinite rest',d=>d.rest[0]=NaN,/finite/i],
 ['nonfinite weights',d=>d.weights[0]=Infinity,/finite/i],
 ['negative weight',d=>d.weights[0]=-1,/weight/i],
 ['outside triangle',d=>d.triangles[0]=4,/triangle/i],
]){
 const before=snapshot(),candidate=structuredClone(large);mutate(candidate);
 assert.throws(()=>runtime.replaceSkin(candidate),error,name);
 assert.equal(mesh.geometry,before.geometry,name+' preserves the current geometry handle');
 assert.deepEqual(snapshot(),before,name+' preserves current skin and pose');
}
runtime.replaceSkin(small);assert.deepEqual(pose(),held);assert.equal(runtime.read().vertices,3);

class Element{constructor(){this.children=[];}append(...nodes){this.children.push(...nodes);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element()},adapter={frames:3,fps:30,jointNames:['pelvis'],frame(i){return {actorMatrix:new THREE.Matrix4().makeTranslation(i,0,0).toArray(),bones:[{name:'pelvis',parent:null,localMatrix:new THREE.Matrix4().toArray()}]};}};
const player=attachGivenPalettePlayback({THREE,runtime,adapter,source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)},document,mountRoot:new Element(),dirty:()=>{}});
player.seek(1);bone.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.2);runtime.update();
const playback=player.read(),manualPose=pose();runtime.replaceSkin(large);
assert.deepEqual(player.read(),playback,'skin exchange preserves frame, pause state and the edited-after-source distinction');
assert.deepEqual(pose(),manualPose,'skin exchange must not discard a manual Bone edit');
player.play();player.tick(performance.now()+1000);assert.equal(player.read().frame,2,'the same attached player continues driving the exchanged skin');
player.dispose();runtime.dispose();
assert.throws(()=>runtime.replaceSkin(small),/disposed/i);
console.log('Skin-only cast exchange preserves actual Bone handles, placement, held/manual pose and existing player; incompatible inputs preserve the prior skin');
