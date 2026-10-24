// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../lib/three.core.js';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createWorkbenchSceneHost,disposeOwnedSceneTree} from '../workbench-scene-host.mjs';

test('record construction preserves source provenance and domain fields without admitting a root',()=>{
  const object=new THREE.Group(),generation={run:'accepted',nested:{sha:'123'}},assetOrigin={kind:'generated'};
  const row=createSceneObjectRecord(object,{type:'glb',source:'/retained/accepted.glb',fileName:'accepted.glb',generation,assetOrigin,
    collision:{domainId:'flame-field',enabled:true},giProxy:{enabled:false,selection:{faces:500}}},{id:'mesh'});
  generation.nested.sha='changed';assetOrigin.kind='changed';
  assert.equal(object.parent,null);
  assert.equal(row.generation.nested.sha,'123');assert.equal(row.assetOrigin.kind,'generated');
  assert.equal(object.userData.kaminosSceneObject.id,'mesh');assert.equal(row.source,'/retained/accepted.glb');
  assert.equal(row.giProxy.enabled,false);assert.equal(row.collision.enabled,true);
  const water=createSceneObjectRecord(new THREE.Group(),{type:'water-emitter',localLiquidEmitter:{mode:'finite_drop'}},{id:'water'});
  // Unknown domain payloads are not promoted by generic registration.
  assert.equal(water.localLiquidEmitter,null);
});

test('real Workbench sessions admit owned roots and preserve borrowed roots through the imported operation',async()=>{
  const scene=new THREE.Scene(),state=createWorkingScene(),camera=new THREE.PerspectiveCamera();let nextId=0;
  const operations=createSceneMembershipOperations({scene:state,records:{serialize:row=>({id:row.id}),reloadable:()=>false},
    roots:{detach:row=>scene.remove(row.object),dispose:root=>disposeOwnedSceneTree(root,[scene])}});
  const register=(root,metadata)=>operations.admit(createSceneObjectRecord(root,metadata,{id:'object-'+(++nextId)}),{activate:true});
  const host=createWorkbenchSceneHost({scene,camera,controls:{target:new THREE.Vector3(),update(){}},
    loadAsset(){throw Error('this consumer attaches constructed roots');},registerObject:register,findObject:root=>state.findRoot(root),
    removeObject:handle=>operations.removeOwned(handle,root=>disposeOwnedSceneTree(root,[scene])),redraw(){},onFrame:()=>()=>{}});
  const source=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(source);const authored=register(source,{type:'glb',source:'/asset.glb'});
  const owned=new THREE.Mesh(source.geometry,source.material),disposals=[];
  source.geometry.addEventListener('dispose',()=>disposals.push('geometry'));source.material.addEventListener('dispose',()=>disposals.push('material'));
  const session=host.open();await session.attach(source,{owned:false});
  const handle=await session.attach(owned,{owned:true,metadata:{label:'Comparison'}});
  assert.equal(state.find(handle.id).object,owned);assert.equal(state.activeObjectId,handle.id);
  assert.equal(owned.parent,scene);assert.equal(state.objects.length,2);
  await session.dispose();assert.equal(state.find(handle.id),undefined);assert.equal(owned.parent,null);
  assert.equal(state.find(authored.id),authored);assert.equal(source.parent,scene);assert.deepEqual(disposals,[]);
  source.geometry.dispose();source.material.dispose();
});
