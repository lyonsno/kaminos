// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneMembershipOperations, membershipEditTargetId} from '../scene-membership-operations.mjs';

function fixture({admit = () => {}, domains = {fixture:{retainRoot:true}}, reloadable = record => record.source !== null} = {}) {
  const scene = createWorkingScene(), calls = [], messages = [];
  const edits = createSceneEdits({read:() => null, write(){}, admit});
  const add = (id, type = 'fixture', source = id) => {
    const entry = {id, type, source, label:id, object:{mounted:true, disposed:false, userData:{kaminosSceneObject:{id}}}};
    scene.put(entry);
    return entry;
  };
  const operations = createSceneMembershipOperations({scene, domains,
    records:{serialize:entry => ({id:entry.id, type:entry.type, source:entry.source, label:entry.label}),
      reloadable, async load(record){calls.push('load');return add(record.id, record.type, record.source).object;}},
    roots:{
      attach(entry){entry.object.mounted = true;calls.push('attach');},
      detach(entry){entry.object.mounted = false;calls.push('detach');},
      restore(){calls.push('restore');},
      dispose(root){root.disposed = true;calls.push('dispose');},
    },
    captureContext:() => ({activeCameraId:'camera-before'}),
    status:message => messages.push(message),
    changed:({operation}) => calls.push(operation),
  });
  operations.attachHistory(edits);
  return {scene, edits, operations, add, calls, messages};
}

test('membership history preserves root, group order, active group and insertion position', async () => {
  const f = fixture(), first = f.add('first');f.add('second');f.add('third');
  f.scene.setGroups([{id:'pair',objectIds:['first','second']}]);f.scene.select(['@group:pair']);
  f.operations.remove('first');
  assert.deepEqual(f.scene.objects.map(row => row.id), ['second','third']);
  assert.deepEqual(f.scene.groups[0].objectIds, ['second']);
  assert.equal(f.scene.activeGroupId,'pair');
  await f.edits.undo();
  assert.equal(f.scene.find('first').object,first.object);
  assert.deepEqual(f.scene.objects.map(row => row.id), ['first','second','third']);
  assert.deepEqual(f.scene.groups[0].objectIds, ['first','second']);
  assert.equal(f.scene.activeGroupId,'pair');
  f.edits.clear();
  assert.equal(first.object.disposed,false,'dropping history cannot destroy a mounted root');
});

test('a rejected edit leaves membership, groups, selection and resources intact', () => {
  const f = fixture({admit:() => {throw Error('held by consumer');}}), entry = f.add('one');
  f.scene.setGroups([{id:'group',objectIds:['one']}]);f.scene.select(['one']);
  assert.equal(f.operations.remove('one'),false);
  assert.equal(f.scene.find('one'),entry);
  assert.deepEqual(f.scene.groups[0].objectIds,['one']);
  assert.deepEqual(f.scene.selection.ids,['one']);
  assert.equal(entry.object.disposed,false);assert.equal(entry.object.mounted,true);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.messages,['held by consumer']);
});

test('removal retargets the active object while pruning a surviving multi-selection', () => {
  const f = fixture();for(const id of ['one','two','three'])f.add(id);
  f.scene.select(['two']);f.operations.remove('two');
  assert.equal(f.scene.activeObjectId,'three');
  f.scene.select(['one','three'],'three');f.operations.remove('one');
  assert.deepEqual(f.scene.selection.ids,['three']);
});

test('compound history keeps an owner-closed root through unrelated ledger notifications', () => {
  const f = fixture(), entry = f.add('one');
  f.edits.register('@compound',{read:() => 1,write(){},check:value => value});
  f.edits.recordApplied('@compound',null,1);
  f.operations.retainForHistory('one','@compound');
  let disposed = 0;
  assert.equal(f.operations.removeOwned({id:'one',root:entry.object},() => disposed++),true);
  f.edits.register('@other',{read:() => 0,write(){},check:value => value});
  f.edits.begin('@other');f.edits.cancel();assert.equal(disposed,0);
  f.edits.clear();assert.equal(disposed,1);
});

test('owner closure rejects a stale handle for a replacement with the same ID', () => {
  const f = fixture(), old = f.add('one'), replacement = f.add('one');
  assert.equal(f.operations.removeOwned({id:'one',root:old.object}),false);
  assert.equal(f.scene.find('one'),replacement);assert.deepEqual(f.calls,[]);
});

test('domain lifecycle runs around membership changes without page globals', async () => {
  const effects = [];
  const f = fixture({domains:{fixture:{retainRoot:true,
    detached:entry => effects.push(['detached',Boolean(f.scene.find(entry.id))]),
    removed:entry => effects.push(['removed',entry.object.mounted]),
    attach:(_entry,snapshot) => effects.push(['attach',snapshot.activeCameraId]),
    restored:entry => effects.push(['restored',f.scene.find(entry.id) === entry]),
  }}});
  f.add('one');f.operations.remove('one');await f.edits.undo();
  assert.deepEqual(effects,[['detached',false],['removed',false],['attach','camera-before'],['restored',true]]);
});

test('a domain-owned compound removal retains its own implementation authority', () => {
  const removed=[];const f=fixture({domains:{fixture:{remove:id=>{removed.push(id);return 'domain-result';}}}});
  const entry=f.add('one');assert.equal(f.operations.remove('one'),'domain-result');
  assert.deepEqual(removed,['one']);assert.equal(f.scene.find('one'),entry);assert.deepEqual(f.calls,[]);
});

test('non-retained reloadable records restore through the source adapter', async () => {
  const f=fixture({domains:{}}), entry=f.add('one');
  f.operations.remove('one');assert.equal(entry.object.disposed,true);
  await f.edits.undo();assert.notEqual(f.scene.find('one').object,entry.object);
  assert.ok(f.calls.includes('load'));assert.ok(f.calls.includes('restore'));
});

test('history target cleanup permits reuse and separate scenes retain separate histories', async () => {
  const a=fixture(), b=fixture();const root=a.add('same');b.add('same');
  a.operations.recordInsertion('same');assert.equal(a.edits.state().undoCount,1);assert.equal(b.edits.state().undoCount,0);
  assert.throws(()=>a.operations.clearHistoryTargets(),/retained by scene history/);
  a.edits.clear();a.operations.clearHistoryTargets();
  a.operations.recordInsertion('same');await a.edits.undo();
  assert.equal(root.object.mounted,false);assert.equal(b.scene.find('same').object.mounted,true);
});

test('membership snapshots reject mismatched identity and malformed group provenance', () => {
  const f=fixture();f.add('one');const value=f.operations.snapshot('one');
  assert.throws(()=>f.operations.check(value,'other'),/cannot be restored/);
  assert.throws(()=>f.operations.check({...value,groups:[{id:'g',groupIndex:-1,objectIds:['one']}]},'one'),/cannot be restored/);
  const checked=f.operations.check(value,'one');checked.record.label='changed';assert.equal(value.record.label,'one');
  assert.equal(membershipEditTargetId('a/b'),'@scene-membership:a%2Fb');
});
