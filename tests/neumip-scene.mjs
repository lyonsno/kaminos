// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {createSceneMaterials} from '../scene-material-recipes.mjs';
import {Mesh,MeshStandardMaterial,PlaneGeometry} from '../lib/three.webgpu.js';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
const source={url:'/api/read?root=image-inbox&path=neumip-author-models%2Fwool2_web.model',sha256:'a'.repeat(64)};
const carrier={id:'cloth',type:'pbr',source:'kaminos:neumip-carrier',neuralCarrier:{surface:'folded'},transform:{position:[1,2,3],rotation:[0,.4,0],scale:[1,1,1]}};
const library={recipes:[{id:'wool',name:'Wool',implementation:'neumip',version:1,parameters:{source,uvScale:2.5,gain:1.2}}],bindings:[{objectId:'cloth',slot:'.:0',recipeId:'wool'}]};
test('capture preserves a live carrier shape edit over its admission snapshot',()=>{
 const mesh=new Mesh(new PlaneGeometry(),new MeshStandardMaterial()),entry=createSceneObjectRecord(mesh,carrier,{id:carrier.id});
 mesh.userData.kaminosSceneObject.neuralCarrier={surface:'sphere'};
 const records=createSceneRecordOperations({readers:{transform:()=>carrier.transform,materials:()=>null}});
 assert.equal(records.serialize(entry).neuralCarrier.surface,'sphere');
});
test('normal document round trip retains independent neural source, carrier, slot and controls',()=>{
 const doc=buildSceneDocument({objects:[carrier],materialLibrary:library});
 const plan=planSceneRestore(JSON.parse(JSON.stringify(doc)));
 assert.deepEqual(plan.materialLibrary,library);
 assert.deepEqual(plan.objects[0].neuralCarrier,carrier.neuralCarrier);
 assert.deepEqual(plan.objects[0].transform,carrier.transform);
 const records=createSceneRecordOperations();assert.equal(records.reloadable(plan.objects[0]),true);
 assert.throws(()=>planSceneRestore({...doc,materialLibrary:{...library,recipes:[{...library.recipes[0],parameters:{...library.recipes[0].parameters,source:{...source,sha256:'bad'}}}]}}),/digest|SHA/i);
 assert.equal(records.reloadable({...carrier,neuralCarrier:{surface:'missing'}}),false);
});
test('checkpoint preparation and source replacement preserve slot lifetime and refuse unavailable sources atomically',async()=>{
 const root=new Mesh(new PlaneGeometry(),new MeshStandardMaterial()),entry={id:'cloth',object:root};
 const loaded=new Set();let created=0,disposed=0;
 const definition={id:'neumip',version:1,fields:[],check:p=>p,resourceKey:p=>p.source.sha256,
  prepare:async p=>{if(p.source.url==='missing')throw Error('Source unavailable');loaded.add(p.source.sha256);},
  create:({parameters})=>{assert(loaded.has(parameters.source.sha256));created++;const material=new MeshStandardMaterial();return {material,update:p=>material.opacity=p.gain,dispose:()=>{disposed++;material.dispose();}};}};
 const materials=createSceneMaterials({entries:()=>[entry],definitions:[definition]});
 await materials.prepare(library);materials.write(library);const first=root.material;
 const edit=structuredClone(library);edit.recipes[0].parameters.gain=1.5;materials.write(edit);assert.equal(root.material,first);assert.equal(created,1);
 const replacement=structuredClone(edit);replacement.recipes[0].parameters.source.sha256='b'.repeat(64);await materials.prepare(replacement);materials.write(replacement);
 assert.notEqual(root.material,first);assert.equal(created,2);assert.equal(disposed,1);
 const missing=structuredClone(replacement);missing.recipes[0].parameters.source.url='missing';await assert.rejects(materials.prepare(missing),/unavailable/);assert.deepEqual(materials.read(),replacement);
 materials.clear();assert.equal(disposed,2);
});
