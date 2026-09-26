import assert from 'node:assert/strict';
import { flameDomainTranslationForPose, flameDomainTranslationForAcceptedPose,
  flamePoseInDomain, flamePoseToDomain, defaultFlameEmitterPose } from '../scene-flame-emitter.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { buildSceneDocument, planSceneRestore } from '../scene-persistence-core.js';

const pose = position => ({ ...defaultFlameEmitterPose(), position });
assert.deepEqual(flameDomainTranslationForPose(pose([0.3, -0.76, 0])), [0, 0, 0]);
assert.deepEqual(flameDomainTranslationForPose(pose([2.3, -1.3, 0.4])), [2.3, -0.54, 0.4]);
assert.equal(flamePoseInDomain(pose([2.3, -1.3, 0.4]), [0, 0, 0]), false);
assert.equal(flamePoseInDomain(pose([2.3, -1.3, 0.4]), [2.3, -0.54, 0.4]), true);
assert.deepEqual(flamePoseToDomain(pose([2.3, -1.3, 0.4]), [2.3, -0.54, 0.4]).position, [0, -0.76, 0]);
assert.deepEqual(flameDomainTranslationForAcceptedPose(pose([2.4, -0.76, 0]), [2.3, 0, 0]),
  [2.3, 0, 0], 'an accepted tweak inside the relocated grid keeps the evolving field');
assert.deepEqual(flameDomainTranslationForAcceptedPose(pose([0.3, -0.76, 0]), [2.3, 0, 0]), [0, 0, 0]);

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

let domain = [0, 0, 0];
let accepted = pose([0.3, -0.76, 0]);
const contextual = createSceneEdits({ read: () => accepted, write: (_id, value) => { accepted = value; },
  captureContext: () => [...domain],
  settled: event => {
    domain = event.operation === 'commit'
      ? flameDomainTranslationForAcceptedPose(event.after, domain)
      : event.afterContext;
  } });
contextual.apply('flame-emitter', { position: [2.3, -0.76, 0] });
assert.deepEqual(domain, [2.3, 0, 0]);
contextual.apply('flame-emitter', { position: [2.4, -0.76, 0] });
assert.deepEqual(domain, [2.3, 0, 0]);
contextual.undo();
assert.deepEqual(domain, [2.3, 0, 0]);
contextual.undo();
assert.deepEqual(domain, [0, 0, 0]);
contextual.redo();
assert.deepEqual(domain, [2.3, 0, 0]);

const composition = { schema: 'kaminos.stationary-flame-composition.v1',
  flame: { presetId: `vsp-${'a'.repeat(64)}`, stationary: true }, lightGainStops: 0,
  route: { volume_light_field: '1' } };
const document = buildSceneDocument({ composition, flameDomainTranslation: [2.3, 0, 0], objects: [{
  id: 'flame-emitter', type: 'flame-emitter', source: 'kaminos:analytic-flame',
  transform: pose([2.4, -0.76, 0]),
}] });
assert.deepEqual(document.flameDomainTranslation, [2.3, 0, 0]);
assert.deepEqual(planSceneRestore(document).flameDomainTranslation, [2.3, 0, 0]);
assert.deepEqual(planSceneRestore({ ...document, flameDomainTranslation: undefined }).flameDomainTranslation,
  [2.4, 0, 0], 'legacy outside-source saves should regain a live grid on reopen');
