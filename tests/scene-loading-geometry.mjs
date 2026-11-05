// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneLoadingGeometry} from '../scene-loading-geometry.mjs';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function fixture({waitForLighting=async()=>{},compile=async()=>{},renderLighting=null}={}){
 const rows=[],draws=[],events=[],camera=new THREE.PerspectiveCamera(),world=new THREE.Group();let current=1;
 const renderer={target:{label:'prior-target'},mrt:{label:'prior-mrt'},autoClear:false,getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},getMRT(){return this.mrt;},setMRT(value){this.mrt=value;},compileAsync:async(scene,cam)=>{events.push('compile');await compile(scene,cam);},render(scene,cam){draws.push({meshes:scene.children.flatMap(root=>root.children??[]).filter(m=>m.isMesh).map(m=>({geometry:m.geometry,matrix:m.matrixWorld.toArray(),material:m.material})),camera:cam,target:this.target,mrt:this.mrt});events.push('draw');}};
 const preview=createSceneLoadingGeometry({THREE,renderer,camera,readObjects:()=>rows,isCurrent:id=>id===current,waitForLighting,renderLighting,yieldForPaint:async()=>events.push('paint')});
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

test('a later authored-lighting frame preserves neutral first contact and stays provisional',async()=>{
 const lighting=[];const f=fixture({renderLighting:options=>{lighting.push(options);return true;}});f.add('geometry');f.add('hidden');
 assert.equal(typeof f.preview.presentLighting,'function','preview must support an authored lighting stage');
 f.preview.begin(1);await f.preview.present(1,{isVisible:id=>id!=='hidden'});
 assert.deepEqual(f.preview.read().lastPresentation.ids,['geometry'],'saved group visibility can be supplied before group admission');
 assert.equal(f.preview.read().lastPresentation.shading,'neutral-loading-preview');
 assert.equal(await f.preview.presentLighting(1,{isVisible:id=>id!=='hidden'}),true);
 assert.equal(lighting.length,1);assert.equal(lighting[0].isVisible('hidden'),false);
 const state=f.preview.read();assert.equal(state.phase,'lighting-visible');assert.equal(state.active,true);
 assert.equal(state.lastPresentation.shading,'saved-scene-lighting');assert.deepEqual(state.lastPresentation.ids,['geometry']);
 assert.equal(state.draws,2);assert.deepEqual(f.events,['compile','draw','paint','paint']);
 assert.equal(await f.preview.presentLighting(1),false,'a completed lit stage is not redrawn by the post-load callback');
 f.preview.finish(1,true);assert.equal(f.preview.read().phase,'complete');
});

test('authored lighting shares renderer ownership, rejects stale requests, and drains before disposal',async()=>{
 let enter;const gate=new Promise(resolve=>enter=resolve);let calls=0;
 const f=fixture({renderLighting:async()=>{calls++;await gate;return true;}});f.add();
 assert.equal(typeof f.preview.presentLighting,'function');
 f.preview.begin(1);const pending=f.preview.presentLighting(1);await new Promise(r=>setImmediate(r));
 let disposed=false;const done=f.preview.dispose().then(()=>disposed=true);await Promise.resolve();assert.equal(disposed,false);
 enter();await Promise.all([pending,done]);assert.equal(calls,1);assert.equal(disposed,true);
 const next=fixture({renderLighting:()=>calls++});next.add();next.preview.begin(1);next.setCurrent(2);
 assert.equal(await next.preview.presentLighting(1),false);assert.equal(calls,1,'stale lighting never acquires a draw');
});

test('a skipped lighting draw cannot masquerade as a displayed lighting frame',async()=>{
 const f=fixture({renderLighting:()=>false});f.add();f.preview.begin(1);await f.preview.present(1);
 assert.equal(await f.preview.presentLighting(1),false);
 assert.equal(f.preview.read().lastPresentation.shading,'neutral-loading-preview');
 assert.equal(f.preview.read().draws,1);
});

test('authored lighting failure is visible and does not falsely claim a lit presentation',async()=>{
 const f=fixture({renderLighting:()=>{throw Error('lighting draw rejected');}});f.add();
 assert.equal(typeof f.preview.presentLighting,'function');
 f.preview.begin(1);await f.preview.present(1);assert.equal(await f.preview.presentLighting(1),false);
 assert.equal(f.preview.read().lastPresentation.shading,'neutral-loading-preview');assert.match(f.preview.read().error,/lighting draw rejected/);
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
test('later lighting preparation waits for preview ownership, then uses its own target and restores the original state',async()=>{
 const {createLightingPreparation,compileSceneLighting}=await import('../scene-lighting-compile.mjs');
 const p=gate(),l=gate(),litScene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),draws=[];
 const prior={label:'original'},lightTarget={label:'lighting-pass'},mrt={label:'original-mrt'},context={};
 const renderer={target:prior,mrt,autoClear:false,contextNode:context,transparent:true,opaque:true,getRenderTarget(){return this.target;},setRenderTarget(v){this.target=v;},getMRT(){return this.mrt;},setMRT(v){this.mrt=v;},compileAsync:scene=>scene===litScene?l.promise:p.promise,render(){draws.push(this.target);}};
 const pass={scene:litScene,camera,renderTarget:lightTarget,_mrt:null,overrideMaterial:null,contextNode:null};
 const prep=createLightingPreparation({compile:()=>compileSceneLighting(renderer,[pass]),hold:()=>{}});
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
 const preview=createSceneLoadingGeometry({THREE,renderer,camera,readObjects:()=>[{id:'mesh',type:'glb',object:mesh}],isCurrent:()=>true,waitForLighting:prep.whenIdle,withRenderer:prep.withRenderer,yieldForPaint:async()=>{}});
 preview.begin(1);const previewTask=preview.present(1);await new Promise(r=>setImmediate(r));const lightingTask=prep.request(()=>{});await new Promise(r=>setImmediate(r));
 try{
  assert.equal(renderer.target,null,'a later preparation cannot replace the preview canvas target');
  p.resolve();await previewTask;assert.deepEqual(draws,[null],'preview actually submits to canvas');await new Promise(r=>setImmediate(r));assert.equal(renderer.target,lightTarget,'lighting acquires its own target after preview restoration');
 }finally{p.resolve();l.resolve();await Promise.allSettled([previewTask,lightingTask]);}
 assert.equal(renderer.target,prior);assert.equal(renderer.mrt,mrt);assert.equal(renderer.autoClear,false);assert.equal(renderer.contextNode,context);
});
