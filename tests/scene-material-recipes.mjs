// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture} from '../lib/three.core.js';
import {checkedMaterialDocument,materialSlots,createSceneMaterials} from '../scene-material-recipes.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const recipe={id:'copper',name:'Workshop copper',implementation:'standard-surface',version:1,parameters:{color:'#aa5533',roughness:.3,metalness:.8}};
test('recipes and individual array slots round trip; invalid references fail before mutation',()=>{
 const value={recipes:[recipe],bindings:[{objectId:'part',slot:'.:1',recipeId:'copper'}]};
 assert.deepEqual(checkedMaterialDocument(value),value);
 assert.throws(()=>checkedMaterialDocument({...value,bindings:[{...value.bindings[0],recipeId:'missing'}]}),/missing/i);
 assert.throws(()=>checkedMaterialDocument({...value,recipes:[{...recipe,implementation:'unavailable-program'}]}),/implementation/i);
 assert.throws(()=>checkedMaterialDocument({...value,recipes:[{...recipe,version:2}]}),/version/i);
 assert.throws(()=>checkedMaterialDocument({...value,bindings:[value.bindings[0],value.bindings[0]]}),/duplicate/i);
});
test('slots distinguish meshes and array indices without flattening an imported asset',()=>{
 const root=new Group(),mesh=new Mesh(new BoxGeometry(),[new MeshStandardMaterial(),new MeshStandardMaterial()]);root.add(mesh);
 assert.deepEqual(materialSlots(root).map(s=>s.key),['0:0','0:1']);
});
test('shared editing, make unique, undo, replacement roots and source textures retain their meaning',()=>{
 const texture=new Texture(),base=new MeshStandardMaterial({map:texture,color:0xeeeeee});
 const entries=['a','b'].map(id=>({id,object:new Mesh(new BoxGeometry(),base.clone())}));
 const definitions=[{id:'standard-surface',version:1,check:p=>structuredClone(p),create:({base,parameters})=>{
   const material=base.clone();const update=p=>{material.color.set(p.color);material.roughness=p.roughness;material.metalness=p.metalness;};update(parameters);
   return {material,update,dispose:()=>material.dispose()};
 }}];
 const materials=createSceneMaterials({entries:()=>entries,definitions});
 const initial={recipes:[recipe],bindings:entries.map(e=>({objectId:e.id,slot:'.:0',recipeId:recipe.id}))};
 materials.write(initial);
 assert.equal(entries[0].object.material.roughness,.3);
 assert.equal(entries[1].object.material.map,texture);
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 edits.register('@materials',{read:materials.read,write:materials.write,check:materials.check});
 const changed=materials.read();changed.recipes[0].parameters.roughness=.65;edits.apply('@materials',changed,'Edit shared finish');
 assert.equal(entries[1].object.material.roughness,.65);
 edits.undo();assert.equal(entries[1].object.material.roughness,.3);edits.redo();
 const unique=materials.read();unique.recipes.push({...recipe,id:'unique',name:'Own copper'});unique.bindings[0].recipeId='unique';edits.apply('@materials',unique,'Make unique');
 const patch=materials.read();patch.recipes.find(r=>r.id==='unique').parameters.roughness=.9;edits.apply('@materials',patch);
 assert.equal(entries[0].object.material.roughness,.9);assert.equal(entries[1].object.material.roughness,.65);
 const old=entries[1].object;entries[1].object=new Mesh(new BoxGeometry(),base.clone());materials.sync();
 assert.equal(entries[1].object.material.roughness,.65);assert.equal(old.material.map,texture);
 const before=materials.read();assert.throws(()=>materials.write({...before,bindings:[{objectId:'b',slot:'.:99',recipeId:'copper'}]}),/slot/i);
 assert.deepEqual(materials.read(),before);
 materials.write({recipes:[],bindings:[]});assert.equal(entries[1].object.material.roughness,base.roughness);assert.equal(texture.source.data,null);
});
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const meshRecord={id:'part',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{}},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
const materialLibrary={recipes:[recipe],bindings:[{objectId:'part',slot:'.:0',recipeId:'copper'}]};
test('saved scene retains recipes and assignments and rejects unsupported material data before loading',()=>{
 const saved=buildSceneDocument({objects:[meshRecord],materialLibrary});
 assert.deepEqual(saved.materialLibrary,materialLibrary);assert.ok(saved.version>=12);
 assert.deepEqual(planSceneRestore(JSON.parse(JSON.stringify(saved))).materialLibrary,materialLibrary);
 assert.deepEqual(planSceneRestore(buildSceneDocument({objects:[meshRecord]})).materialLibrary,{recipes:[],bindings:[]});
 assert.throws(()=>planSceneRestore({...saved,materialLibrary:{...materialLibrary,bindings:[{...materialLibrary.bindings[0],objectId:'absent'}]}}),/material.*object/i);
 assert.throws(()=>planSceneRestore({...saved,materialLibrary:{...materialLibrary,recipes:[{...recipe,implementation:'missing'}]}}),/implementation/i);
});
test('runtime parameter edits reuse programs, failed program construction is atomic, and source cloning excludes derived materials',()=>{
 const root=new Mesh(new BoxGeometry(),new MeshStandardMaterial()),entry={id:'a',object:root};let disposed=0;
 const definition={id:'standard-surface',version:1,check:p=>p,create:({base,parameters})=>{
  if(parameters.roughness===.99)throw Error('Program rejected input');const material=base.clone();material.roughness=parameters.roughness;
  return {material,update:p=>{material.roughness=p.roughness;},dispose:()=>{disposed++;material.dispose();}};
 }};
 const materials=createSceneMaterials({entries:()=>[entry],definitions:[definition]});const source=root.material;
 const initial={recipes:[recipe],bindings:[{objectId:'a',slot:'.:0',recipeId:'copper'}]};materials.write(initial);const derived=root.material;
 const edited=materials.read();edited.recipes[0].parameters.roughness=.7;materials.write(edited);assert.equal(root.material,derived);assert.equal(root.material.roughness,.7);
 assert.equal(materials.withSource(root,()=>root.material),source);assert.equal(root.material,derived);
 const failed=materials.read();failed.recipes[0].version=2;assert.throws(()=>materials.write(failed),/version/);assert.deepEqual(materials.read(),edited);
 materials.releaseObject(root);assert.equal(root.material,source);assert.equal(disposed,1);materials.sync();assert.notEqual(root.material,source);materials.clear();assert.equal(root.material,source);assert.equal(disposed,2);
 const bad=structuredClone(initial);bad.recipes[0].parameters.roughness=.99;assert.throws(()=>materials.write(bad),/Program rejected/);assert.deepEqual(materials.read(),{recipes:[],bindings:[]});assert.equal(root.material,source);
});
test('shared edits and unique copies respect a live Burning owner; unchanged sync preserves its wrapper',()=>{
 const a={id:'a',object:new Mesh(new BoxGeometry(),new MeshStandardMaterial())},b={id:'b',label:'Burning timber',object:new Mesh(new BoxGeometry(),new MeshStandardMaterial())};
 const definition={id:'standard-surface',version:1,check:p=>p,create:({base,parameters})=>{const material=base.clone(),update=p=>{material.roughness=p.roughness;};update(parameters);return {material,update,dispose:()=>material.dispose()};}};
 const materials=createSceneMaterials({entries:()=>[a,b],definitions:[definition]});materials.write({recipes:[recipe],bindings:[a,b].map(e=>({objectId:e.id,slot:'.:0',recipeId:recipe.id}))});
 const original=b.object.material,wrapper=new MeshStandardMaterial({color:0x111111});b.burnable={enabled:true};b.object.material=wrapper;
 const changed=materials.read();changed.recipes[0].parameters.roughness=.8;assert.throws(()=>materials.check(changed),/Disable Burning/);assert.equal(original.roughness,.3);assert.equal(b.object.material,wrapper);
 const unique=materials.read();unique.recipes.push({...recipe,id:'unique'});unique.bindings[1].recipeId='unique';assert.throws(()=>materials.write(unique),/Disable Burning/);
 materials.sync();assert.equal(b.object.material,wrapper);b.burnable.enabled=false;b.object.material=original;materials.write(changed);assert.equal(b.object.material.roughness,.8);
});
test('geometry replacement validates bound slots before the caller retires its old geometry',()=>{
 const group=new Group().add(new Mesh(new BoxGeometry(),new MeshStandardMaterial()),new Mesh(new BoxGeometry(),new MeshStandardMaterial())),entry={id:'part',object:group};
 const definition={id:'standard-surface',version:1,check:p=>p,create:({base})=>({material:base.clone(),update(){},dispose(){}})};
 const materials=createSceneMaterials({entries:()=>[entry],definitions:[definition]});materials.write({recipes:[recipe],bindings:[{objectId:'part',slot:'1:0',recipeId:recipe.id}]});
 const replacement=new Group().add(new Mesh(new BoxGeometry(),new MeshStandardMaterial()));assert.throws(()=>materials.validateSlots('part',replacement),/remove assigned/);assert.equal(entry.object,group);assert.equal(materials.bindings('part')[0].slot,'1:0');
});
test('scene admission rejects a custom glaze that the live Burning adapter cannot preserve',()=>{
 const materialLibrary={recipes:[{id:'glaze',name:'Ceramic',implementation:'kiln-glaze',version:1,parameters:{}}],bindings:[{objectId:'part',slot:'.:0',recipeId:'glaze'}]};
 const saved=buildSceneDocument({objects:[{...meshRecord,burnable:{enabled:true,material:'wood'}}],materialLibrary});
 assert.throws(()=>planSceneRestore(saved),/Burning.*Kiln glaze|Kiln glaze.*Burning/);
});
test('reflection settings are admitted before scene replacement, normalized and preserved with material assignments',()=>{
 const saved=buildSceneDocument({objects:[meshRecord],materialLibrary,postprocessing:{reflections:{enabled:true,resolutionScale:.25}}});
 const plan=planSceneRestore(saved);assert.equal(plan.reflections.enabled,true);assert.equal(plan.reflections.resolutionScale,.25);
 assert.throws(()=>planSceneRestore({...saved,postprocessing:{reflections:{steps:-1}}}),/Reflection steps/);
});
test('a removed Burning user retains its owned program until root retirement while save omits it',()=>{
 const a={id:'a',object:new Mesh(new BoxGeometry(),new MeshStandardMaterial())},b={id:'b',label:'Retained timber',object:new Mesh(new BoxGeometry(),new MeshStandardMaterial())};let entries=[a,b],disposed=0;
 const definition={id:'standard-surface',version:1,check:p=>p,create:({base})=>({material:base.clone(),update(){},dispose(){disposed++;}})};
 const materials=createSceneMaterials({entries:()=>entries,definitions:[definition]});materials.write({recipes:[recipe],bindings:[a,b].map(e=>({objectId:e.id,slot:'.:0',recipeId:recipe.id}))});const program=b.object.material,wrapper=new MeshStandardMaterial();b.burnable={enabled:true};b.object.material=wrapper;entries=[a];materials.sync();assert.equal(b.object.material,wrapper);assert.equal(disposed,0);assert.equal(materials.document().bindings.length,1);
 const change=materials.read();change.recipes[0].parameters.roughness=.8;assert.throws(()=>materials.check(change),/Disable Burning/);b.object.material=program;materials.releaseObject(b.object);assert.equal(disposed,1);
});
