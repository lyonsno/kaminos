import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../scene-object-witness.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function runCatRetainedPlaybackScenario'), source.indexOf('async function runCatMotionRetargetScenario'));
const clip = { sha256: 'abc', authority: 'retained-motion-playback', frameCount: 180, fps: 30 };
const rest = { meshes: [{ boneQuaternions: { hip: [0, 0, 0, 1] } }] };
async function exercise({ reason = 'clip-complete', advancing = true, captureFailure = false } = {}) {
const evidence = { meshAssetLink: { state: { registeredObjectId: 'cat' } } };
let clock = 0;
let samples = 0;
const run = Function('assert', 'lastEvidence', 'url', 'runMeshAssetLinkScenario', 'evaluate', 'delay', 'capturePngScreenshot', 'siblingPngPath', 'dispatchMouseClick', 'performance', `let phase; ${body}; return runCatRetainedPlaybackScenario;`)(
  assert, evidence, 'http://localhost/?motion_clip_sha256=abc', async () => {},
  async (_ws, expression) => {
    if (expression.includes('__kaminosRetainedMotionClip')) return clip;
    if (expression.includes('kaminosSkinnedRigDebugState')) return rest;
    if (expression.includes('__kaminosMotionRigPreview')) return { active: false, stopReason: reason };
    if (expression.includes('kaminosMotionRigPreviewDebugState')) return ++samples <= 2 ? { active: true, frame: advancing ? samples * 30 : 0 } : { active: false };
    return { x: 1, y: 1 };
  }, async ms => { clock += ms; }, async (_ws, path) => { clock += 2000; if (captureFailure && path === '-retained-0') throw new Error('capture failed'); return { path }; }, suffix => suffix,
  async () => {}, { now: () => clock });
try { await run({}); } catch (error) { error.evidence = evidence; throw error; }
return evidence;
}
const evidence = await exercise();
assert.equal(evidence.catRetainedPlayback.frames.length, 2, 'natural completion does not become a missing-active failure');
assert.ok(evidence.catRetainedPlayback.frames[1].elapsedMs > evidence.catRetainedPlayback.frames[0].elapsedMs + 500, 'capture timestamps include screenshot cost');
assert.equal(evidence.catRetainedPlayback.completed.stopReason, 'clip-complete');
await assert.rejects(exercise({ reason: 'selection-changed' }), /natural completion/);
await assert.rejects(exercise({ advancing: false }), /frames must advance/);
await assert.rejects(exercise({ captureFailure: true }), error => {
  assert.equal(error.evidence.catRetainedPlayback.frames[0].state.frame, 30, 'failed capture still preserves the last observed live frame');
  return /capture failed/.test(error.message);
});
console.log('cat playback witness contracts passed');
