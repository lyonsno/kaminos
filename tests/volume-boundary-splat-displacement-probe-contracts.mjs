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
assert.match(source, /candidate-feature-row-reconstructed-from-exported-field-v0/, 'probe names exact offline feature reconstruction authority');
assert.match(source, /always-center-offset-control-v0/, 'probe retains the inert center control');
assert.match(source, /multiclass-ridge-offset-control-v0/, 'probe retains a linear multiclass control');
assert.match(source, /tiny-softmax-mlp-offset-v0/, 'probe names the nonlinear offset model');
assert.match(source, /validation-selected-collision-aware-move-gate-v0/, 'probe calibrates collision-safe movement on validation blocks');
assert.match(source, /vacant-in-original-candidate-set-v0/, 'move gate only targets originally vacant candidate cells');
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
  '--spatial-block-size', '1',
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
assert.ok(existsSync(join(outDir, 'displacement-model.npz')), 'probe persists the fitted displacement model');

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
