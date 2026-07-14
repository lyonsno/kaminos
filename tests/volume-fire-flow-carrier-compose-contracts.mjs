#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const composerPath = join(root, 'volume-fire-flow-carrier-compose.py');
assert.ok(existsSync(composerPath), 'frozen fire-flow carrier composer exists');

const source = existsSync(composerPath) ? readFileSync(composerPath, 'utf8') : '';
assert.match(source, /kaminos\.volume\.fire-flow-carrier-composition\.v0/, 'composer emits a stable schema');
assert.match(source, /positive-carrier-residual-to-fire-lick-v0/, 'composer names its bounded channel policy');
assert.match(source, /failurePhase/, 'composer writes durable failure reports');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-fire-flow-compose-'));
const lowGrid = 2;
const highGrid = 4;
const lowCells = lowGrid ** 3;
const highCells = highGrid ** 3;
const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeF32(name, values, shape, channelOrder) {
  const path = join(fixtureRoot, name);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  writeFileSync(path, bytes);
  return {
    path,
    shape,
    channelOrder,
    dtype: 'float32-le',
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

const lowFluid = new Float32Array(lowCells * 16);
const lowFront = new Float32Array(lowCells);
for (let cell = 0; cell < lowCells; cell += 1) {
  for (let channel = 0; channel < 16; channel += 1) {
    lowFluid[cell * 16 + channel] = cell * 0.01 + channel * 0.001;
  }
  lowFluid[cell * 16 + 14] = 0.10 + cell * 0.01;
  lowFront[cell] = 0.20 + cell * 0.01;
}
const highFluid = new Float32Array(highCells * 16);
const highFront = new Float32Array(highCells);
const lowCarrier = new Float32Array(highCells);
const truthCarrier = new Float32Array(highCells);
const frozenCarrier = new Float32Array(highCells);
for (let cell = 0; cell < highCells; cell += 1) {
  highFluid.fill(0, cell * 16, cell * 16 + 16);
  highFluid[cell * 16 + 14] = 0.6;
  highFront[cell] = 0.7;
  lowCarrier[cell] = 0.20;
  truthCarrier[cell] = cell % 2 === 0 ? 0.50 : 0.10;
  frozenCarrier[cell] = cell % 3 === 0 ? 0.40 : 0.15;
}

const lowFluidDesc = writeF32('low.fluid.f32', lowFluid, [lowGrid, lowGrid, lowGrid, 16], channels);
const lowFrontDesc = writeF32('low.front.f32', lowFront, [lowGrid, lowGrid, lowGrid, 1], ['frontTopology']);
const highFluidDesc = writeF32('high.fluid.f32', highFluid, [highGrid, highGrid, highGrid, 16], channels);
const highFrontDesc = writeF32('high.front.f32', highFront, [highGrid, highGrid, highGrid, 1], ['frontTopology']);
const pairPath = join(fixtureRoot, 'pair.json');
writeFileSync(pairPath, `${JSON.stringify({
  schema: 'kaminos.volume.full-grid-field-pair.v0',
  identity: 'fire-flow-compose-fixture-pair',
  status: 'captured',
  failurePhase: null,
  lowGrid,
  highGrid,
  low: { fluid: lowFluidDesc, front: lowFrontDesc },
  high: { fluid: highFluidDesc, front: highFrontDesc },
  source: {
    exactBasinSourceCaptureSha256: 'a'.repeat(64),
    deterministicReplay: { identity: 'fixture-replay', completedSteps: 160, simStepCount: 160 },
  },
}, null, 2)}\n`);

const carrierDescriptors = {
  lowDerived: writeF32('carrier.low.f32', lowCarrier, [highGrid, highGrid, highGrid, 1], ['fireFlowVisibilityCarrier']),
  truthHigh: writeF32('carrier.truth.f32', truthCarrier, [highGrid, highGrid, highGrid, 1], ['fireFlowVisibilityCarrier']),
  frozenConstant: writeF32('carrier.frozen.f32', frozenCarrier, [highGrid, highGrid, highGrid, 1], ['fireFlowVisibilityCarrier']),
};
const transferPath = join(fixtureRoot, 'transfer.json');
writeFileSync(transferPath, `${JSON.stringify({
  schema: 'kaminos.volume.fire-flow-carrier-frozen-transfer.v0',
  identity: 'checksum-bound-frozen-fire-flow-carrier-transfer-v0',
  status: 'captured',
  failurePhase: null,
  target: {
    pairManifest: { path: pairPath, sha256: sha256(readFileSync(pairPath)) },
    lowGrid,
    highGrid,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:fixture',
    exactBasinSourceCaptureSha256: 'a'.repeat(64),
  },
  transfer: {
    sourceReplay: { identity: 'fixture-replay', completedSteps: 96, simStepCount: 96 },
    targetReplay: { identity: 'fixture-replay', completedSteps: 160, simStepCount: 160 },
    targetDataUsedForTraining: false,
    targetDataUsedForCalibration: false,
    targetLabelsUsedForModelSelection: false,
  },
  denseDerivedTargets: { fireFlowVisibilityCarrier: carrierDescriptors },
}, null, 2)}\n`);

const outDir = join(fixtureRoot, 'composed');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--carrier-manifest', transferPath,
  '--carrier-role', 'frozenConstant',
  '--gain', '0.5',
  '--out-dir', outDir,
], { stdio: 'pipe' });

const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.fire-flow-carrier-composition.v0');
assert.equal(manifest.status, 'captured');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.compositionAuthority, 'frozen-fire-flow-carrier-fire-lick-composition-v0');
assert.equal(manifest.policy.identity, 'positive-carrier-residual-to-fire-lick-v0');
assert.equal(manifest.policy.channel, 'fireLick');
assert.equal(manifest.policy.channelIndex, 14);
assert.equal(manifest.policy.gain, 0.5);
assert.equal(manifest.policy.subtractiveResidualApplied, false);
assert.equal(manifest.verification.unchangedFluidChannelCount, 15);
assert.equal(manifest.verification.frontByteIdenticalToLowUpsampled, true);
assert.equal(manifest.source.pairManifest.sha256, sha256(readFileSync(pairPath)));
assert.equal(manifest.source.carrierManifest.sha256, sha256(readFileSync(transferPath)));

function readF32(path) {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const composedFluid = readF32(manifest.receiver.fluid.path);
const composedFront = readF32(manifest.receiver.front.path);
for (let z = 0; z < highGrid; z += 1) {
  for (let y = 0; y < highGrid; y += 1) {
    for (let x = 0; x < highGrid; x += 1) {
      const highCell = x + y * highGrid + z * highGrid * highGrid;
      const lowCell = Math.floor(x / 2) + Math.floor(y / 2) * lowGrid + Math.floor(z / 2) * lowGrid * lowGrid;
      for (let channel = 0; channel < 16; channel += 1) {
        const carrierResidual = Math.max(0, Math.fround(frozenCarrier[highCell] - lowCarrier[highCell]));
        const expected = channel === 14
          ? Math.fround(lowFluid[lowCell * 16 + channel] + Math.fround(carrierResidual * Math.fround(0.5)))
          : lowFluid[lowCell * 16 + channel];
        assert.equal(composedFluid[highCell * 16 + channel], expected, `cell ${highCell} channel ${channel} follows composition policy`);
      }
      assert.equal(composedFront[highCell], lowFront[lowCell], 'front remains low-upsampled and unchanged');
    }
  }
}

const corruptCarrier = structuredClone(JSON.parse(readFileSync(transferPath, 'utf8')));
corruptCarrier.denseDerivedTargets.fireFlowVisibilityCarrier.frozenConstant.sha256 = '0'.repeat(64);
const corruptPath = join(fixtureRoot, 'transfer-corrupt.json');
writeFileSync(corruptPath, `${JSON.stringify(corruptCarrier, null, 2)}\n`);
const failedDir = join(fixtureRoot, 'failed');
const failed = spawnSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--carrier-manifest', corruptPath,
  '--carrier-role', 'frozenConstant',
  '--gain', '0.5',
  '--out-dir', failedDir,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'altered carrier checksum fails before composition');
const failure = JSON.parse(readFileSync(join(failedDir, 'manifest.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'artifact-validation');

console.log('fire-flow carrier composition contracts passed');
