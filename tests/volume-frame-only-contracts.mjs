import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admitFrameOnlySource, verifyFrameOnlyReadback } from '../volume-frame-only-contract.mjs';

const presetId = `vsp-${'a'.repeat(64)}`;
const url = `http://127.0.0.1:18447/?kaminos_volume_smoke=1&settings_preset=${presetId}&settings_preset_authority=shared-volume-settings-preset-v2`;
const receipt = { presetId, contentHash: `sha256:${'a'.repeat(64)}`, sourcePresetAuthority: 'shared-volume-settings-preset-v2' };
const state = { active: true, effectiveRoute: 'native-3d-compute-fluid-raymarch-v0', backend: 'WebGPU:apple', simStepCount: 12 };
const expectedSource = { repoRoot: '/worktree', commit: '1234abcd' };
const servingSource = { ...expectedSource, branch: 'cc/test', dirty: false };
assert.deepEqual(admitFrameOnlySource(url, receipt, state, servingSource, expectedSource).servingSource, servingSource);
for (const [name, route, source, runtime] of [
  ['missing preset', 'http://127.0.0.1:18447/?kaminos_volume_smoke=1', receipt, state],
  ['wrong preset', url, { ...receipt, presetId: `vsp-${'b'.repeat(64)}` }, state],
  ['wrong authority', url, { ...receipt, sourcePresetAuthority: 'fallback' }, state],
  ['fallback route', url, receipt, { ...state, effectiveRoute: 'cpu-fallback' }],
  ['CPU backend', url, receipt, { ...state, backend: 'CPU' }],
  ['inactive route', url, receipt, { ...state, active: false }],
  ['no steps', url, receipt, { ...state, simStepCount: 0 }],
]) assert.throws(() => admitFrameOnlySource(route, source, runtime, servingSource, expectedSource), Error, name);
for (const [name, server] of [
  ['missing source', null],
  ['wrong checkout', { ...servingSource, repoRoot: '/other' }],
  ['stale commit', { ...servingSource, commit: 'old' }],
  ['dirty source', { ...servingSource, dirty: true }],
]) assert.throws(() => admitFrameOnlySource(url, receipt, state, server, expectedSource), Error, name);

const image = { authority: 'gpu-presentation-texture-rgba8-readback-frozen-sim-state', width: 4, height: 3, byteLength: 48, rgbaBase64: Buffer.alloc(48, 10).toString('base64') };
const capture = { ok: true, imageAuthority: image.authority, image, renderWidth: 4, renderHeight: 3, simStepCount: 13, sameStateCaptureId: 'frame-1' };
const sample = { renderWidth: 4, renderHeight: 3, sameStateCaptureId: 'frame-1' };
assert.equal(verifyFrameOnlyReadback(capture, sample, 13).length, 48);
for (const [name, candidate] of [
  ['missing image', { ...capture, image: null }],
  ['partial bytes', { ...capture, image: { ...image, rgbaBase64: Buffer.alloc(16).toString('base64') } }],
  ['blank bytes', { ...capture, image: { ...image, rgbaBase64: Buffer.alloc(48).toString('base64') } }],
  ['opaque black', { ...capture, image: { ...image, rgbaBase64: Buffer.from(Array.from({ length: 12 }, () => [0, 0, 0, 255]).flat()).toString('base64') } }],
  ['stale step', { ...capture, simStepCount: 12 }],
  ['wrong state', { ...capture, sameStateCaptureId: 'old' }],
  ['fallback authority', { ...capture, imageAuthority: 'canvas-screenshot' }],
]) assert.throws(() => verifyFrameOnlyReadback(candidate, sample, 13), Error, name);

const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const frozen = core.slice(core.indexOf('async function renderFrozenScaleToCanvas('), core.indexOf('async function renderFrozenScaleToCanvas(') + 18000);
assert.match(frozen, /enqueueCanvasReadback\(encoder, finalPresentationTexture/,
  'copy of transient swap-chain texture must be encoded before the render submit');
assert.match(frozen, /enqueueCanvasReadback\(retryEncoder, retryTexture/,
  'capacity retry must copy its final swap-chain texture before submit');
assert.ok(witness.indexOf('if (frameOnlyRequested)') < witness.indexOf("phase = 'identity'"), 'frame-only route must precede broad physics gate');
assert.match(witness, /phase = 'frame-only-capture'/);
assert.match(witness, /writeFrameOnlyPreflightFailure\(/);
assert.match(witness, /\/api\/runtime-config/);
assert.match(witness, /partialControlledStepFrames/);
console.log('volume frame-only contracts passed');
