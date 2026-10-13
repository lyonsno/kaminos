// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const moduleUrl = new URL('../investigation-recording.mjs', import.meta.url);
test('shared recording retains intermediate effective operations, independent of undo history', async () => {
  assert.ok(existsSync(moduleUrl), 'the workbench needs an operation recording ingress');
  const {createInvestigationRecording, investigationOperations} = await import(moduleUrl);
  let time = 0;
  const recorder = createInvestigationRecording({id: 'trial', source: {revision: 'observed'},
    initial: {clock: {generation: 1, step: 47}},
    startingConditions: {kind: 'live-runtime', reconstructAfterRestart: false}, now: () => ++time});
  const operation = {kind: 'fluid.controls', phase: 'applied', target: 'fluid',
    requested: {cohesion: 12}, effective: {cohesion: 10}, clock: {generation: 1, step: 47}};
  investigationOperations.emit(operation);
  operation.effective.cohesion = 12;
  investigationOperations.emit(operation);
  const camera = {position: [1, 2, 3], target: [0, 0, 0], up: [0, -1, 0],
    projection: 'perspective', fov: 50, near: 0.1, far: 200};
  investigationOperations.emit({kind: 'camera.pose', phase: 'changed', target: 'camera', effective: camera});
  const snapshot = recorder.snapshot();
  assert.deepEqual(snapshot.operations.map(o => o.sequence), [1, 2, 3]);
  assert.deepEqual(snapshot.operations.slice(0, 2).map(o => o.effective.cohesion), [10, 12]);
  assert.deepEqual(snapshot.operations[2].effective, camera);
  assert.equal(snapshot.operations[0].actor, 'unattributed');
  assert.deepEqual(snapshot.initial.clock, {generation: 1, step: 47});
  assert.equal(snapshot.startingConditions.reconstructAfterRestart, false);
  snapshot.operations[0].effective.cohesion = -1;
  assert.equal(recorder.snapshot().operations[0].effective.cohesion, 10);
  const final = recorder.finish();
  investigationOperations.emit(operation);
  assert.equal(recorder.snapshot().operations.length, 3);
  assert.equal(final.status, 'finished');
});

test('malformed operation marks the recording incomplete without interrupting the source control', async () => {
  assert.ok(existsSync(moduleUrl), 'the workbench needs an operation recording ingress');
  const {createInvestigationRecording, investigationOperations} = await import(moduleUrl);
  const recorder = createInvestigationRecording({id: 'failure', source: {revision: 'observed'}, initial: {},
    startingConditions: {kind: 'live-runtime'}});
  assert.doesNotThrow(() => investigationOperations.emit({kind: 'camera.pose', effective: () => {}}));
  const state = recorder.finish();
  assert.equal(state.complete, false);
  assert.equal(state.issues.length, 1);
  assert.equal(state.operations.length, 0);
});

test('all active consumers receive independent values and disposal leaves no recorder listener', async () => {
  assert.ok(existsSync(moduleUrl), 'the workbench needs an operation recording ingress');
  const {createInvestigationRecording, investigationOperations} = await import(moduleUrl);
  const options = {source: {revision: 'observed'}, initial: {}, startingConditions: {kind: 'live-runtime'}};
  const a = createInvestigationRecording({...options, id: 'a'});
  const b = createInvestigationRecording({...options, id: 'b'});
  assert.equal(investigationOperations.active, true);
  investigationOperations.emit({kind: 'scene.edit', phase: 'cancel', target: 'mesh-1', effective: {x: 1}});
  a.finish(); b.finish();
  assert.equal(investigationOperations.active, false);
  assert.equal(b.snapshot().operations[0].phase, 'cancel');
});
