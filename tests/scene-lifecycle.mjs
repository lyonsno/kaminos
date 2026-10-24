// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneLifecycle} from '../scene-lifecycle.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {disposeOwnedSceneTree} from '../workbench-scene-host.mjs';
function fixture(){
 const state=createWorkingScene(),world=new THREE.Scene(),events=[],disposed=[];
 const add=id=>{const object=new THREE.Group();world.add(object);return state.put({id,type:'glb',object});};
 const adapters={scene:state,roots:{detach:row=>row.object.removeFromParent(),dispose:root=>disposed.push(root),mount:(row,on)=>on?world.add(row.object):row.object.removeFromParent()},
 records:{load:async record=>add(record.id).object,restore:(row,record)=>{row.object.position.x=record.x??0;}},
 groups:{restore:rows=>state.setGroups(rows)},selection:{set:(ids,id)=>state.select(ids,id),object:id=>state.select(id?[id]:[],id??null),group:id=>state.select(['@group:'+id])},
 context:{beforeClear(){events.push(['history',state.objects.length+state.suspendedObjects().length]);},clearDomains(){events.push(['domains',state.generation]);},cleared(){events.push(['cleared',state.objects.length]);}}};
 return {state,world,events,disposed,adapters,add,lifecycle:createSceneLifecycle(adapters)};
}
test('clear invalidates pending work, retires active or parked roots once, and ends history before disposal',()=>{
 for(const preview of [false,true]){
  const f=fixture(),a=f.add('a'),arrival=f.state.arrival(),load=f.state.loads.begin();f.state.select(['a']);
  if(preview)f.lifecycle.suspendPreview();const before=f.state.generation;
  f.lifecycle.clear();assert.deepEqual(f.disposed,[a.object]);assert.equal(a.object.parent,null);
  assert.equal(f.state.objects.length,0);assert.equal(f.state.suspendedObjects().length,0);assert.equal(f.state.isSuspended,false);
  assert.equal(arrival.isCurrent(),false);assert.equal(f.state.loads.isCurrent(load),false);assert.equal(f.state.generation,before+1);
  assert.deepEqual(f.events,[['history',1],['domains',before+1],['cleared',0]]);
 }
});
test('replacement uses nonactivating typed constructors, restores groups, then selects the saved group',async()=>{
 const f=fixture(),old=f.add('old'),id=f.state.loads.begin();
 assert.equal(await f.lifecycle.replace([{id:'a',x:2},{id:'b',x:3}],{loadRequestId:id,groups:[{id:'pair',objectIds:['a','b']}],activeGroupId:'pair'}),true);
 assert.deepEqual(f.disposed,[old.object]);assert.equal(f.state.find('a').object.position.x,2);assert.equal(f.state.activeGroupId,'pair');assert.equal(f.state.loads.isCurrent(id),true);
});
test('a failing replacement retires its partial roots and leaves no selectable partial scene',async()=>{
 const f=fixture();f.adapters.records.load=async record=>{const row=f.add(record.id);if(record.id==='broken')throw Error('source rejected');return row.object;};
 await assert.rejects(f.lifecycle.replace([{id:'first'},{id:'broken'}]),/source rejected/);
 assert.equal(f.state.objects.length,0);assert.equal(f.state.selection.activeId,null);assert.equal(f.disposed.length,2);
});
test('superseded replacement cannot clear or select over the newer scene',async()=>{
 const f=fixture();let finish;
 f.adapters.records.load=(record,id)=>record.id==='slow'?new Promise(resolve=>{finish=()=>resolve(f.state.loads.isCurrent(id)?f.add(record.id).object:null);}):Promise.resolve(f.add(record.id).object);
 const old=f.state.loads.begin(),pending=f.lifecycle.replace([{id:'slow'}],{loadRequestId:old});
 const fresh=f.state.loads.begin();await f.lifecycle.replace([{id:'current'}],{loadRequestId:fresh});finish();
 assert.equal(await pending,false);assert.deepEqual(f.state.objects.map(row=>row.id),['current']);assert.equal(f.state.activeObjectId,'current');
 assert.equal(await f.lifecycle.replace([{id:'stale'}],{loadRequestId:old}),false);assert.equal(f.state.activeObjectId,'current');
});
test('closing an owner during preview cannot resurrect it or destroy a parked comparison resource',()=>{
 const f=fixture(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),unique=new THREE.BoxGeometry(),released=[];
 const owned=f.add('owned'),borrowed=f.add('borrowed');owned.object.add(new THREE.Mesh(geometry,material),new THREE.Mesh(unique,material));borrowed.object.add(new THREE.Mesh(geometry,material));
 geometry.addEventListener('dispose',()=>released.push('shared'));unique.addEventListener('dispose',()=>released.push('unique'));
 f.state.setGroups([{id:'comparison',objectIds:['owned','borrowed']}]);f.state.select(['@group:comparison']);
 const operations=createSceneMembershipOperations({scene:f.state,records:{},roots:{detach:row=>row.object.removeFromParent(),dispose(){throw Error('must use scoped disposal');}}});
 f.lifecycle.suspendPreview();assert.equal(f.world.children.length,0);
 const close=()=>operations.removeOwned({id:'owned',root:owned.object},root=>disposeOwnedSceneTree(root,[f.world,...f.state.suspendedObjects().map(row=>row.object)]));
 assert.equal(close(),true);assert.equal(close(),false);assert.deepEqual(released,['unique']);
 f.lifecycle.resumePreview({});assert.equal(f.state.find('owned'),undefined);assert.equal(owned.object.parent,null);assert.equal(borrowed.object.parent,f.world);
 assert.deepEqual(f.state.groups[0].objectIds,['borrowed']);assert.equal(f.state.activeGroupId,'comparison');assert.deepEqual(released,['unique']);
});
test('replacement identity mismatch fails loudly and releases the published partial root',async()=>{
 const f=fixture();f.adapters.records.load=async record=>{f.add(record.id);return new THREE.Group();};
 await assert.rejects(f.lifecycle.replace([{id:'mismatch'}]),/did not publish its loaded identity/);assert.equal(f.state.objects.length,0);assert.equal(f.disposed.length,1);
});

test('domain startup failure during replacement retires the loaded roots',async()=>{
 const f=fixture();f.adapters.context.loaded=async()=>{throw Error('domain startup failed');};
 await assert.rejects(f.lifecycle.replace([{id:'loaded'}],{setup:{}}),/domain startup failed/);
 assert.equal(f.state.objects.length,0,'failed domain setup must not leave a selectable partial scene');assert.equal(f.disposed.length,1);
});
