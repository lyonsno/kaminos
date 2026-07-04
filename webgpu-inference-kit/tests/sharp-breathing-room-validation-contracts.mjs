import assert from 'node:assert/strict';

import {
  SHARP_BREATHING_ROOM_VALIDATION_SCHEMA,
  createSchedulerVerificationReceipt,
  validateSharpBreathingRoomComparisonEvidence,
} from '../src/index.js';

const CLAIM_BOUNDARY = 'single-pair smoke only; no optimization, speedup, slowdown, or stable throughput claim';

function schedulerVerification({
  status = undefined,
  timingAuthority = 'browser-wall-clock',
  events = true,
  boundaryAssertions = true,
  vitBlockVerified = false,
} = {}) {
  const traceEvents = events ? [
    { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'chunk-start' },
    { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-start' },
    { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-end' },
    { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-start' },
    { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-end' },
    { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'queue-work-done-start' },
    { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'queue-work-done-end' },
    { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'js-yield-start' },
    { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'js-yield-end' },
  ] : [];
  const assertions = boundaryAssertions ? [
    {
      field: 'phaseChunkSize.spnPatch',
      requested: 1,
      effective: 1,
      status: 'verified',
      observedBoundary: 'spn-patch-chunk',
      observedCount: 1,
      observedQueueWaitCount: 1,
      observedYieldCount: 1,
    },
    {
      field: 'phaseYieldMs.gaussianPhase',
      requested: 4,
      effective: 4,
      status: 'verified',
      observedBoundary: 'gaussian-phase',
      observedCount: 1,
      observedQueueWaitCount: 1,
      observedYieldCount: 1,
    },
    ...(vitBlockVerified ? [{
      field: 'phaseChunkSize.vitBlock',
      requested: 2,
      effective: 2,
      status: 'verified',
      observedBoundary: 'vit-block-chunk',
      observedCount: 1,
      observedQueueWaitCount: 1,
      observedYieldCount: 1,
    }] : []),
  ] : [];
  return createSchedulerVerificationReceipt({
    status,
    route: {
      pipelineId: 'sharp-image-to-splat-live-v0',
      requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
    },
    scheduler: {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      requestedScheduler: {
        mode: 'cooperative',
        phaseChunkSize: {
          spnPatch: 1,
        },
        waitForSubmittedWorkDone: true,
        yieldMs: 3,
        gaussianPhaseYieldMs: 4,
        ...(vitBlockVerified ? { vitBlockChunkSize: 2 } : {}),
      },
      effectiveScheduler: {
        mode: 'cooperative',
        phaseChunkSize: {
          spnPatch: 1,
        },
        waitForSubmittedWorkDone: true,
        yieldMs: 3,
        gaussianPhaseYieldMs: 4,
        unsupportedFields: vitBlockVerified ? [] : ['phaseChunkSize.vitBlock'],
        ...(vitBlockVerified ? { vitBlockChunkSize: 2 } : {}),
      },
    },
    backpressure: {
      schema: 'kaminos.webgpu-route-backpressure.v0',
      requestedBudget: 'visible-wait',
      effectiveBudget: 'visible-wait',
    },
    eventTrace: {
      schema: 'kaminos.webgpu-scheduler-event-trace.v0',
      timingAuthority,
      events: traceEvents,
    },
    boundaryAssertions: assertions,
  });
}

function comparisonReport({
  status = 'valid-smoke',
  evidenceClass = 'single-pair-smoke',
  claimBoundary = CLAIM_BOUNDARY,
  outputStatus = 'same-output',
  baselineTiming = { frameP95Ms: 124.1, queueDoneP95Ms: 473.6, rafFps: 8.1 },
  cooperativeTiming = { frameP95Ms: 121.8, queueDoneP95Ms: 410.2, rafFps: 8.7 },
  cooperativeVerification = schedulerVerification(),
  baselineVerification = { status: 'scheduler-unverified', classification: 'config-only' },
  baselineStageStatus = 'real',
  cooperativeStageStatus = 'real',
  cooperativeUnsupportedFields = ['phaseChunkSize.vitBlock'],
  visibleUi = null,
  optimizationClaim = null,
} = {}) {
  return {
    schema: 'kaminos.sharp-breathing-room-comparison.v0',
    status,
    evidenceClass,
    claimBoundary,
    routeIdentity: {
      requestedPipelineId: 'sharp-image-to-splat-live-v0',
      requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
    },
    input: { path: '/tmp/source.png', sha256: 'f'.repeat(64), bytes: 10 },
    flameBudget: { budgetId: 'real-flame-over-sharp-0704' },
    outputEquivalence: {
      status: outputStatus,
      sha256: outputStatus === 'same-output' ? 'a'.repeat(64) : null,
    },
    runs: [
      {
        profileId: 'baseline-default',
        stageStatus: baselineStageStatus,
        artifact: { path: '/tmp/baseline.ply', bytes: 100, sha256: 'a'.repeat(64), status: 'real' },
        schedulerVerification: baselineVerification,
        timing: baselineTiming,
        routePhaseTimeline: [{ phase: 'sharp-webgpu:spn-patch-encoder' }],
      },
      {
        profileId: 'cooperative-spn-gaussian',
        stageStatus: cooperativeStageStatus,
        artifact: { path: '/tmp/cooperative.ply', bytes: 100, sha256: outputStatus === 'same-output' ? 'a'.repeat(64) : 'b'.repeat(64), status: 'real' },
        schedulerVerification: cooperativeVerification,
        unsupportedFields: cooperativeUnsupportedFields,
        timing: cooperativeTiming,
        routePhaseTimeline: [{ phase: 'sharp-webgpu:spn-patch-encoder' }],
      },
    ],
    schedulerComparison: {
      baseline: { status: baselineVerification.status, classification: baselineVerification.classification },
      cooperative: {
        status: cooperativeVerification.status,
        classification: cooperativeVerification.classification,
        unsupportedFields: cooperativeUnsupportedFields,
        timingAuthority: cooperativeVerification.eventTrace?.timingAuthority || null,
      },
    },
    timingComparison: {
      frameP95Ms: {
        baseline: baselineTiming?.frameP95Ms ?? null,
        cooperative: cooperativeTiming?.frameP95Ms ?? null,
      },
      queueDoneP95Ms: {
        baseline: baselineTiming?.queueDoneP95Ms ?? null,
        cooperative: cooperativeTiming?.queueDoneP95Ms ?? null,
      },
    },
    falseClosureChecks: {
      singlePairOptimizationClaimRejected: true,
    },
    downgrades: ['single-pair-smoke-not-optimization-proof'],
    ...(visibleUi ? { visibleUi } : {}),
    ...(optimizationClaim ? { optimizationClaim } : {}),
  };
}

const valid = validateSharpBreathingRoomComparisonEvidence(comparisonReport());
assert.equal(valid.schema, SHARP_BREATHING_ROOM_VALIDATION_SCHEMA);
assert.equal(valid.status, 'valid-smoke');
assert.equal(valid.ok, true);
assert.equal(valid.canClaim.breathingRoomSmoke, true);
assert.equal(valid.canClaim.optimization, false);
assert.ok(valid.downgrades.includes('single-pair-smoke-not-optimization-proof'));
assert.equal(valid.falseClosureChecks.singlePairOptimizationClaimRejected, true);
assert.equal(valid.falseClosureChecks.unsupportedVitBlockOverclaimed, false);

const routeBridge = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  status: 'route-bridge',
  evidenceClass: 'route-bridge',
  baselineTiming: {},
  cooperativeTiming: {},
}));
assert.equal(routeBridge.ok, true);
assert.equal(routeBridge.status, 'route-bridge');
assert.equal(routeBridge.canClaim.routeBridge, true);
assert.equal(routeBridge.canClaim.breathingRoomSmoke, false);
assert.equal(routeBridge.errors.includes('missing-frame-queue-evidence'), false);

const forgedVerified = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  cooperativeVerification: {
    schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
    status: 'verified',
    classification: 'observed-boundary',
    eventTrace: { timingAuthority: 'browser-wall-clock', events: [] },
    boundaryAssertions: [],
  },
}));
assert.equal(forgedVerified.ok, false);
assert.equal(forgedVerified.status, 'invalid');
assert.ok(forgedVerified.errors.includes('cooperative-verified-without-boundary-proof'));
assert.equal(forgedVerified.falseClosureChecks.verifiedWithoutObservedBoundary, true);

const proxyOnly = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  cooperativeVerification: schedulerVerification({ timingAuthority: 'raf-and-queue-proxy' }),
}));
assert.equal(proxyOnly.ok, false);
assert.equal(proxyOnly.status, 'invalid');
assert.ok(proxyOnly.errors.includes('cooperative-scheduler-proof-proxy-only'));
assert.equal(proxyOnly.falseClosureChecks.proxyOnlySchedulerProof, true);

const missingFrameQueue = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  baselineTiming: { frameP95Ms: null, queueDoneP95Ms: 473.6 },
}));
assert.equal(missingFrameQueue.ok, false);
assert.equal(missingFrameQueue.status, 'invalid');
assert.ok(missingFrameQueue.errors.includes('baseline-frame-queue-evidence-missing'));
assert.equal(missingFrameQueue.falseClosureChecks.missingFrameQueueEvidence, true);

const outputMismatch = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  outputStatus: 'mismatch',
}));
assert.equal(outputMismatch.ok, false);
assert.equal(outputMismatch.status, 'invalid');
assert.ok(outputMismatch.errors.includes('same-input-output-mismatch'));
assert.equal(outputMismatch.falseClosureChecks.sameInputOutputMismatch, true);

const vitOverclaim = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  cooperativeVerification: schedulerVerification({ vitBlockVerified: true }),
  cooperativeUnsupportedFields: [],
}));
assert.equal(vitOverclaim.ok, false);
assert.equal(vitOverclaim.status, 'invalid');
assert.ok(vitOverclaim.errors.includes('vit-block-chunking-overclaimed'));
assert.equal(vitOverclaim.falseClosureChecks.unsupportedVitBlockOverclaimed, true);

const staleUi = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  visibleUi: {
    schedulerVerificationStatus: 'scheduler-unverified',
    evidenceClass: 'fallback-demo',
  },
}));
assert.equal(staleUi.ok, false);
assert.equal(staleUi.status, 'invalid');
assert.ok(staleUi.errors.includes('visible-ui-contradiction'));
assert.equal(staleUi.falseClosureChecks.visibleUiContradiction, true);

const fixture = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  baselineStageStatus: 'fixture',
}));
assert.equal(fixture.ok, false);
assert.equal(fixture.status, 'invalid');
assert.ok(fixture.errors.includes('baseline-default-fixture-route'));
assert.equal(fixture.falseClosureChecks.fallbackOrFixtureRoute, true);

const optimizationClaim = validateSharpBreathingRoomComparisonEvidence(comparisonReport({
  optimizationClaim: {
    kind: 'speedup',
    value: 1.1,
  },
}));
assert.equal(optimizationClaim.ok, false);
assert.equal(optimizationClaim.status, 'invalid');
assert.ok(optimizationClaim.errors.includes('single-pair-optimization-claim'));
assert.equal(optimizationClaim.falseClosureChecks.singlePairOptimizationClaimRejected, true);

console.log('sharp breathing-room validation contracts passed');
