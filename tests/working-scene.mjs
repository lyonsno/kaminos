// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkingScene} from '../working-scene.mjs';

const row=id=>({id,object:{userData:{kaminosSceneObject:{id}}},type:'glb'});

test('membership reads cannot splice the scene and replacement validates before mutation',()=>{
  const scene=createWorkingScene(),a=row('a'),b=row('b');scene.put(a);scene.put(b);
  const read=scene.objects;
  assert.throws(()=>read.pop(),TypeError);
  assert.throws(()=>{read[0].id='other';},TypeError);
  assert.throws(()=>{read[0].object={};},TypeError);
  assert.throws(()=>scene.replaceObjects([a,a]),/unique/);
  assert.deepEqual(scene.objects.map(row=>row.id),['a','b']);
  scene.forget('a');assert.deepEqual(read.map(row=>row.id),['a','b']);
  assert.deepEqual(scene.objects.map(row=>row.id),['b']);
});

test('groups own membership and selection derives object, group and simulation identities',()=>{
  const scene=createWorkingScene(),a=row('a'),b=row('b');scene.replaceObjects([a,b]);
  const group={id:'pair',objectIds:['a','b'],label:'Pair',transform:{position:[0,0,0]}};scene.setGroups([group]);
  assert.throws(()=>{scene.groups[0].transform.position[0]=10;},TypeError);
  group.objectIds.pop();assert.deepEqual(scene.groups[0].objectIds,['a','b']);
  assert.throws(()=>scene.groups[0].objectIds.push('lost'),TypeError);
  assert.equal(a.object.userData.kaminosSceneObject.groupId,'pair');
  scene.select(['@group:pair']);assert.equal(scene.activeGroupId,'pair');assert.equal(scene.activeObjectId,null);
  scene.select(['a','b'],'a');assert.equal(scene.activeObjectId,'a');
  scene.forget('a');assert.deepEqual(scene.selection,{ids:['b'],activeId:'b'});
  assert.deepEqual(scene.groups[0].objectIds,['b']);
  scene.forget('b');assert.deepEqual(scene.groups,[]);assert.equal(scene.selection.activeId,null);
  scene.select(['flame-field'],'flame-field',['flame-field']);
  assert.equal(scene.activeFieldId,'flame-field');assert.equal(scene.activeObjectId,null);
});

test('invalid group changes leave the current groups and object metadata intact',()=>{
  const scene=createWorkingScene(),a=row('a');scene.put(a);scene.setGroups([{id:'g',objectIds:['a']}]);
  for(const groups of [[{id:'g',objectIds:['missing']}],[{id:'x',objectIds:['a']},{id:'y',objectIds:['a']}]] )assert.throws(()=>scene.setGroups(groups),/absent|already grouped/);
  assert.equal(scene.groups[0].id,'g');assert.equal(a.groupId,'g');
});

test('admission belongs to the scene lifetime rather than completion time or another instance',()=>{
  const scene=createWorkingScene(),other=createWorkingScene(),arrival=scene.arrival();
  other.invalidateArrivals();assert.equal(arrival.isCurrent(),true);
  scene.invalidateArrivals();assert.equal(arrival.isCurrent(),false);assert.throws(()=>arrival.assertCurrent(),/Scene changed/);
  const current=scene.arrival();scene.put(row('new'));assert.equal(current.isCurrent(),true,'ordinary edits do not replace the scene');
});

test('retained roots keep their own disposer until history releases them',()=>{
  const scene=createWorkingScene(),a=row('a'),b=row('b'),released=[];scene.replaceObjects([a,b]);
  scene.retain(a,object=>released.push(object));scene.retain(b);
  scene.forget('a');scene.releaseUnreferenced(id=>id==='a',()=>{throw Error('a must use its scoped disposer');});
  assert.equal(scene.retained('a'),a);assert.equal(scene.retained('b'),undefined,'dropping history on a live root does not dispose it');
  assert.deepEqual(released,[]);
  scene.releaseUnreferenced(()=>false,()=>{throw Error('scoped disposer was lost');});
  assert.deepEqual(released,[a.object]);assert.deepEqual(scene.retainedObjects(),[]);
});

test('reorder preserves exact roots and rejects incomplete or duplicate ordering',()=>{
  const scene=createWorkingScene(),a=row('a'),b=row('b');scene.replaceObjects([a,b]);
  assert.throws(()=>scene.reorder(['a','a']),/every current member/);
  scene.reorder(['b','a']);assert.equal(scene.objects[0],b);assert.equal(scene.objects[1],a);
  scene.move('a',0);assert.equal(scene.objects[0],a);
});
