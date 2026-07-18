import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const contractUrl = new URL('../volume-boundary-splat-full-support-multiplicity-report.mjs', import.meta.url);
assert.ok(
  existsSync(contractUrl),
  'Census must own a durable Full Flame multiplicity report validator before the consumer runtime can close evidence',
);

const {
  FULL_SUPPORT_MULTIPLICITY_SCHEMA,
  validateFullSupportMultiplicityReport,
} = await import(contractUrl.href);

const EXPECTED = {
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  rendererIdentity: 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0',
  modelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  selectorIdentity: 'boundary-splat-live-union-projected-footprint-hash-thinning-v0',
  descriptorIdentity: 'boundary-splat-instance-descriptor-v0',
  allocationIdentity: 'boundary-splat-projected-area-nested-tiers-v0',
  sourceUnionCount: 1_899_742,
  requestedInstanceCount: 100,
  allowedTargetPixels: [6, 9, 24],
  selectedCandidateCountByTarget: {
    6: 204_128,
    9: 243_742,
    24: 440_786,
  },
};

function validReport() {
  return {
    schema: FULL_SUPPORT_MULTIPLICITY_SCHEMA,
    status: 'captured',
    failurePhase: null,
    lastTrustworthyEvidence: 'all exact route, population, tier, timing, and image gates passed',
    durableReportPath: '/durable/full-support-multiplicity-report.json',
    route: {
      requestedRoute: EXPECTED.effectiveRoute,
      effectiveRoute: EXPECTED.effectiveRoute,
      backend: EXPECTED.backend,
      rendererIdentity: EXPECTED.rendererIdentity,
      modelIdentity: EXPECTED.modelIdentity,
      selectorIdentity: EXPECTED.selectorIdentity,
      descriptorIdentity: EXPECTED.descriptorIdentity,
      allocationIdentity: EXPECTED.allocationIdentity,
      fallbackReason: null,
    },
    source: {
      simulatorCount: 1,
      compactionCount: 1,
      sameStateCaptureId: 'coefficient-state-120-f120-s120',
      sourceUnionCount: EXPECTED.sourceUnionCount,
      sourceRowsPreserved: true,
      hiddenCapInstalled: false,
      stableNativeCellIdAuthority: 'gpu-compacted-native-grid-linear-index-v0',
    },
    request: {
      requestedInstanceCount: EXPECTED.requestedInstanceCount,
      requestedTargetPixels: EXPECTED.allowedTargetPixels,
    },
    effective: {
      instanceCount: EXPECTED.requestedInstanceCount,
      targetPixels: EXPECTED.allowedTargetPixels,
      uniqueSelectedCandidateCount: 440_786,
    },
    tiers: [
      {
        requestedTargetPixels: 24,
        effectiveTargetPixels: 24,
        descriptorCount: 10,
        selectedCandidateCount: 440_786,
        renderedInstanceCount: 4_407_860,
      },
      {
        requestedTargetPixels: 9,
        effectiveTargetPixels: 9,
        descriptorCount: 30,
        selectedCandidateCount: 243_742,
        renderedInstanceCount: 7_312_260,
      },
      {
        requestedTargetPixels: 6,
        effectiveTargetPixels: 6,
        descriptorCount: 60,
        selectedCandidateCount: 204_128,
        renderedInstanceCount: 12_247_680,
      },
    ],
    selectionResidency: {
      authority: 'gpu-compacted-stable-native-cell-id-prefix-audit-v0',
      stableOrderIdentity: 'boundary-splat-deterministic-native-cell-hash-order-v0',
      populationStateId: 'coefficient-state-120-f120-s120',
      nestedPrefixValidated: true,
      cohorts: [
        { targetPixels: 6, selectedCandidateCount: 204_128, nativeCellIdSha256: '6'.repeat(64) },
        { targetPixels: 9, selectedCandidateCount: 243_742, nativeCellIdSha256: '9'.repeat(64) },
        { targetPixels: 24, selectedCandidateCount: 440_786, nativeCellIdSha256: '2'.repeat(64) },
      ],
    },
    accounting: {
      totalRasterInstanceCount: 23_967_800,
      projectedFragmentCount: 78_456_321.5,
      finalOverflowCount: 0,
      initialOverflowCount: 176_432,
      capacityRetryCount: 1,
      candidateCopyBytes: 0,
    },
    timing: {
      timestampStatus: 'available',
      timeUnit: 'ms',
      stages: {
        compaction: { status: 'sampled', ms: 4.75 },
        tierSetup: { status: 'sampled', ms: 0.18 },
        splatRaster: { status: 'sampled', ms: 12.5 },
        chargedTotal: { status: 'sampled', ms: 17.43 },
      },
    },
    capture: {
      authority: 'gpu-rgba8-readback-frozen-sim-state-v0',
      freshnessStatus: 'live-controlled-capture',
      captureNonce: 'full-support-multiplicity-r1-frame-120',
      width: 1280,
      height: 960,
      litPixels: 284_112,
      rgbaByteLength: 4_915_200,
      pngSha256: 'a'.repeat(64),
    },
  };
}

function validate(report) {
  return validateFullSupportMultiplicityReport(report, EXPECTED);
}

function expectRejected(label, mutate, expectedError) {
  const report = structuredClone(validReport());
  mutate(report);
  const result = validate(report);
  assert.equal(result.ok, false, `${label} must be rejected`);
  assert.ok(result.errors.includes(expectedError), `${label} must report ${expectedError}; got ${result.errors.join(', ')}`);
}

const valid = validate(validReport());
assert.equal(valid.ok, true, valid.errors.join(', '));
assert.equal(valid.accounting.totalRasterInstanceCount, 23_967_800);
assert.equal(valid.accounting.uniqueSelectedCandidateCount, 440_786);
assert.equal(valid.accounting.chargedTotalMs, 17.43);

expectRejected('wrong effective route', report => { report.route.effectiveRoute = 'fallback-canvas-v0'; }, 'wrong-effective-route');
expectRejected('wrong backend', report => { report.route.backend = 'WebGL2'; }, 'wrong-backend');
expectRejected('wrong renderer', report => { report.route.rendererIdentity = 'old-splat-renderer-v0'; }, 'wrong-renderer-identity');
expectRejected('wrong model', report => { report.route.modelIdentity = 'sha256:wrong'; }, 'wrong-model-identity');
expectRejected('wrong selector', report => { report.route.selectorIdentity = 'fixed-cap-v0'; }, 'wrong-selector-identity');
expectRejected('wrong descriptor', report => { report.route.descriptorIdentity = 'prerecorded-loop-v0'; }, 'wrong-descriptor-identity');
expectRejected('wrong allocation', report => { report.route.allocationIdentity = 'global-replication-v0'; }, 'wrong-allocation-identity');
expectRejected('fallback', report => { report.route.fallbackReason = 'capacity-fallback'; }, 'fallback-present');
expectRejected('second simulator', report => { report.source.simulatorCount = 2; }, 'simulator-count-not-one');
expectRejected('repeated compaction', report => { report.source.compactionCount = 100; }, 'compaction-count-not-one');
expectRejected('wrong source union', report => { report.source.sourceUnionCount -= 1; }, 'source-union-count-mismatch');
expectRejected('source rows not preserved', report => { report.source.sourceRowsPreserved = false; }, 'source-rows-not-preserved');
expectRejected('hidden cap', report => { report.source.hiddenCapInstalled = true; }, 'hidden-cap-installed');
expectRejected('stale effective instances', report => { report.effective.instanceCount = 64; }, 'requested-effective-instance-count-mismatch');
expectRejected('partial descriptor tiers', report => { report.tiers[2].descriptorCount = 59; }, 'tier-descriptor-count-mismatch');
expectRejected('stale effective target', report => { report.tiers[0].effectiveTargetPixels = 12; }, 'requested-effective-target-mismatch');
expectRejected('unexpected target', report => { report.effective.targetPixels = [3, 6, 9, 24]; }, 'effective-target-set-mismatch');
expectRejected('tier raster arithmetic drift', report => { report.tiers[1].renderedInstanceCount -= 1; }, 'tier-rendered-instance-count-mismatch');
expectRejected('global raster arithmetic drift', report => { report.accounting.totalRasterInstanceCount -= 1; }, 'total-raster-instance-count-mismatch');
expectRejected('stale selected population', report => {
  report.tiers[1].selectedCandidateCount -= 1;
  report.tiers[1].renderedInstanceCount -= report.tiers[1].descriptorCount;
}, 'selected-candidate-count-mismatch');
expectRejected('selected count beyond source', report => { report.tiers[0].selectedCandidateCount = 2_000_000; }, 'selected-candidate-count-out-of-range');
expectRejected('missing residency audit', report => { report.selectionResidency = null; }, 'selection-residency-authority-mismatch');
expectRejected('wrong residency state', report => { report.selectionResidency.populationStateId = 'cached-state-119'; }, 'selection-residency-state-mismatch');
expectRejected('non-nested cohorts', report => { report.selectionResidency.nestedPrefixValidated = false; }, 'nested-prefix-not-validated');
expectRejected('partial residency cohort', report => { report.selectionResidency.cohorts.pop(); }, 'selection-residency-target-set-mismatch');
expectRejected('stale residency count', report => { report.selectionResidency.cohorts[0].selectedCandidateCount -= 1; }, 'selection-residency-count-mismatch');
expectRejected('missing residency hash', report => { report.selectionResidency.cohorts[0].nativeCellIdSha256 = ''; }, 'selection-residency-hash-invalid');
expectRejected('final overflow', report => { report.accounting.finalOverflowCount = 1; }, 'final-overflow-present');
expectRejected('copy', report => { report.accounting.candidateCopyBytes = 64; }, 'candidate-copy-present');
expectRejected('missing timestamp', report => { report.timing.timestampStatus = 'unavailable'; }, 'timestamp-status-unavailable');
expectRejected('partial timestamp', report => { report.timing.stages.splatRaster.ms = null; }, 'partial-stage-timestamps');
expectRejected('dishonest charged total', report => { report.timing.stages.chargedTotal.ms = 12.5; }, 'charged-total-mismatch');
expectRejected('blank capture', report => { report.capture.litPixels = 0; }, 'blank-capture');
expectRejected('partial rgba capture', report => { report.capture.rgbaByteLength -= 4; }, 'capture-payload-partial');
expectRejected('cached capture', report => { report.capture.freshnessStatus = 'cached'; }, 'capture-not-live');
expectRejected('missing capture nonce', report => { report.capture.captureNonce = ''; }, 'capture-nonce-missing');
expectRejected('missing durable report', report => { report.durableReportPath = ''; }, 'durable-report-path-missing');

const durableFailure = validReport();
durableFailure.status = 'failed';
durableFailure.failurePhase = 'route-load';
durableFailure.lastTrustworthyEvidence = 'server hash matched before route load';
durableFailure.durableReportPath = '/durable/failed-full-support-multiplicity-report.json';
const acceptedFailure = validate(durableFailure);
assert.equal(acceptedFailure.ok, true, acceptedFailure.errors.join(', '));
assert.equal(acceptedFailure.status, 'failed');

expectRejected('failure without phase', report => {
  report.status = 'failed';
  report.failurePhase = null;
}, 'failure-phase-missing');
expectRejected('failure without last evidence', report => {
  report.status = 'failed';
  report.failurePhase = 'route-load';
  report.lastTrustworthyEvidence = '';
}, 'last-trustworthy-evidence-missing');

console.log('boundary splat full support multiplicity report contracts passed');
