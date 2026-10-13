// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module;
try{module=await import('../experiments/creature-motion/given-palette-motion.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!error.message.includes('given-palette-motion.mjs'))throw error;module={};}
assert.equal(typeof module.createGivenPaletteMotion,'function','named canonical-world to source-normalized motion adapter is absent');
const rows=m=>Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>m.elements[j*4+i]));
const restRoot=new THREE.Matrix4().makeTranslation(1,4,3);
const restChild=new THREE.Matrix4().makeRotationZ(Math.PI/2);restChild.setPosition(1,6,3);
const normalization=new THREE.Matrix4().compose(new THREE.Vector3(1,2,3),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2),new THREE.Vector3(2,2,2));
const rigFrame={canonicalWorldToSourceNormalized:rows(normalization),bones:[{name:'pelvis',parent:null,restMatrix:rows(restRoot)},{name:'fore-elbow',parent:'pelvis',restMatrix:rows(restChild)}]};
const s=Math.SQRT1_2;
const motion={frames:3,joints:2,skeleton:{fps:30,jointNames:['pelvis','fore-elbow'],parents:[-1,0]},
 positions:[0,1,0,0,2,0, 1,1,0,2,1,0, 0,1,0,0,2,0],
 localRotations:[1,0,0,0,1,0,0,0, s,0,0,-s,1,0,0,0, 1,0,0,0,s,s,0,0]};
const adapter=module.createGivenPaletteMotion({THREE,motion,rigFrame});
const near=(a,b,message)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-6),message);
const identity=new THREE.Matrix4().elements;
const first=adapter.frame(0);near(first.actorMatrix,identity,'neutral source preserves actor');for(const b of first.bones)near(b.skinMatrix,identity,'neutral source preserves original bind axes');
const moved=adapter.frame(1);
near(moved.bones[0].worldMatrix.slice(12,15),[1,4,1],'root positions use the observed similarity');
near(moved.bones[1].worldMatrix.slice(12,15),[1,4,-1],'child world follows canonical positions, not raw bone deltas');
for(const b of moved.bones)near(b.skinMatrix,identity,'common root rotation/translation belongs to actor, including fixed skin');
const parent=new THREE.Matrix4().fromArray(moved.actorMatrix);
for(const b of moved.bones){const local=new THREE.Matrix4().fromArray(b.localMatrix);if(b.parent)parent.multiply(local);else parent.multiply(local);near(parent.elements,b.worldMatrix,'actual actor and local Bone chain reproduce desired world pose');}
const articulated=adapter.frame(2),child=articulated.bones[1];
const point=new THREE.Vector3(2,6,3).applyMatrix4(new THREE.Matrix4().fromArray(child.skinMatrix));near(point.toArray(),[1,5,3],'canonical rotation respects nontrivial original Bone bind axes');
assert.throws(()=>adapter.frame(-1),/frame/);assert.throws(()=>adapter.frame(3),/frame/);
const wrong=structuredClone(motion);wrong.skeleton.parents[1]=-1;assert.throws(()=>module.createGivenPaletteMotion({THREE,motion:wrong,rigFrame}),/parent|hierarchy|root/);
const changed=structuredClone(rigFrame);changed.canonicalWorldToSourceNormalized[0][0]+=1;assert.throws(()=>module.createGivenPaletteMotion({THREE,motion,rigFrame:changed}),/similarity|rigid|scale/);
console.log('Analytic given-tree conversion preserves bind axes, actor carry, articulated rotation and exact source/head correspondence');
