// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneBurnFracture} from '../scene-burn-fracture.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material),parent=new THREE.Group();
 mesh.geometry.computeBoundingBox();const prepared={cells:[{index:0}],bonds:[],pieces:[{index:0,bounds:{min:[-1,-1,-1],max:[1,1,1]}}]};
 let required=false,motion=null,disposed=0,viewDisposed=0,steps=0,contacts=true;
 const ground={center:[0,0,0],height:-1,radius:10,visible:true};
 const field={device:{},residentState:()=>({mesh,bounds:mesh.geometry.boundingBox,dimensions:[2,2,2],initial:new Uint32Array(8).fill(1),regionMotion:motion}),setRegionMotion:value=>{motion=value;}};
 const gate=deferred(),dynamics={matrices:{},wrapper:{},setSupport(){},setGravity(){},setContactsEnabled:value=>{contacts=value;},advance:()=>steps++,read:()=>({steps}),dispose:()=>disposed++};
 const debrisMesh={visible:true},capsMesh={visible:true},updatedTargets=[];
 const surfaceMaterial=new THREE.MeshStandardMaterial(),surfaceMesh=new THREE.Mesh(new THREE.BoxGeometry(),[surfaceMaterial]);
 const body=createSceneBurnFracture({renderer:{},field,parent,ground:()=>ground,materials:[material],
  structure:{setRequired:value=>{required=value;},resident:()=>({prepared,sourceMaterials:[material]})},debris:{caps:capsMesh,debris:debrisMesh,setRegionMotion(){}},
  createDynamics:()=>gate.promise,createSurface:()=>({mesh:surfaceMesh,bindings:[{setAppearance(){},update:(_s,displayed)=>updatedTargets.push(displayed)}],pick:async()=>null,read:()=>({}),dispose(){viewDisposed++;this.mesh.removeFromParent();}})});
 return {body,mesh,parent,material,debrisMesh,capsMesh,surfaceMaterial,updatedTargets,gate,dynamics,ground,read:()=>({required,motion,disposed,viewDisposed,steps,contacts})};
}
const live=fixture(),pending=live.body.configure(true);
assert.equal(live.capsMesh.visible,false,'Cubic voxel interior caps must hide immediately when fracture is enabled, even while preparing');
assert.equal(live.debrisMesh.visible,false,'Cubic voxel debris must hide immediately when fracture is enabled, even while preparing');
await Promise.resolve();live.gate.resolve(live.dynamics);await pending;
assert.equal(live.body.active,true);
assert.equal(live.mesh.visible,true,'Replacing the presentation must retain the original collider registration');
assert.equal(live.material.visible,false,'The original surface must not render over the posed replacement');
assert.equal(live.capsMesh.visible,false,'Cubic voxel interior caps must hide while watertight fracture regions own presentation');
assert.equal(live.debrisMesh.visible,false,'Cubic voxel debris must hide while fracture regions own collapse');
live.body.update(1.5,{glow:1});
assert.equal(live.updatedTargets.at(-1),live.surfaceMaterial,'Fracture surface update must forward displayed material clones');
assert.equal(live.parent.children.length,1);assert.ok(live.read().motion);
live.body.afterSubmit({dt:1/60});assert.equal(live.read().steps,1);
live.ground.visible=false;live.body.afterSubmit({dt:1/60});assert.equal(live.read().contacts,false,'Hidden ground must not retain invisible mechanical support');
live.ground.visible=true;live.body.afterSubmit({dt:1/60});assert.equal(live.read().contacts,true);
live.mesh.scale.setScalar(2);
assert.doesNotThrow(()=>live.body.afterSubmit({dt:1/60}),'One object cannot stop the shared fluid submission loop');
assert.equal(live.body.read().status,'failed');assert.match(live.body.read().error,/scale changed/);
assert.equal(live.read().steps,3);assert.equal(live.read().disposed,0,'Failure retains the last physical state for inspection');
assert.ok(live.read().motion);assert.equal(live.parent.children.length,1);
live.body.afterSubmit({dt:1/60});assert.equal(live.read().steps,3);
live.body.configure(false);assert.equal(live.material.visible,true);assert.equal(live.capsMesh.visible,true);assert.equal(live.debrisMesh.visible,true);assert.equal(live.mesh.visible,true);assert.equal(live.read().required,false);
assert.equal(live.read().motion,null);assert.equal(live.read().disposed,1);assert.equal(live.read().viewDisposed,1);
live.body.dispose();assert.equal(live.read().disposed,1);
const cancelled=fixture(),late=cancelled.body.configure(true);await Promise.resolve();cancelled.body.configure(false);cancelled.gate.resolve(cancelled.dynamics);await late;
assert.equal(cancelled.body.active,false);assert.equal(cancelled.parent.children.length,0);assert.equal(cancelled.read().disposed,1);assert.equal(cancelled.material.visible,true);
const removed=fixture(),preparing=removed.body.configure(true);await Promise.resolve();removed.body.dispose();removed.gate.resolve(removed.dynamics);await preparing;
assert.equal(removed.read().disposed,1);assert.equal(removed.parent.children.length,0);assert.equal(removed.body.read().status,'disposed');
