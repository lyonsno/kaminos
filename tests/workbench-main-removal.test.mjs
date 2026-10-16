// kaminos-test: node
// Exercise actual application removal and history release, not just the disposer.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {disposeOwnedSceneTree} from '../workbench-scene-host.mjs';
import {createSceneResourceFinalizers} from '../scene-resource-finalizers.mjs';
const source=fs.readFileSync(process.env.KAMINOS_REMOVAL_TEST_INDEX||new URL('../index.html',import.meta.url),'utf8');
function actual(name){const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}\n',a);assert.ok(a>=0&&b>a);return source.slice(a,b+2);}
const a=source.indexOf('    removeObject:handle=>{',source.indexOf('workbenchSceneHost=createWorkbenchSceneHost('));
const b=source.indexOf('\n    },',a);assert.ok(a>=0&&b>a);
const adapter=source.slice(a,b).replace('    removeObject:handle=>{','function closeOwned(handle){')+'\n}';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function fixture(){
 const scene=new THREE.Scene(),texture=new THREE.Texture(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial({map:texture});
 const owned=new THREE.Group(),shared=new THREE.Mesh(geometry,material),borrowed=new THREE.Mesh(geometry,material);owned.add(shared);scene.add(owned,borrowed);
 const uniqueGeometry=new THREE.BoxGeometry(),uniqueMaterial=new THREE.MeshBasicMaterial();owned.add(new THREE.Mesh(uniqueGeometry,uniqueMaterial));
 const disposed=[];for(const [name,value]of Object.entries({texture,geometry,material,uniqueGeometry,uniqueMaterial}))value.addEventListener('dispose',()=>disposed.push(name));
 const edits=createSceneEdits({read:()=>pose,write(){}}),rows=[{id:'owned',type:'glb',object:owned},{id:'borrowed',type:'glb',object:borrowed}];
 const c={scene,sceneObjects:rows,sceneGroups:[],sceneSelection:{ids:[],activeId:null},activeSceneObjectId:null,activeSceneGroupId:null,currentMesh:null,transformControls:null,sceneCameras:null,
  FLAME_EMITTER_ID:'flame',LOCAL_LIQUID_EMITTER_TYPE:'liquid',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural',RIM_LIGHT_ID:'rim',hybridSplatOverlayState:{},splatCorrectionMode:null,
  sceneMembershipRetainedObjects:new Map(),sceneMembershipDisposers:new WeakMap(),sceneResourceFinalizers:createSceneResourceFinalizers(),compoundRetentionTargets:new Map(),scenePlacementTools:{edits,finish(){}},disposeOwnedSceneTree,
  pruneSceneGroups(){},renderSceneObjectList(){},updateTransformInspector(){},setActiveSceneObject(id){c.activeSceneObjectId=id;},setInfo(){},window:{_kaminosDirty(){}},proceduralMeshes:new Map(),disposeSceneSpotLight(){throw Error('unexpected light');},setSceneSelection(){throw Error('unexpected selection');},setActiveSceneGroup(){throw Error('unexpected group');},
 };
 vm.createContext(c);vm.runInContext(['membershipEditTargetId','sceneObjectHasMembershipHistory','releaseUnreferencedSceneMembershipObjects','pruneSceneSelection','removeSceneObjectInternal','disposeObjectTree'].map(actual).join('\n')+'\n'+adapter,c);
 edits.subscribe(c.releaseUnreferencedSceneMembershipObjects);
 return {c,edits,owned,borrowed,texture,geometry,material,disposed,close:()=>c.closeOwned({id:'owned',root:owned})};
}
function intact(f){assert.equal(f.material.map,f.texture);assert.ok(!f.disposed.some(v=>['geometry','material','texture'].includes(v)));assert.equal(f.borrowed.parent,f.c.scene);}
test('unreferenced owner GLB releases immediately without destroying a registered comparison clone',()=>{
 const f=fixture();assert.equal(f.close(),true);assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),false,'owner without Undo references is released immediately');assert.ok(f.disposed.includes('uniqueGeometry'));assert.ok(f.disposed.includes('uniqueMaterial'));intact(f);
 f.edits.begin('borrowed');intact(f);f.edits.cancel();intact(f);
});
test('history-retained owner keeps its scoped disposer through eventual release',()=>{
 const f=fixture(),id=f.c.membershipEditTargetId('owned');let present=1;
 f.edits.register(id,{allowMissing:true,check:value=>value,read:()=>present,write:value=>{present=value;}});f.edits.recordApplied(id,null,1,'Insert owner');
 assert.equal(f.close(),true);assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),true);assert.deepEqual(f.disposed,[]);
 f.edits.begin('borrowed');assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),true);f.edits.cancel();
 f.edits.undo();assert.equal(f.edits.state().redoCount,1);assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),true);intact(f);
 f.edits.redo();assert.equal(f.edits.state().undoCount,1);assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),true);intact(f);
 f.edits.clear();assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),false);assert.ok(f.disposed.includes('uniqueGeometry'));assert.ok(f.disposed.includes('uniqueMaterial'));intact(f);
});
test('owner release protects resources held by another Undo root and borrowed scene textures',()=>{
 const f=fixture(),retained=new THREE.Mesh(f.geometry,f.material),id=f.c.membershipEditTargetId('retained');let present=1;
 f.c.scene.remove(f.borrowed);f.c.sceneObjects.splice(1,1);f.c.scene.environment=f.texture;
 f.edits.register(id,{allowMissing:true,check:value=>value,read:()=>present,write:value=>{present=value;}});f.edits.recordApplied(id,null,1,'Retain other root');
 f.c.sceneMembershipRetainedObjects.set('retained',{id:'retained',type:'glb',object:retained});
 f.close();assert.equal(f.c.sceneMembershipRetainedObjects.has('owned'),false);assert.equal(f.c.sceneMembershipRetainedObjects.has('retained'),true);assert.equal(f.material.map,f.texture);assert.ok(!f.disposed.some(v=>['geometry','material','texture'].includes(v)));assert.ok(f.disposed.includes('uniqueGeometry'));
});

test('whole-scene history for another object retains a producer through session close and replay',async()=>{
 const f=fixture(),entry=f.c.sceneObjects[0];entry.type='experiment';entry.source=null;
 let finalizations=0;f.c.sceneResourceFinalizers.register(f.owned,()=>{++finalizations;});
 let snapshot={objects:[{id:'owned'},{id:'borrowed'}]};
 f.edits.register('@selection-membership',{read:()=>snapshot,check:value=>value,write:value=>{
  snapshot=value;
  if(value.objects.some(row=>row.id==='owned')&&!f.c.sceneObjects.includes(entry)){
   assert.equal(f.c.sceneMembershipRetainedObjects.get('owned')?.object,f.owned);
   f.c.sceneObjects.push(entry);f.c.scene.add(f.owned);
  }
 }});
 const before=structuredClone(snapshot);snapshot={objects:[{id:'owned'}]};
 f.edits.recordApplied('@selection-membership',before,snapshot,'Remove unrelated comparison');
 f.close();await Promise.resolve();assert.equal(finalizations,0,'a whole-scene snapshot is a real producer reference');
 assert.equal(f.c.sceneMembershipRetainedObjects.get('owned')?.object,f.owned);
 await f.edits.undo();assert.equal(f.owned.parent,f.c.scene);await f.edits.redo();assert.equal(f.owned.parent,f.c.scene);
 f.close();f.edits.clear();await f.c.sceneResourceFinalizers.pending(f.owned);assert.equal(finalizations,1);
});
