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

test('an already-applied authored control change joins the shared undo and redo history', () => {
  let setting = { radius: 0.24, flow: 0.8 };
  let writes = 0;
  const edits = createSceneEdits({
    read: () => clone(original),
    write() {},
  });
  edits.register('@burner', {
    read: () => clone(setting),
    write: next => { setting = clone(next); writes++; },
    check: value => {
      if (!Number.isFinite(value?.radius) || !Number.isFinite(value?.flow)) throw new Error('Burner values must be finite');
      return { radius: value.radius, flow: value.flow };
    },
  });

  const before = clone(setting);
  setting = { radius: 0.36, flow: 1.25 };
  assert.equal(edits.recordApplied('@burner', before, 'Burner tuning'), true);
  assert.equal(edits.state().undoCount, 1);
  assert.equal(edits.undo(), true);
  assert.deepEqual(setting, before);
  assert.equal(edits.redo(), true);
  assert.deepEqual(setting, { radius: 0.36, flow: 1.25 });
  assert.equal(writes, 2, 'undo and redo must use the registered target writer');
});

test('already-applied history rejects gated or invalid transitions without changing the undo ledger', () => {
  let admitted = true, setting = { value: 1 };
  const edits = createSceneEdits({ read: () => clone(original), write() {}, admit: () => {
    if (!admitted) throw new Error('authoring action is busy');
  } });
  edits.register('@setting', {
    read: () => clone(setting),
    write: value => { setting = clone(value); },
    check: value => {
      if (!Number.isFinite(value?.value)) throw new Error('setting must be finite');
      return { value: value.value };
    },
  });
  const before = clone(setting);
  setting = { value: 2 };
  admitted = false;
  assert.throws(() => edits.recordApplied('@setting', before), /busy/);
  admitted = true;
  setting = { value: NaN };
  assert.throws(() => edits.recordApplied('@setting', before, 'Invalid'), /finite/);
  setting = { value: 2 };
  assert.equal(edits.recordApplied('@setting', setting, 'No change'), false);
  assert.equal(edits.state().undoCount, 0);
  assert.deepEqual(setting, { value: 2 });
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
