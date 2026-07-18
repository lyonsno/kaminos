import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSparseHybridOpticalRecurrenceReport } from '../volume-sparse-hybrid-optical-recurrence-contract.mjs';

const ROUTE = 'coarse-residual-plus-full-resolution-splat-shared-optical-recurrence-v0';
const SCALES = [0.20, 0.15, 0.10];

function fixture() {
  const captures = [];
  for (let cameraIndex = 0; cameraIndex < 21; cameraIndex += 1) {
    for (const scale of SCALES) {
      captures.push({
        cameraIndex,
        cameraPoseHash: `camera-${cameraIndex}`,
        requestedRaymarchScale: scale,
        frameCount: 96,
        simStepCount: 96,
        footprintAudit: { candidatePayloadSha256: 'a'.repeat(64) },
        sparseHybridPresentationReceipt: {
          effectiveRoute: ROUTE,
          fallbackReason: null,
          effectiveRaymarchScale: scale,
          raymarchScaleClamped: false,
          intermediateClamped: false,
          coefficientConservationEligible: false,
          selfTransmittanceParityEligible: true,
        },
      });
    }
  }
  const timingProfiles = [0.20, 0.15].map(scale => ({
    status: 'complete',
    effectiveRoute: ROUTE,
    effectiveRaymarchScale: scale,
    raymarchScaleClamped: false,
    warmupIterations: 3,
    sampleIterations: 7,
    distribution: Object.fromEntries([
      'coarseRaymarchMs',
      'reconstructionMs',
      'splatRasterMs',
      'recurrenceMs',
      'totalGpuMs',
    ].map(stage => [stage, { median: 1, p10: 0.9, p90: 1.1 }])),
  }));
  return {
    schema: 'kaminos.volume.sparse-hybrid-optical-orbit-capture.v0',
    status: 'captured-awaiting-personal-inspection',
    requestedRoute: ROUTE,
    scaleLadder: SCALES,
    timingScaleLadder: [0.20, 0.15],
    frozenState: { baseFrameCount: 96, baseSimStepCount: 96 },
    candidatePayload: { sha256: 'a'.repeat(64) },
    captures,
    timingProfiles,
    inspection: { personallyInspected: false, disposition: 'captured-awaiting-personal-inspection' },
  };
}

test('complete captured evidence remains inspection-gated', () => {
  const validated = validateSparseHybridOpticalRecurrenceReport(fixture());
  assert.equal(validated.parityClaimEligible, false);
  assert.equal(validated.remainingGate, 'personal-dynamic-360-and-native-frame-inspection');
});

test('false optical eligibility cannot claim parity', () => {
  const report = fixture();
  report.status = 'accepted';
  report.inspection = { personallyInspected: true, disposition: 'accepted' };
  report.captures[0].sparseHybridPresentationReceipt.selfTransmittanceParityEligible = false;
  assert.throws(() => validateSparseHybridOpticalRecurrenceReport(report), /self-transmittance parity eligibility/);
});

test('fallback evidence cannot claim parity', () => {
  const report = fixture();
  report.captures[0].sparseHybridPresentationReceipt.fallbackReason = 'substituted-route';
  assert.throws(() => validateSparseHybridOpticalRecurrenceReport(report), /fallback/);
});

test('clamped evidence cannot claim parity', () => {
  const report = fixture();
  report.timingProfiles[0].raymarchScaleClamped = true;
  assert.throws(() => validateSparseHybridOpticalRecurrenceReport(report), /clamp/);
});

test('partial orbit cannot claim parity', () => {
  const report = fixture();
  report.captures.pop();
  assert.throws(() => validateSparseHybridOpticalRecurrenceReport(report), /63 captures/);
});
