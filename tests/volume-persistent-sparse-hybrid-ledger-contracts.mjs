import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  aggregateCoefficientTotalsExact,
  authenticateDerivedComplementDescriptor,
  auditFullCandidateCountContract,
  buildCoefficientLedger,
  buildComplementRowIndices,
  buildExpectedLedgerContract,
  buildFailedLedgerReport,
  buildSourceAuthenticationFailureReport,
  requireCapturedEvidence,
  requireExactCoefficientOwnership,
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
    states: [114, 116, 118, 120].map((steps, index) => ({
      stateId: `coefficient-state-${steps}`,
      rowCount: 481447,
      arrays: { nativeCellIndices: { sha256: `${steps}`.padStart(64, '0') } },
      sourceRows: {
        count: [1924725, 1926470, 1927051, 1925788][index],
        nativeCellIndices: { sha256: `${steps + 1}`.padStart(64, '0') },
      },
      camera: { width: 900, height: 960, cameraPose: { position: [1, 2, 3] } },
    })),
  });
  assert.equal(expected.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(expected.rendererIdentity, 'shared-linear-hdr-sparse-splat-positive-residual-v0');
  assert.equal(expected.recurrenceIdentity, 'ordered-emission-extinction-shared-transmittance-v0');
  assert.deepEqual(expected.fullCandidateCountByState, {
    'coefficient-state-114': 1924725,
    'coefficient-state-116': 1926470,
    'coefficient-state-118': 1927051,
    'coefficient-state-120': 1925788,
  });
  assert.equal(expected.fullCandidateCount, undefined);
  assert.equal(expected.residualGridScale, 0.10);
  assert.equal(expected.residualRaySteps, 64);
  assert.equal(expected.width, 900);
  assert.equal(expected.height, 960);
});

test('state-keyed full populations are exact and scalar aliases stay forbidden', () => {
  const states = [
    ['coefficient-state-114', 1924725],
    ['coefficient-state-116', 1926470],
    ['coefficient-state-118', 1927051],
    ['coefficient-state-120', 1925788],
  ].map(([stateId, count]) => ({ stateId, sourceRows: { count } }));
  const expectedCounts = Object.fromEntries(states.map(state => [state.stateId, state.sourceRows.count]));
  assert.deepEqual(auditFullCandidateCountContract({ states }, expectedCounts), expectedCounts);
  assert.throws(() => auditFullCandidateCountContract({ states }, 1925788), /state-keyed/);
  const manifest = {
    schema: 'persistent-sparse-cohort-export-v0',
    authority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
    source: { implementationBundle: { sha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f' } },
    states: states.map((state, index) => ({
      ...state,
      rowCount: 481447,
      arrays: { nativeCellIndices: { sha256: `${index + 1}`.repeat(64) } },
      sourceRows: { ...state.sourceRows, nativeCellIndices: { sha256: `${index + 5}`.repeat(64) } },
      camera: { width: 900, height: 960, cameraPose: { position: [1, 2, 3] } },
    })),
  };
  const expected = buildExpectedLedgerContract(manifest);
  assert.deepEqual(expected.fullCandidateCountByState, expectedCounts);
  assert.equal(Object.hasOwn(expected, 'fullCandidateCount'), false);
});

test('positive complement is the disjoint source-order set difference', () => {
  assert.deepEqual(
    buildComplementRowIndices(7, new Uint32Array([1, 3, 6])),
    new Uint32Array([0, 2, 4, 5]),
  );
  assert.throws(() => buildComplementRowIndices(4, new Uint32Array([1, 1])), /duplicate/);
  assert.throws(() => buildComplementRowIndices(4, new Uint32Array([4])), /escaped/);
  assert.throws(() => buildComplementRowIndices(4, new Uint32Array([2, 1])), /source row order/);
});

test('binary32 coefficient ownership closes exactly before JSON projection', () => {
  const source = new Float32Array([
    1, 2, 3, 4, 5, 6, 7, 8,
    0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125, 0.00390625,
  ]);
  const sparse = source.slice(0, 8);
  const sourceTotals = aggregateCoefficientTotalsExact(source);
  const sparseTotals = aggregateCoefficientTotalsExact(sparse);
  for (const channel of ['emission', 'extinction']) {
    const sourceUnits = BigInt(sourceTotals[channel].binary32UnitSum);
    const sparseUnits = BigInt(sparseTotals[channel].binary32UnitSum);
    assert.ok(sourceUnits >= sparseUnits);
    assert.equal(sparseUnits + (sourceUnits - sparseUnits), sourceUnits);
    assert.equal(sourceTotals[channel].binary32UnitExponent, -149);
  }
});

test('derived complement descriptors are rehashed and confined to the artifact root', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kaminos-bailiff-complement-'));
  try {
    const artifactPath = join(directory, 'hybrid-artifact.json');
    const payloadPath = join(directory, 'states', 'complement.u32');
    const payload = Buffer.from(new Uint32Array([0, 2, 4]).buffer);
    mkdirSync(join(directory, 'states'));
    writeFileSync(payloadPath, payload);
    const descriptor = {
      path: 'states/complement.u32',
      bytes: payload.byteLength,
      sha256: '5c4f0026a5866967334fd37912b9c876b024f0b17f5fac1252ad635a96848b51',
      dtype: '<u4',
      shape: [3],
      semanticRole: 'source-order-positive-complement-row-indices',
      authentication: 'derived-from-authenticated-disjoint-source-row-partition-v0',
    };
    assert.equal(await authenticateDerivedComplementDescriptor({ artifactPath, descriptor, expectedRows: 3 }), true);
    await assert.rejects(
      authenticateDerivedComplementDescriptor({
        artifactPath,
        descriptor: { ...descriptor, sha256: 'f'.repeat(64) },
        expectedRows: 3,
      }),
      /SHA-256 drifted/,
    );
    const escapedPath = join(directory, '..', 'escaped-complement.u32');
    writeFileSync(escapedPath, payload);
    await assert.rejects(
      authenticateDerivedComplementDescriptor({
        artifactPath,
        descriptor: { ...descriptor, path: '../escaped-complement.u32' },
        expectedRows: 3,
      }),
      /escaped the artifact root/,
    );
    rmSync(escapedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  assert.throws(
    () => buildCoefficientLedger(
      'sparse-positive-complement',
      { emission: 0, extinction: 0 },
      { emission: 0.0000005, extinction: 0 },
    ),
    /outside source ownership/,
    'tiny sparse-over-source mass must not disappear behind a tolerance or complement clamp',
  );
});

test('publication gate rejects approximate-conservation sparse-over-source evidence', () => {
  assert.throws(
    () => requireExactCoefficientOwnership({
      armId: 'sparse-positive-complement',
      coefficientLedger: {
        emission: { source: 0, splat: 0.0000005, residual: 0.0000001, dropped: 0 },
        extinction: { source: 0, splat: 0.0000005, residual: 0.0000001, dropped: 0 },
      },
    }),
    /emission splat exceeds source ownership/,
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
    fullCandidateCountByState: {
      'coefficient-state-114': 1924725,
      'coefficient-state-116': 1926470,
      'coefficient-state-118': 1927051,
      'coefficient-state-120': 1925788,
    },
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
  assert.deepEqual(failure.request.fullCandidateCountByState, expected.fullCandidateCountByState);
  assert.equal(Object.hasOwn(failure.request, 'fullCandidateCount'), false);
  assert.equal(failure.failureContext.sourceBindingStatus, 'authenticated');
});

test('source authentication failures preserve phase and cannot claim authenticated arrays', () => {
  const expected = {
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    cohortSchema: 'persistent-sparse-cohort-export-v0',
    cohortManifestSha256: EXPECTED_SHA256,
    cohortAuthority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
    coefficientAuthority: 'exact-local-layer-emission-extinction',
    implementationBundleSha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f',
    ownershipAuthority: 'complementary-local-optical-coefficient-ownership-v0',
    fullCandidateCountByState: Object.fromEntries([114, 116, 118, 120].map((step, index) => [
      `coefficient-state-${step}`,
      [1924725, 1926470, 1927051, 1925788][index],
    ])),
    sparseCandidateCount: 481447,
    stateIds: [114, 116, 118, 120].map(step => `coefficient-state-${step}`),
    armIds: EXPECTED_ARMS,
    residualGridScale: 0.10,
    residualRaySteps: 64,
    width: 900,
    height: 960,
  };
  const error = new Error('coefficient SHA-256 drifted');
  error.failurePhase = 'source-array-authentication';
  const failure = buildSourceAuthenticationFailureReport({
    expected,
    durableReportPath: '/durable/report.json',
    error,
    sourcePopulationCountsByState: expected.fullCandidateCountByState,
  });
  assert.equal(failure.failurePhase, 'source-array-authentication');
  assert.equal(failure.failureContext.sourceBindingStatus, 'unresolved-before-source-binding');
  assert.doesNotMatch(failure.lastTrustworthyEvidence, /all arrays authenticated/i);
  assert.match(failure.reason, /SHA-256 drifted/);
});
