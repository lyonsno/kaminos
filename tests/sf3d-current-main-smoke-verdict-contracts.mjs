import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as host from '../sf3d-host-device.mjs';

const smokeSource = readFileSync(new URL('../sf3d-shared-device-smoke.mjs', import.meta.url), 'utf8');
const hostSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const compositionSource = readFileSync(new URL('../sf3d-live-flame-inject.mjs', import.meta.url), 'utf8');
assert.match(smokeSource, /scene-file-input[\s\S]*?dispatchEvent\(new Event\('change'/,
  'the smoke must restore the authored kiln through Kaminos’ supported scene-file path');
assert.match(smokeSource, /getElementById\('info-bar'\)\?\.textContent/,
  'the smoke must observe Kaminos’ actual scene-load completion receipt');
assert.doesNotMatch(smokeSource, /getElementById\('composition-status'\)/,
  'the smoke must not depend on a nonexistent scene-status element');
assert.match(smokeSource, /if\s*\(report\.inferenceOk[\s\S]*?sf3d-kiln-save-reopen-witness\.mjs/,
  'the registered kiln smoke must continue into Save As and reopen after inference succeeds');
assert.match(smokeSource, /applySf3dPersistenceResult\(report/,
  'the durable report must apply the complete persistence result to its top-level verdict');
assert.match(compositionSource, /export const transparentVolumeCanvas = true/,
  'the SF3D consumer must request alpha composition for its foreground flame canvas');
assert.match(hostSource, /transparentCanvas:\s*transparentVolumeCanvas/,
  'Kaminos must configure the volume renderer alpha path for composition modules that request it');
assert.match(hostSource, /html\.volume-transparent-composition #kaminos-volume-canvas\.active[^}]*background:\s*transparent/,
  'the active volume canvas background must not paint over the authored Three scene');

assert.equal(typeof host.judgeSf3dSmoke, 'function',
  'the current consumer host must expose the exercised SF3D verdict used by the kiln smoke');
assert.equal(typeof host.canReuseGeneratedOutput, 'function',
  'partial smoke output may be reused only under a narrow, testable evidence exception');
const expectedScene = {
  file: 'kiln.kaminos.json',
  presetId: 'vsp-authored-basin',
  modelSource: '/api/read?root=generated-meshes&path=kiln.glb',
};
const result = {
  runId: 'same-run',
  deviceTopology: 'same-device',
  foregroundScheduling: 'producer-foreground-opportunities',
  receiptValidation: {ok: true},
  glbBytes: 30,
  glbSha256: 'chair-hash',
  presentation: {status: 'registered', objectId: 'chair', source: '/api/read?root=generated-meshes&path=chair.glb', sha256: 'chair-hash', runId: 'same-run'},
  flameProgress: {before: {frameCount: 2, simStepCount: 8}, after: {frameCount: 5, simStepCount: 20}},
  foregroundFrames: [0, 1].map(frame => ({
    runId: 'same-run', status: 'completed',
    submissions: [{submissionStatus: 'queue-submit-returned', commandBufferCount: 1}],
    result: {renderer: 'ordinary-volume', status: 'submitted', frameCount: frame + 1, simStepCount: frame + 1, sceneFrameCount: frame + 1},
  })),
  sceneEvidence: {routeSceneFile: expectedScene.file, runtimePresetId: expectedScene.presetId,
    runtimeModelSources: [expectedScene.modelSource], runtimeStatus: 'Restored'},
  reopenEvidence: {savedSceneFile: 'new.kaminos.json', savedSources: [expectedScene.modelSource, '/chair.glb'],
    savedPresetId: 'vsp-wrong-basin', reopenedSources: [expectedScene.modelSource, '/chair.glb'],
    reopenedPresetId: 'vsp-wrong-basin', reopenedStatus: 'Restored', flameBefore: 2, flameAfter: 4,
    sourceUnchanged: true, originalPosition: [0, 0, 0], editedPosition: [0.25, 0, 0], reopenedPosition: [0.25, 0, 0]},
};
const errors = host.judgeSf3dSmoke(result, {expectedScene, expectedReopen: {generatedSource: '/chair.glb'}});
assert.ok(errors.includes('reopened scene has wrong flame basin'),
  'a mutually consistent but wrong saved/reopened basin must not pass the authored-kiln verdict');
const partial = {
  ok: false,
  phase: 'terminal',
  errors: ['scene restore did not complete'],
  expectedScene,
  sceneEvidence: {routeSceneFile: expectedScene.file, runtimePresetId: expectedScene.presetId,
    runtimeModelSources: [expectedScene.modelSource], runtimeStatus: null},
  output: {result: {...result, sceneEvidence: undefined}},
};
assert.equal(host.canReuseGeneratedOutput(partial), true,
  'a valid produced GLB can be reused when only the old status locator failed and the next witness reloads the scene');
assert.equal(host.canReuseGeneratedOutput({...partial, errors: [...partial.errors, 'not same-device']}), false,
  'the reuse exception must reject any additional failed invariant');
assert.equal(host.canReuseGeneratedOutput({...partial, output: {result: {...result, receiptValidation: {ok: false}}}}), false,
  'the reuse exception must not admit an invalid producer receipt');
assert.equal(host.canReuseGeneratedOutput({...partial, ok: true, errors: []}), false,
  'a prior inference pass without matching authored-scene evidence must not be reusable');
assert.equal(host.canReuseGeneratedOutput({...partial, ok: true, errors: [],
  sceneEvidence: {...partial.sceneEvidence, runtimeStatus: 'Scene loaded: 1 object(s)'}}), true,
  'a fully successful prior run with the exact authored-scene receipt remains reusable');
assert.equal(host.canReuseGeneratedOutput({...partial, ok: false, inferenceOk: true, errors: [],
  persistence: {status: 'running'}, sceneEvidence: {...partial.sceneEvidence,
    runtimeStatus: 'Scene loaded: 1 object(s)'}}), true,
  'the save/reopen child must accept a validated inference report while end-to-end persistence is still pending');
assert.equal(host.canReuseGeneratedOutput({...partial, ok: false, inferenceOk: true, errors: [],
  integrationOk: false, persistence: {status: 'failed'}, sceneEvidence: {...partial.sceneEvidence,
    runtimeStatus: 'Scene loaded: 1 object(s)'}}), true,
  'a failed persistence attempt must allow retrying the same validated inference output');
const incomplete = host.applySf3dPersistenceResult({inferenceOk: true, ok: false}, {
  status: 1, report: '/evidence/save-reopen/report.json', error: 'reopen failed',
});
assert.equal(incomplete.ok, false, 'failed Save As/reopen must fail the durable integration verdict');
assert.equal(incomplete.integrationOk, false);
assert.equal(incomplete.persistence.status, 'failed');
const complete = host.applySf3dPersistenceResult({inferenceOk: true, ok: false}, {
  status: 0, report: '/evidence/save-reopen/report.json',
});
assert.equal(complete.ok, true, 'only inference plus persistence success may set the top-level ok bit');
console.log('current-main SF3D authored-basin verdict contract passed');
