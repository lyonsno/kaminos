import assert from 'node:assert/strict';

export const RAY_STEP_ABLATION_AUTHORITY = 'frozen-sim-state-native-raymarch-step-ablation-v0';
export const RAY_STEP_ABLATION_TARGET_DECOMPOSITION = 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0';

export function validateRayStepAblationValues(values) {
  const steps = Array.from(values || []);
  assert.ok(steps.length >= 2, 'ray-step ablation requires at least two requested steps');
  assert.ok(steps.every(step => Number.isFinite(step) && Number.isInteger(step) && step >= 1 && step <= 160), 'ray-step ablation values must be integers in the renderer range 1..160');
  assert.equal(new Set(steps).size, steps.length, 'ray-step ablation values must be unique');
  assert.ok(steps.every((step, index) => index === 0 || step > steps[index - 1]), 'ray-step ablation values must be strictly ascending');
  return steps;
}

export function parseRayStepAblation(value) {
  const raw = String(value || '');
  if (!raw.trim()) return validateRayStepAblationValues([]);
  const tokens = raw.split(',').map(entry => entry.trim());
  assert.ok(tokens.every(token => token.length > 0), 'ray-step ablation contains a malformed value');
  const steps = tokens.map(token => Number(token));
  assert.ok(steps.every(step => Number.isFinite(step)), 'ray-step ablation contains a malformed value');
  return validateRayStepAblationValues(steps);
}

export function validateRayStepAblationSequenceBackends(frames) {
  assert.ok(Array.isArray(frames) && frames.length > 0, 'ray-step ablation backend sequence is empty');
  const backend = frames[0]?.backend;
  assert.match(String(backend || ''), /^WebGPU:/, 'ray-step ablation sequence did not preserve a WebGPU backend');
  for (const [index, frame] of frames.entries()) {
    assert.equal(frame?.backend, backend, `ray-step ablation backend drift at frame ${index}: all frames must match ${backend}`);
  }
  return backend;
}

function sameCamera(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateRayStepAblationReceipt(receipt, requestedRaySteps) {
  assert.equal(receipt?.ok, true, 'ray-step ablation receipt did not complete');
  assert.equal(receipt?.authority, RAY_STEP_ABLATION_AUTHORITY, 'ray-step ablation authority mismatch');
  assert.equal(receipt?.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'ray-step ablation used the wrong effective route');
  assert.match(String(receipt?.backend || ''), /^WebGPU:/, 'ray-step ablation did not use WebGPU');
  assert.equal(receipt?.fallbackReason, null, 'ray-step ablation fallback is not admissible');
  assert.deepEqual(receipt?.requestedRaySteps, requestedRaySteps, 'ray-step ablation changed or capped the requested sequence');
  assert.ok(receipt?.sameStateCaptureId, 'ray-step ablation omitted same-state identity');
  assert.ok(Array.isArray(receipt?.targets), 'ray-step ablation omitted targets');
  assert.equal(receipt.targets.length, requestedRaySteps.length, 'ray-step ablation is partial or missing a requested target');
  assert.deepEqual(receipt.targets.map(target => target.requestedRaySteps), requestedRaySteps, 'ray-step ablation target sequence is partial or reordered');
  for (const target of receipt.targets) {
    assert.equal(target.effectiveRaySteps, target.requestedRaySteps, 'ray-step ablation effective ray steps were silently capped');
    assert.equal(target.sameStateCaptureId, receipt.sameStateCaptureId, 'ray-step ablation state drift: same-state identity changed');
    assert.equal(target.frameCount, receipt.baseFrameCount, 'ray-step ablation state drift: frame count changed');
    assert.equal(target.simStepCount, receipt.baseSimStepCount, 'ray-step ablation state drift: simulator step changed');
    assert.equal(target.sampleAuthority, 'render-only-frozen-sim-state', 'ray-step ablation target advanced the simulation');
    assert.equal(target.rendererIdentity, 'native-3d-compute-fluid-raymarch-v0', 'ray-step ablation target substituted the renderer');
    assert.equal(target.decomposition, RAY_STEP_ABLATION_TARGET_DECOMPOSITION, 'ray-step ablation target decomposition drifted');
    assert.equal(target.adaptiveRays, 0, 'ray-step ablation adaptive rays must be disabled');
    assert.equal(target.temporalAccum, 0, 'ray-step ablation temporal accumulation must be disabled');
    assert.equal(target.temporalJitter, 0, 'ray-step ablation temporal jitter must be disabled');
    assert.equal(target.historyClamp, 0, 'ray-step ablation history clamp must be disabled');
    assert.equal(target.renderScale, 1, 'ray-step ablation must render at native scale');
    assert.ok(sameCamera(target.camera, receipt.camera), 'ray-step ablation camera drift detected');
    assert.ok(Number.isInteger(target.width) && target.width > 0 && Number.isInteger(target.height) && target.height > 0, 'ray-step ablation target dimensions are missing');
    assert.ok(target.visualMetrics?.meanLuma >= 1.5 && target.visualMetrics?.litPixels >= 80, 'ray-step ablation target is blank or nearly blank');
    assert.ok(target.path && target.bytes > 0 && target.sha256, 'ray-step ablation target artifact is missing or partial');
  }
  return receipt;
}
