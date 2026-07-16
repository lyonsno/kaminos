#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const probePath = join(root, 'volume-exact-basin-support-probe.py');
const composerPath = join(root, 'volume-exact-basin-selective-compose.py');

assert.ok(existsSync(probePath), 'exact-basin support classifier probe exists');
const source = readFileSync(probePath, 'utf8');
assert.match(source, /kaminos\.volume\.exact-basin-support-probe\.v0/, 'probe emits a stable report schema');
assert.match(source, /effective-splat-position-and-shader-formula-agreement-v0/, 'probe names independent accepted-label agreement authority');
assert.match(source, /spatial-block-hash-holdout-v0/, 'probe uses spatial blocks instead of random-cell leakage');
assert.match(source, /validation-selected-f1-threshold-v0/, 'probe selects its gate threshold on validation data');
assert.match(source, /offSupport/, 'probe reports off-support pollution explicitly');
assert.match(source, /failurePhase/, 'probe writes durable failure-phase reports');
assert.ok(existsSync(composerPath), 'exact-basin selective-head composer exists');
const composerSource = readFileSync(composerPath, 'utf8');
assert.match(composerSource, /kaminos\.volume\.exact-basin-selective-composition\.v0/, 'composer emits a stable manifest schema');
assert.match(composerSource, /dense-ungated-residual-v0/, 'composer names the dense topology policy');
assert.match(composerSource, /sparse-hard-support-gated-residual-v0/, 'composer names the sparse carrier policy');
assert.match(composerSource, /--support-threshold/, 'composer accepts an explicit calibration-assay support threshold');
assert.match(composerSource, /caller-specified-calibration-assay-v0/, 'threshold overrides carry explicit non-checkpoint authority');
assert.match(composerSource, /--residual-scale/, 'composer accepts an explicit calibration-assay residual scale');
assert.match(composerSource, /caller-specified-residual-blend-assay-v0/, 'residual-scale overrides carry explicit assay authority');
assert.match(composerSource, /--channel-residual-scales/, 'composer accepts explicit per-head residual ablations');
assert.match(composerSource, /caller-specified-per-channel-residual-ablation-v0/, 'per-head residual ablations carry diagnostic authority');
assert.match(composerSource, /--channels/, 'composer requires explicit application-head selection when diagnostics and deployed heads differ');
assert.match(composerSource, /caller-selected-application-heads-v0/, 'selected application heads carry explicit authority');
assert.match(composerSource, /--checkpoint-transfer-mode/, 'composer requires an explicit mode before applying checkpoints to another frame');
assert.match(composerSource, /consecutive-phase-aligned-sequence-v0/, 'composer names the narrow lawful temporal transfer mode');
assert.match(composerSource, /same-high-capture-cross-grid-zero-shot-v0/, 'composer names cross-grid zero-shot authority explicitly');
assert.match(composerSource, /--materialization-mode/, 'composer exposes the low-to-output materialization contract');
assert.match(composerSource, /normalized-trilinear-low-to-output-grid-v0/, 'composer names the neutral trilinear materialization');
assert.match(composerSource, /failurePhase/, 'composer writes durable failure-phase reports');

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
    deterministicReplay: {
      identity: 'fixture-replay',
      completedSteps: 12,
      simStepCount: 12,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      controlsSignature: 'fixture-controls-signature',
    },
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
const narrowFullGridPath = join(fixtureRoot, 'full-grid-fluid-front-only.json');
const narrowFullGrid = JSON.parse(readFileSync(fullGridPath, 'utf8'));
narrowFullGrid.identity = 'full-grid-fluid-front-only-v0';
narrowFullGrid.exportScope = 'fluid-front-only-v0';
narrowFullGrid.derivedBoundaryCoverage = 'omitted-by-caller-v0';
delete narrowFullGrid.boundarySidecar;
delete narrowFullGrid.boundarySplats;
writeFileSync(narrowFullGridPath, `${JSON.stringify(narrowFullGrid, null, 2)}\n`);
const narrowProbeDir = join(fixtureRoot, 'narrow-probe-out');
const narrowProbe = spawnSync('python3', [
  probePath,
  '--pair-manifest', pairPath,
  '--full-grid-manifest', narrowFullGridPath,
  '--out-dir', narrowProbeDir,
  '--channels', 'fuel',
], { encoding: 'utf8' });
assert.notEqual(narrowProbe.status, 0, 'boundary-dependent support probe rejects fluid/front-only exports before artifact access');
const narrowProbeReport = JSON.parse(readFileSync(join(narrowProbeDir, 'manifest.json'), 'utf8'));
assert.equal(narrowProbeReport.failurePhase, 'manifest-validation');
assert.match(narrowProbeReport.error, /requires included derived boundary coverage/, 'scope rejection names the missing authority');
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

const compositionDir = join(fixtureRoot, 'composition-out');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', compositionDir,
  '--batch-cells', '256',
], { stdio: 'pipe' });
const composition = JSON.parse(readFileSync(join(compositionDir, 'manifest.json'), 'utf8'));
assert.equal(composition.schema, 'kaminos.volume.exact-basin-selective-composition.v0');
assert.equal(composition.status, 'captured');
assert.equal(composition.failurePhase, null);
assert.equal(composition.source.pairManifestSha256, sha256(readFileSync(pairPath)));
assert.equal(composition.source.supportProbeManifestSha256, sha256(readFileSync(join(outDir, 'manifest.json'))));
assert.equal(composition.channelPolicies.frontTopology, 'dense-ungated-residual-v0');
assert.equal(composition.channelPolicies.fuel, 'sparse-hard-support-gated-residual-v0');
assert.deepEqual(composition.support.appliesToHeads, ['fuel']);
assert.equal(composition.support.applicationAuthority, 'hard-gate-applied-to-explicit-sparse-heads-v0');
assert.deepEqual(composition.receiver.fluid.shape, [highGrid, highGrid, highGrid, 16]);
assert.deepEqual(composition.receiver.front.shape, [highGrid, highGrid, highGrid, 1]);
assert.deepEqual(composition.support.probability.shape, [highGrid, highGrid, highGrid, 1]);
assert.deepEqual(composition.support.hardMask.shape, [highGrid, highGrid, highGrid, 1]);
assert.ok(composition.support.predictedPositiveCount > 0, 'composition retains predicted sparse support');

const thresholdCompositionDir = join(fixtureRoot, 'composition-threshold-override');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', thresholdCompositionDir,
  '--batch-cells', '256',
  '--support-threshold', '0.99',
], { stdio: 'pipe' });
const thresholdComposition = JSON.parse(readFileSync(join(thresholdCompositionDir, 'manifest.json'), 'utf8'));
assert.equal(thresholdComposition.support.threshold, 0.99);
assert.equal(thresholdComposition.support.thresholdAuthority, 'caller-specified-calibration-assay-v0');
assert.equal(thresholdComposition.support.checkpointThreshold, composition.support.threshold);

const blendCompositionDir = join(fixtureRoot, 'composition-residual-blend');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', blendCompositionDir,
  '--batch-cells', '256',
  '--residual-scale', '0.5',
], { stdio: 'pipe' });
const blendComposition = JSON.parse(readFileSync(join(blendCompositionDir, 'manifest.json'), 'utf8'));
assert.equal(blendComposition.residualBlend.scale, 0.5);
assert.equal(blendComposition.residualBlend.authority, 'caller-specified-residual-blend-assay-v0');

const channelBlendCompositionDir = join(fixtureRoot, 'composition-channel-residual-ablation');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', channelBlendCompositionDir,
  '--batch-cells', '256',
  '--channel-residual-scales', 'fuel=0,frontTopology=1',
], { stdio: 'pipe' });
const channelBlendComposition = JSON.parse(readFileSync(join(channelBlendCompositionDir, 'manifest.json'), 'utf8'));
assert.deepEqual(channelBlendComposition.residualBlend.channelScales, { fuel: 0, frontTopology: 1 });
assert.equal(channelBlendComposition.residualBlend.authority, 'caller-specified-per-channel-residual-ablation-v0');

const diagnosticProbePath = join(outDir, 'manifest-with-diagnostic-flame.json');
const diagnosticProbe = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
diagnosticProbe.gatedChannels.push({ ...diagnosticProbe.gatedChannels[0], channel: 'flame', channelIndex: 8 });
writeFileSync(diagnosticProbePath, `${JSON.stringify(diagnosticProbe, null, 2)}\n`);
const selectedCompositionDir = join(fixtureRoot, 'composition-selected-application-heads');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', diagnosticProbePath,
  '--out-dir', selectedCompositionDir,
  '--batch-cells', '256',
  '--channels', 'fuel,frontTopology',
], { stdio: 'pipe' });
const selectedComposition = JSON.parse(readFileSync(join(selectedCompositionDir, 'manifest.json'), 'utf8'));
assert.deepEqual(selectedComposition.applicationHeads.channels, ['fuel', 'frontTopology']);
assert.equal(selectedComposition.applicationHeads.authority, 'caller-selected-application-heads-v0');
assert.deepEqual(Object.keys(selectedComposition.channelPolicies), ['fuel', 'frontTopology']);
assert.ok(!('flame' in selectedComposition.channelMetrics), 'diagnostic-only flame head is not applied');

const frontOnlyCompositionDir = join(fixtureRoot, 'composition-front-only');
const frontOnlyRun = spawnSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', frontOnlyCompositionDir,
  '--batch-cells', '256',
  '--channels', 'frontTopology',
], { encoding: 'utf8' });
assert.equal(
  frontOnlyRun.status,
  0,
  `dense front-only composition must not require an unrelated sparse carrier head: ${frontOnlyRun.stderr}`,
);
const frontOnlyComposition = JSON.parse(readFileSync(join(frontOnlyCompositionDir, 'manifest.json'), 'utf8'));
assert.deepEqual(frontOnlyComposition.applicationHeads.channels, ['frontTopology']);
assert.deepEqual(frontOnlyComposition.support.appliesToHeads, []);
assert.equal(frontOnlyComposition.support.applicationAuthority, 'diagnostic-only-not-applied-v0');
assert.deepEqual(Object.keys(frontOnlyComposition.channelPolicies), ['frontTopology']);
assert.equal(frontOnlyComposition.channelPolicies.frontTopology, 'dense-ungated-residual-v0');

const applicationLowFluid = new Float32Array(lowFluid);
for (let cell = 0; cell < lowCells; cell += 1) applicationLowFluid[cell * 16 + 3] += 0.125;
const applicationLowFluidDesc = writeF32('application-low-fluid.f32', applicationLowFluid);
const applicationHighFluid = new Float32Array(highFluid);
const applicationHighFront = new Float32Array(highFront);
applicationHighFluid[3] += 0.25;
applicationHighFront[0] += 0.125;
const applicationHighFluidDesc = writeF32('application-high-fluid.f32', applicationHighFluid);
const applicationHighFrontDesc = writeF32('application-high-front.f32', applicationHighFront);
const applicationPair = JSON.parse(readFileSync(pairPath, 'utf8'));
applicationPair.identity = 'support-probe-contract-application-pair';
applicationPair.low.fluid = {
  ...applicationLowFluidDesc,
  shape: [lowGrid, lowGrid, lowGrid, 16],
  channelOrder: fluidChannels,
};
applicationPair.high.fluid = {
  ...applicationHighFluidDesc,
  shape: [highGrid, highGrid, highGrid, 16],
  channelOrder: fluidChannels,
};
applicationPair.high.front = {
  ...applicationHighFrontDesc,
  shape: [highGrid, highGrid, highGrid, 1],
  channelOrder: ['frontTopology'],
};
applicationPair.source.deterministicReplay = {
  ...applicationPair.source.deterministicReplay,
  completedSteps: 13,
  simStepCount: 13,
};
const applicationPairPath = join(fixtureRoot, 'application-pair.json');
writeFileSync(applicationPairPath, `${JSON.stringify(applicationPair, null, 2)}\n`);
const transferCompositionDir = join(fixtureRoot, 'composition-checkpoint-transfer');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', applicationPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', transferCompositionDir,
  '--batch-cells', '256',
  '--checkpoint-transfer-mode', 'consecutive-phase-aligned-sequence-v0',
  '--sequence-start-step', '13',
  '--sequence-frame-index', '0',
], { stdio: 'pipe' });
const transferComposition = JSON.parse(readFileSync(join(transferCompositionDir, 'manifest.json'), 'utf8'));
assert.equal(transferComposition.checkpointTransfer.identity, 'consecutive-phase-aligned-sequence-v0');
assert.equal(transferComposition.checkpointTransfer.sequenceStartStep, 13);
assert.equal(transferComposition.checkpointTransfer.frameIndex, 0);
assert.equal(transferComposition.checkpointTransfer.trainingPair.sha256, sha256(readFileSync(pairPath)));
assert.equal(transferComposition.checkpointTransfer.applicationPair.sha256, sha256(readFileSync(applicationPairPath)));
assert.equal(transferComposition.checkpointTransfer.sourceCaptureSha256, 'a'.repeat(64));
assert.equal(transferComposition.checkpointTransfer.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
assert.equal(transferComposition.checkpointTransfer.controlsSignature, 'fixture-controls-signature');

const crossLowGrid = 4;
const crossLowCells = crossLowGrid ** 3;
const crossLowFluid = new Float32Array(crossLowCells * 16);
const crossLowFront = new Float32Array(crossLowCells);
for (let z = 0; z < crossLowGrid; z += 1) {
  for (let y = 0; y < crossLowGrid; y += 1) {
    for (let x = 0; x < crossLowGrid; x += 1) {
      const cell = x + y * crossLowGrid + z * crossLowGrid * crossLowGrid;
      for (let channel = 0; channel < 16; channel += 1) {
        crossLowFluid[cell * 16 + channel] = x + y * 10 + z * 100 + channel * 1000;
      }
      crossLowFront[cell] = x + y * 10 + z * 100 + 16000;
    }
  }
}
const crossLowFluidDesc = writeF32('cross-low-fluid.f32', crossLowFluid);
const crossLowFrontDesc = writeF32('cross-low-front.f32', crossLowFront);
const crossPair = structuredClone(JSON.parse(readFileSync(pairPath, 'utf8')));
crossPair.identity = 'support-probe-contract-cross-grid-application-pair';
crossPair.lowGrid = crossLowGrid;
crossPair.low = {
  fluid: {
    ...crossLowFluidDesc,
    shape: [crossLowGrid, crossLowGrid, crossLowGrid, 16],
    channelOrder: fluidChannels,
  },
  front: {
    ...crossLowFrontDesc,
    shape: [crossLowGrid, crossLowGrid, crossLowGrid, 1],
    channelOrder: ['frontTopology'],
  },
};
const crossPairPath = join(fixtureRoot, 'cross-grid-application-pair.json');
writeFileSync(crossPairPath, `${JSON.stringify(crossPair, null, 2)}\n`);

const implicitCrossDir = join(fixtureRoot, 'composition-cross-grid-implicit');
const implicitCross = spawnSync('python3', [
  composerPath,
  '--pair-manifest', crossPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', implicitCrossDir,
  '--batch-cells', '256',
], { encoding: 'utf8' });
assert.notEqual(implicitCross.status, 0, 'cross-grid checkpoint application fails without explicit authority');
const implicitCrossReport = JSON.parse(readFileSync(join(implicitCrossDir, 'manifest.json'), 'utf8'));
assert.equal(implicitCrossReport.failurePhase, 'checkpoint-transfer-validation');

const crossCompositionDir = join(fixtureRoot, 'composition-cross-grid-trilinear-zero-shot');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', crossPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', crossCompositionDir,
  '--batch-cells', '256',
  '--checkpoint-transfer-mode', 'same-high-capture-cross-grid-zero-shot-v0',
  '--materialization-mode', 'normalized-trilinear-low-to-output-grid-v0',
  '--residual-scale', '0',
], { stdio: 'pipe' });
const crossComposition = JSON.parse(readFileSync(join(crossCompositionDir, 'manifest.json'), 'utf8'));
assert.equal(crossComposition.checkpointTransfer.identity, 'same-high-capture-cross-grid-zero-shot-v0');
assert.equal(
  crossComposition.checkpointTransfer.authority,
  'frozen-checkpoint-same-high-capture-cross-grid-application-v0',
  'cross-grid authority remains truthful for any recorded training grid',
);
assert.equal(crossComposition.checkpointTransfer.trainingGrid.low, lowGrid);
assert.equal(crossComposition.checkpointTransfer.applicationGrid.low, crossLowGrid);
assert.equal(crossComposition.checkpointTransfer.trainingGrid.high, highGrid);
assert.equal(crossComposition.checkpointTransfer.applicationGrid.high, highGrid);
assert.equal(crossComposition.checkpointTransfer.sourceCaptureSha256, 'a'.repeat(64));
assert.equal(crossComposition.materialization.identity, 'normalized-trilinear-low-to-output-grid-v0');
assert.equal(crossComposition.materialization.sourceGrid, crossLowGrid);
assert.equal(crossComposition.materialization.outputGrid, highGrid);
assert.equal(crossComposition.materialization.coordinateConvention, 'cell-center-clamped-v0');
assert.equal(crossComposition.materialization.legacyArtifactControl, false);

function trilinearCrossValue(tx, ty, tz, channel) {
  const axis = (target) => {
    const q = Math.min(crossLowGrid - 1, Math.max(0, ((target + 0.5) * crossLowGrid / highGrid) - 0.5));
    const lo = Math.floor(q);
    return [lo, Math.min(crossLowGrid - 1, lo + 1), q - lo];
  };
  const [x0, x1, fx] = axis(tx);
  const [y0, y1, fy] = axis(ty);
  const [z0, z1, fz] = axis(tz);
  const sample = (x, y, z) => x + y * 10 + z * 100 + channel * 1000;
  const x00 = sample(x0, y0, z0) * (1 - fx) + sample(x1, y0, z0) * fx;
  const x10 = sample(x0, y1, z0) * (1 - fx) + sample(x1, y1, z0) * fx;
  const x01 = sample(x0, y0, z1) * (1 - fx) + sample(x1, y0, z1) * fx;
  const x11 = sample(x0, y1, z1) * (1 - fx) + sample(x1, y1, z1) * fx;
  const y0v = x00 * (1 - fy) + x10 * fy;
  const y1v = x01 * (1 - fy) + x11 * fy;
  return y0v * (1 - fz) + y1v * fz;
}

const crossFluid = readF32(crossComposition.receiver.fluid.path);
for (const [x, y, z] of [[0, 0, 0], [2, 5, 8], [11, 11, 11]]) {
  const cell = highIndex(x, y, z);
  const expected = trilinearCrossValue(x, y, z, 3);
  assert.ok(
    Math.abs(crossFluid[cell * 16 + 3] - expected) < 1e-3,
    'zero-residual cross-grid composition materializes untouched channels with cell-centered trilinear sampling',
  );
}

const learnedCrossCompositionDir = join(fixtureRoot, 'composition-cross-grid-trilinear-learned');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', crossPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', learnedCrossCompositionDir,
  '--batch-cells', '256',
  '--checkpoint-transfer-mode', 'same-high-capture-cross-grid-zero-shot-v0',
  '--materialization-mode', 'normalized-trilinear-low-to-output-grid-v0',
  '--support-threshold', '0.000001',
], { stdio: 'pipe' });
const learnedCrossComposition = JSON.parse(readFileSync(join(learnedCrossCompositionDir, 'manifest.json'), 'utf8'));
const learnedCrossFluid = readF32(learnedCrossComposition.receiver.fluid.path);
const learnedCrossFront = readF32(learnedCrossComposition.receiver.front.path);
const learnedCrossProbability = readF32(learnedCrossComposition.support.probability.path);
assert.ok(learnedCrossProbability.every(Number.isFinite), 'cross-grid support probabilities are finite');
assert.ok(
  learnedCrossFluid.some((value, index) => index % 16 === 6 && value !== crossFluid[index]),
  'cross-grid application executes a selected sparse residual head',
);
const crossFront = readF32(crossComposition.receiver.front.path);
assert.ok(
  learnedCrossFront.some((value, index) => value !== crossFront[index]),
  'cross-grid application executes the dense front residual head',
);

const ablatedCrossCompositionDir = join(fixtureRoot, 'composition-cross-grid-trilinear-front-only');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', crossPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', ablatedCrossCompositionDir,
  '--batch-cells', '256',
  '--checkpoint-transfer-mode', 'same-high-capture-cross-grid-zero-shot-v0',
  '--materialization-mode', 'normalized-trilinear-low-to-output-grid-v0',
  '--support-threshold', '0.000001',
  '--channel-residual-scales', 'fuel=0,frontTopology=1',
], { stdio: 'pipe' });
const ablatedCrossComposition = JSON.parse(readFileSync(join(ablatedCrossCompositionDir, 'manifest.json'), 'utf8'));
const ablatedCrossFluid = readF32(ablatedCrossComposition.receiver.fluid.path);
const ablatedCrossFront = readF32(ablatedCrossComposition.receiver.front.path);
for (let cell = 0; cell < highCells; cell += 1) {
  assert.equal(
    ablatedCrossFluid[cell * 16 + 6],
    crossFluid[cell * 16 + 6],
    'zero sparse-head scale preserves the trilinear cross-grid baseline',
  );
  assert.equal(
    ablatedCrossFront[cell],
    learnedCrossFront[cell],
    'unit dense-head scale preserves the learned cross-grid front result',
  );
}

const badCrossPair = structuredClone(crossPair);
badCrossPair.source.exactBasinSourceCaptureSha256 = 'c'.repeat(64);
const badCrossPairPath = join(fixtureRoot, 'cross-grid-application-pair-wrong-source.json');
writeFileSync(badCrossPairPath, `${JSON.stringify(badCrossPair, null, 2)}\n`);
const badCrossDir = join(fixtureRoot, 'composition-cross-grid-wrong-source');
const badCross = spawnSync('python3', [
  composerPath,
  '--pair-manifest', badCrossPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', badCrossDir,
  '--checkpoint-transfer-mode', 'same-high-capture-cross-grid-zero-shot-v0',
  '--materialization-mode', 'normalized-trilinear-low-to-output-grid-v0',
], { encoding: 'utf8' });
assert.notEqual(badCross.status, 0, 'cross-grid transfer rejects a different exact source capture');
const badCrossReport = JSON.parse(readFileSync(join(badCrossDir, 'manifest.json'), 'utf8'));
assert.equal(badCrossReport.failurePhase, 'checkpoint-transfer-validation');

const badTransferPair = structuredClone(applicationPair);
badTransferPair.source.exactBasinSourceCaptureSha256 = 'b'.repeat(64);
const badTransferPairPath = join(fixtureRoot, 'application-pair-wrong-source.json');
writeFileSync(badTransferPairPath, `${JSON.stringify(badTransferPair, null, 2)}\n`);
const badTransferDir = join(fixtureRoot, 'composition-checkpoint-transfer-wrong-source');
const badTransfer = spawnSync('python3', [
  composerPath,
  '--pair-manifest', badTransferPairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', badTransferDir,
  '--checkpoint-transfer-mode', 'consecutive-phase-aligned-sequence-v0',
  '--sequence-start-step', '13',
  '--sequence-frame-index', '0',
], { encoding: 'utf8' });
assert.notEqual(badTransfer.status, 0, 'checkpoint transfer rejects a different exact source basin');
const badTransferReport = JSON.parse(readFileSync(join(badTransferDir, 'manifest.json'), 'utf8'));
assert.equal(badTransferReport.failurePhase, 'checkpoint-transfer-validation');

function readF32(path) {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const composedFluid = readF32(composition.receiver.fluid.path);
const composedFront = readF32(composition.receiver.front.path);
const blendFluid = readF32(blendComposition.receiver.fluid.path);
const blendFront = readF32(blendComposition.receiver.front.path);
const channelBlendFluid = readF32(channelBlendComposition.receiver.fluid.path);
const channelBlendFront = readF32(channelBlendComposition.receiver.front.path);
const transferFluid = readF32(transferComposition.receiver.fluid.path);
const frontOnlyFluid = readF32(frontOnlyComposition.receiver.fluid.path);
const frontOnlyFront = readF32(frontOnlyComposition.receiver.front.path);
let selectedFuelChanged = false;
let denseFrontChanged = false;
let frontOnlyDenseChanged = false;
for (let z = 0; z < highGrid; z += 1) {
  for (let y = 0; y < highGrid; y += 1) {
    for (let x = 0; x < highGrid; x += 1) {
      const highCell = highIndex(x, y, z);
      const lowCell = Math.floor(x / 2) + Math.floor(y / 2) * lowGrid + Math.floor(z / 2) * lowGrid * lowGrid;
      assert.equal(
        composedFluid[highCell * 16 + 3],
        lowFluid[lowCell * 16 + 3],
        'unselected densityCarrier remains byte-value identical to the low baseline',
      );
      assert.equal(
        transferFluid[highCell * 16 + 3],
        applicationLowFluid[lowCell * 16 + 3],
        'checkpoint transfer inherits untouched channels from the application frame rather than the training frame',
      );
      assert.ok(
        Math.abs(blendFluid[highCell * 16 + 6] - (
          lowFluid[lowCell * 16 + 6]
          + 0.5 * (composedFluid[highCell * 16 + 6] - lowFluid[lowCell * 16 + 6])
        )) < 1e-6,
        'residual blend scales sparse fuel displacement from the low baseline',
      );
      assert.ok(
        Math.abs(blendFront[highCell] - (
          lowFront[lowCell] + 0.5 * (composedFront[highCell] - lowFront[lowCell])
        )) < 1e-6,
        'residual blend scales dense topology displacement from the low baseline',
      );
      assert.equal(
        channelBlendFluid[highCell * 16 + 6],
        lowFluid[lowCell * 16 + 6],
        'zero per-channel fuel scale preserves the materialized baseline exactly',
      );
      assert.equal(
        channelBlendFront[highCell],
        composedFront[highCell],
        'unit per-channel front scale preserves the full learned topology head',
      );
      for (let channel = 0; channel < 16; channel += 1) {
        assert.equal(
          frontOnlyFluid[highCell * 16 + channel],
          lowFluid[lowCell * 16 + channel],
          'dense front-only composition preserves every fluid channel at the materialized baseline',
        );
      }
      if (composedFluid[highCell * 16 + 6] !== lowFluid[lowCell * 16 + 6]) selectedFuelChanged = true;
      if (composedFront[highCell] !== lowFront[lowCell]) denseFrontChanged = true;
      if (frontOnlyFront[highCell] !== lowFront[lowCell]) frontOnlyDenseChanged = true;
    }
  }
}
assert.equal(selectedFuelChanged, true, 'sparse selected fuel head changes at least one high-grid cell');
assert.equal(denseFrontChanged, true, 'dense topology head changes at least one high-grid cell');
assert.equal(frontOnlyDenseChanged, true, 'dense front-only topology head changes at least one high-grid cell');

const corruptedClassifierPath = join(fixtureRoot, 'support-classifier-corrupt.npz');
const classifierBytes = readFileSync(report.classifier.artifact.path);
writeFileSync(corruptedClassifierPath, Buffer.concat([classifierBytes, Buffer.from([0x7f])]));
const corruptProbeManifest = structuredClone(report);
corruptProbeManifest.classifier.artifact.path = corruptedClassifierPath;
const corruptProbeManifestPath = join(fixtureRoot, 'support-probe-corrupt-model.json');
writeFileSync(corruptProbeManifestPath, `${JSON.stringify(corruptProbeManifest, null, 2)}\n`);
const corruptCompositionDir = join(fixtureRoot, 'composition-corrupt-model');
const corruptComposition = spawnSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', corruptProbeManifestPath,
  '--out-dir', corruptCompositionDir,
], { encoding: 'utf8' });
assert.notEqual(corruptComposition.status, 0, 'composer rejects a checkpoint whose bytes disagree with manifest authority');
const corruptCompositionReport = JSON.parse(readFileSync(join(corruptCompositionDir, 'manifest.json'), 'utf8'));
assert.equal(corruptCompositionReport.status, 'failed');
assert.equal(corruptCompositionReport.failurePhase, 'model-validation');

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
