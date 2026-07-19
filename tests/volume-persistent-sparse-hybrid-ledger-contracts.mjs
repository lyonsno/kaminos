import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const modulePath = join(root, 'volume-persistent-sparse-hybrid-ledger.mjs');

assert.ok(
  existsSync(modulePath),
  'Bailiff must own a manifest-pinned sparse-positive-complement ledger emitter before Census capture can begin',
);

const source = readFileSync(modulePath, 'utf8');
const {
  ARM_IDS,
  EXPECTED_COHORT_MANIFEST_SHA256,
  auditFullCandidateCountContract,
  buildCoefficientLedger,
  buildExpectedLedgerContract,
  buildFailedLedgerReport,
  requireCapturedEvidence,
} = await import(pathToFileURL(modulePath));

const EXPECTED_SHA256 = '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20';
const EXPECTED_ARMS = [
  'full-correct',
  'sparse-drop',
  'sparse-conservative',
  'sparse-positive-complement',
];

test('ledger identity is pinned to the immutable producer artifact', () => {
  assert.equal(EXPECTED_COHORT_MANIFEST_SHA256, EXPECTED_SHA256);
  assert.deepEqual(ARM_IDS, EXPECTED_ARMS);
  assert.doesNotMatch(source, /selectOpticalEnergy|rerunSelection|function\s+\w*select/i);
  const expected = buildExpectedLedgerContract({
    schema: 'persistent-sparse-cohort-export-v0',
    authority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
    source: { implementationBundle: { sha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f' } },
    states: [114, 116, 118, 120].map(steps => ({
      stateId: `coefficient-state-${steps}`,
      rowCount: 481447,
      arrays: { nativeCellIndices: { sha256: `${steps}`.padStart(64, '0') } },
      sourceRows: {
        count: 1925788,
        nativeCellIndices: { sha256: `${steps + 1}`.padStart(64, '0') },
      },
      camera: { width: 900, height: 960, cameraPose: { position: [1, 2, 3] } },
    })),
  });
  assert.equal(expected.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(expected.rendererIdentity, 'shared-linear-hdr-sparse-splat-positive-residual-v0');
  assert.equal(expected.recurrenceIdentity, 'ordered-emission-extinction-shared-transmittance-v0');
  assert.equal(expected.residualGridScale, 0.10);
  assert.equal(expected.residualRaySteps, 64);
  assert.equal(expected.width, 900);
  assert.equal(expected.height, 960);
});

test('one scalar full count cannot impersonate state-varying authenticated populations', () => {
  const states = [
    ['coefficient-state-114', 1924725],
    ['coefficient-state-116', 1926470],
    ['coefficient-state-118', 1927051],
    ['coefficient-state-120', 1925788],
  ].map(([stateId, count]) => ({ stateId, sourceRows: { count } }));
  assert.throws(
    () => auditFullCandidateCountContract({ states }, 1925788),
    /state-varying authenticated full populations.*114=1924725.*116=1926470.*118=1927051.*120=1925788/,
  );
});

test('coefficient ownership stays nonnegative and exact in every arm', () => {
  const sourceTotals = { emission: 100, extinction: 80 };
  const sparseTotals = { emission: 32, extinction: 26 };
  assert.deepEqual(buildCoefficientLedger('full-correct', sourceTotals, sparseTotals), {
    emission: { source: 100, splat: 100, residual: 0, dropped: 0 },
    extinction: { source: 80, splat: 80, residual: 0, dropped: 0 },
  });
  assert.deepEqual(buildCoefficientLedger('sparse-drop', sourceTotals, sparseTotals), {
    emission: { source: 100, splat: 32, residual: 0, dropped: 68 },
    extinction: { source: 80, splat: 26, residual: 0, dropped: 54 },
  });
  assert.deepEqual(buildCoefficientLedger('sparse-conservative', sourceTotals, sparseTotals), {
    emission: { source: 100, splat: 100, residual: 0, dropped: 0 },
    extinction: { source: 80, splat: 80, residual: 0, dropped: 0 },
  });
  assert.deepEqual(buildCoefficientLedger('sparse-positive-complement', sourceTotals, sparseTotals), {
    emission: { source: 100, splat: 32, residual: 68, dropped: 0 },
    extinction: { source: 80, splat: 26, residual: 54, dropped: 0 },
  });
  assert.throws(
    () => buildCoefficientLedger('sparse-positive-complement', sourceTotals, { emission: 101, extinction: 26 }),
    /outside source ownership/,
  );
});

test('fallback, clamped, partial, stale, and non-WebGPU evidence cannot claim capture', () => {
  const complete = {
    route: {
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      backend: 'WebGPU:apple',
      fallbackReason: null,
    },
    request: { residualGridScale: 0.10, residualRaySteps: 64, width: 900, height: 960 },
    effective: { residualGridScale: 0.10, residualRaySteps: 64, width: 900, height: 960 },
    recurrenceIdentity: 'ordered-emission-extinction-shared-transmittance-v0',
    presentation: { targetFormat: 'rgba16float', exposure: 0.96, gradePower: 0.84, independentlyToneMapped: false },
    timing: {
      timestampStatus: 'available',
      stages: Object.fromEntries([
        'selection', 'compaction', 'deposition', 'splatRaster', 'residualMarch',
        'reconstruction', 'composition', 'chargedTotal',
      ].map(name => [name, { status: 'sampled', ms: 0 }])),
    },
    capture: {
      authority: 'gpu-linear-hdr-readback-live-held-state-v0',
      freshnessStatus: 'live-controlled-capture',
      rgbaFloatCount: 900 * 960 * 4,
      finitePixelCount: 900 * 960,
      litPixels: 1,
    },
  };
  assert.equal(requireCapturedEvidence(complete), true);
  for (const mutate of [
    row => { row.route.fallbackReason = 'fallback'; },
    row => { row.effective.residualGridScale = 0.2; },
    row => { row.timing.stages.residualMarch.status = 'unavailable'; },
    row => { row.capture.rgbaFloatCount -= 4; },
    row => { row.capture.freshnessStatus = 'cached'; },
    row => { row.route.backend = 'cpu-oracle'; },
    row => { row.presentation.exposure = 1; },
    row => { row.presentation.independentlyToneMapped = true; },
  ]) {
    const evidence = structuredClone(complete);
    mutate(evidence);
    assert.throws(() => requireCapturedEvidence(evidence));
  }
});

test('failed receipts remain route, cohort, and requested-config bound', () => {
  const expected = {
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    cohortSchema: 'persistent-sparse-cohort-export-v0',
    cohortManifestSha256: EXPECTED_SHA256,
    cohortAuthority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
    coefficientAuthority: 'exact-local-layer-emission-extinction',
    implementationBundleSha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f',
    ownershipAuthority: 'complementary-local-optical-coefficient-ownership-v0',
    fullCandidateCount: 1925788,
    sparseCandidateCount: 481447,
    stateIds: ['coefficient-state-114', 'coefficient-state-116', 'coefficient-state-118', 'coefficient-state-120'],
    armIds: EXPECTED_ARMS,
    residualGridScale: 0.10,
    residualRaySteps: 64,
    width: 900,
    height: 960,
  };
  const failure = buildFailedLedgerReport({
    expected,
    durableReportPath: '/durable/report.json',
    failurePhase: 'gpu-route-load',
    reason: 'renderer unavailable',
    lastTrustworthyEvidence: 'manifest authenticated',
    effectiveRouteStatus: 'unresolved-before-effective-route',
    sourceBindingStatus: 'authenticated',
    effectiveConfigStatus: 'verified',
  });
  assert.equal(failure.status, 'failed');
  assert.equal(failure.route.requestedRoute, expected.effectiveRoute);
  assert.equal(failure.source.cohortManifestSha256, EXPECTED_SHA256);
  assert.deepEqual(failure.request.stateIds, expected.stateIds);
  assert.equal(failure.failureContext.sourceBindingStatus, 'authenticated');
});
