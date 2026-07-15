#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const probePath = join(root, 'volume-boundary-splat-displacement-probe.py');
assert.ok(existsSync(probePath), 'boundary-splat displacement probe exists');

const source = readFileSync(probePath, 'utf8');
assert.match(source, /kaminos\.volume\.boundary-splat-displacement-probe\.v0/, 'probe emits a stable report schema');
assert.match(source, /one-cell-27-class-offset-v0/, 'probe names the bounded 27-class target');
assert.match(source, /spatial-block-hash-holdout-v0/, 'probe prevents neighboring candidate rows from crossing roles');
assert.match(source, /one-cell-chebyshev-cross-role-exclusion-v0/, 'probe excludes radius-one label neighborhoods that cross role ownership');
assert.match(source, /candidate-feature-row-reconstructed-from-exported-field-v0/, 'probe names exact offline feature reconstruction authority');
assert.match(source, /always-center-offset-control-v0/, 'probe retains the inert center control');
assert.match(source, /multiclass-ridge-offset-control-v0/, 'probe retains a linear multiclass control');
assert.match(source, /tiny-softmax-mlp-offset-v0/, 'probe names the nonlinear offset model');
assert.match(source, /validation-selected-collision-aware-move-gate-v0/, 'probe calibrates collision-safe movement on validation blocks');
assert.match(source, /vacant-in-original-candidate-set-v0/, 'move gate only targets originally vacant candidate cells');
assert.match(source, /validation-selected-vacancy-gated-offset-class-grid-v0/, 'probe names the dense displacement output authority');
assert.match(source, /boundarySplatOffsetClassNormalized/, 'probe emits a renderer-consumable normalized offset class channel');
assert.match(source, /global-vacancy-election-then-role-slice-v0/, 'probe evaluates every role from one deployment-identical global vacancy election');
assert.match(source, /postOffsetUniqueOverlap/, 'probe reports collision-aware unique support overlap');
assert.match(source, /duplicateDestinationCount/, 'probe reports candidate collapse explicitly');
assert.match(source, /failurePhase/, 'probe writes durable failure-phase reports');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-boundary-splat-displacement-'));
const grid = 8;
const cells = grid ** 3;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeF32(name, values) {
  const path = join(fixtureRoot, name);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  writeFileSync(path, bytes);
  return { path, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

function index(x, y, z) {
  return x + y * grid + z * grid * grid;
}

function splatRows(indexes) {
  const values = new Float32Array(indexes.length * 12);
  indexes.forEach((cell, row) => {
    const x = cell % grid;
    const y = Math.floor(cell / grid) % grid;
    const z = Math.floor(cell / (grid * grid));
    values[row * 12 + 0] = ((x + 0.5) / grid) * 2 - 1;
    values[row * 12 + 1] = ((y + 0.5) / grid) * 2 - 1;
    values[row * 12 + 2] = ((z + 0.5) / grid) * 2 - 1;
    values[row * 12 + 3] = 0.5;
    values[row * 12 + 4] = 1;
    values[row * 12 + 5] = 0.4;
    values[row * 12 + 6] = 0.1;
    values[row * 12 + 7] = 0.03;
    values[row * 12 + 8] = 0.1;
    values[row * 12 + 9] = 0.12;
    values[row * 12 + 10] = 0.6;
    values[row * 12 + 11] = 0.7;
  });
  return values;
}

const lowFluid = new Float32Array(cells * 16);
const lowFront = new Float32Array(cells);
const lowBoundary = new Float32Array(cells * 4);
const lowIndexes = [];
const highIndexes = [];
for (let z = 1; z < grid - 1; z += 1) {
  for (let y = 0; y < grid; y += 1) {
    const positiveX = y < grid / 2 ? 2 : 5;
    const highX = y < grid / 2 ? 3 : 4;
    const lowCell = index(positiveX, y, z);
    const highCell = index(highX, y, z);
    lowIndexes.push(lowCell);
    highIndexes.push(highCell);
    const featureBand = y < grid / 2 ? 0.15 : 0.85;
    lowFluid[lowCell * 16 + 3] = featureBand;
    lowFluid[lowCell * 16 + 5] = featureBand;
    lowFluid[lowCell * 16 + 8] = 0.4 + featureBand * 0.2;
    lowFluid[lowCell * 16 + 10] = featureBand;
    lowFluid[lowCell * 16 + 12] = z / grid;
    lowBoundary[lowCell * 4 + 0] = 1;
    lowBoundary[lowCell * 4 + 1] = featureBand;
    lowBoundary[lowCell * 4 + 2] = 0.7;
    lowBoundary[lowCell * 4 + 3] = 0.5;
  }
}
for (let z = 2; z < grid - 2; z += 1) {
  const lowCell = index(0, 3, z);
  lowIndexes.push(lowCell);
  highIndexes.push(lowCell);
  lowFluid[lowCell * 16 + 3] = 0.5;
  lowFluid[lowCell * 16 + 5] = 0.5;
  lowFluid[lowCell * 16 + 8] = 0.5;
  lowBoundary[lowCell * 4 + 0] = 1;
  lowBoundary[lowCell * 4 + 1] = 0.5;
  lowBoundary[lowCell * 4 + 2] = 0.7;
  lowBoundary[lowCell * 4 + 3] = 0.5;
}

const lowFluidDesc = writeF32('low-fluid.f32', lowFluid);
const lowFrontDesc = writeF32('low-front.f32', lowFront);
const lowBoundaryDesc = writeF32('low-boundary.f32', lowBoundary);
const lowSplatDesc = writeF32('low-splats.f32', splatRows(lowIndexes));
const highSplatDesc = writeF32('high-splats.f32', splatRows(highIndexes));

function manifest(path, identity, fluid, front, boundary, splats) {
  writeFileSync(path, `${JSON.stringify({
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity,
    status: 'captured',
    failurePhase: null,
    grid,
    cellCount: cells,
    completeFieldCoverage: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:fixture',
    sourceCapture: { payloadSha256: 'a'.repeat(64), hashMatches: true },
    sidecars: {
      fluid: { ...fluid, shape: [grid, grid, grid, 16] },
      front: { ...front, shape: [grid, grid, grid, 1] },
    },
    boundarySidecar: {
      authority: 'band-limited-support-coverage-ridge-proximity-footprint-v1',
      sidecars: { boundary: { ...boundary, shape: [grid, grid, grid, 4] } },
    },
    boundarySplats: {
      identity: 'live-boundary-sidecar-learned-attribute-splats-v0',
      attributeModelIdentity: 'sha256:fixture',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      draw: { instanceCount: splats.byteLength / 48, candidateCount: splats.byteLength / 48, overflowCount: 0, capacity: 1024 },
      sidecars: { boundarySplats: { ...splats, shape: [splats.byteLength / 48, 12] } },
    },
  }, null, 2)}\n`);
}

const lowManifest = join(fixtureRoot, 'low.json');
const highManifest = join(fixtureRoot, 'high.json');
manifest(lowManifest, 'displacement-low-fixture', lowFluidDesc, lowFrontDesc, lowBoundaryDesc, lowSplatDesc);
manifest(highManifest, 'displacement-high-fixture', lowFluidDesc, lowFrontDesc, lowBoundaryDesc, highSplatDesc);

const outDir = join(fixtureRoot, 'probe');
const run = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', highManifest,
  '--out-dir', outDir,
  '--spatial-block-size', '4',
  '--epochs', '10',
  '--hidden-width', '16',
  '--batch-size', '32',
  '--seed', '9413',
], { encoding: 'utf8' });
assert.equal(run.status, 0, `fixture probe succeeds: ${run.stderr}`);
const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.boundary-splat-displacement-probe.v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.dataset.lowCandidateCount, lowIndexes.length);
assert.equal(report.dataset.highCandidateCount, highIndexes.length);
assert.equal(report.dataset.correctableWithinRadiusOneCount, lowIndexes.length);
assert.equal(report.dataset.offsetClassCount, 27);
assert.ok(report.dataset.offsetHistogram['1,0,0'] > 0);
assert.ok(report.dataset.offsetHistogram['-1,0,0'] > 0);
assert.ok(report.dataset.offsetHistogram['0,0,0'] > 0);
assert.ok(report.split.trainRows > 0 && report.split.validationRows > 0 && report.split.testRows > 0);
assert.deepEqual(report.split.roleBins, { test: [0, 1], validation: [2, 3], train: [4, 5, 6, 7, 8, 9] });
assert.equal(report.split.guardBandIdentity, 'one-cell-chebyshev-cross-role-exclusion-v0');
assert.ok(report.split.guardBandRows > 0, 'fixture exercises guarded cross-role boundaries');
assert.equal(report.split.crossRoleRadiusOneRowsAfterGuard, 0);
assert.equal(
  report.split.activeRows + report.split.guardBandRows,
  lowIndexes.length,
  'every candidate is either evaluated or explicitly held out by the guard band',
);
for (const model of ['alwaysCenter', 'ridge', 'mlp', 'mlpVacancyGated']) {
  const metrics = report.models[model].test;
  assert.ok(Number.isFinite(metrics.destinationMembershipAccuracy));
  assert.ok(Number.isFinite(metrics.postOffsetUniqueOverlap));
  assert.ok(Number.isInteger(metrics.duplicateDestinationCount));
}
assert.equal(report.models.mlpVacancyGated.test.duplicateDestinationCount, 0);
assert.equal(report.models.mlpVacancyGated.test.uniqueDestinationCount, report.models.mlpVacancyGated.test.rowCount);
assert.equal(report.models.mlpVacancyGated.calibration.selectedOn, 'validation');
assert.equal(report.models.mlpVacancyGated.calibration.testDataUsedForSelection, false);
const thresholdSweep = report.models.mlpVacancyGated.calibration.thresholdSweep;
assert.equal(thresholdSweep.identity, 'uncapped-validation-vacancy-threshold-sweep-v0');
assert.equal(thresholdSweep.capped, false);
assert.equal(thresholdSweep.testDataUsedForSelection, false);
assert.equal(thresholdSweep.pointCount, thresholdSweep.points.length);
assert.ok(thresholdSweep.pointCount > 1, 'sweep preserves every validation threshold transition');
assert.equal(thresholdSweep.points[0].acceptedMoveCount, 0, 'sweep starts from the no-move control');
for (let index = 1; index < thresholdSweep.points.length; index += 1) {
  const previous = thresholdSweep.points[index - 1];
  const point = thresholdSweep.points[index];
  assert.ok(point.threshold <= previous.threshold, 'sweep thresholds descend monotonically');
  assert.ok(point.acceptedMoveCount > previous.acceptedMoveCount, 'accepted coverage grows monotonically');
  assert.equal(
    point.correctedLowOnlyCount - point.corruptedOverlapCount,
    point.uniqueOverlapDelta,
    'validation net correction equals unique-overlap delta under collision-free arbitration',
  );
}
assert.equal(thresholdSweep.paretoPointCount, thresholdSweep.paretoFrontier.length);
assert.ok(thresholdSweep.paretoPointCount > 0, 'sweep preserves its non-dominated coverage/overlap frontier');
assert.ok(
  thresholdSweep.maximumCoveragePositiveNet.acceptedMoveCount
    >= report.models.mlpVacancyGated.calibration.validationSelectedMoveCount,
  'coverage-edge candidate is at least as broad as the maximum-overlap selection',
);
assert.equal(report.models.mlpVacancyGated.evaluationAuthority, 'global-vacancy-election-then-role-slice-v0');
assert.equal(report.models.mlpVacancyGated.gateRoles.all.duplicateDestinationCount, 0);
assert.equal(report.checkpoint.replay.status, 'verified');
assert.equal(report.checkpoint.replay.classParity, true);
assert.equal(report.checkpoint.replay.outputSha256, report.denseOutputs.boundarySplatOffsetClass.sha256);
assert.equal(report.producer.script.path, probePath);
assert.match(report.producer.script.sha256, /^[a-f0-9]{64}$/);
assert.equal(report.producer.arguments.spatial_block_size, 4);
const displacement = report.denseOutputs.boundarySplatOffsetClass;
assert.deepEqual(displacement.shape, [grid, grid, grid, 1]);
assert.deepEqual(displacement.channelOrder, ['boundarySplatOffsetClassNormalized']);
assert.equal(displacement.authority, 'validation-selected-vacancy-gated-offset-class-grid-v0');
assert.ok(existsSync(displacement.path), 'probe persists the dense gated displacement grid');
const displacementBytes = readFileSync(displacement.path);
assert.equal(displacementBytes.byteLength, cells * Float32Array.BYTES_PER_ELEMENT);
assert.equal(sha256(displacementBytes), displacement.sha256);
const displacementValues = new Float32Array(
  displacementBytes.buffer,
  displacementBytes.byteOffset,
  displacementBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
);
assert.ok(displacementValues.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
assert.ok(existsSync(join(outDir, 'displacement-model.npz')), 'probe persists the fitted displacement model');

const coverageOutDir = join(fixtureRoot, 'probe-maximum-coverage-positive-net');
const coverageRun = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', highManifest,
  '--out-dir', coverageOutDir,
  '--spatial-block-size', '4',
  '--epochs', '10',
  '--hidden-width', '16',
  '--batch-size', '32',
  '--seed', '9413',
  '--move-gate-selection', 'maximum-coverage-positive-net',
], { encoding: 'utf8' });
assert.equal(coverageRun.status, 0, `coverage-edge fixture probe succeeds: ${coverageRun.stderr}`);
const coverageReport = JSON.parse(readFileSync(join(coverageOutDir, 'manifest.json'), 'utf8'));
const coverageCalibration = coverageReport.models.mlpVacancyGated.calibration;
assert.equal(coverageCalibration.selectionPolicy, 'maximum-coverage-positive-net');
assert.equal(coverageCalibration.testDataUsedForSelection, false);
assert.equal(
  coverageCalibration.validationSelectedMoveCount,
  coverageCalibration.thresholdSweep.maximumCoveragePositiveNet.acceptedMoveCount,
);
assert.equal(
  coverageCalibration.validationUniqueOverlapDelta,
  coverageCalibration.thresholdSweep.maximumCoveragePositiveNet.uniqueOverlapDelta,
);
assert.ok(
  coverageReport.denseOutputs.boundarySplatOffsetClass.acceptedMovedCandidateCount
    >= displacement.acceptedMovedCandidateCount,
  'coverage-edge policy emits at least as many globally gated moves as maximum-overlap selection',
);
assert.equal(coverageReport.checkpoint.replay.status, 'verified');
assert.equal(coverageReport.checkpoint.replay.classParity, true);

const mismatchedManifest = join(fixtureRoot, 'high-mismatched-source.json');
const mismatched = JSON.parse(readFileSync(highManifest, 'utf8'));
mismatched.sourceCapture.payloadSha256 = 'b'.repeat(64);
writeFileSync(mismatchedManifest, `${JSON.stringify(mismatched, null, 2)}\n`);
const mismatchedOut = join(fixtureRoot, 'probe-mismatched-source');
const mismatchedRun = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', mismatchedManifest,
  '--out-dir', mismatchedOut,
], { encoding: 'utf8' });
assert.notEqual(mismatchedRun.status, 0, 'different captured source states fail before training');
const mismatchedFailure = JSON.parse(readFileSync(join(mismatchedOut, 'manifest.json'), 'utf8'));
assert.equal(mismatchedFailure.status, 'failed');
assert.equal(mismatchedFailure.failurePhase, 'input-validation');
assert.match(mismatchedFailure.error.message, /source state|source capture|payload/i);

const corruptManifest = join(fixtureRoot, 'low-corrupt.json');
const corrupt = JSON.parse(readFileSync(lowManifest, 'utf8'));
corrupt.sidecars.fluid.sha256 = '0'.repeat(64);
writeFileSync(corruptManifest, `${JSON.stringify(corrupt, null, 2)}\n`);
const corruptOut = join(fixtureRoot, 'probe-corrupt');
const corruptRun = spawnSync('python3', [
  probePath,
  '--low-manifest', corruptManifest,
  '--high-manifest', highManifest,
  '--out-dir', corruptOut,
], { encoding: 'utf8' });
assert.notEqual(corruptRun.status, 0, 'corrupt checksum fails before training');
const failed = JSON.parse(readFileSync(join(corruptOut, 'manifest.json'), 'utf8'));
assert.equal(failed.status, 'failed');
assert.equal(failed.failurePhase, 'input-validation');
assert.match(failed.error.message, /checksum/i);

console.log('boundary splat displacement probe contracts passed');
