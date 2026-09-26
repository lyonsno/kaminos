import assert from 'node:assert/strict';
import { flameDomainTranslationForPose, flamePoseInDomain, flamePoseToDomain, defaultFlameEmitterPose } from '../scene-flame-emitter.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';

const pose = position => ({ ...defaultFlameEmitterPose(), position });
assert.deepEqual(flameDomainTranslationForPose(pose([0.3, -0.76, 0])), [0, 0, 0]);
assert.deepEqual(flameDomainTranslationForPose(pose([2.3, -1.3, 0.4])), [2.3, -0.54, 0.4]);
assert.equal(flamePoseInDomain(pose([2.3, -1.3, 0.4]), [0, 0, 0]), false);
assert.equal(flamePoseInDomain(pose([2.3, -1.3, 0.4]), [2.3, -0.54, 0.4]), true);
assert.deepEqual(flamePoseToDomain(pose([2.3, -1.3, 0.4]), [2.3, -0.54, 0.4]).position, [0, -0.76, 0]);

let current = pose([0, -0.76, 0]);
const events = [];
const edits = createSceneEdits({ read: () => current, write: (_id, value) => { current = value; }, settled: event => events.push(event) });
edits.begin('flame-emitter');
edits.preview({ position: [2.3, -0.76, 0] });
assert.deepEqual(events, [], 'preview must not relocate the domain');
edits.commit();
assert.equal(events.at(-1).operation, 'commit');
assert.deepEqual(events.at(-1).after.position, [2.3, -0.76, 0]);
edits.undo();
assert.equal(events.at(-1).operation, 'undo');
assert.deepEqual(events.at(-1).after.position, [0, -0.76, 0]);
edits.redo();
assert.equal(events.at(-1).operation, 'redo');
edits.begin('flame-emitter');
edits.preview({ position: [3, -0.76, 0] });
edits.cancel();
assert.equal(events.length, 3, 'cancel must not reseed');

let rejected = pose([0, -0.76, 0]);
const guarded = createSceneEdits({ read: () => rejected, write: (_id, value) => { rejected = value; },
  settled: () => { throw new Error('domain relocation failed'); } });
guarded.begin('flame-emitter');
guarded.preview({ position: [2.3, -0.76, 0] });
assert.throws(() => guarded.commit(), /domain relocation failed/);
assert.equal(guarded.state().undoCount, 0, 'failed domain settlement must not enter history');
guarded.cancel();
assert.deepEqual(rejected.position, [0, -0.76, 0]);
