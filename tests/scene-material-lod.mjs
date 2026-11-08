import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneMaterials,materialSlots} from '../scene-material-recipes.mjs';
import {createSceneBeautyLodController} from '../scene-lod-budget.mjs';
const recipe={id:'finish',name:'Copper',implementation:'standard-surface',version:1,parameters:{color:'#aa5533',roughness:.23,metalness:.8}};
const definitions=[{id:'standard-surface',version:1,check:p=>p,create:({base,parameters})=>{const material=base.clone();const update=p=>{material.color.set(p.color);material.roughness=p.roughness;material.metalness=p.metalness;};update(parameters);return {material,update,dispose:()=>material.dispose()};}}];
test('only canonical source slots are authorable while an LOD or editor helper is present',()=>{
 const root=new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
 for(const flag of ['kaminosBeautyLodProxy','kaminosEditorHelper','kaminosEditorOnly','kaminosRepetitionCopy']){const helper=new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));helper.userData[flag]=true;root.add(helper);}
 assert.deepEqual(materialSlots(root).map(s=>s.key),['0:0']);
});
test('a recipe changes the displayed beauty LOD, preserves that tier’s maps, and survives a tier switch',async()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),heroMesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1,8,8,8),new THREE.MeshStandardMaterial());root.add(heroMesh);scene.add(root);root.userData.kaminosSceneObject={id:'asset',source:'/api/read?root=generated-meshes&path='+('a'.repeat(64))+'.glb'};
 const map=new THREE.Texture();let proxy;
 const level={sha:'b'.repeat(64),faces:12,purpose:'beauty',error:{relative:{p95:0,max:0,mean:0}}},handle={root,levels:[level],beautyLevels:[level]};
 let materials;const controller=createSceneBeautyLodController({THREE,scene,giProxies:{list:()=>[handle],get:()=>handle},settings:{faceBudget:100,texelWeight:0},loadLevel:async()=>{proxy=new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map})));return proxy;},onRungLoaded:()=>materials?.sync()});
 materials=createSceneMaterials({entries:()=>[{id:'asset',object:root}],definitions,representations:entry=>controller.materialRoots?.(entry.object)??[]});
 const camera=new THREE.PerspectiveCamera(50,1,.01,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateProjectionMatrix();
 try{
  controller.update(camera);await controller.whenIdle();controller.update(camera);
  assert.equal(controller.state().objects[0].displayedTier,level.sha);
  materials.write({recipes:[recipe],bindings:[{objectId:'asset',slot:'0:0',recipeId:recipe.id}]});
  assert.equal(proxy.children[0].material.roughness,.23,'the visible LOD must consume the recipe');
  assert.equal(proxy.children[0].material.map,map,'each tier retains its own baked texture source');
  assert.equal(materials.read().bindings.length,1,'derived slots must not enter authored state');
  controller.setSettings({enabled:false});controller.update(camera);assert.equal(heroMesh.material.roughness,.23);
  controller.setSettings({enabled:true});controller.update(camera);assert.equal(proxy.children[0].material.roughness,.23);
 }finally{materials.clear();controller.dispose();}
});
test('an LOD that merges independently assigned source slots keeps truthful hero display and face accounting',async()=>{
 const scene=new THREE.Scene(),root=new THREE.Group();for(const name of ['Left','Right']){const mat=new THREE.MeshStandardMaterial();mat.name=name;root.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1,5,5,5),mat));}scene.add(root);root.userData.kaminosSceneObject={id:'asset',source:'/api/read?root=generated-meshes&path='+('a'.repeat(64))+'.glb'};
 const level={sha:'b'.repeat(64),faces:12,purpose:'beauty',error:{relative:{p95:0,max:0,mean:0}}},handle={root,levels:[level],beautyLevels:[level]};let materials;
 const controller=createSceneBeautyLodController({THREE,scene,giProxies:{list:()=>[handle],get:()=>handle},settings:{faceBudget:100,texelWeight:0},loadLevel:async()=>new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())),onRungLoaded:()=>materials.sync(),canDisplayRung:(a,b)=>materials.canDisplay(a,b)});
 materials=createSceneMaterials({entries:()=>[{id:'asset',object:root}],definitions,representations:e=>controller.materialRoots(e.object)});
 const camera=new THREE.PerspectiveCamera(50,1,.01,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateProjectionMatrix();
 try{materials.write({recipes:[recipe],bindings:[{objectId:'asset',slot:'0:0',recipeId:'finish'}]});controller.update(camera);await controller.whenIdle();const state=controller.update(camera);assert.equal(state.objects[0].displayedTier,'hero');assert.match(state.objects[0].materialFallback,/slots/);assert.equal(state.totalFaces,600);assert.equal(state.withinBudget,false);}finally{materials.clear();controller.dispose();}
});
