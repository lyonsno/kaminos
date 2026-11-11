// kaminos-test: node
import vm from 'node:vm';
import {createDuplicateCommit} from '../scene-duplicate-commit.mjs';
import {FIRE_UNIT_TYPE} from '../fire-unit-record.mjs';import {readFileSync} from 'node:fs';
import {createRepetitionView} from '../scene-repetition.mjs';
import {exportCloneInWorld} from '../scene-export.mjs';
import {surfaceSplatsGLTFPlugin} from '../surface-splat-object.mjs';
import {installSurfaceFieldMaterials} from '../surface-field-material.mjs';
import {resolveBurnableHeroMesh} from '../burnable-target.mjs';
import {createSceneColliderCollection} from '../scene-collider.mjs';
import {createResidentSolidMeshes} from '../scene-solid-gpu.mjs';
import {createAshCollisionRecords} from '../ash/scene-object.mjs';
import {trianglesFromSceneObject} from '../volume-scene-solid.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import * as T from '../lib/three.webgpu.js';
import {createSurfaceSplatObject} from '../surface-splat-object.mjs';
import {createSelectionFeedback} from '../scene-selection-feedback.mjs';
import {materialSlots,createSceneMaterials} from '../scene-material-recipes.mjs';
import {sceneMaterialPrograms} from '../scene-material-programs.mjs';
import {snapshotAssetGeometry,restoreAssetGeometry,assetWorldGeometry,prepareAssetGeometryArrival} from '../asset-geometry-preparation.mjs';
const fixture=()=>createSurfaceSplatObject(new T.Mesh(new T.BoxGeometry(.2,.5,.3),new T.MeshStandardMaterial()),{
 data:new Float32Array([0,0,0,0,0,1,1,.5,0,0,.3,1,.1,0,0,0,0,1,1,.5,0,0,.3,.2]),
 footprints:new Float32Array([1,0,0,10,0,1,0,10,1,0,0,10,0,1,0,10]),meta:{count:2,stride:12,radius:.01}});
test('outline follows the same physical silhouette used for picking, without resolve rectangles',()=>{
 const root=fixture();try{
  const m=createSelectionFeedback.maskProxies(new T.Scene(),{selected:new T.MeshBasicNodeMaterial(),active:new T.MeshBasicNodeMaterial()});
  m.update([{id:'surface',object:root}],['surface']);assert.equal(m.pairs().length,1,'one stable object silhouette, not thousands of splat coverage edges');
  assert.equal(m.pairs()[0].source,root.proxy);assert.equal(m.pairs()[0].proxy.geometry,root.proxy.geometry);
 }finally{root.dispose();}
});
test('recipes cannot expose a surface-splat physical fallback as visible beauty',()=>{
 const splat=fixture(),body=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()),root=new T.Group().add(body,splat);
 const materials=createSceneMaterials({entries:()=>[{id:'hybrid',object:root}],definitions:sceneMaterialPrograms}),recipe={id:'copper',name:'Copper',implementation:'standard-surface',version:1,parameters:{color:'#aa5533',roughness:.3,metalness:.8}};
 try{
  assert.deepEqual(materialSlots(root).map(s=>s.key),['0:0'],'only the visible triangle body is an authored slot');
  assert.throws(()=>materials.write({recipes:[recipe],bindings:[{objectId:'hybrid',slot:'1/0:0',recipeId:'copper'}]}),/slot.*absent/i);
  assert.equal(splat.proxy.material.visible,false);assert.deepEqual(materials.read(),{recipes:[],bindings:[]});
  materials.write({recipes:[recipe],bindings:[{objectId:'hybrid',slot:'0:0',recipeId:'copper'}]});
  assert.equal(body.material.roughness,.3);assert.equal(splat.proxy.material.visible,false);
 }finally{materials.clear();splat.dispose();}
});
test('arrival worker payload excludes resolved screen quads and preserves physical proxy geometry',()=>{
 const root=fixture();try{
  const expected=assetWorldGeometry(root.proxy,{triangles:true});
  assert.deepEqual(assetWorldGeometry(root,{triangles:true}),expected,'internal carrier vertices are not object geometry');
  const captured=snapshotAssetGeometry(root);assert.ok(captured);assert.equal(captured.originals.length,1);
  const restored=restoreAssetGeometry(structuredClone(captured.snapshot)).root;assert.deepEqual(assetWorldGeometry(restored,{triangles:true}),expected);
  const options={mode:'fresh',groundY:0,anchor:[0,0],viewDirection:[0,0,1],obstacles:[],framing:{fovDeg:45,aspect:1.4,window:{left:-.62,right:.62,bottom:-.62,top:.42}}};
  for(const mode of ['fresh','append']){const actual=prepareAssetGeometryArrival(captured.snapshot,{...options,mode}),reference=prepareAssetGeometryArrival(snapshotAssetGeometry(root.proxy).snapshot,{...options,mode});
   assert.deepEqual(actual.bounds,reference.bounds);assert.deepEqual(actual.framing,reference.framing);assert.deepEqual(actual.pose,reference.pose);}
 }finally{root.dispose();}
});

// Execute the page's actual Duplicate entry point with only editor bookkeeping stubbed.
function duplicate(object){
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),block=name=>{const start=html.indexOf('function '+name+'(');return html.slice(start,html.indexOf('\n}',start)+2);};
 const rows=[{id:'original',type:'glb',object}],context={createDuplicateCommit,FIRE_UNIT_TYPE,THREE:T,originalBurnMaterial:m=>m,assertSceneConstructionAvailable(){},workingScene:{objects:rows},canDuplicateObject:()=>true,makeSceneObjectId:()=> 'copy',serializeSceneObject:()=>({type:'glb'}),sceneObjectDisplayLabel:()=> 'Object',ensureSceneObjectMembershipTarget:()=> 'copy',scenePlacementTools:{edits:{assertCanRecordApplied(){}}},FLAME_EMITTER_TYPE:'flame',LOCAL_LIQUID_EMITTER_TYPE:'water',ASH_SOURCE_TYPE:'ash',PROCEDURAL_MESH_TYPE:'procedural',CAMERA_TYPE:'camera',sceneMaterials:{withSource:(_o,fn)=>fn(),read:()=>({bindings:[]})},withoutRepetitionCopies:(_o,fn)=>fn(),cloneSceneObjectHierarchy:o=>o.clone(),scene:new T.Scene(),registerSceneObject:(o,r)=>rows.push({...r,object:o}),setActiveSceneObject(){},renderSceneObjectList(){},recordSceneObjectInsertion(){}};
 vm.createContext(context);const start=html.indexOf('function cloneSceneMaterial(');vm.runInContext(html.slice(start,html.indexOf('\nasync function',start))+block('duplicateSceneObject'),context);context.duplicateSceneObject('original');return rows[1].object;
}
test('native Duplicate keeps drawn splat resources under their runtime owner and preserves PBR fields',()=>{
 const splat=fixture(),body=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({roughness:.27,metalness:.4,map:new T.Texture()}));
 const n=body.geometry.getAttribute('position').count;body.geometry.setAttribute('_kaminos_material',new T.Float32BufferAttribute(Array.from({length:n*2},(_,i)=>i%2?.3:.6),2));installSurfaceFieldMaterials(body);
 const root=new T.Group().add(body,splat),copy=duplicate(root),other=copy.children[1];
 try{
  assert.equal(copy.children[0].material.roughness,.27);assert.ok(copy.children[0].material.map);assert.notEqual(copy.children[0].material.map,body.material.map);
  const glass=other.splats.root.children[1];assert.equal(glass.material.transmission,1);
  other.splats.set({mode:'opaque'});assert.equal(glass.material.transmission,0);other.splats.set({mode:'glass'});assert.equal(glass.material.transmission,1);
  assert.notEqual(other.proxy.geometry,splat.proxy.geometry,'duplicated physical geometry is independently disposable');
  let disposed=0;glass.material.addEventListener('dispose',()=>disposed++);other.dispose();assert.equal(disposed,1,'runtime disposes the drawn material');assert.equal(splat.splats.root.children[1].material.transmission,1);
 }finally{other.dispose();splat.dispose();}
});
test('legacy hybrid visual bodies survive repetition/export and remain excluded from solids',()=>{
 const splat=fixture(),body=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()),root=new T.Group().add(body,new T.Group().add(splat));body.name='Visible hybrid body';body.userData.kaminosBeautyLodProxy=true;
 const view=createRepetitionView();
 try{
  surfaceSplatsGLTFPlugin({}).afterRoot?.({scene:root});
  assert.equal(body.userData.kaminosBeautyLodProxy,undefined);assert.equal(body.userData.kaminosNonSolidVisual,true);assert.deepEqual(materialSlots(root).map(s=>s.key),['0:0']);
  view.sync(root,{mode:'line',count:2,step:[2,0,0]},{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});const repeated=root.children.find(o=>o.userData.kaminosRepetitionCopy);
  assert.equal(repeated.children[0].name,body.name);assert.equal(repeated.children[0].userData.kaminosNonSolidVisual,true);assert.equal(trianglesFromSceneObject(repeated).triangles.length,12);
  const resident=createResidentSolidMeshes({upload:x=>x,release(){}});assert.equal(resident.update([{id:'hybrid',object:root}],{translate:[0,0,0],scale:1})[0].triangleCount,24);resident.destroy();
  assert.equal(resolveBurnableHeroMesh(root),splat.proxy,'renaming the visual marker preserves the prior volumetric target');
  const colliders=createSceneColliderCollection(T).update([{id:'hybrid',type:'glb',object:root,collision:{domainId:'flame-field',enabled:true}}]);assert.equal(trianglesFromSceneObject(colliders.object).triangles.length,24,'live fire wrapper must retain only the two physical proxies');
  const ash=createAshCollisionRecords(new T.Group(),()=>[{id:'hybrid',type:'glb',object:root}]);assert.equal(ash().length,2,'only original and repeated physical proxies collide');
  const exported=exportCloneInWorld(root);assert.ok(exported.children.some(o=>o.name===body.name));
 }finally{view.clear(root);splat.dispose();}
});
