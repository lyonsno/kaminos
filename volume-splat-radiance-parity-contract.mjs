import assert from 'node:assert/strict';

const SCHEMA = 'kaminos.volume.splat-radiance-parity.v0';
const WRAPPER_ROUTE = 'exact-basin-selective-head-live-v0';
const RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const CAMERA_COUNT = 21;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;

function validateSource(source) {
  assert.ok(source && typeof source === 'object', 'source identity is missing');
  assert.match(source.commit || '', GIT_COMMIT, 'source commit is missing or invalid');
  assert.match(source.sameStateCaptureId || '', /^filament-orbit-f\d+-s\d+$/, 'frozen state identity is invalid');
  assert.match(source.controlsSha256 || '', SHA256, 'controls hash is missing or invalid');
  assert.match(source.candidatePayloadSha256 || '', SHA256, 'candidate payload hash is missing or invalid');
  assert.match(source.fluidSha256 || '', SHA256, 'fluid hash is missing or invalid');
  assert.match(source.frontSha256 || '', SHA256, 'front hash is missing or invalid');
  assert.ok(Number.isInteger(source.candidateCount) && source.candidateCount > 0, 'candidate count is missing or invalid');
}

function validateArm(arm, source) {
  assert.ok(arm && typeof arm === 'object', 'parity arm is missing');
  assert.equal(arm.requestedRoute, arm.id, `requested arm identity disagrees for ${arm.id}`);
  assert.equal(arm.effectiveRoute, arm.id, `effective arm substitution for ${arm.id}`);
  assert.equal(arm.fallbackReason, null, `fallback evidence cannot close ${arm.id}`);
  assert.equal(arm.intermediateClamped, false, `clamped intermediate cannot close ${arm.id}`);
  assert.equal(arm.captures?.length, CAMERA_COUNT, `partial orbit cannot close ${arm.id}`);
  const seen = new Set();
  for (const capture of arm.captures) {
    assert.ok(Number.isInteger(capture.cameraIndex) && capture.cameraIndex >= 0 && capture.cameraIndex < CAMERA_COUNT, `invalid camera index in ${arm.id}`);
    assert.ok(!seen.has(capture.cameraIndex), `duplicate camera in ${arm.id}`);
    seen.add(capture.cameraIndex);
    assert.ok(capture.nonblank === true && capture.pixelHash, `blank or missing capture in ${arm.id}`);
    assert.ok(capture.cameraPoseHash, `camera pose hash missing in ${arm.id}`);
    assert.equal(capture.controlsSha256, source.controlsSha256, `stale controls in ${arm.id}`);
    assert.equal(capture.candidatePayloadSha256, source.candidatePayloadSha256, `candidate payload substitution in ${arm.id}`);
    assert.equal(capture.candidateCount, source.candidateCount, `candidate count changed in ${arm.id}`);
  }
  if (arm.id === 'current-additive-v0') {
    assert.equal(arm.resolveIdentity, 'direct-additive-presentation-v0', 'additive control resolve identity changed');
    assert.equal(arm.intermediateReadbackStatus, 'not-applicable', 'additive control invented HDR readback evidence');
  } else if (arm.id === 'matched-presentation-v0') {
    assert.equal(arm.targetFormat, 'rgba16float', 'matched presentation did not use rgba16float');
    assert.equal(arm.resolveIdentity, 'raymarch-matched-exponential-power-grade-v0', 'matched presentation resolve identity changed');
    assert.equal(arm.intermediateReadbackStatus, 'complete', 'matched presentation HDR readback is incomplete');
    assert.ok(arm.captures.every(capture => capture.hdrTelemetry?.status === 'complete'), 'matched presentation HDR telemetry is partial');
    assert.ok(arm.captures.every(capture => capture.hdrTelemetry?.targetFormat === 'rgba16float'), 'matched presentation telemetry target format changed');
    assert.ok(arm.captures.every(capture => capture.hdrTelemetry?.nonFiniteChannels === 0), 'matched presentation HDR contains non-finite channels');
  } else {
    throw new Error(`unsupported parity arm: ${arm.id}`);
  }
}

export function validateSplatRadianceParityReport(report) {
  assert.equal(report?.schema, SCHEMA, 'radiance parity schema mismatch');
  assert.equal(report.status, 'completed', 'partial report cannot claim radiance parity');
  assert.equal(report.failurePhase, null, 'completed report retains a failure phase');
  assert.equal(report.requestedRoute, '/volume-selective-head-live.html', 'requested wrapper route changed');
  assert.equal(report.effectiveWrapperRoute, WRAPPER_ROUTE, 'requested/effective wrapper route disagreement');
  assert.equal(report.effectiveRendererRoute, RENDERER_ROUTE, 'requested/effective renderer route disagreement');
  assert.match(report.backend || '', /^WebGPU/, 'renderer backend substituted away from WebGPU');
  assert.equal(report.cameraCount, CAMERA_COUNT, 'radiance parity requires the exact 21-camera orbit');
  assert.deepEqual(report.curve, { exposure: 0.96, vignetteBase: 0.80, vignetteGain: 0.18, power: 0.84 }, 'raymarch curve parameters changed');
  validateSource(report.source);
  assert.equal(report.arms?.length, 2, 'presentation-only evidence requires exactly two arms');
  const armMap = new Map(report.arms.map(arm => [arm.id, arm]));
  assert.equal(armMap.size, 2, 'duplicate or missing presentation arms');
  const additive = armMap.get('current-additive-v0');
  const matched = armMap.get('matched-presentation-v0');
  validateArm(additive, report.source);
  validateArm(matched, report.source);
  for (let index = 0; index < CAMERA_COUNT; index += 1) {
    const additiveCapture = additive.captures.find(capture => capture.cameraIndex === index);
    const matchedCapture = matched.captures.find(capture => capture.cameraIndex === index);
    assert.equal(matchedCapture.cameraPoseHash, additiveCapture.cameraPoseHash, `camera pose changed between arms at ${index}`);
  }
  return report;
}

export const SPLAT_RADIANCE_PARITY_CONTRACT = Object.freeze({
  schema: SCHEMA,
  wrapperRoute: WRAPPER_ROUTE,
  rendererRoute: RENDERER_ROUTE,
  cameraCount: CAMERA_COUNT,
});
