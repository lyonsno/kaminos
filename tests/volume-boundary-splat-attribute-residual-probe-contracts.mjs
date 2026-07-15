#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const probePath = join(root, 'volume-boundary-splat-attribute-residual-probe.py');
assert.ok(existsSync(probePath), 'support-conditioned splat attribute residual probe exists');

const source = readFileSync(probePath, 'utf8');
assert.match(source, /kaminos\.volume\.boundary-splat-attribute-residual-probe\.v0/);
assert.match(source, /survival-conditioned-exact-cell-color-opacity-residual-v0/);
assert.match(source, /validation-selected-candidate-survival-mask-v0/);
assert.match(source, /same-cell-high-splat-color-opacity-v0/);
assert.match(source, /low-copy-color-opacity-control-v0/);
assert.match(source, /linear-residual-color-opacity-v0/);
assert.match(source, /tiny-mlp-residual-color-opacity-v0/);
assert.match(source, /survival-conditioned-color-opacity-grid-v0/);
assert.match(source, /source-target-survival-bound-verified/);
assert.match(source, /failurePhase/);

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-splat-attribute-residual-'));
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

function splatRows(indexes, high = false) {
  const values = new Float32Array(indexes.length * 12);
  indexes.forEach((cell, row) => {
    const x = cell % grid;
    const y = Math.floor(cell / grid) % grid;
    const z = Math.floor(cell / (grid * grid));
    const signal = ((x * 3 + y * 5 + z * 7) % 17) / 16;
    const base = row * 12;
    values[base + 0] = ((x + 0.5) / grid) * 2 - 1;
    values[base + 1] = ((y + 0.5) / grid) * 2 - 1;
    values[base + 2] = ((z + 0.5) / grid) * 2 - 1;
    values[base + 3] = 0.45 + 0.35 * signal;
    values[base + 4] = high ? 0.12 + 0.72 * signal * signal : 0.12 + 0.48 * signal;
    values[base + 5] = high ? 0.16 + 0.42 * Math.sqrt(signal) : 0.16 + 0.30 * signal;
    values[base + 6] = high ? 0.68 - 0.50 * signal * signal : 0.68 - 0.34 * signal;
    values[base + 7] = high ? 0.004 + 0.032 * signal * signal : 0.004 + 0.020 * signal;
    values[base + 8] = 0.02 + 0.01 * signal;
    values[base + 9] = 0.03 + 0.01 * signal;
    values[base + 10] = 0.5 + 0.3 * signal;
    values[base + 11] = 0.4 + 0.4 * signal;
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
      const signal = ((x * 3 + y * 5 + z * 7) % 17) / 16;
      lowIndexes.push(cell);
      if (signal >= 0.25) highIndexes.push(cell);
      fluid[cell * 16 + 3] = signal;
      fluid[cell * 16 + 4] = y / grid;
      fluid[cell * 16 + 5] = signal;
      fluid[cell * 16 + 6] = z / grid;
      fluid[cell * 16 + 8] = signal;
      fluid[cell * 16 + 10] = signal;
      fluid[cell * 16 + 12] = (x + z) / (grid * 2);
      boundary[cell * 4 + 0] = 1;
      boundary[cell * 4 + 1] = signal;
      boundary[cell * 4 + 2] = 0.65 + 0.25 * signal;
      boundary[cell * 4 + 3] = 0.45 + 0.35 * signal;
    }
  }
}

const fluidDesc = writeF32('fluid.f32', fluid);
const frontDesc = writeF32('front.f32', front);
const boundaryDesc = writeF32('boundary.f32', boundary);
const lowSplatDesc = writeF32('low-splats.f32', splatRows(lowIndexes));
const highSplatDesc = writeF32('high-splats.f32', splatRows(highIndexes, true));
const payloadSha = '7'.repeat(64);

function writeExport(path, identity, splats) {
  const manifest = {
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
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return sha256(readFileSync(path));
}

const lowManifest = join(fixtureRoot, 'low.json');
const highManifest = join(fixtureRoot, 'high.json');
const lowManifestSha = writeExport(lowManifest, 'attribute-low-fixture', lowSplatDesc);
const highManifestSha = writeExport(highManifest, 'attribute-high-fixture', highSplatDesc);

const survivalMask = new Float32Array(cells);
for (const index of highIndexes) survivalMask[index] = 1;
const highIndexSet = new Set(highIndexes);
const unlabeledSurvivorIndexes = lowIndexes.filter((index) => !highIndexSet.has(index)).slice(0, 7);
for (const index of unlabeledSurvivorIndexes) survivalMask[index] = 1;
const survivalIndexes = [...highIndexes, ...unlabeledSurvivorIndexes];
const survivalMaskDesc = writeF32('survival-mask.f32', survivalMask);
const survivalManifest = join(fixtureRoot, 'survival.json');
writeFileSync(survivalManifest, `${JSON.stringify({
  schema: 'kaminos.volume.boundary-splat-survival-probe.v0',
  identity: 'candidate-only-exact-cell-survival-v0',
  status: 'captured',
  failurePhase: null,
  source: {
    lowManifest: { path: lowManifest, sha256: lowManifestSha },
    highManifest: { path: highManifest, sha256: highManifestSha },
    sourcePair: { payloadSha256: payloadSha, authority: 'matched-verified-source-capture-payload-v0' },
    grid,
  },
  denseOutputs: {
    boundarySplatSurvivalMask: {
      ...survivalMaskDesc,
      shape: [grid, grid, grid, 1],
      channelOrder: ['boundarySplatSurvivalMask'],
      authority: 'validation-selected-candidate-survival-mask-v0',
      applicationIdentity: 'survival-only-remove-rejected-low-candidates-v0',
      candidateCount: lowIndexes.length,
      keptCandidateCount: survivalIndexes.length,
    },
  },
  checkpoint: {
    threshold: 0.25,
    sourceBinding: { lowManifestSha256: lowManifestSha },
    targetBinding: { highManifestSha256: highManifestSha },
    replay: {
      status: 'source-target-bound-verified',
      sourceBindingParity: true,
      targetBindingParity: true,
      thresholdParity: true,
      probabilityParity: true,
      keepMaskParity: true,
      outputSha256: survivalMaskDesc.sha256,
    },
  },
}, null, 2)}\n`);

const outputDir = join(fixtureRoot, 'probe');
const run = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', highManifest,
  '--survival-manifest', survivalManifest,
  '--out-dir', outputDir,
  '--spatial-block-size', '4',
  '--epochs', '16',
  '--hidden-width', '16',
  '--batch-size', '64',
  '--seed', '9517',
], { encoding: 'utf8' });
assert.equal(run.status, 0, `fixture probe succeeds: ${run.stderr || run.stdout}`);

const report = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.boundary-splat-attribute-residual-probe.v0');
assert.equal(report.identity, 'survival-conditioned-exact-cell-color-opacity-residual-v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.dataset.lowCandidateCount, lowIndexes.length);
assert.equal(report.dataset.highCandidateCount, highIndexes.length);
assert.equal(report.dataset.survivalKeptCandidateCount, survivalIndexes.length);
assert.equal(report.dataset.sameCellTrainingPopulation, highIndexes.length);
assert.equal(report.dataset.survivingWithoutSameCellHighLabel, unlabeledSurvivorIndexes.length);
assert.deepEqual(report.dataset.targetChannels, ['color.r', 'color.g', 'color.b', 'opacity']);
assert.equal(report.dataset.targetAuthority, 'same-cell-high-splat-color-opacity-v0');
assert.equal(report.dataset.candidateMutationPolicy, 'survival fixed; attributes only');
assert.ok(report.split.trainRows > 0 && report.split.validationRows > 0 && report.split.testRows > 0);
assert.equal(report.split.testDataUsedForSelection, false);

for (const model of ['lowCopy', 'linearResidual', 'mlpResidual']) {
  for (const role of ['validation', 'test', 'all']) {
    const metrics = report.models[model][role];
    assert.ok(Number.isFinite(metrics.aggregateRmse));
    assert.ok(Number.isFinite(metrics.aggregateMae));
    assert.equal(metrics.channels.length, 4);
    for (const channel of metrics.channels) {
      assert.ok(Number.isFinite(channel.rmse));
      assert.ok(Number.isFinite(channel.mae));
    }
  }
}
assert.equal(report.models.lowCopy.identity, 'low-copy-color-opacity-control-v0');
assert.equal(report.models.linearResidual.identity, 'linear-residual-color-opacity-v0');
assert.equal(report.models.mlpResidual.identity, 'tiny-mlp-residual-color-opacity-v0');
assert.equal(report.checkpoint.testDataUsedForSelection, false);
assert.equal(report.checkpoint.targetDataUsedForTraining, true);
assert.equal(report.checkpoint.sourceBinding.lowManifestSha256, lowManifestSha);
assert.equal(report.checkpoint.targetBinding.highManifestSha256, highManifestSha);
assert.equal(report.checkpoint.survivalBinding.survivalMaskSha256, survivalMaskDesc.sha256);
assert.equal(report.checkpoint.replay.status, 'source-target-survival-bound-verified');
assert.equal(report.checkpoint.replay.sourceBindingParity, true);
assert.equal(report.checkpoint.replay.targetBindingParity, true);
assert.equal(report.checkpoint.replay.survivalBindingParity, true);
assert.equal(report.checkpoint.replay.predictionParity, true);
assert.equal(report.checkpoint.replay.contractParity, true);
assert.equal(report.checkpoint.replay.denseOutputParity, true);
assert.equal(report.checkpoint.replay.denseOutputByteParity, true);

const dense = report.denseOutputs.colorOpacity;
assert.deepEqual(dense.shape, [grid, grid, grid, 4]);
assert.deepEqual(dense.channelOrder, ['color.r', 'color.g', 'color.b', 'opacity']);
assert.equal(dense.authority, 'survival-conditioned-color-opacity-grid-v0');
assert.equal(dense.nonSurvivorPolicy, 'zero');
assert.equal(dense.candidateMutationPolicy, 'attribute override only; no birth, movement, or simulator mutation');
assert.ok(existsSync(dense.path));
const denseBytes = readFileSync(dense.path);
assert.equal(denseBytes.byteLength, cells * 4 * Float32Array.BYTES_PER_ELEMENT);
assert.equal(sha256(denseBytes), dense.sha256);
const denseValues = new Float32Array(
  denseBytes.buffer,
  denseBytes.byteOffset,
  denseBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
);
const survivalSet = new Set(survivalIndexes);
let populatedCells = 0;
for (let cell = 0; cell < cells; cell += 1) {
  const row = Array.from(denseValues.subarray(cell * 4, cell * 4 + 4));
  const populated = row.some((value) => value !== 0);
  assert.equal(populated, survivalSet.has(cell), `dense membership matches frozen survivor cell ${cell}`);
  if (populated) populatedCells += 1;
}
assert.equal(populatedCells, survivalIndexes.length);
for (const cell of unlabeledSurvivorIndexes) {
  const row = Array.from(denseValues.subarray(cell * 4, cell * 4 + 4));
  assert.ok(row.some((value) => value !== 0), 'survivors without same-cell labels still receive inference');
}

const mismatchedSurvival = join(fixtureRoot, 'survival-mismatched.json');
const mismatched = JSON.parse(readFileSync(survivalManifest, 'utf8'));
mismatched.source.lowManifest.sha256 = 'f'.repeat(64);
writeFileSync(mismatchedSurvival, `${JSON.stringify(mismatched, null, 2)}\n`);
const mismatchOut = join(fixtureRoot, 'probe-mismatched');
const mismatchRun = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', highManifest,
  '--survival-manifest', mismatchedSurvival,
  '--out-dir', mismatchOut,
], { encoding: 'utf8' });
assert.notEqual(mismatchRun.status, 0, 'mismatched survival source ancestry must fail');
const mismatchReport = JSON.parse(readFileSync(join(mismatchOut, 'manifest.json'), 'utf8'));
assert.equal(mismatchReport.status, 'failed');
assert.equal(mismatchReport.failurePhase, 'survival-binding');
assert.match(mismatchReport.error.message, /low manifest sha256/i);

const failedReplaySurvival = join(fixtureRoot, 'survival-failed-replay.json');
const failedReplay = JSON.parse(readFileSync(survivalManifest, 'utf8'));
failedReplay.checkpoint.replay.status = 'failed';
failedReplay.checkpoint.replay.sourceBindingParity = false;
writeFileSync(failedReplaySurvival, `${JSON.stringify(failedReplay, null, 2)}\n`);
const failedReplayOut = join(fixtureRoot, 'probe-failed-replay');
const failedReplayRun = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', highManifest,
  '--survival-manifest', failedReplaySurvival,
  '--out-dir', failedReplayOut,
], { encoding: 'utf8' });
assert.notEqual(failedReplayRun.status, 0, 'failed survival checkpoint replay must be rejected');
const failedReplayReport = JSON.parse(readFileSync(join(failedReplayOut, 'manifest.json'), 'utf8'));
assert.equal(failedReplayReport.status, 'failed');
assert.equal(failedReplayReport.failurePhase, 'survival-binding');
assert.match(failedReplayReport.error.message, /replay/i);

// Alter only held-test target attributes. Train-only fitting must reproduce identical dense bytes.
function spatialRole(cell) {
  const x = cell % grid;
  const y = Math.floor(cell / grid) % grid;
  const z = Math.floor(cell / (grid * grid));
  const bx = Math.floor(x / 4);
  const by = Math.floor(y / 4);
  const bz = Math.floor(z / 4);
  const hash = ((bx * 73856093) ^ (by * 19349663) ^ (bz * 83492791) ^ 9517) >>> 0;
  const bin = hash % 10;
  return bin < 2 ? 'test' : bin < 4 ? 'validation' : 'train';
}

const heldPerturbedSplats = splatRows(highIndexes, true);
let heldPerturbedRows = 0;
for (let row = 0; row < highIndexes.length; row += 1) {
  if (spatialRole(highIndexes[row]) !== 'test') continue;
  heldPerturbedSplats[row * 12 + 4] = Math.min(1, heldPerturbedSplats[row * 12 + 4] + 0.11);
  heldPerturbedSplats[row * 12 + 5] = Math.max(0, heldPerturbedSplats[row * 12 + 5] - 0.07);
  heldPerturbedRows += 1;
}
assert.ok(heldPerturbedRows > 0, 'fixture has held-test targets to perturb');
const heldSplatDesc = writeF32('high-held-perturbed-splats.f32', heldPerturbedSplats);
const heldHighManifest = join(fixtureRoot, 'high-held-perturbed.json');
const heldHighManifestSha = writeExport(heldHighManifest, 'attribute-high-held-perturbed-fixture', heldSplatDesc);
const heldSurvivalManifest = join(fixtureRoot, 'survival-held-perturbed.json');
const heldSurvival = JSON.parse(readFileSync(survivalManifest, 'utf8'));
heldSurvival.source.highManifest = { path: heldHighManifest, sha256: heldHighManifestSha };
heldSurvival.checkpoint.targetBinding.highManifestSha256 = heldHighManifestSha;
writeFileSync(heldSurvivalManifest, `${JSON.stringify(heldSurvival, null, 2)}\n`);
const heldOut = join(fixtureRoot, 'probe-held-perturbed');
const heldRun = spawnSync('python3', [
  probePath,
  '--low-manifest', lowManifest,
  '--high-manifest', heldHighManifest,
  '--survival-manifest', heldSurvivalManifest,
  '--out-dir', heldOut,
  '--spatial-block-size', '4',
  '--epochs', '16',
  '--hidden-width', '16',
  '--batch-size', '64',
  '--seed', '9517',
], { encoding: 'utf8' });
assert.equal(heldRun.status, 0, `held-only target perturbation probe succeeds: ${heldRun.stderr || heldRun.stdout}`);
const heldReport = JSON.parse(readFileSync(join(heldOut, 'manifest.json'), 'utf8'));
const heldDenseBytes = readFileSync(heldReport.denseOutputs.colorOpacity.path);
assert.deepEqual(heldDenseBytes, denseBytes, 'held-test target perturbations cannot change learned dense inference');

console.log('boundary splat attribute residual probe contracts passed');
