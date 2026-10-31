// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSceneRecordOperations as records} from '../scene-record-operations.mjs';

const record=()=>({id:'ash-1',type:'retained-ash',source:'kaminos:retained-ash',label:'Ash',transform:{position:[2,0,-3],rotation:[0,0,0],scale:[1,1,1]},ash:{schema:'kaminos.ash-object.v1',width:3.84,depth:3.84,height:1.6,cellSize:.04,initialDepth:.08,paused:false,emitting:false,rate:.008,spread:.24,sourcePosition:[0,1.15,0],checkpoint:null}});
test('native scene record retains ash setup and evolved state and is reloadable',()=>{
 const raw=record();raw.ash.checkpoint={schema:'kaminos.tiled-ash.v1',values:[.5],steps:17};
 const normalized=records.normalize(raw);
 assert.deepEqual(normalized.ash,raw.ash);
 assert.equal(records.reloadable(normalized),true);
 raw.ash.sourcePosition[0]=99;assert.equal(normalized.ash.sourcePosition[0],0);
});
test('native ash rejects malformed settings instead of silently dropping simulation state',()=>{
 const raw=record();raw.ash.cellSize=0;assert.throws(()=>records.normalize(raw),/cell/i);
 const missing=record();delete missing.ash;assert.throws(()=>records.normalize(missing),/ash/i);
});

import {Group,Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {createAshSceneObject,createAshCollisionRecords} from '../ash/scene-object.mjs';
test('ash initialization is once-only; hidden or removed fields do no work; dispose releases once',async()=>{
 let ticks=0,deposits=0,disposed=0,restores=0;
 const patch={root:new Group(),syncScene(){},deposit:async()=>{deposits++;},step(){ticks++;},dispose(){disposed++;},read:()=>({steps:ticks}),snapshot:async()=>({schema:'kaminos.tiled-ash.v1',steps:ticks}),restore(){restores++;}};
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],createPatch:async()=>patch});
 object.tick(1000);assert.equal(ticks,0);
 await object.initialize();await object.initialize();assert.equal(deposits,1);
 object.tick(1001,{active:false});assert.equal(ticks,0);object.tick(1100);assert.equal(ticks,1);
 object.set({paused:true});object.tick(1200);assert.equal(ticks,1);
 const saved=await object.checkpoint();assert.equal(saved.checkpoint.steps,1);
 object.dispose();object.dispose();object.tick(1300);assert.equal(disposed,1);assert.equal(ticks,1);
 const reloaded=await createAshSceneObject({record:{...record(),ash:saved},readObjects:()=>[],createPatch:async()=>({...patch,root:new Group()})});
 reloaded.tick(1400);assert.equal(ticks,1);await reloaded.initialize();assert.equal(restores,1);assert.equal(deposits,1);reloaded.dispose();
});
test('scene triangles are borrowed in field coordinates; their native transform is unchanged',()=>{
 const root=new Group();root.position.set(2,0,-3);
 const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.position.set(3,1,-2);
 const list=createAshCollisionRecords(root,()=>[{id:'box',type:'procedural-mesh',object:mesh},{id:'self',type:'retained-ash',object:root}]);
 const first=list();assert.equal(first.length,1);assert.deepEqual(first[0].object.matrixWorld.elements.slice(12,15),[1,1,1]);assert.deepEqual(mesh.position.toArray(),[3,1,-2]);
 mesh.position.x=4;const second=list();assert.equal(second[0].object,first[0].object);assert.deepEqual(second[0].object.matrixWorld.elements.slice(12,15),[2,1,1]);
 mesh.visible=false;assert.equal(list().length,0);mesh.geometry.dispose();mesh.material.dispose();
});
test('ash refuses a singular field transform before GPU construction',()=>{
 const raw=record();raw.transform.scale=[1,0,1];assert.throws(()=>records.normalize(raw),/scale|transform/i);
});
