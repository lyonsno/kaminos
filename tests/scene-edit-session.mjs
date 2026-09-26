import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

assert.ok(existsSync(new URL('../scene-edit-session.mjs', import.meta.url)), 'scene authoring needs one reversible edit lifecycle shared by transforms and parameter controls');
const { createSceneEdits, transformPose } = await import('../scene-edit-session.mjs');
const original = { position: [.4, .2, -.1], rotation: [0, .4, 0], scale: [2, 1, 3] };
const clone = value => structuredClone(value);

function fixture() {
  let pose = clone(original);
  return {
    get pose() { return pose; },
    edits: createSceneEdits({
      read: id => id === 'kiln' ? clone(pose) : null,
      write: (id, next) => { pose = clone(next); },
    }),
  };
}

test('preview is provisional; cancel restores accepted pose; commit, undo and redo are one gesture', () => {
  const f = fixture(), edits = f.edits;
  edits.begin('kiln');
  edits.preview({ position: [1, 2, 3] });
  edits.preview({ rotation: [.2, .3, .4] });
  assert.equal(edits.state().undoCount, 0);
  edits.cancel();
  assert.deepEqual(f.pose, original);

  edits.begin('kiln');
  edits.preview({ position: [1, 2, 3] });
  edits.preview({ rotation: [.2, .3, .4] });
  edits.commit();
  const accepted = clone(f.pose);
  assert.equal(edits.state().undoCount, 1);
  edits.undo();
  assert.deepEqual(f.pose, original);
  edits.redo();
  assert.deepEqual(f.pose, accepted);
});

test('failed preview leaves the current gesture recoverable and no-op commit creates no history', () => {
  const f = fixture(), edits = f.edits;
  edits.begin('kiln');
  assert.throws(() => edits.preview({ position: [NaN, 0, 0] }), /finite/);
  assert.deepEqual(f.pose, original);
  edits.commit();
  assert.equal(edits.state().undoCount, 0);
});

test('applied membership edits can restore a missing object and wait for asynchronous writes', async () => {
  let member = null;
  const edits = createSceneEdits({ read: () => null, write: () => {} });
  edits.register('@scene-membership:generated-chair', {
    allowMissing: true,
    read: () => clone(member),
    check: value => value === null ? null : structuredClone(value),
    write: async value => {
      await Promise.resolve();
      member = clone(value);
    },
  });
  const stored = { id: 'generated-chair', source: '/api/ingest-mesh/chair.glb', type: 'glb' };
  member = clone(stored);
  edits.recordApplied('@scene-membership:generated-chair', null, stored, 'Add generated chair');

  const undo = edits.undo();
  assert.equal(edits.state().replaying, true, 'async replay is visible while the object is being restored');
  assert.equal(edits.state().undoCount, 1, 'history does not advance before the async write succeeds');
  await undo;
  assert.equal(member, null, 'undo removes authored membership');
  assert.deepEqual(edits.state(), { active: null, undoCount: 0, redoCount: 1, replaying: false });

  await edits.redo();
  assert.deepEqual(member, stored, 'redo restores the retained source record');
  assert.deepEqual(edits.state(), { active: null, undoCount: 1, redoCount: 0, replaying: false });
});

test('a failed asynchronous restore leaves the membership history available to retry', async () => {
  const member = { id: 'generated-chair', source: '/api/ingest-mesh/chair.glb', type: 'glb' };
  let current = clone(member);
  const edits = createSceneEdits({ read: () => null, write: () => {} });
  edits.register('@scene-membership:unavailable-chair', {
    allowMissing: true,
    read: () => clone(current),
    check: value => value === null ? null : structuredClone(value),
    write: async () => { throw new Error('retained source unavailable'); },
  });
  edits.recordApplied('@scene-membership:unavailable-chair', null, member, 'Add generated chair');
  await assert.rejects(edits.undo(), /retained source unavailable/);
  assert.deepEqual(edits.state(), { active: null, undoCount: 1, redoCount: 0, replaying: false });
});

test('clearing scene history is rejected while asynchronous membership replay is pending', async () => {
  let member = { id: 'generated-chair', source: '/api/ingest-mesh/chair.glb', type: 'glb' };
  let completeWrite;
  const edits = createSceneEdits({ read: () => null, write: () => {} });
  edits.register('@scene-membership:pending-chair', {
    allowMissing: true,
    read: () => clone(member),
    check: value => value === null ? null : structuredClone(value),
    write: value => new Promise(resolve => {
      completeWrite = () => { member = clone(value); resolve(); };
    }),
  });
  edits.recordApplied('@scene-membership:pending-chair', null, member, 'Add generated chair');

  const undo = edits.undo();
  assert.throws(() => edits.clear(), /Wait for the current scene history action to finish/);
  completeWrite();
  await undo;
  assert.equal(member, null);
  assert.deepEqual(edits.state(), { active: null, undoCount: 0, redoCount: 1, replaying: false });
});

test('registered membership targets can be released only after their history is cleared', () => {
  let member = { id: 'generated-chair' };
  const edits = createSceneEdits({ read: () => null, write: () => {} });
  edits.register('@scene-membership:released-chair', {
    allowMissing: true,
    read: () => clone(member),
    check: value => value === null ? null : structuredClone(value),
    write: value => { member = clone(value); },
  });
  edits.recordApplied('@scene-membership:released-chair', null, member, 'Add generated chair');
  assert.throws(() => edits.unregister('@scene-membership:released-chair'), /retained by scene history/);
  edits.clear();
  assert.equal(edits.unregister('@scene-membership:released-chair'), true);
  assert.equal(edits.unregister('@scene-membership:released-chair'), false);
});

test('an arriving scene object records beside an active edit on a different object', () => {
  const f = fixture(), edits = f.edits;
  let member = null;
  edits.register('@scene-membership:generated-chair', {
    allowMissing: true,
    read: () => clone(member),
    check: value => value === null ? null : structuredClone(value),
    write: value => { member = clone(value); },
  });
  edits.begin('kiln');
  edits.preview({ position: [1, 2, 3] });
  const chair = { id: 'generated-chair', source: '/api/ingest-mesh/chair.glb' };
  member = clone(chair);
  edits.recordApplied('@scene-membership:generated-chair', null, chair, 'Add generated chair');
  assert.deepEqual(edits.state().active.before, original, 'asset arrival does not cancel the in-progress object edit');
  edits.commit();
  edits.undo();
  assert.deepEqual(f.pose, original, 'the active transform remains the newest chronological action');
  edits.undo();
  assert.equal(member, null, 'the preceding insertion remains independently undoable');
});

test('operation switching recalculates from the gesture-start pose and local axis uses the authored frame', () => {
  const moved = transformPose(original, {
    operation: 'translate', axis: 'x', frame: 'local', frameRotation: original.rotation, amount: 1,
  });
  assert.ok(Math.abs(moved.position[0] - original.position[0] - Math.cos(.4)) < 1e-10);
  const rotated = transformPose(original, {
    operation: 'rotate', axis: 'z', frame: 'local', frameRotation: original.rotation, amount: Math.PI / 2,
  });
  assert.deepEqual(rotated.position, original.position);
  assert.deepEqual(rotated.scale, original.scale);
  assert.ok(rotated.rotation.some((value, index) => Math.abs(value - original.rotation[index]) > .1));
});
