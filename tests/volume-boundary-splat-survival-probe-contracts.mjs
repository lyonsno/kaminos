#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const probePath = join(root, 'volume-boundary-splat-survival-probe.py');
assert.ok(existsSync(probePath), 'boundary-splat survival probe exists');

const source = readFileSync(probePath, 'utf8');
assert.match(source, /kaminos\.volume\.boundary-splat-survival-probe\.v0/);
assert.match(source, /candidate-only-exact-cell-survival-v0/);
assert.match(source, /exact-low-candidate-cell-in-high-accepted-set-v0/);
assert.match(source, /uncapped-validation-jaccard-threshold-sweep-v0/);
assert.match(source, /minimum-recall-survival-gate-v0/);
assert.match(source, /validation-selected-candidate-survival-mask-v0/);
assert.match(source, /boundarySplatSurvivalMask/);
assert.match(source, /source-target-bound-verified/);
assert.match(source, /failurePhase/);

const thresholdRun = spawnSync('python3', ['-c', `
import importlib.util
import json
import numpy as np
spec = importlib.util.spec_from_file_location("survival_probe", ${JSON.stringify(probePath)})
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
probability = np.asarray([0.95, 0.84, 0.22, 0.77, 0.55, 0.11], dtype=np.float32)
labels = np.asarray([1, 1, 1, 0, 0, 0], dtype=np.bool_)
selection = probe.select_survival_threshold(probability, labels, minimum_recall=0.9)
print(json.dumps(selection))
`], { encoding: 'utf8' });
assert.equal(thresholdRun.status, 0, `threshold contract succeeds: ${thresholdRun.stderr}`);
const threshold = JSON.parse(thresholdRun.stdout);
assert.equal(threshold.identity, 'uncapped-validation-jaccard-threshold-sweep-v0');
assert.equal(threshold.selectedOn, 'validation');
assert.equal(threshold.testDataUsedForSelection, false);
assert.equal(threshold.minimumRecall, 0.9);
assert.equal(threshold.capped, false);
assert.equal(threshold.pointCount, threshold.points.length);
assert.ok(threshold.pointCount > 2);
assert.equal(threshold.points[0].keptCandidateCount, 0, 'sweep begins from a true keep-none sentinel');
assert.ok(threshold.selected.metrics.recall >= 0.9);
assert.equal(threshold.selected.metrics.truePositive, 3);
assert.equal(threshold.selected.metrics.falseNegative, 0);
assert.equal(threshold.selected.metrics.falsePositive, 2);
for (let index = 1; index < threshold.points.length; index += 1) {
  assert.ok(threshold.points[index].threshold <= threshold.points[index - 1].threshold);
  assert.ok(threshold.points[index].keptCandidateCount >= threshold.points[index - 1].keptCandidateCount);
}

const splitCoverageRun = spawnSync('python3', ['-c', `
import importlib.util
import json
import numpy as np
spec = importlib.util.spec_from_file_location("survival_probe", ${JSON.stringify(probePath)})
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
try:
    probe.validate_split_class_coverage(
        np.asarray([1, 1, 1, 0, 1, 0], dtype=np.bool_),
        np.asarray([0, 0, 1, 1, 2, 2], dtype=np.int8),
    )
except probe.ProbeFailure as error:
    print(json.dumps({"phase": error.phase, "message": str(error), "details": error.details}))
else:
    raise SystemExit("class-empty held-test role was accepted")
`], { encoding: 'utf8' });
assert.equal(splitCoverageRun.status, 0, `class-coverage guard rejects empty classes: ${splitCoverageRun.stderr}`);
const splitCoverage = JSON.parse(splitCoverageRun.stdout);
assert.equal(splitCoverage.phase, 'dataset-split');
assert.match(splitCoverage.message, /both positive and negative/i);
assert.equal(splitCoverage.details.roles.test.negativeLabelCount, 0);

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-boundary-splat-survival-'));
const grid = 16;
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

function cellIndex(x, y, z) {
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

const fluid = new Float32Array(cells * 16);
const front = new Float32Array(cells);
const boundary = new Float32Array(cells * 4);
const lowIndexes = [];
const highIndexes = [];
for (const x of [2, 5, 8, 11, 14]) {
  for (let y = 1; y < grid - 1; y += 1) {
    for (let z = 1; z < grid - 1; z += 1) {
      const cell = cellIndex(x, y, z);
      lowIndexes.push(cell);
      const survivalSignal = ((x * 3 + y * 5 + z * 7) % 11) / 10;
      const survives = survivalSignal >= 0.3;
      if (survives) highIndexes.push(cell);
      fluid[cell * 16 + 3] = survivalSignal;
      fluid[cell * 16 + 4] = y / grid;
      fluid[cell * 16 + 5] = survivalSignal;
      fluid[cell * 16 + 6] = z / grid;
      fluid[cell * 16 + 8] = survivalSignal;
      fluid[cell * 16 + 10] = survivalSignal;
      fluid[cell * 16 + 12] = (x + z) / (grid * 2);
      boundary[cell * 4 + 0] = 1;
      boundary[cell * 4 + 1] = survivalSignal;
      boundary[cell * 4 + 2] = 0.7;
      boundary[cell * 4 + 3] = 0.5;
    }
  }
}

const fluidDesc = writeF32('fluid.f32', fluid);
const frontDesc = writeF32('front.f32', front);
const boundaryDesc = writeF32('boundary.f32', boundary);
const lowSplatDesc = writeF32('low-splats.f32', splatRows(lowIndexes));
const highSplatDesc = writeF32('high-splats.f32', splatRows(highIndexes));

function writeManifest(path, identity, splats, payloadSha = 'a'.repeat(64)) {
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
    sourceCapture: { payloadSha256: payloadSha, hashMatches: true },
    sidecars: {
      fluid: { ...fluidDesc, shape: [grid, grid, grid, 16] },
      front: { ...frontDesc, shape: [grid, grid, grid, 1] },
    },
    boundarySidecar: {
      authority: 'band-limited-support-coverage-ridge-proximity-footprint-v1',
      sidecars: { boundary: { ...boundaryDesc, shape: [grid, grid, grid, 4] } },
    },
    boundarySplats: {
      identity: 'live-boundary-sidecar-learned-attribute-splats-v0',
      attributeModelIdentity: 'sha256:fixture',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      draw: {
        instanceCount: splats.byteLength / 48,
        candidateCount: splats.byteLength / 48,
        overflowCount: 0,
        capacity: 4096,
      },
      sidecars: { boundarySplats: { ...splats, shape: [splats.byteLength / 48, 12] } },
    },
  }, null, 2)}\n`);
}

const lowManifest = join(fixtureRoot, 'low.json');
const highManifest = join(fixtureRoot, 'high.json');
writeManifest(lowManifest, 'survival-low-fixture', lowSplatDesc);
writeManifest(highManifest, 'survival-high-fixture', highSplatDesc);

const outDir = join(fixtureRoot, 'probe');
const run = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', highManifest,
  '--out-dir', outDir,
  '--spatial-block-size', '4',
  '--epochs', '18',
  '--hidden-width', '16',
  '--batch-size', '64',
  '--minimum-recall', '0.9',
  '--seed', '9413',
], { encoding: 'utf8' });
assert.equal(run.status, 0, `fixture probe succeeds: ${run.stderr}`);

const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.boundary-splat-survival-probe.v0');
assert.equal(report.identity, 'candidate-only-exact-cell-survival-v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.dataset.lowCandidateCount, lowIndexes.length);
assert.equal(report.dataset.highCandidateCount, highIndexes.length);
assert.equal(report.dataset.exactOverlapCount, highIndexes.length);
assert.equal(report.dataset.lowOnlyCount, lowIndexes.length - highIndexes.length);
assert.equal(report.dataset.labelAuthority, 'exact-low-candidate-cell-in-high-accepted-set-v0');
assert.equal(report.dataset.positiveLabelCount, highIndexes.length);
assert.equal(report.dataset.negativeLabelCount, lowIndexes.length - highIndexes.length);
assert.ok(report.split.trainRows > 0 && report.split.validationRows > 0 && report.split.testRows > 0);
assert.deepEqual(report.split.roleBins, { test: [0, 1], validation: [2, 3], train: [4, 5, 6, 7, 8, 9] });
for (const role of ['train', 'validation', 'test']) {
  assert.ok(report.split.classCoverage[role].positiveLabelCount > 0);
  assert.ok(report.split.classCoverage[role].negativeLabelCount > 0);
}

const selection = report.models.mlpSurvival.calibration;
assert.equal(selection.identity, 'uncapped-validation-jaccard-threshold-sweep-v0');
assert.equal(selection.selectedOn, 'validation');
assert.equal(selection.testDataUsedForSelection, false);
assert.equal(selection.minimumRecall, 0.9);
assert.equal(selection.capped, false);
assert.equal(selection.pointCount, selection.points.length);
assert.ok(selection.selected.metrics.recall >= 0.9);

for (const role of ['validation', 'test', 'all']) {
  const control = report.models.keepAll[role];
  const learned = report.models.mlpSurvival[role];
  for (const metrics of [control, learned]) {
    assert.ok(Number.isFinite(metrics.precision));
    assert.ok(Number.isFinite(metrics.recall));
    assert.ok(Number.isFinite(metrics.jaccard));
    assert.ok(Number.isInteger(metrics.keptCandidateCount));
    assert.ok(Number.isInteger(metrics.exactOverlapRetained));
    assert.ok(Number.isInteger(metrics.lowOnlyRemoved));
    assert.ok(Number.isInteger(metrics.exactOverlapLost));
    assert.equal(metrics.duplicateDestinationCount, 0);
  }
}
assert.ok(report.models.mlpSurvival.test.recall >= 0.9);
assert.ok(report.models.mlpSurvival.test.jaccard > report.models.keepAll.test.jaccard);
assert.ok(report.models.mlpSurvival.all.jaccard > report.models.keepAll.all.jaccard);

assert.equal(report.checkpoint.targetDataUsedForTraining, true);
assert.equal(report.checkpoint.targetDataUsedForCalibration, true);
assert.equal(report.checkpoint.testDataUsedForSelection, false);
assert.equal(report.checkpoint.sourceBinding.lowManifestSha256, report.source.lowManifest.sha256);
assert.match(report.checkpoint.sourceBinding.candidateIndexesSha256, /^[a-f0-9]{64}$/);
assert.equal(report.checkpoint.targetBinding.highManifestSha256, report.source.highManifest.sha256);
assert.match(report.checkpoint.targetBinding.highCandidateIndexesSha256, /^[a-f0-9]{64}$/);
assert.match(report.checkpoint.targetBinding.labelVectorSha256, /^[a-f0-9]{64}$/);
assert.equal(report.checkpoint.replay.status, 'source-target-bound-verified');
assert.equal(report.checkpoint.replay.sourceBindingParity, true);
assert.equal(report.checkpoint.replay.targetBindingParity, true);
assert.equal(report.checkpoint.replay.thresholdParity, true);
assert.equal(report.checkpoint.replay.keepMaskParity, true);
assert.equal(report.checkpoint.replay.outputSha256, report.denseOutputs.boundarySplatSurvivalMask.sha256);

const dense = report.denseOutputs.boundarySplatSurvivalMask;
assert.deepEqual(dense.shape, [grid, grid, grid, 1]);
assert.deepEqual(dense.channelOrder, ['boundarySplatSurvivalMask']);
assert.equal(dense.authority, 'validation-selected-candidate-survival-mask-v0');
assert.ok(existsSync(dense.path));
const denseBytes = readFileSync(dense.path);
assert.equal(denseBytes.byteLength, cells * Float32Array.BYTES_PER_ELEMENT);
assert.equal(sha256(denseBytes), dense.sha256);

const mismatchedManifest = join(fixtureRoot, 'high-mismatched.json');
writeManifest(mismatchedManifest, 'survival-high-mismatched-fixture', highSplatDesc, 'b'.repeat(64));
const mismatchedOut = join(fixtureRoot, 'probe-mismatched');
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

console.log('volume boundary splat survival probe contracts passed');
