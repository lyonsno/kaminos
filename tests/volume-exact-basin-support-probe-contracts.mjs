#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const probePath = join(root, 'volume-exact-basin-support-probe.py');

assert.ok(existsSync(probePath), 'exact-basin support classifier probe exists');
const source = readFileSync(probePath, 'utf8');
assert.match(source, /kaminos\.volume\.exact-basin-support-probe\.v0/, 'probe emits a stable report schema');
assert.match(source, /effective-splat-position-and-shader-formula-agreement-v0/, 'probe names independent accepted-label agreement authority');
assert.match(source, /spatial-block-hash-holdout-v0/, 'probe uses spatial blocks instead of random-cell leakage');
assert.match(source, /validation-selected-f1-threshold-v0/, 'probe selects its gate threshold on validation data');
assert.match(source, /offSupport/, 'probe reports off-support pollution explicitly');
assert.match(source, /failurePhase/, 'probe writes durable failure-phase reports');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-exact-basin-support-probe-'));
const highGrid = 12;
const lowGrid = 6;
const highCells = highGrid ** 3;
const lowCells = lowGrid ** 3;
const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function writeF32(name, values) {
  const path = join(fixtureRoot, name);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  writeFileSync(path, bytes);
  return { path, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

function highIndex(x, y, z) {
  return x + y * highGrid + z * highGrid * highGrid;
}

const highFluid = new Float32Array(highCells * 16);
const highFront = new Float32Array(highCells);
const highBoundary = new Float32Array(highCells * 4);
const positiveIndexes = [];
for (let z = 0; z < highGrid; z += 1) {
  for (let y = 0; y < highGrid; y += 1) {
    for (let x = 0; x < highGrid; x += 1) {
      const cell = highIndex(x, y, z);
      const positive = x >= 4 && x <= 7 && y >= 3 && y <= 8 && z >= 4 && z <= 6;
      highFluid[cell * 16 + 3] = 0.1 + y / highGrid;
      highFluid[cell * 16 + 4] = 0.05 + z / (highGrid * 2);
      highFluid[cell * 16 + 5] = positive ? 0.5 : 0.02;
      highFluid[cell * 16 + 6] = positive ? 0.16 : 0.0;
      highFluid[cell * 16 + 7] = (x + z) / (highGrid * 2);
      highFluid[cell * 16 + 8] = positive ? 0.35 : 0.0;
      highFluid[cell * 16 + 10] = positive ? 0.28 : 0.0;
      highFluid[cell * 16 + 11] = positive ? 0.18 : 0.0;
      highFluid[cell * 16 + 12] = (x + y + z) / (highGrid * 3);
      highFluid[cell * 16 + 14] = positive ? 0.22 : 0.0;
      highFront[cell] = positive ? 1.0 : 0.02;
      highBoundary[cell * 4 + 0] = positive ? 1.0 : 0.05;
      highBoundary[cell * 4 + 1] = positive ? 1.0 : 0.0;
      highBoundary[cell * 4 + 2] = positive ? 1.0 : 0.0;
      highBoundary[cell * 4 + 3] = positive ? 0.8 : 0.1;
      if (positive) positiveIndexes.push(cell);
    }
  }
}

const lowFluid = new Float32Array(lowCells * 16);
const lowFront = new Float32Array(lowCells);
for (let z = 0; z < lowGrid; z += 1) {
  for (let y = 0; y < lowGrid; y += 1) {
    for (let x = 0; x < lowGrid; x += 1) {
      const lowCell = x + y * lowGrid + z * lowGrid * lowGrid;
      const hx = Math.min(highGrid - 1, x * 2 + 1);
      const hy = Math.min(highGrid - 1, y * 2 + 1);
      const hz = Math.min(highGrid - 1, z * 2 + 1);
      const highCell = highIndex(hx, hy, hz);
      lowFluid.set(highFluid.subarray(highCell * 16, highCell * 16 + 16), lowCell * 16);
      lowFront[lowCell] = highFront[highCell];
    }
  }
}

function makeSplats(corrupt = false) {
  const values = new Float32Array(positiveIndexes.length * 12);
  positiveIndexes.forEach((cell, row) => {
    let x = cell % highGrid;
    const y = Math.floor(cell / highGrid) % highGrid;
    const z = Math.floor(cell / (highGrid * highGrid));
    if (corrupt && row === 0) x = 0;
    values[row * 12 + 0] = ((x + 0.5) / highGrid) * 2 - 1;
    values[row * 12 + 1] = ((y + 0.5) / highGrid) * 2 - 1;
    values[row * 12 + 2] = ((z + 0.5) / highGrid) * 2 - 1;
    values[row * 12 + 3] = 1;
    values[row * 12 + 4] = 1;
    values[row * 12 + 5] = 0.4;
    values[row * 12 + 6] = 0.1;
    values[row * 12 + 7] = 0.03;
    values[row * 12 + 8] = 0.1;
    values[row * 12 + 9] = 0.12;
    values[row * 12 + 10] = 1;
    values[row * 12 + 11] = 1;
  });
  return values;
}

const highFluidDesc = writeF32('high-fluid.f32', highFluid);
const highFrontDesc = writeF32('high-front.f32', highFront);
const highBoundaryDesc = writeF32('high-boundary.f32', highBoundary);
const lowFluidDesc = writeF32('low-fluid.f32', lowFluid);
const lowFrontDesc = writeF32('low-front.f32', lowFront);
const splatDesc = writeF32('boundary-splats.f32', makeSplats(false));

const pairPath = join(fixtureRoot, 'pair.json');
writeFileSync(pairPath, `${JSON.stringify({
  schema: 'kaminos.volume.full-grid-field-pair.v0',
  identity: 'support-probe-contract-pair',
  status: 'captured',
  authority: 'downsampled-same-high-history-input-to-exact-high-target',
  lowGrid,
  highGrid,
  low: {
    fluid: { ...lowFluidDesc, shape: [lowGrid, lowGrid, lowGrid, 16], channelOrder: fluidChannels },
    front: { ...lowFrontDesc, shape: [lowGrid, lowGrid, lowGrid, 1], channelOrder: ['frontTopology'] },
  },
  high: {
    fluid: { ...highFluidDesc, shape: [highGrid, highGrid, highGrid, 16], channelOrder: fluidChannels },
    front: { ...highFrontDesc, shape: [highGrid, highGrid, highGrid, 1], channelOrder: ['frontTopology'] },
  },
  source: {
    exactBasinSourceCaptureSha256: 'a'.repeat(64),
    deterministicReplay: { identity: 'fixture-replay', completedSteps: 12, simStepCount: 12 },
  },
}, null, 2)}\n`);

function fullGridManifest(path, splats) {
  writeFileSync(path, `${JSON.stringify({
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'support-probe-contract-full-grid',
    status: 'captured',
    failurePhase: null,
    grid: highGrid,
    cellCount: highCells,
    completeFieldCoverage: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:fixture',
    sourceCapture: { payloadSha256: 'a'.repeat(64), hashMatches: true },
    deterministicReplay: { identity: 'fixture-replay', completedSteps: 12, simStepCount: 12 },
    sidecars: {
      fluid: { ...highFluidDesc, shape: [highGrid, highGrid, highGrid, 16], channelOrder: fluidChannels },
      front: { ...highFrontDesc, shape: [highGrid, highGrid, highGrid, 1], channelOrder: ['frontTopology'] },
    },
    boundarySidecar: {
      authority: 'band-limited-support-coverage-ridge-proximity-footprint-v1',
      sidecars: { boundary: { ...highBoundaryDesc, shape: [highGrid, highGrid, highGrid, 4], channelOrder: ['support', 'coverage', 'ridge', 'footprint'] } },
    },
    boundarySplats: {
      identity: 'live-boundary-sidecar-learned-attribute-splats-v0',
      attributeModelIdentity: 'sha256:fixture',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      draw: { instanceCount: positiveIndexes.length, candidateCount: positiveIndexes.length, overflowCount: 0, capacity: 1024 },
      sidecars: { boundarySplats: { ...splats, shape: [positiveIndexes.length, 12], channelOrder: ['positionX', 'positionY', 'positionZ', 'support', 'colorR', 'colorG', 'colorB', 'opacity', 'radiusX', 'radiusY', 'ridge', 'fireSignal'] } },
    },
  }, null, 2)}\n`);
}

const fullGridPath = join(fixtureRoot, 'full-grid.json');
fullGridManifest(fullGridPath, splatDesc);
const outDir = join(fixtureRoot, 'valid-out');
execFileSync('python3', [
  probePath,
  '--pair-manifest', pairPath,
  '--full-grid-manifest', fullGridPath,
  '--out-dir', outDir,
  '--channels', 'fuel,frontTopology',
  '--train-samples', '700',
  '--validation-samples', '350',
  '--test-samples', '350',
  '--hidden-width', '16',
  '--epochs', '8',
  '--batch-size', '128',
  '--spatial-block-size', '3',
  '--preview-slice-y', '5',
], { stdio: 'pipe' });

const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.exact-basin-support-probe.v0');
assert.equal(report.status, 'captured');
assert.equal(report.labelAuthority.exactAgreement, true, 'shader formula and effective splat positions agree exactly');
assert.equal(report.labelAuthority.formulaPositiveCount, positiveIndexes.length);
assert.equal(report.split.identity, 'spatial-block-hash-holdout-v0');
assert.equal(report.classifier.thresholdSelection.identity, 'validation-selected-f1-threshold-v0');
assert.equal(report.classifier.thresholdSelection.selectedOn, 'validation');
for (const metric of ['precision', 'recall', 'f1', 'prAuc']) {
  assert.equal(typeof report.classifier.test.metrics[metric], 'number', `classifier reports ${metric}`);
}
assert.equal(report.gatedChannels.length, 2, 'probe evaluates the requested gated channels');
for (const channel of report.gatedChannels) {
  assert.equal(typeof channel.offSupport.ungated.mae, 'number', `${channel.channel} reports ungated off-support MAE`);
  assert.equal(typeof channel.offSupport.gated.mae, 'number', `${channel.channel} reports gated off-support MAE`);
}
assert.ok(existsSync(join(outDir, 'previews', 'fuel.support-gate-preview.png')), 'probe writes labeled fuel gate preview');
const preview = JSON.parse(readFileSync(join(outDir, 'previews', 'fuel.support-gate-preview.json'), 'utf8'));
assert.deepEqual(preview.rowOrder, ['truthHigh', 'lowUpsampled', 'ungatedPrediction', 'gatedPrediction', 'truthSupport', 'predictedSupport', 'gatedSignedError']);

const corruptSplatDesc = writeF32('boundary-splats-corrupt.f32', makeSplats(true));
const corruptFullGridPath = join(fixtureRoot, 'full-grid-corrupt.json');
fullGridManifest(corruptFullGridPath, corruptSplatDesc);
const corruptOutDir = join(fixtureRoot, 'corrupt-out');
const corruptRun = spawnSync('python3', [
  probePath,
  '--pair-manifest', pairPath,
  '--full-grid-manifest', corruptFullGridPath,
  '--out-dir', corruptOutDir,
  '--channels', 'fuel',
  '--epochs', '1',
], { encoding: 'utf8' });
assert.notEqual(corruptRun.status, 0, 'probe rejects checksum-valid splat positions that disagree with shader-derived support');
const failed = JSON.parse(readFileSync(join(corruptOutDir, 'manifest.json'), 'utf8'));
assert.equal(failed.status, 'failed');
assert.equal(failed.failurePhase, 'label-validation');
assert.match(failed.error, /accepted label disagreement/);

console.log('exact-basin support probe contracts passed');
