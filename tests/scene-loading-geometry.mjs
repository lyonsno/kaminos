// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneLoadingGeometry} from '../scene-loading-geometry.mjs';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function fixture({waitForLighting=async()=>{},compile=async()=>{}}={}){
 const rows=[],draws=[],events=[],camera=new THREE.PerspectiveCamera(),world=new THREE.Group();let current=1;
 const renderer={target:{label:'prior-target'},mrt:{label:'prior-mrt'},autoClear:false,getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},getMRT(){return this.mrt;},setMRT(value){this.mrt=value;},compileAsync:async(scene,cam)=>{events.push('compile');await compile(scene,cam);},render(scene,cam){draws.push({meshes:scene.children.flatMap(root=>root.children??[]).filter(m=>m.isMesh).map(m=>({geometry:m.geometry,matrix:m.matrixWorld.toArray(),material:m.material})),camera:cam,target:this.target,mrt:this.mrt});events.push('draw');}};
 const preview=createSceneLoadingGeometry({THREE,renderer,camera,readObjects:()=>rows,isCurrent:id=>id===current,waitForLighting,yieldForPaint:async()=>events.push('paint')});
 const add=(id='mesh',type='glb')=>{const object=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());object.add(mesh);world.add(object);rows.push({id,type,object});return {object,mesh};};
 return {rows,draws,events,camera,renderer,preview,add,world,setCurrent:id=>current=id};
}
test('preview borrows actual geometry/world poses and the existing camera, with distinct neutral material and balanced renderer state',async()=>{
 const f=fixture(),{mesh,object}=f.add();f.world.position.set(2,3,4);object.position.x=5;mesh.rotation.y=.5;const original=mesh.material;
 const target=f.renderer.target,mrt=f.renderer.mrt;let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);original.addEventListener('dispose',()=>disposed++);
 f.preview.begin(1);assert.equal(await f.preview.present(1),true);object.updateWorldMatrix(true,true);
 const draw=f.draws[0];assert.equal(draw.camera,f.camera);assert.equal(draw.target,null);assert.equal(draw.mrt,null);assert.equal(draw.meshes[0].geometry,mesh.geometry);assert.deepEqual(draw.meshes[0].matrix,mesh.matrixWorld.toArray());assert.notEqual(draw.meshes[0].material,original);assert.equal(mesh.material,original);
 assert.equal(f.renderer.target,target);assert.equal(f.renderer.mrt,mrt);assert.equal(f.renderer.autoClear,false);assert.deepEqual(f.events,['compile','draw','paint']);
 assert.deepEqual(f.preview.read().lastPresentation.ids,['mesh']);assert.equal(f.preview.read().lastPresentation.shading,'neutral-loading-preview');
 assert.equal(await f.preview.present(1),false,'identical geometry does not cause another compile/draw');
 f.preview.finish(1,true);await f.preview.dispose();assert.equal(disposed,0,'preview never disposes borrowed geometry or authored material');
});
test('preview waits for renderer lighting ownership and refuses superseded compilation before drawing',async()=>{
 const lighting=gate(),compilation=gate();const f=fixture({waitForLighting:()=>lighting.promise,compile:()=>compilation.promise});f.add();f.preview.begin(1);const pending=f.preview.present(1);await new Promise(r=>setImmediate(r));assert.deepEqual(f.events,[]);
 lighting.resolve();await new Promise(r=>setImmediate(r));assert.deepEqual(f.events,['compile']);f.setCurrent(2);compilation.resolve();assert.equal(await pending,false);assert.deepEqual(f.draws,[]);assert.equal(f.renderer.autoClear,false);
});
test('preview excludes simulation roots, hidden objects, helpers and unsupported deforming geometry, without admitting them as shown',async()=>{
 const f=fixture();f.add('geometry');f.add('ash','retained-ash');f.add('hidden').object.visible=false;f.add('helper').mesh.userData.kaminosEditorOnly=true;f.add('dynamic').mesh.isSkinnedMesh=true;
 f.preview.begin(1);await f.preview.present(1);assert.equal(f.draws[0].meshes.length,1);assert.deepEqual(f.preview.read().lastPresentation.ids,['geometry']);assert.deepEqual(f.preview.read().unsupportedIds,['dynamic']);
});
test('optional preview failure restores renderer ownership and is recorded without rejecting final scene restoration',async()=>{
 const f=fixture({compile:async()=>{throw Error('preview pipeline unavailable');}});f.add();const target=f.renderer.target;f.preview.begin(1);assert.equal(await f.preview.present(1),false);assert.match(f.preview.read().error,/pipeline unavailable/);assert.equal(f.renderer.target,target);assert.equal(f.renderer.autoClear,false);assert.deepEqual(f.draws,[]);f.preview.finish(1,true);assert.equal(f.preview.read().phase,'complete');
});
test('finishing an older request cannot dismiss the newer preview and later geometry can replace an earlier partial preview',async()=>{
 const f=fixture();f.add('one');f.preview.begin(1);await f.preview.present(1);f.add('two');await f.preview.present(1);assert.equal(f.draws.length,2);assert.deepEqual(f.preview.read().lastPresentation.ids,['one','two']);f.setCurrent(2);f.preview.begin(2);f.preview.finish(1,true);assert.equal(f.preview.read().active,true);assert.equal(f.preview.read().requestId,2);assert.equal(await f.preview.present(1),false);
});
