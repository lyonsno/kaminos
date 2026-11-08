// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneBurnFracture} from '../scene-burn-fracture.mjs';
import {createSceneBurnContact} from '../scene-burn-contact.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material),parent=new THREE.Group();
 mesh.geometry.computeBoundingBox();const prepared={cells:[{index:0}],bonds:[],pieces:[{index:0,bounds:{min:[-1,-1,-1],max:[1,1,1]}}]};
 let required=false,motion=null,disposed=0,viewDisposed=0,steps=0,contacts=true,surfaceCutout,support,gravity;
 const ground={center:[0,0,0],height:-1,radius:10,visible:true};
 const field={device:{},residentState:()=>({mesh,bounds:mesh.geometry.boundingBox,dimensions:[2,2,2],initial:new Uint32Array(8).fill(1),regionMotion:motion}),setRegionMotion:value=>{motion=value;}};
 const gate=deferred(),dynamics={matrices:{},wrapper:{},setSupport:(_i,value)=>{support=value;},setGravity:value=>{gravity=value;},setContactsEnabled:value=>{contacts=value;},advance:()=>steps++,reset:()=>{steps=0;},read:()=>({steps,gravity,contactsEnabled:contacts,finiteSupports:[support]}),snapshot:async()=>({state:dynamics.read(),supportPositions:[...support.position,0],supportCollisionMasks:[contacts?1:0]}),dispose:()=>disposed++};
 const debrisMesh={visible:true},capsMesh={visible:true},updatedTargets=[];
 const surfaceMaterial=new THREE.MeshStandardMaterial(),surfaceMesh=new THREE.Mesh(new THREE.BoxGeometry(),[surfaceMaterial]);
 const body=createSceneBurnFracture({renderer:{},field,parent,ground:()=>ground,materials:[material],
  structure:{setRequired:value=>{required=value;},resident:()=>({prepared,sourceMaterials:[material]})},debris:{caps:capsMesh,debris:debrisMesh,setRegionMotion(){}},
  createDynamics:()=>gate.promise,createSurface:options=>{surfaceCutout=options.surfaceCutout;return {mesh:surfaceMesh,bindings:[{setAppearance(){},update:(_s,displayed)=>updatedTargets.push(displayed)}],pick:async()=>null,read:()=>({}),dispose(){viewDisposed++;this.mesh.removeFromParent();}};}});
 return {body,mesh,parent,material,debrisMesh,capsMesh,surfaceMaterial,updatedTargets,gate,dynamics,ground,read:()=>({required,motion,disposed,viewDisposed,steps,contacts,surfaceCutout})};
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
assert.notEqual(live.parent.children[0].userData.kaminosEditorHelper,true,'Physical fracture surface must remain in clean captures');
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

const previousLocation=globalThis.location;
try {
 for(const [search,hash,expected]of [
  ['', '', false],
  ['?unrelated=1', '#workspace=workbench', false],
  ['?burn_fracture_cutout=1', '', true],
  ['', '#burn_fracture_cutout=1', true],
  ['?burn_fracture_cutout=1', '#burn_fracture_cutout=0', false],
 ]) {
  globalThis.location={search,hash};
  const view=fixture(),loading=view.body.configure(true);await Promise.resolve();view.gate.resolve(view.dynamics);await loading;
  assert.equal(view.read().surfaceCutout,expected,'Ordinary fracture defaults to closed regional material; cutout is explicit opt-in');
  view.body.dispose();
 }
} finally {
 if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;
}

const joined=fixture();joined.dynamics.residentMotion={};const loading=joined.body.configure(true);await Promise.resolve();joined.gate.resolve(joined.dynamics);await loading;
let resetParticipant=null;
const world=createSceneBurnContact({renderer:{backend:{device:{}}},createWorld:async()=>({read:()=>({steps:7,seconds:.1,remainder:.005,mutualContacts:true}),advance(){},synchronizeReset:participant=>{resetParticipant=participant;},dispose(){}})});
const member=joined.body.mechanicalParticipant();await world.sync([member]);
assert.equal(joined.body.read().sharedContact?.status,'live','Cold paused material must report its already-bound shared contact world before any fluid step');
joined.mesh.position.x=.6;joined.ground.visible=false;
const local=await joined.body.snapshot();assert.ok(Math.abs(local.supportPositions[0]+.6)<1e-6,'Paused native placement must update diagnostic support coordinates');assert.deepEqual(local.supportCollisionMasks,[0],'Hidden ground must be reflected in participant snapshots');
joined.body.reset();assert.equal(resetParticipant,member,'Reset must synchronize the one participant with the shared phase, not rewind other bodies');
await world.sync([]);assert.equal(joined.body.read().sharedContact,null,'Removing the shared binding must clear its diagnostic authority');world.dispose();joined.body.dispose();
