import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  RAY_STEP_ABLATION_AUTHORITY,
  parseRayStepAblation,
  validateRayStepAblationValues,
  validateRayStepAblationReceipt,
} from '../boundary-splat-ray-step-ablation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = readFileSync(resolve(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(resolve(root, 'volume-witness.mjs'), 'utf8');

assert.equal(RAY_STEP_ABLATION_AUTHORITY, 'frozen-sim-state-native-raymarch-step-ablation-v0');
assert.deepEqual(parseRayStepAblation('36,96,144'), [36, 96, 144], 'requested step sequence is preserved uncapped');
assert.throws(() => parseRayStepAblation('36,bad,144'), /integer|malformed/i, 'malformed tokens are rejected instead of silently removed');
assert.throws(() => validateRayStepAblationValues([36, 96.5, 144]), /integer/i, 'browser API values are rejected instead of floored');
assert.throws(() => parseRayStepAblation('36,36,144'), /unique/i, 'duplicate steps are rejected');
assert.throws(() => parseRayStepAblation('96,36,144'), /ascending/i, 'nonascending steps are rejected');
assert.throws(() => parseRayStepAblation('36,96,161'), /1.*160|160/i, 'steps above the renderer maximum are rejected');
assert.throws(() => parseRayStepAblation(''), /at least two/i, 'an empty diagnostic cannot masquerade as an ablation');

const camera = {
  viewProjection: Array.from({ length: 16 }, (_, index) => index / 10),
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
  viewport: [640, 480],
};
const targets = [36, 96, 144].map(raySteps => ({
  requestedRaySteps: raySteps,
  effectiveRaySteps: raySteps,
  sameStateCaptureId: 'ray-step-ablation-state-7',
  frameCount: 41,
  simStepCount: 37,
  sampleAuthority: 'render-only-frozen-sim-state',
  rendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
  decomposition: 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0',
  adaptiveRays: 0,
  temporalAccum: 0,
  temporalJitter: 0,
  historyClamp: 0,
  renderScale: 1,
  camera,
  width: 640,
  height: 480,
  visualMetrics: { meanLuma: 9, litPixels: 900, litFraction: 0.08 },
  path: `/tmp/frame-000.raymarch-steps-${raySteps}.png`,
  bytes: 4000 + raySteps,
  sha256: String(raySteps).padStart(64, '0'),
}));
const validReceipt = {
  ok: true,
  authority: RAY_STEP_ABLATION_AUTHORITY,
  requestedRoute: 'http://127.0.0.1:8095/?kaminos_volume_smoke=1',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  fallbackReason: null,
  sameStateCaptureId: 'ray-step-ablation-state-7',
  baseFrameCount: 41,
  baseSimStepCount: 37,
  requestedRaySteps: [36, 96, 144],
  camera,
  targets,
};

assert.deepEqual(validateRayStepAblationReceipt(validReceipt, [36, 96, 144]), validReceipt);
assert.throws(
  () => validateRayStepAblationReceipt({ ...validReceipt, targets: targets.slice(0, 2) }, [36, 96, 144]),
  /partial|missing/i,
  'missing 144-step output fails loud',
);
assert.throws(
  () => validateRayStepAblationReceipt({
    ...validReceipt,
    targets: targets.map((target, index) => index === 1 ? { ...target, simStepCount: 38 } : target),
  }, [36, 96, 144]),
  /state drift/i,
  'simulator drift between targets is rejected',
);
assert.throws(
  () => validateRayStepAblationReceipt({
    ...validReceipt,
    targets: targets.map((target, index) => index === 2 ? {
      ...target,
      camera: { ...target.camera, viewport: [641, 480] },
    } : target),
  }, [36, 96, 144]),
  /camera drift/i,
  'camera or viewport drift is rejected',
);
assert.throws(
  () => validateRayStepAblationReceipt({
    ...validReceipt,
    targets: targets.map((target, index) => index === 0 ? { ...target, adaptiveRays: 1 } : target),
  }, [36, 96, 144]),
  /adaptive/i,
  'adaptive raymarch contamination is rejected',
);
assert.throws(
  () => validateRayStepAblationReceipt({
    ...validReceipt,
    targets: targets.map((target, index) => index === 0 ? { ...target, temporalAccum: 1 } : target),
  }, [36, 96, 144]),
  /temporal/i,
  'temporal accumulation contamination is rejected',
);
assert.throws(
  () => validateRayStepAblationReceipt({ ...validReceipt, fallbackReason: 'webgl-fallback' }, [36, 96, 144]),
  /fallback/i,
  'fallback evidence cannot pass as the requested route',
);
assert.throws(
  () => validateRayStepAblationReceipt({
    ...validReceipt,
    targets: targets.map((target, index) => index === 2 ? {
      ...target,
      visualMetrics: { meanLuma: 0, litPixels: 0, litFraction: 0 },
    } : target),
  }, [36, 96, 144]),
  /blank/i,
  'blank high-step output cannot close the diagnostic',
);

assert.match(core, /captureBoundarySplatRayStepAblation/, 'core exposes the frozen-state ray-step ablation');
assert.doesNotMatch(core, /options\.raySteps\.map\(value => Math\.floor/, 'browser capture must not floor requested step values');
assert.match(core, /controlsSnapshot\s*=\s*controlsBefore/, 'core restores the exact pre-ablation controls');
assert.match(witness, /--boundary-splat-ray-step-ablation/, 'witness exposes the explicit ray-step sequence');
assert.match(witness, /raymarch-steps-\$\{raySteps\}\.png/, 'witness materializes one stable target artifact per requested step count');
assert.match(witness, /validateRayStepAblationReceipt/, 'witness validates the complete receipt before reporting success');
assert.match(witness, /rayStepAblationFailureReport/, 'failure before complete output remains durable');

console.log('boundary splat ray-step ablation contracts passed');
