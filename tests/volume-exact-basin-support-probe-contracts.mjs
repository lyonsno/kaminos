#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const probePath = join(root, 'volume-exact-basin-support-probe.py');
const frozenTransferPath = join(root, 'volume-fire-flow-carrier-frozen-transfer.py');
const composerPath = join(root, 'volume-exact-basin-selective-compose.py');
const phaseAlignedPackerPath = join(root, 'volume-phase-aligned-corpus-contract.py');

assert.ok(existsSync(probePath), 'exact-basin support classifier probe exists');
assert.ok(existsSync(frozenTransferPath), 'frozen fire-flow carrier transfer evaluator exists');
const source = readFileSync(probePath, 'utf8');
const frozenTransferSource = existsSync(frozenTransferPath) ? readFileSync(frozenTransferPath, 'utf8') : '';
assert.match(source, /kaminos\.volume\.exact-basin-support-probe\.v0/, 'probe emits a stable report schema');
assert.match(source, /effective-splat-position-and-shader-formula-agreement-v0/, 'probe names independent accepted-label agreement authority');
assert.match(source, /spatial-block-hash-holdout-v0/, 'probe uses spatial blocks instead of random-cell leakage');
assert.match(source, /validation-selected-f1-threshold-v0/, 'probe selects its gate threshold on validation data');
assert.match(source, /offSupport/, 'probe reports off-support pollution explicitly');
assert.match(source, /failurePhase/, 'probe writes durable failure-phase reports');
assert.match(source, /fire-flow-visibility-carrier-v0/, 'probe names the renderer-coupled fire flow carrier derivation');
assert.match(source, /clamped-central-difference-matching-volume-core-wgsl-v0/, 'carrier derivation preserves the renderer velocity stencil identity');
assert.match(source, /full-low-context-ridge-residual-control-v0/, 'carrier probe preserves a calibrated linear-context control');
assert.match(source, /native-low-derived-neighborhood-flow-context-v0/, 'carrier probe gives both controls free low-grid derivative context');
assert.match(source, /validation-selected-support-conditioned-residual-gate-v0/, 'carrier probe calibrates residual weighting on validation data');
assert.match(frozenTransferSource, /kaminos\.volume\.fire-flow-carrier-frozen-transfer\.v0/, 'frozen evaluator emits a stable transfer report schema');
assert.match(frozenTransferSource, /targetDataUsedForTraining/, 'frozen evaluator reports whether target data entered fitting');
assert.match(frozenTransferSource, /frozen-model-validation/, 'frozen evaluator fails checkpoints before target metrics');
assert.match(frozenTransferSource, /--write-dense/, 'frozen evaluator exposes explicit dense artifact generation');
assert.ok(existsSync(phaseAlignedPackerPath), 'phase-aligned corpus packer exists beside the carrier probe');
const phaseAlignedPackerSource = existsSync(phaseAlignedPackerPath) ? readFileSync(phaseAlignedPackerPath, 'utf8') : '';
assert.match(phaseAlignedPackerSource, /kaminos\.volume\.full-grid-field-pair\.v0/, 'phase-aligned packer emits the carrier probe pair schema directly');
assert.match(phaseAlignedPackerSource, /pair-manifest\.json/, 'phase-aligned packer writes a canonical pair manifest without operator transcription');
assert.ok(existsSync(composerPath), 'exact-basin selective-head composer exists');
const composerSource = readFileSync(composerPath, 'utf8');
assert.match(composerSource, /kaminos\.volume\.exact-basin-selective-composition\.v0/, 'composer emits a stable manifest schema');
assert.match(composerSource, /dense-ungated-residual-v0/, 'composer names the dense topology policy');
assert.match(composerSource, /sparse-hard-support-gated-residual-v0/, 'composer names the sparse carrier policy');
assert.match(composerSource, /--support-threshold/, 'composer accepts an explicit calibration-assay support threshold');
assert.match(composerSource, /caller-specified-calibration-assay-v0/, 'threshold overrides carry explicit non-checkpoint authority');
assert.match(composerSource, /--residual-scale/, 'composer accepts an explicit calibration-assay residual scale');
assert.match(composerSource, /caller-specified-residual-blend-assay-v0/, 'residual-scale overrides carry explicit assay authority');
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
      highFluid[cell * 16 + 0] = 0.08 * Math.sin(y * 0.8) + 0.02 * z;
      highFluid[cell * 16 + 1] = 0.06 * Math.cos(z * 0.6) + 0.015 * x;
      highFluid[cell * 16 + 2] = 0.07 * Math.sin(x * 0.7) + 0.02 * y;
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
const packedPairDir = join(fixtureRoot, 'phase-aligned-pair');
execFileSync('python3', [
  phaseAlignedPackerPath,
  '--high-manifest', fullGridPath,
  '--out-dir', packedPairDir,
  '--target-grid', String(lowGrid),
  '--source-note', 'carrier probe contract fixture',
], { stdio: 'pipe' });
const packedCorpus = JSON.parse(readFileSync(join(packedPairDir, 'manifest.json'), 'utf8'));
const packedPairPath = join(packedPairDir, 'pair-manifest.json');
const packedPair = JSON.parse(readFileSync(packedPairPath, 'utf8'));
const packedBundleReceipt = JSON.parse(readFileSync(join(packedPairDir, 'pair-bundle-receipt.json'), 'utf8'));
assert.equal(packedPair.schema, 'kaminos.volume.full-grid-field-pair.v0');
assert.equal(packedPair.status, 'captured');
assert.equal(packedPair.failurePhase, null);
assert.equal(packedPair.lowGrid, lowGrid);
assert.equal(packedPair.highGrid, highGrid);
assert.equal(packedPair.source.phaseAlignedCorpusSha256, sha256(readFileSync(join(packedPairDir, 'manifest.json'))));
assert.equal(packedPair.low.fluid.sourceSha256, highFluidDesc.sha256);
assert.equal(packedPair.low.front.sourceSha256, highFrontDesc.sha256);
assert.equal(packedPair.high.fluid.sha256, highFluidDesc.sha256);
assert.equal(packedPair.high.front.sha256, highFrontDesc.sha256);
assert.equal(realpathSync(packedCorpus.probePair.path), realpathSync(packedPairPath));
assert.equal(
  realpathSync(packedCorpus.probePair.bundleReceiptPath),
  realpathSync(join(packedPairDir, 'pair-bundle-receipt.json')),
);
assert.equal(packedBundleReceipt.corpus.sha256, sha256(readFileSync(join(packedPairDir, 'manifest.json'))));
assert.equal(packedBundleReceipt.pair.sha256, sha256(readFileSync(packedPairPath)));
assert.equal(packedPair.source.phaseAlignedCorpusSha256, packedBundleReceipt.corpus.sha256);
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
assert.deepEqual(preview.rowOrder, ['truthHigh', 'lowUpsampled', 'linearContext', 'ungatedPrediction', 'softSupportPrediction', 'hardSupportPrediction', 'truthSupport', 'predictedSupport', 'softSupportSignedError']);

const carrierOutDir = join(fixtureRoot, 'carrier-out');
execFileSync('python3', [
  probePath,
  '--pair-manifest', packedPairPath,
  '--full-grid-manifest', fullGridPath,
  '--out-dir', carrierOutDir,
  '--channels', 'fireFlowVisibilityCarrier',
  '--train-samples', '700',
  '--validation-samples', '350',
  '--test-samples', '350',
  '--hidden-width', '16',
  '--epochs', '8',
  '--batch-size', '128',
  '--dense-batch-cells', '256',
  '--spatial-block-size', '3',
  '--preview-slice-y', '5',
], { stdio: 'pipe' });
const carrierReport = JSON.parse(readFileSync(join(carrierOutDir, 'manifest.json'), 'utf8'));
assert.equal(carrierReport.status, 'captured');
assert.deepEqual(carrierReport.features.derivedLowContext, {
  identity: 'native-low-derived-neighborhood-flow-context-v0',
  channelOrder: ['curlMagnitude', 'absoluteDivergence', 'flowTerm', 'materialTerm', 'fireFlowVisibilityCarrier'],
  source: 'native low field only; exact clamped central-difference stencil before high-grid sampling',
});
assert.deepEqual(carrierReport.derivedTargets.fireFlowVisibilityCarrier, {
  identity: 'fire-flow-visibility-carrier-v0',
  authority: 'exact-high-field-renderer-coupled-derived-target-v0',
  velocityStencil: 'clamped-central-difference-matching-volume-core-wgsl-v0',
  flowTerm: 'smoothstep(0.015,0.12,curlMagnitude+absDivergence)',
  materialTerm: 'smoothstep(0.025,0.74,max(flame,visibleFireCarrier,interfaceShred,frontTopology))',
  composition: 'flowTerm*materialTerm',
  targetFamily: 'fire-only-diagnostic-carrier',
  physicalTruth: false,
});
const carrierChannel = carrierReport.gatedChannels.find(({ channel }) => channel === 'fireFlowVisibilityCarrier');
assert.ok(carrierChannel, 'probe reports the derived fire flow carrier');
assert.equal(carrierChannel.channelIndex, null, 'derived carrier does not impersonate a native fluid channel');
assert.equal(carrierChannel.linearContext.identity, 'full-low-context-ridge-residual-control-v0');
assert.equal(typeof carrierChannel.linearContext.metrics.rmse, 'number');
assert.deepEqual(carrierChannel.linearContext.artifactKeys, {
  weights: 'fireFlowVisibilityCarrier.linearWeights',
  bias: 'fireFlowVisibilityCarrier.linearBias',
  ridgeAlpha: 'fireFlowVisibilityCarrier.linearRidgeAlpha',
});
assert.equal(typeof carrierChannel.ungated.improvementVsLinearContext.rmseReductionFraction, 'number');
assert.equal(typeof carrierChannel.softGated.improvementVsLinearContext.rmseReductionFraction, 'number');
assert.equal(carrierChannel.calibratedResidual.calibration.identity, 'validation-selected-support-conditioned-residual-gate-v0');
assert.equal(carrierChannel.calibratedResidual.calibration.selectedOn, 'validation');
assert.equal(carrierChannel.calibratedResidual.calibration.testDataUsedForSelection, false);
assert.ok(['logit-temperature-bias', 'constant-residual-scale'].includes(carrierChannel.calibratedResidual.calibration.selectedFamily));
assert.equal(typeof carrierChannel.calibratedResidual.calibration.selectedAtSearchBoundary, 'boolean');
assert.equal(typeof carrierChannel.calibratedResidual.calibration.constantControl.validationMetrics.rmse, 'number');
assert.equal(typeof carrierChannel.calibratedResidual.calibration.constantControl.testMetrics.rmse, 'number');
assert.equal(typeof carrierChannel.calibratedResidual.calibration.constantControl.selectedImprovementVsConstant.rmseReductionFraction, 'number');
assert.equal(carrierChannel.calibratedResidual.calibration.constantControl.testDataUsedForSelection, false);
assert.equal(typeof carrierChannel.calibratedResidual.metrics.rmse, 'number');
assert.equal(typeof carrierChannel.gated.improvementVsLinearContext.rmseReductionFraction, 'number');
for (const role of ['lowDerived', 'truthHigh', 'ungatedPrediction', 'softSupportGatedPrediction', 'calibratedResidualPrediction', 'supportGatedPrediction']) {
  const artifact = carrierReport.denseDerivedTargets.fireFlowVisibilityCarrier[role];
  assert.deepEqual(artifact.shape, [highGrid, highGrid, highGrid, 1], `${role} records dense carrier shape`);
  assert.equal(artifact.byteLength, highCells * Float32Array.BYTES_PER_ELEMENT, `${role} records full dense byte length`);
  assert.ok(existsSync(artifact.path), `${role} dense carrier exists`);
  assert.equal(artifact.sha256, sha256(readFileSync(artifact.path)), `${role} dense carrier checksum binds bytes`);
}

const frozenTargetPairPath = join(fixtureRoot, 'frozen-target-pair.json');
const frozenTargetPair = structuredClone(JSON.parse(readFileSync(packedPairPath, 'utf8')));
frozenTargetPair.source.deterministicReplay = { identity: 'fixture-replay', completedSteps: 13, simStepCount: 13 };
writeFileSync(frozenTargetPairPath, `${JSON.stringify(frozenTargetPair, null, 2)}\n`);
const frozenTargetFullPath = join(fixtureRoot, 'frozen-target-full-grid.json');
const frozenTargetFull = JSON.parse(readFileSync(fullGridPath, 'utf8'));
frozenTargetFull.deterministicReplay = { identity: 'fixture-replay', completedSteps: 13, simStepCount: 13 };
writeFileSync(frozenTargetFullPath, `${JSON.stringify(frozenTargetFull, null, 2)}\n`);
const frozenTransferDir = join(fixtureRoot, 'frozen-transfer-out');
execFileSync('python3', [
  frozenTransferPath,
  '--source-probe-manifest', join(carrierOutDir, 'manifest.json'),
  '--target-pair-manifest', frozenTargetPairPath,
  '--target-full-grid-manifest', frozenTargetFullPath,
  '--out-dir', frozenTransferDir,
  '--test-samples', '350',
  '--write-dense',
], { stdio: 'pipe' });
const frozenTransfer = JSON.parse(readFileSync(join(frozenTransferDir, 'manifest.json'), 'utf8'));
assert.equal(frozenTransfer.schema, 'kaminos.volume.fire-flow-carrier-frozen-transfer.v0');
assert.equal(frozenTransfer.status, 'captured');
assert.equal(frozenTransfer.failurePhase, null);
assert.equal(frozenTransfer.transfer.targetDataUsedForTraining, false);
assert.equal(frozenTransfer.transfer.targetDataUsedForCalibration, false);
assert.equal(frozenTransfer.transfer.targetLabelsUsedForModelSelection, false);
assert.equal(frozenTransfer.transfer.distinctReplay, true);
assert.equal(frozenTransfer.transfer.sourceReplay.completedSteps, 12);
assert.equal(frozenTransfer.transfer.targetReplay.completedSteps, 13);
assert.equal(frozenTransfer.source.probeManifest.sha256, sha256(readFileSync(join(carrierOutDir, 'manifest.json'))));
assert.equal(frozenTransfer.source.classifier.sha256, carrierReport.classifier.artifact.sha256);
assert.equal(frozenTransfer.source.channelHeads.sha256, carrierReport.channelHeadArtifact.sha256);
assert.equal(frozenTransfer.channel.channel, 'fireFlowVisibilityCarrier');
assert.equal(frozenTransfer.channel.linearContext.identity, 'full-low-context-ridge-residual-control-v0');
assert.equal(typeof frozenTransfer.channel.lowUpsampled.rmse, 'number');
assert.equal(typeof frozenTransfer.channel.linearContext.metrics.rmse, 'number');
assert.equal(typeof frozenTransfer.channel.ungated.metrics.rmse, 'number');
assert.equal(typeof frozenTransfer.channel.constantResidual.metrics.rmse, 'number');
assert.equal(typeof frozenTransfer.channel.constantResidual.improvementVsLow.rmseReductionFraction, 'number');
assert.equal(frozenTransfer.channel.constantResidual.scale, carrierChannel.calibratedResidual.calibration.constantControl.scale);
assert.equal(frozenTransfer.split.targetTest.samplingIdentity, 'reproduced-probe-rng-sequence-without-fit-v0');
assert.equal(frozenTransfer.split.targetTest.sameSamplingContractAsSourceProbe, true);
for (const role of ['lowDerived', 'truthHigh', 'frozenLinear', 'frozenUngated', 'frozenSelected', 'frozenConstant']) {
  const artifact = frozenTransfer.denseDerivedTargets.fireFlowVisibilityCarrier[role];
  assert.deepEqual(artifact.shape, [highGrid, highGrid, highGrid, 1], `${role} frozen transfer records dense carrier shape`);
  assert.equal(artifact.byteLength, highCells * Float32Array.BYTES_PER_ELEMENT, `${role} frozen transfer records dense byte length`);
  assert.ok(existsSync(artifact.path), `${role} frozen transfer artifact exists`);
  assert.equal(artifact.sha256, sha256(readFileSync(artifact.path)), `${role} frozen transfer checksum binds bytes`);
}

const corruptFrozenHeadsPath = join(fixtureRoot, 'frozen-heads-corrupt.npz');
const frozenHeadBytes = readFileSync(carrierReport.channelHeadArtifact.path);
writeFileSync(corruptFrozenHeadsPath, Buffer.concat([frozenHeadBytes, Buffer.from([0x7f])]));
const corruptFrozenSource = structuredClone(carrierReport);
corruptFrozenSource.channelHeadArtifact.path = corruptFrozenHeadsPath;
const corruptFrozenSourcePath = join(fixtureRoot, 'frozen-source-corrupt-heads.json');
writeFileSync(corruptFrozenSourcePath, `${JSON.stringify(corruptFrozenSource, null, 2)}\n`);
const corruptFrozenTransferDir = join(fixtureRoot, 'frozen-transfer-corrupt');
const corruptFrozenTransfer = spawnSync('python3', [
  frozenTransferPath,
  '--source-probe-manifest', corruptFrozenSourcePath,
  '--target-pair-manifest', frozenTargetPairPath,
  '--target-full-grid-manifest', frozenTargetFullPath,
  '--out-dir', corruptFrozenTransferDir,
], { encoding: 'utf8' });
assert.notEqual(corruptFrozenTransfer.status, 0, 'frozen evaluator rejects altered head bytes before metrics');
const corruptFrozenTransferReport = JSON.parse(readFileSync(join(corruptFrozenTransferDir, 'manifest.json'), 'utf8'));
assert.equal(corruptFrozenTransferReport.status, 'failed');
assert.equal(corruptFrozenTransferReport.failurePhase, 'frozen-model-validation');

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

const velocityOracleCompositionDir = join(fixtureRoot, 'composition-velocity-oracle');
execFileSync('python3', [
  composerPath,
  '--pair-manifest', pairPath,
  '--support-probe-manifest', join(outDir, 'manifest.json'),
  '--out-dir', velocityOracleCompositionDir,
  '--batch-cells', '256',
  '--diagnostic-velocity-source', 'high-truth-oracle',
], { stdio: 'pipe' });
const velocityOracleComposition = JSON.parse(readFileSync(join(velocityOracleCompositionDir, 'manifest.json'), 'utf8'));
assert.equal(velocityOracleComposition.compositionAuthority, 'offline-high-truth-diagnostic-velocity-oracle-v0');
assert.equal(velocityOracleComposition.runtimeTruthAvailable, false);
assert.deepEqual(velocityOracleComposition.diagnosticVelocity, {
  identity: 'exact-high-velocity-transplant-oracle-v0',
  source: 'high-truth-oracle',
  authority: 'offline-high-truth-oracle-not-deployable-v0',
  targetChannels: ['velocityX', 'velocityY', 'velocityZ'],
  highTruthReadAtApplication: true,
  deployable: false,
});
assert.equal(
  velocityOracleComposition.relationship.applicationInput,
  'phase-aligned low field plus offline high velocity oracle',
);
assert.match(
  velocityOracleComposition.consumptionContract.mustNotBePromotedAs,
  /prediction|runtime/i,
  'oracle transplant fails loud as non-predictive evidence',
);

function readF32(path) {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const composedFluid = readF32(composition.receiver.fluid.path);
const composedFront = readF32(composition.receiver.front.path);
const blendFluid = readF32(blendComposition.receiver.fluid.path);
const blendFront = readF32(blendComposition.receiver.front.path);
const velocityOracleFluid = readF32(velocityOracleComposition.receiver.fluid.path);
let selectedFuelChanged = false;
let denseFrontChanged = false;
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
      for (let component = 0; component < 3; component += 1) {
        assert.equal(
          composedFluid[highCell * 16 + component],
          lowFluid[lowCell * 16 + component],
          'default composition retains low-upsampled diagnostic velocity',
        );
        assert.equal(
          velocityOracleFluid[highCell * 16 + component],
          highFluid[highCell * 16 + component],
          'diagnostic oracle composition transplants exact high velocity',
        );
      }
      assert.equal(
        velocityOracleFluid[highCell * 16 + 3],
        composedFluid[highCell * 16 + 3],
        'diagnostic oracle does not alter non-velocity composition',
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
      if (composedFluid[highCell * 16 + 6] !== lowFluid[lowCell * 16 + 6]) selectedFuelChanged = true;
      if (composedFront[highCell] !== lowFront[lowCell]) denseFrontChanged = true;
    }
  }
}
assert.equal(selectedFuelChanged, true, 'sparse selected fuel head changes at least one high-grid cell');
assert.equal(denseFrontChanged, true, 'dense topology head changes at least one high-grid cell');

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
