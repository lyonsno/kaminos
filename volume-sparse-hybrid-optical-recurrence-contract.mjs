import assert from 'node:assert/strict';

const SCHEMA = 'kaminos.volume.sparse-hybrid-optical-orbit-capture.v0';
const ROUTE = 'coarse-residual-plus-full-resolution-splat-shared-optical-recurrence-v0';
const CAPTURE_SCALES = [0.20, 0.15, 0.10];
const TIMING_SCALES = [0.20, 0.15];
const TIMING_STAGES = [
  'coarseRaymarchMs',
  'reconstructionMs',
  'splatRasterMs',
  'recurrenceMs',
  'totalGpuMs',
];

function sameNumbers(actual, expected, message) {
  assert.deepEqual(
    [...actual].map(Number).sort((left, right) => right - left),
    [...expected].sort((left, right) => right - left),
    message,
  );
}

export function validateSparseHybridOpticalRecurrenceReport(report) {
  assert.ok(report && typeof report === 'object', 'shared optical report must be an object');
  assert.equal(report.schema, SCHEMA, 'shared optical report schema mismatch');
  assert.equal(report.requestedRoute, ROUTE, 'shared optical requested route mismatch');
  sameNumbers(report.scaleLadder || [], CAPTURE_SCALES, 'shared optical capture scale ladder mismatch');
  sameNumbers(report.timingScaleLadder || [], TIMING_SCALES, 'shared optical timing scale ladder mismatch');
  assert.match(report.candidatePayload?.sha256 || '', /^[a-f0-9]{64}$/, 'candidate payload hash missing');

  const captures = Array.isArray(report.captures) ? report.captures : [];
  assert.equal(captures.length, 63, 'shared optical report requires exactly 63 captures');
  assert.equal(new Set(captures.map(capture => capture.cameraPoseHash)).size, 21, 'shared optical report requires 21 distinct camera poses');
  for (const capture of captures) {
    const receipt = capture.sparseHybridPresentationReceipt || {};
    assert.equal(receipt.effectiveRoute, ROUTE, 'shared optical capture effective route mismatch');
    assert.equal(receipt.fallbackReason, null, 'shared optical capture contains fallback evidence');
    assert.equal(receipt.raymarchScaleClamped, false, 'shared optical capture contains a raymarch scale clamp');
    assert.equal(receipt.intermediateClamped, false, 'shared optical capture contains an intermediate clamp');
    assert.equal(receipt.selfTransmittanceParityEligible, true, 'shared optical capture lacks self-transmittance parity eligibility');
    assert.equal(receipt.coefficientConservationEligible, false, 'unproven learned splat coefficients claimed exact conservation');
    assert.equal(Number(receipt.effectiveRaymarchScale), Number(capture.requestedRaymarchScale), 'shared optical capture scale substitution');
    assert.equal(capture.frameCount, report.frozenState?.baseFrameCount, 'shared optical capture advanced frame state');
    assert.equal(capture.simStepCount, report.frozenState?.baseSimStepCount, 'shared optical capture advanced simulation state');
    assert.equal(capture.footprintAudit?.candidatePayloadSha256, report.candidatePayload.sha256, 'shared optical capture substituted candidate payload');
  }
  for (let cameraIndex = 0; cameraIndex < 21; cameraIndex += 1) {
    const cameraCaptures = captures.filter(capture => Number(capture.cameraIndex) === cameraIndex);
    assert.equal(cameraCaptures.length, 3, `shared optical camera ${cameraIndex} is partial`);
    sameNumbers(cameraCaptures.map(capture => capture.requestedRaymarchScale), CAPTURE_SCALES, `shared optical camera ${cameraIndex} scale coverage mismatch`);
  }

  const timingProfiles = Array.isArray(report.timingProfiles) ? report.timingProfiles : [];
  assert.equal(timingProfiles.length, 2, 'shared optical report requires two timing profiles');
  sameNumbers(timingProfiles.map(profile => profile.effectiveRaymarchScale), TIMING_SCALES, 'shared optical timing profile scale coverage mismatch');
  for (const profile of timingProfiles) {
    assert.equal(profile.status, 'complete', 'shared optical timing profile is incomplete');
    assert.equal(profile.effectiveRoute, ROUTE, 'shared optical timing effective route mismatch');
    assert.equal(profile.raymarchScaleClamped, false, 'shared optical timing contains a scale clamp');
    assert.equal(profile.warmupIterations, 3, 'shared optical timing warmup count mismatch');
    assert.equal(profile.sampleIterations, 7, 'shared optical timing sample count mismatch');
    for (const stage of TIMING_STAGES) {
      const distribution = profile.distribution?.[stage];
      assert.ok(distribution, `shared optical timing distribution missing ${stage}`);
      for (const statistic of ['median', 'p10', 'p90']) {
        assert.ok(Number.isFinite(Number(distribution[statistic])), `shared optical timing ${stage}.${statistic} is not finite`);
      }
    }
  }

  const personallyInspected = report.inspection?.personallyInspected === true;
  const claimsAcceptance = report.status === 'accepted' || report.verdict?.parityClaim === true;
  if (claimsAcceptance) {
    assert.equal(personallyInspected, true, 'shared optical parity acceptance requires personal inspection');
    assert.ok(report.inspection?.dynamicWitnessPath, 'shared optical parity acceptance requires a dynamic 360 witness');
    assert.ok(Array.isArray(report.inspection?.nativeFramePaths) && report.inspection.nativeFramePaths.length >= 3, 'shared optical parity acceptance requires sparse native frames');
  } else {
    assert.equal(report.status, 'captured-awaiting-personal-inspection', 'uninspected shared optical evidence cannot claim parity');
  }
  return {
    ok: true,
    parityClaimEligible: claimsAcceptance && personallyInspected,
    remainingGate: personallyInspected ? null : 'personal-dynamic-360-and-native-frame-inspection',
    captureCount: captures.length,
    cameraCount: 21,
    captureScales: [...CAPTURE_SCALES],
    timingScales: [...TIMING_SCALES],
  };
}
