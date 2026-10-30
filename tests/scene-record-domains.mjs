// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../lib/three.core.js';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {sceneRecordDomains} from '../scene-record-domains.mjs';
import {restorePromptRelief} from '../inference-kiln-record.mjs';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';

// Actual source shape from Dark Side's reviewed inference-kiln-record.mjs@9add5e70.
// A small complete triangle exercises the same BufferGeometry decoder contract.
function relief() {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.computeVertexNormals();
  return {schema:'kaminos.prompt-relief.v1',prompt:'SHARED FLOOR',appearance:'crust',geometry:geometry.toJSON()};
}
function record() {
  return {id:'lettering',type:'pbr',source:'kaminos:prompt-relief-v1',fileName:'Prompt',label:'Lettering',
    transform:{position:[1,2,3],rotation:[0,.2,0],scale:[1,1,1]},promptRelief:relief()};
}

test('feature-owned geometry survives ordinary scene record admission',()=>{
  const raw=record(),object=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial());
  const entry=createSceneObjectRecord(object,raw,{id:raw.id});
  assert.deepEqual(entry.promptRelief,raw.promptRelief,'admission must retain the domain-owned source payload');
  raw.promptRelief.prompt='changed after admission';
  assert.equal(entry.promptRelief.prompt,'SHARED FLOOR','accepted feature data must not alias its caller');
  assert.deepEqual(object.userData.kaminosSceneObject.promptRelief,entry.promptRelief);
});

test('the document builder and restoration planner preserve the same feature-owned source',()=>{
  const raw=record(),document=buildSceneDocument({objects:[raw],activeObjectId:raw.id});
  assert.deepEqual(document.objects[0].promptRelief,raw.promptRelief,'document normalization must retain reconstructible feature data');
  const restored=planSceneRestore(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(restored.objects[0].promptRelief,raw.promptRelief);
  assert.deepEqual(restored.objects[0].transform,raw.transform);
});

test('reloadability follows the feature decoder, including malformed geometry refusal',()=>{
  const raw=record();
  assert.equal(isReloadableSceneObjectRecord(raw),true,'the feature source already has a real geometry decoder');
  raw.promptRelief.geometry.data.attributes.position.array[0]=Infinity;
  assert.equal(isReloadableSceneObjectRecord(raw),false);
});

const readers={transform:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),materials:()=>null};

test('an owner-created root supplies the same source at admission and capture',()=>{
  const raw=record(),object=restorePromptRelief(raw);
  object.position.fromArray(raw.transform.position);object.rotation.set(...raw.transform.rotation);
  const entry=createSceneObjectRecord(object,{id:raw.id,type:'pbr',source:null},{id:raw.id});
  const records=createSceneRecordOperations({readers});
  const captured=records.serialize(entry);
  assert.equal(entry.source,raw.source);assert.equal(captured.source,raw.source);
  assert.equal(captured.promptRelief.prompt,'SHARED FLOOR');
  assert.deepEqual(captured.promptRelief.geometry.data.attributes.position.array,raw.promptRelief.geometry.data.attributes.position.array);
  assert.deepEqual(captured.transform,raw.transform);
});

test('the actual parametric lettering constructor retains rendered vertices before combustion setup',()=>{
  const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(1,0);shape.lineTo(1,1);shape.lineTo(0,1);shape.closePath();
  const object=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:false}),new THREE.MeshStandardMaterial());
  object.userData.kaminosPromptRelief={schema:'kaminos.prompt-relief.v1',prompt:'ACTUAL CONSTRUCTOR',appearance:'crust'};
  const entry=createSceneObjectRecord(object,{type:'pbr',label:'Lettering'},{id:'actual'});
  const saved=createSceneRecordOperations({readers}).serialize(entry);
  assert.equal(saved.source,'kaminos:prompt-relief-v1');
  assert.deepEqual(saved.promptRelief.geometry.data.attributes.position.array,[...object.geometry.attributes.position.array]);
  const restored=restorePromptRelief(saved);
  assert.deepEqual([...restored.geometry.attributes.position.array],[...object.geometry.attributes.position.array]);
  assert.deepEqual(restored.geometry.groups,object.geometry.groups);
  const next=createSceneRecordOperations({readers}).serialize(entry);
  assert.deepEqual(next.promptRelief,saved.promptRelief,'unchanged rendered geometry must produce stable source data');
});

test('actual membership Undo reconstructs feature geometry through its domain contribution',async()=>{
  const state=createWorkingScene(),scene=new THREE.Scene();
  const edits=createSceneEdits({read:()=>null,write(){}});
  let records;
  const mount=(object,raw)=>{object.position.fromArray(raw.transform.position);object.rotation.set(...raw.transform.rotation);scene.add(object);state.put(createSceneObjectRecord(object,raw,{id:raw.id}));return object;};
  records=createSceneRecordOperations({readers,loaders:{constructed:mount}});
  const membership=createSceneMembershipOperations({scene:state,records:{serialize:records.serialize,reloadable:records.reloadable,load:records.load},
    roots:{detach:entry=>scene.remove(entry.object),dispose:object=>{object.geometry.dispose();object.material.dispose();},restore(){}}});
  membership.attachHistory(edits);
  const raw=record(),original=mount(restorePromptRelief(raw),raw);
  membership.remove(raw.id);assert.equal(state.find(raw.id),undefined);
  await edits.undo();const restored=state.find(raw.id);
  assert.notEqual(restored.object,original,'history uses the domain constructor rather than a retained fixture root');
  assert.equal(restored.object.parent,scene);assert.equal(restored.promptRelief.prompt,raw.promptRelief.prompt);
  assert.deepEqual([...restored.object.geometry.attributes.position.array],raw.promptRelief.geometry.data.attributes.position.array);
  const document=buildSceneDocument({objects:state.objects.map(records.serialize)});
  assert.deepEqual(planSceneRestore(JSON.parse(JSON.stringify(document))).objects[0].promptRelief,records.serialize(restored).promptRelief);
});

test('source-specific contributions coexist with file-backed types and reject duplicate installation',async()=>{
  let invoked=0;
  const contribution={type:'pbr',source:'kaminos:fixture-owned',fields:r=>({recipe:r.recipe}),
    check:r=>{if(!Number.isFinite(r.recipe?.value))throw Error('Invalid fixture recipe');return r;},
    reloadable:r=>Number.isFinite(r.recipe?.value),load:r=>{invoked++;return {value:r.recipe.value};}};
  const records=createSceneRecordOperations({domains:[...sceneRecordDomains,contribution],readers});
  const raw={id:'feature',type:contribution.type,source:contribution.source,recipe:{value:17}};
  assert.deepEqual(records.normalize(raw).recipe,{value:17});
  assert.equal(records.reloadable(raw),true);assert.deepEqual(await records.load(raw),{value:17});assert.equal(invoked,1);
  assert.equal(records.reloadable({type:'pbr',source:'demos/example'}),true);
  assert.equal(records.reloadable({...raw,recipe:{value:'17'}}),false);
  assert.throws(()=>createSceneRecordOperations({domains:[contribution,contribution]}),/Duplicate scene record domain/);
});

test('the real decoder refuses representations it cannot faithfully reconstruct',()=>{
  for(const mutate of [r=>r.geometry.data.index=null,r=>r.geometry.data.boundingSphere=null,
    r=>r.geometry.data.attributes.position.array[0]=1e100,r=>r.geometry.data.drawcalls=[]]){
    const raw=record();mutate(raw.promptRelief);
    assert.equal(isReloadableSceneObjectRecord(raw),false);
  }
});
