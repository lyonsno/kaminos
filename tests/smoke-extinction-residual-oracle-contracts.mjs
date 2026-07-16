import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const oraclePath = join(root, 'smoke-extinction-residual-oracle.mjs');

assert.ok(existsSync(oraclePath), 'smoke extinction residual oracle producer exists');

const {
  KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER,
  buildSmokeExtinctionResidualOracle,
} = await import(oraclePath);

const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function field(grid) {
  return new Float32Array(grid ** 3 * fluidChannels.length);
}

function setCell(values, grid, x, y, z, channels) {
  const offset = (x + y * grid + z * grid * grid) * fluidChannels.length;
  for (const [name, value] of Object.entries(channels)) {
    values[offset + fluidChannels.indexOf(name)] = value;
  }
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const grid = 2;
const values = field(grid);
setCell(values, grid, 0, 0, 0, {
  smokeDensity: 1,
  detail: 0.1,
  microdetail: 0.5,
  interfaceShred: 0.25,
  velocityX: 0.2,
  velocityY: 0.4,
  velocityZ: -0.1,
});
setCell(values, grid, 1, 0, 0, { smokeDensity: 0.5 });

const controlRows = [{
  position: [0, 0, 0],
  covariance: [0.1, 0, 0, 0.1, 0, 0.1],
  orientation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  radii: [Math.sqrt(0.1), Math.sqrt(0.1), Math.sqrt(0.1)],
  extinctionMass: 1.5,
  densityWitness: 0.75,
  temperatureWitness: 0,
  velocityWitness: [0, 0, 0],
  sourceVoxelCount: 2,
}];

const oracle = buildSmokeExtinctionResidualOracle({
  grid,
  field: values,
  channelOrder: fluidChannels,
  controlRows,
  residualBlockSize: 1,
});

assert.deepEqual(KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER, [
  'physicalExtinction', 'coverage', 'ridge', 'residualExtinction',
]);
assert.equal(oracle.schema, 'kaminos.smoke-extinction-residual-oracle.v0');
assert.equal(oracle.authority, 'exact-fluid-extinction-neighborhood-residual-oracle-v0');
assert.equal(oracle.hiddenCandidateCapApplied, false);
assert.equal(oracle.sidecar.shape.join('x'), '2x2x2x4');
assert.equal(oracle.sidecar.channelOrder.join(','), KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER.join(','));

const expectedResidual = 0.42 * 0.5 + 0.34 * 0.25 + 0.12 * 0.1;
const expectedPhysical = 0.74 + expectedResidual;
assert.ok(Math.abs(oracle.sidecar.values[0] - expectedPhysical) < 1e-6, 'support follows exact renderer extinction coefficients');
assert.ok(Math.abs(oracle.sidecar.values[3] - expectedResidual) < 1e-6, 'residual excludes the broad smoke-density body');
assert.ok(oracle.sidecar.values[4 + 1] >= expectedPhysical - 1e-6, 'coverage reaches a neighboring occupied support cell');
assert.ok(oracle.sidecar.values[2] > 0, 'local support discontinuity produces a ridge response');

assert.equal(oracle.coarseRows.length, 1);
assert.deepEqual(oracle.coarseRows[0].position, controlRows[0].position, 'coarse support geometry remains fixed');
assert.deepEqual(oracle.coarseRows[0].covariance, controlRows[0].covariance, 'coarse covariance remains fixed');
assert.ok(Math.abs(oracle.coarseRows[0].extinctionMass - 1.5 * 0.74) < 1e-12);
assert.equal(oracle.residualRows.length, 1, 'every naturally occupied residual block is emitted without top-k or capacity');
assert.equal(oracle.combinedRows.length, 2);
assert.equal(oracle.residualRows[0].sourceVoxelCount, 1);
assert.ok(Math.abs(oracle.residualRows[0].extinctionMass - expectedResidual) < 1e-6);
assert.deepEqual(oracle.residualRows[0].velocityWitness.map(value => Number(value.toFixed(6))), [0.2, 0.4, -0.1]);
assert.equal(oracle.accounting.controlSmokeDensityMass, 1.5);
assert.ok(Math.abs(oracle.accounting.physicalExtinctionMass - (expectedPhysical + 0.74 * 0.5)) < 1e-6);
assert.ok(oracle.accounting.combinedRelativeError < 1e-12, 'coarse plus residual conserves physical extinction');
assert.equal(oracle.accounting.residualCandidateCount, 1);
assert.equal(oracle.accounting.residualCandidateCountAuthority, 'all-positive-explicit-blocks-no-cap-v0');

const correlatedGrid = 4;
const correlatedField = field(correlatedGrid);
setCell(correlatedField, correlatedGrid, 0, 0, 0, { smokeDensity: 1, microdetail: 1 });
setCell(correlatedField, correlatedGrid, 1, 1, 0, { smokeDensity: 1, microdetail: 1 });
const correlatedControl = [{ ...controlRows[0], extinctionMass: 2 }];
const correlatedDiagonal = buildSmokeExtinctionResidualOracle({
  grid: correlatedGrid,
  field: correlatedField,
  channelOrder: fluidChannels,
  controlRows: correlatedControl,
  residualBlockSize: 4,
  residualGeometry: 'diagonal-covariance-v0',
});
const correlatedFull = buildSmokeExtinctionResidualOracle({
  grid: correlatedGrid,
  field: correlatedField,
  channelOrder: fluidChannels,
  controlRows: correlatedControl,
  residualBlockSize: 4,
  residualGeometry: 'full-covariance-v0',
});
assert.equal(correlatedFull.residualGeometry, 'full-covariance-v0');
assert.equal(correlatedFull.residualRows.length, correlatedDiagonal.residualRows.length, 'covariance isolation preserves natural candidate count');
assert.deepEqual(correlatedFull.residualRows[0].position, correlatedDiagonal.residualRows[0].position, 'covariance isolation preserves weighted centroid');
assert.equal(correlatedFull.residualRows[0].extinctionMass, correlatedDiagonal.residualRows[0].extinctionMass, 'covariance isolation preserves residual mass');
assert.equal(correlatedDiagonal.residualRows[0].covariance[1], 0, 'R1 diagonal control discards xy correlation');
assert.ok(correlatedFull.residualRows[0].covariance[1] > 0.05, 'full covariance retains the correlated xy sheet direction');
const fullRow = correlatedFull.residualRows[0];
const reconstructed = [0, 0, 0, 0, 0, 0];
for (let axis = 0; axis < 3; axis += 1) {
  const eigenvalue = fullRow.radii[axis] ** 2;
  const vector = fullRow.orientation[axis];
  reconstructed[0] += eigenvalue * vector[0] * vector[0];
  reconstructed[1] += eigenvalue * vector[0] * vector[1];
  reconstructed[2] += eigenvalue * vector[0] * vector[2];
  reconstructed[3] += eigenvalue * vector[1] * vector[1];
  reconstructed[4] += eigenvalue * vector[1] * vector[2];
  reconstructed[5] += eigenvalue * vector[2] * vector[2];
}
for (let component = 0; component < 6; component += 1) {
  assert.ok(Math.abs(reconstructed[component] - fullRow.covariance[component]) < 1e-10, `eigenbasis reconstructs covariance component ${component}`);
}

const overlapGrid = 8;
const overlapField = field(overlapGrid);
setCell(overlapField, overlapGrid, 3, 3, 3, { smokeDensity: 1, microdetail: 1 });
setCell(overlapField, overlapGrid, 4, 4, 4, { smokeDensity: 1, microdetail: 1 });
const overlapControl = [{ ...controlRows[0], extinctionMass: 2 }];
const overlapOracle = buildSmokeExtinctionResidualOracle({
  grid: overlapGrid,
  field: overlapField,
  channelOrder: fluidChannels,
  controlRows: overlapControl,
  residualBlockSize: 4,
  residualGeometry: 'two-phase-overlap-full-covariance-v0',
});
assert.equal(overlapOracle.residualGeometry, 'two-phase-overlap-full-covariance-v0');
assert.deepEqual(overlapOracle.residualWindowPhases, [[0, 0, 0], [2, 2, 2]], 'second partition is staggered by half a block in every axis');
assert.equal(overlapOracle.residualRows.length, 3, 'two rigid rows plus one cross-boundary bridge are emitted without a cap');
assert.equal(overlapOracle.accounting.residualCandidateCount, 3);
assert.equal(overlapOracle.accounting.residualCandidateCountAuthority, 'all-positive-explicit-overlap-windows-no-cap-v0');
assert.equal(overlapOracle.accounting.residualMassPartitionAuthority, 'equal-share-across-complete-window-partitions-v0');
assert.deepEqual(overlapOracle.accounting.residualMembershipWeightRange, [1, 1], 'every positive voxel contributes exactly one total residual mass across phases');
assert.ok(Math.abs(overlapOracle.accounting.representedResidualMass - overlapOracle.accounting.residualExtinctionMass) < 1e-12);
const bridgeRow = overlapOracle.residualRows.find(row => row.residualPartitionPhase === 1 && row.residualWindowStart.join(',') === '2,2,2');
assert.ok(bridgeRow, 'staggered partition emits the window spanning the old block corner');
assert.deepEqual(bridgeRow.residualWindowEndExclusive, [6, 6, 6]);
assert.equal(bridgeRow.sourceVoxelCount, 2, 'bridge carries both positive voxels across the old ownership boundary');
assert.ok(Math.abs(bridgeRow.extinctionMass - 0.42) < 1e-6, 'bridge receives half of each voxel residual mass');
assert.equal(bridgeRow.residualMembershipWeight, 0.5);
assert.throws(
  () => buildSmokeExtinctionResidualOracle({
    grid: correlatedGrid,
    field: correlatedField,
    channelOrder: fluidChannels,
    controlRows: correlatedControl,
    residualBlockSize: 4,
    residualGeometry: 'silent-fallback-v0',
  }),
  /residual geometry/i,
  'unknown geometry cannot silently fall back to the R1 diagonal arm',
);

assert.throws(
  () => buildSmokeExtinctionResidualOracle({
    grid,
    field: values,
    channelOrder: [...fluidChannels].reverse(),
    controlRows,
  }),
  /channel order mismatch/i,
);
assert.throws(
  () => buildSmokeExtinctionResidualOracle({
    grid,
    field: values,
    channelOrder: fluidChannels,
    controlRows,
    residualBlockSize: 3,
  }),
  /divide grid/i,
);
assert.throws(
  () => buildSmokeExtinctionResidualOracle({
    grid,
    field: values,
    channelOrder: fluidChannels,
    controlRows,
    maxCandidates: 1,
  }),
  /candidate cap/i,
  'oracle refuses a hidden candidate cap instead of silently truncating support',
);
assert.throws(
  () => buildSmokeExtinctionResidualOracle({
    grid,
    field: values,
    channelOrder: fluidChannels,
    controlRows: [{ ...controlRows[0], extinctionMass: 99 }],
  }),
  /control.*smoke.*mass/i,
  'wrong control/source mass binding fails before producing a plausible combined field',
);

const producerRoot = mkdtempSync(join(tmpdir(), 'kaminos-smoke-extinction-residual-producer-'));
try {
  const fluidPath = join(producerRoot, 'source.fluid.f32');
  const fluidBytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  writeFileSync(fluidPath, fluidBytes);
  const manifestPath = join(producerRoot, 'source.manifest.json');
  const manifestCamera = {
    identity: 'descriptive-camera-metadata-must-not-enter-checksum-v0',
    position: [0, 0, 3],
    target: [0, 0, 0],
    projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.02, 0],
    matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3, 1],
  };
  const manifest = {
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    completeFieldCoverage: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:test',
    sampleAuthority: 'render-only-frozen-sim-state',
    grid,
    fluidChannelOrder: fluidChannels,
    worldSpace: {
      coordinateFrame: 'kaminos-volume-world-v0',
      transformAuthority: 'native-volume-grid-world-transform-v0',
      bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
    },
    camera: manifestCamera,
    sidecars: {
      fluid: {
        kind: 'fluid',
        dtype: 'float32',
        byteOrder: 'little-endian',
        floatCount: values.length,
        byteLength: fluidBytes.byteLength,
        shape: [grid, grid, grid, fluidChannels.length],
        channelOrder: fluidChannels,
        path: 'source.fluid.f32',
        sha256: sha(fluidBytes),
      },
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const controlArtifactPath = join(producerRoot, 'control.gaussians.f32');
  const controlValues = new Float32Array([
    0, 0, 0,
    0.1, 0, 0, 0.1, 0, 0.1,
    1, 0, 0, 0, 1, 0, 0, 0, 1,
    Math.sqrt(0.1), Math.sqrt(0.1), Math.sqrt(0.1),
    1.5, 0.75, 0,
    0, 0, 0, 2,
  ]);
  const controlBytes = Buffer.from(controlValues.buffer, controlValues.byteOffset, controlValues.byteLength);
  writeFileSync(controlArtifactPath, controlBytes);
  const gaussianChannels = [
    'positionX', 'positionY', 'positionZ',
    'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
    'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
    'radius0', 'radius1', 'radius2',
    'extinctionMass', 'densityWitness', 'temperatureWitness',
    'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
  ];
  const controlReportPath = join(producerRoot, 'control.fit-report.json');
  const controlReport = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    hiddenBudgetCapApplied: false,
    teacher: {
      effectiveRoute: manifest.effectiveRoute,
      prototypeIdentity: manifest.prototypeIdentity,
      backend: manifest.backend,
      grid,
      worldSpace: manifest.worldSpace,
      camera: null,
    },
    budgetCurve: [{
      requestedBudget: 1,
      activeGaussianCount: 1,
      artifact: {
        path: controlArtifactPath,
        sha256: `sha256:${sha(controlBytes)}`,
        byteLength: controlBytes.byteLength,
        dtype: 'float32',
        byteOrder: 'little-endian',
        shape: [1, gaussianChannels.length],
        channelOrder: gaussianChannels,
      },
    }],
  };
  writeFileSync(controlReportPath, `${JSON.stringify(controlReport, null, 2)}\n`);

  const outDir = join(producerRoot, 'out');
  const args = [
    oraclePath,
    '--manifest', manifestPath,
    '--expected-manifest-sha256', sha(readFileSync(manifestPath)),
    '--control-report', controlReportPath,
    '--expected-control-report-sha256', sha(readFileSync(controlReportPath)),
    '--control-artifact', controlArtifactPath,
    '--expected-control-artifact-sha256', sha(controlBytes),
    '--control-budget', '1',
    '--residual-block-size', '1',
    '--out-dir', outDir,
  ];
  const produced = spawnSync('node', args, { cwd: root, encoding: 'utf8' });
  assert.equal(produced.status, 0, produced.stderr || produced.stdout);
  const report = JSON.parse(readFileSync(join(outDir, 'oracle-report.json'), 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.hiddenCandidateCapApplied, false);
  assert.equal(report.effective.route, manifest.effectiveRoute);
  assert.equal(report.effective.backend, manifest.backend);
  assert.equal(report.accounting.residualCandidateCount, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(report.products).map(([role, product]) => [role, product.count])), {
    coarse: 1,
    residual: 1,
    combined: 2,
  });
  for (const product of Object.values(report.products)) {
    assert.ok(existsSync(product.fitPath));
    assert.equal(product.accounting.relativeError < 1e-6, true, `${product.role} serialized mass remains bound`);
    assert.equal(`sha256:${sha(readFileSync(join(outDir, product.descriptor.path)))}`, product.descriptor.sha256);
    const productFit = JSON.parse(readFileSync(product.fitPath, 'utf8'));
    assert.equal(productFit.teacher.camera.identity, undefined, 'descriptive camera metadata cannot poison numerical camera identity');
    assert.equal(
      productFit.teacher.cameraIdentity,
      `sha256:${sha(Buffer.from(JSON.stringify(productFit.teacher.camera)))}`,
      'each product must carry the checksum of the exact camera payload consumed by witnesses',
    );
  }
  assert.equal(`sha256:${sha(readFileSync(report.sidecar.path))}`, report.sidecar.sha256);

  const firstHashes = Object.fromEntries(Object.entries(report.products).map(([role, product]) => [role, product.descriptor.sha256]));
  const repeated = spawnSync('node', args, { cwd: root, encoding: 'utf8' });
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  const repeatedReport = JSON.parse(readFileSync(join(outDir, 'oracle-report.json'), 'utf8'));
  assert.deepEqual(
    Object.fromEntries(Object.entries(repeatedReport.products).map(([role, product]) => [role, product.descriptor.sha256])),
    firstHashes,
    're-running the same source rewrites the canonical outputs without changing product identity',
  );

  const fullCovarianceOut = join(producerRoot, 'full-covariance-out');
  const fullCovarianceArgs = [
    ...args.slice(0, -2),
    '--residual-geometry', 'full-covariance-v0',
    '--out-dir', fullCovarianceOut,
  ];
  const fullCovarianceProduced = spawnSync('node', fullCovarianceArgs, { cwd: root, encoding: 'utf8' });
  assert.equal(fullCovarianceProduced.status, 0, fullCovarianceProduced.stderr || fullCovarianceProduced.stdout);
  const fullCovarianceReport = JSON.parse(readFileSync(join(fullCovarianceOut, 'oracle-report.json'), 'utf8'));
  assert.equal(fullCovarianceReport.requested.residualGeometry, 'full-covariance-v0');
  assert.equal(fullCovarianceReport.effective.residualGeometry, 'full-covariance-v0');
  assert.equal(fullCovarianceReport.accounting.residualCandidateCount, report.accounting.residualCandidateCount);
  assert.ok(fullCovarianceReport.accounting.combinedRelativeError < 1e-6);

  const overlapOut = join(producerRoot, 'two-phase-overlap-out');
  const overlapArgs = [
    oraclePath,
    '--manifest', manifestPath,
    '--expected-manifest-sha256', sha(readFileSync(manifestPath)),
    '--control-report', controlReportPath,
    '--expected-control-report-sha256', sha(readFileSync(controlReportPath)),
    '--control-artifact', controlArtifactPath,
    '--expected-control-artifact-sha256', sha(controlBytes),
    '--control-budget', '1',
    '--residual-block-size', '2',
    '--residual-geometry', 'two-phase-overlap-full-covariance-v0',
    '--out-dir', overlapOut,
  ];
  const overlapProduced = spawnSync('node', overlapArgs, { cwd: root, encoding: 'utf8' });
  assert.equal(overlapProduced.status, 0, overlapProduced.stderr || overlapProduced.stdout);
  const overlapReport = JSON.parse(readFileSync(join(overlapOut, 'oracle-report.json'), 'utf8'));
  assert.equal(overlapReport.requested.residualGeometry, 'two-phase-overlap-full-covariance-v0');
  assert.equal(overlapReport.effective.residualGeometry, 'two-phase-overlap-full-covariance-v0');
  assert.deepEqual(overlapReport.effective.residualWindowPhases, [[0, 0, 0], [1, 1, 1]]);
  assert.equal(overlapReport.accounting.residualMassPartitionAuthority, 'equal-share-across-complete-window-partitions-v0');
  assert.deepEqual(overlapReport.accounting.residualMembershipWeightRange, [1, 1]);
  assert.ok(overlapReport.accounting.combinedRelativeError < 1e-6);

  const wrongRouteManifest = { ...manifest, effectiveRoute: 'fallback-cpu-demo-v0' };
  const wrongRoutePath = join(producerRoot, 'wrong-route.manifest.json');
  writeFileSync(wrongRoutePath, `${JSON.stringify(wrongRouteManifest, null, 2)}\n`);
  const wrongRouteOut = join(producerRoot, 'wrong-route-out');
  const wrongRoute = spawnSync('node', [
    oraclePath,
    '--manifest', wrongRoutePath,
    '--expected-manifest-sha256', sha(readFileSync(wrongRoutePath)),
    '--control-report', controlReportPath,
    '--expected-control-report-sha256', sha(readFileSync(controlReportPath)),
    '--control-artifact', controlArtifactPath,
    '--expected-control-artifact-sha256', sha(controlBytes),
    '--control-budget', '1',
    '--out-dir', wrongRouteOut,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(wrongRoute.status, 1, 'fallback route cannot produce authoritative smoke support');
  const wrongRouteReport = JSON.parse(readFileSync(join(wrongRouteOut, 'oracle-report.json'), 'utf8'));
  assert.equal(wrongRouteReport.failurePhase, 'input-validation');
  assert.equal(wrongRouteReport.lastTrustworthyEvidence.effectiveRoute, 'fallback-cpu-demo-v0');
  assert.match(wrongRouteReport.error, /route identity/i);
} finally {
  rmSync(producerRoot, { recursive: true, force: true });
}

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-smoke-extinction-residual-failure-'));
try {
  const failed = spawnSync('node', [
    oraclePath,
    '--manifest', join(failureRoot, 'missing.manifest.json'),
    '--control-report', join(failureRoot, 'missing-control.json'),
    '--out-dir', failureRoot,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(failed.status, 1, 'missing source must fail before primary products');
  const report = JSON.parse(readFileSync(join(failureRoot, 'oracle-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'input-validation');
  assert.equal(report.requested.manifestPath, join(failureRoot, 'missing.manifest.json'));
  assert.equal(report.requested.controlReportPath, join(failureRoot, 'missing-control.json'));
  assert.equal(report.hiddenCandidateCapApplied, false);
  assert.ok(report.lastTrustworthyEvidence, 'pre-output failure preserves the last trustworthy evidence');
} finally {
  rmSync(failureRoot, { recursive: true, force: true });
}

console.log('smoke extinction residual oracle contracts passed');
