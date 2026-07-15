import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const trainer = join(root, 'volume-coarse-support-front-scaffold.py');
const fineTrainer = join(root, 'volume-sparse-temporal-front-detail-probe.py');
const calibrationTrainer = join(root, 'volume-source-delta-admission-calibration.py');
assert.ok(existsSync(trainer), 'coarse support/front scaffold trainer must exist');
assert.ok(existsSync(fineTrainer), 'sparse temporal front detail trainer must exist');
assert.ok(existsSync(calibrationTrainer), 'source-only admission calibration trainer must exist');

const scratch = mkdtempSync(join(tmpdir(), 'kaminos-coarse-scaffold-contract-'));
const sourceGrid = 4;
const teacherGrid = 8;
const scaffoldGrid = 2;
const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeF32(path, values) {
  const array = Float32Array.from(values);
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  writeFileSync(path, bytes);
  return { path, sha256: sha(bytes), byteLength: bytes.byteLength };
}

function descriptor(file, shape, channelOrder) {
  return {
    ...file,
    dtype: 'float32-le',
    byteOrder: 'little-endian',
    shape,
    channelOrder,
  };
}

function sourceValue(step, x, y, z, channel) {
  const wave = Math.sin((x + 1) * 0.7 + (y + step) * 0.21 + (z + 2) * 0.37);
  return 0.07 * channel + 0.11 * wave + 0.015 * step;
}

function makeFrame(step) {
  const frameDir = join(scratch, `step-${step}`);
  execFileSync('mkdir', ['-p', frameDir]);
  const fluid = [];
  const front = [];
  for (let z = 0; z < sourceGrid; z += 1) {
    for (let y = 0; y < sourceGrid; y += 1) {
      for (let x = 0; x < sourceGrid; x += 1) {
        for (let channel = 0; channel < 16; channel += 1) {
          fluid.push(sourceValue(step, x, y, z, channel));
        }
        front.push(0.2 + 0.05 * Math.sin(x + y * 0.4 + z * 0.7 + step * 0.2));
      }
    }
  }
  const fluidFile = writeF32(join(frameDir, 'fluid.f32'), fluid);
  const frontFile = writeF32(join(frameDir, 'front.f32'), front);
  const sourceManifest = {
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-only-v0',
    status: 'captured',
    failurePhase: null,
    completeFieldCoverage: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:fixture',
    simStepCount: step,
    artifacts: {
      fluid: descriptor(fluidFile, [sourceGrid, sourceGrid, sourceGrid, 16], fluidChannels),
      front: descriptor(frontFile, [sourceGrid, sourceGrid, sourceGrid, 1], ['frontTopology']),
    },
  };
  const sourceManifestPath = join(frameDir, 'source.json');
  writeFileSync(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
  const sourceManifestSha256 = sha(readFileSync(sourceManifestPath));

  const support = [];
  const composedFront = [];
  for (let z = 0; z < teacherGrid; z += 1) {
    for (let y = 0; y < teacherGrid; y += 1) {
      for (let x = 0; x < teacherGrid; x += 1) {
        const sx = Math.min(sourceGrid - 1, Math.floor(x * sourceGrid / teacherGrid));
        const sy = Math.min(sourceGrid - 1, Math.floor(y * sourceGrid / teacherGrid));
        const sz = Math.min(sourceGrid - 1, Math.floor(z * sourceGrid / teacherGrid));
        const heat = sourceValue(step, sx, sy, sz, 5);
        const nativeFront = front[(sz * sourceGrid + sy) * sourceGrid + sx];
        const occupiedBlock = x < teacherGrid / 2 && (y < teacherGrid / 2 || z < teacherGrid / 2);
        support.push(occupiedBlock ? 0.995 : 0.04);
        composedFront.push(nativeFront + 0.025 * heat + 0.008 * Math.sin(x * 0.8 + y * 0.3 + step));
      }
    }
  }
  const supportFile = writeF32(join(frameDir, 'support.f32'), support);
  const composedFrontFile = writeF32(join(frameDir, 'teacher-front.f32'), composedFront);
  const teacherManifest = {
    schema: 'kaminos.volume.native-low-selective-composition.v0',
    identity: 'native-low-zero-shot-selective-composition-v0',
    status: 'captured',
    failurePhase: null,
    runtimeTruthAvailable: false,
    source: {
      nativeManifestPath: sourceManifestPath,
      nativeManifestSha256: sourceManifestSha256,
      nativeGrid: sourceGrid,
      nativeSimStepCount: step,
      effectiveRoute: sourceManifest.effectiveRoute,
      backend: sourceManifest.backend,
    },
    model: {
      identity: 'exact-basin-selective-carrier-heads-160-to-128-v0',
      modelSha256: 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9',
    },
    outputs: {
      supportProbability: descriptor(supportFile, [teacherGrid, teacherGrid, teacherGrid, 1], ['supportProbability']),
      front: descriptor(composedFrontFile, [teacherGrid, teacherGrid, teacherGrid, 1], ['frontTopology']),
    },
  };
  const teacherManifestPath = join(frameDir, 'teacher.json');
  writeFileSync(teacherManifestPath, `${JSON.stringify(teacherManifest, null, 2)}\n`);
  return { step, sourceManifestPath, teacherManifestPath };
}

const frames = [96, 97, 98].map(makeFrame);
const outDir = join(scratch, 'out');
const args = [
  trainer,
  '--train-frame', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}`,
  '--validation-frame', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
  '--test-frame', `${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
  '--out-dir', outDir,
  '--scaffold-grid', String(scaffoldGrid),
  '--hidden-width', '6',
  '--epochs', '5',
  '--batch-size', '8',
  '--seed', '37',
];
execFileSync('python3', args, { stdio: 'pipe' });

const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.coarse-support-front-scaffold.v0');
assert.equal(report.identity, 'full-input-coarse-support-front-student-v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.producer.identity, 'volume-coarse-support-front-scaffold.py');
assert.equal(report.producer.scriptSha256, sha(readFileSync(trainer)));
assert.deepEqual(report.producer.invocation, {
  scaffoldGrid,
  hiddenWidth: 6,
  epochs: 5,
  batchSize: 8,
  learningRate: 0.002,
  weightDecay: 0.00001,
  frontLossWeight: 1,
  supportTeacherThreshold: 0.98,
  minimumSupportRecall: 0.999,
  seed: 37,
});
assert.deepEqual(report.frameRoles, { train: [96], validation: [97], test: [98] });
assert.equal(report.features.lowFieldCount, 17);
assert.equal(report.features.featureCount, 185);
assert.equal(report.features.sourceSamplingIdentity, 'teacher-block-aligned-native-field-mean-v0');
assert.deepEqual(report.features.lowFieldChannelOrder, [...fluidChannels, 'frontTopology']);
assert.equal(report.labels.support.identity, 'teacher-block-max-hard-occupancy-v0');
assert.equal(report.labels.support.teacherThreshold, 0.98);
assert.equal(report.labels.front.identity, 'teacher-minus-native-low-block-mean-residual-v0');
assert.deepEqual(report.labels.support.shapePerFrame, [scaffoldGrid, scaffoldGrid, scaffoldGrid, 1]);
assert.deepEqual(report.labels.front.shapePerFrame, [scaffoldGrid, scaffoldGrid, scaffoldGrid, 1]);
assert.equal(report.student.architecture, 'shared-tanh-trunk-two-scalar-heads-v0');
assert.equal(report.student.hiddenWidth, 6);
assert.equal(report.support.thresholdSelection.selectedOn, 'validation');
assert.equal(report.support.thresholdSelection.testDataUsedForSelection, false);
assert.equal(report.support.thresholdSelection.capped, false);
assert.equal(typeof report.support.test.recall, 'number');
assert.equal(typeof report.front.test.correlation, 'number');
assert.equal(typeof report.front.test.energyRetention, 'number');
assert.equal(report.front.coarseLabelMetricAuthority, 'coarse-block-label-fit-only-v0');
assert.equal(report.front.denseHeld.interpolationIdentity, 'cell-centered-trilinear-coarse-to-teacher-grid-v0');
assert.equal(typeof report.front.denseHeld.correlation, 'number');
assert.equal(typeof report.front.denseHeld.energyRetention, 'number');
assert.equal(typeof report.front.denseHeld.explainedEnergy, 'number');
assert.equal(report.front.calibration.identity, 'validation-dense-energy-gain-v0');
assert.equal(report.front.calibration.selectedOn, 'validation');
assert.equal(report.front.calibration.testDataUsedForSelection, false);
assert.equal(typeof report.front.calibration.gain, 'number');
assert.equal(typeof report.front.calibratedDenseHeld.energyRetention, 'number');
assert.equal(typeof report.front.calibratedDenseHeld.explainedEnergy, 'number');
assert.equal(report.promotion.metricAuthority, 'held-raw-structure-validation-calibrated-amplitude-v0');
assert.equal(typeof report.promotion.heldRawDenseFrontCorrelationAtLeast093, 'boolean');
assert.equal(typeof report.promotion.heldCalibratedDenseFrontEnergyRetentionBetween090And110, 'boolean');
assert.equal(typeof report.promotion.heldCalibratedDenseFrontExplainedEnergyPositive, 'boolean');
assert.equal(report.promotion.runtimePromotionNotEvaluated, true);
assert.equal(report.checkpoint.replay.status, 'source-teacher-bound-verified');
assert.equal(report.checkpoint.replay.outputParity, true);
assert.equal(report.checkpoint.replay.sourceBindingParity, true);
assert.equal(report.runtimeProjection.scaffoldCellCount, scaffoldGrid ** 3);
assert.equal(report.runtimeProjection.inputFeatureCount, 185);
assert.equal(report.runtimeProjection.hiddenWidth, 6);
assert.equal(report.runtimeProjection.capped, false);
assert.ok(existsSync(report.checkpoint.path));

const corrupt = JSON.parse(readFileSync(frames[2].teacherManifestPath, 'utf8'));
corrupt.source.nativeManifestSha256 = '0'.repeat(64);
const corruptPath = join(scratch, 'corrupt-teacher.json');
writeFileSync(corruptPath, `${JSON.stringify(corrupt, null, 2)}\n`);
const failedDir = join(scratch, 'failed');
let failed = false;
try {
  execFileSync('python3', [
    trainer,
    '--train-frame', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}`,
    '--validation-frame', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
    '--test-frame', `${frames[2].sourceManifestPath}:${corruptPath}`,
    '--out-dir', failedDir,
    '--scaffold-grid', String(scaffoldGrid),
  ], { stdio: 'pipe' });
} catch {
  failed = true;
}
assert.equal(failed, true, 'wrong teacher ancestry fails the run');
const failure = JSON.parse(readFileSync(join(failedDir, 'manifest.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'input-validation');
assert.match(failure.error, /native manifest sha/i);
assert.ok(failure.lastTrustworthyEvidence);

const duplicateSource = JSON.parse(readFileSync(frames[0].sourceManifestPath, 'utf8'));
duplicateSource.simStepCount = 99;
const duplicateSourcePath = join(scratch, 'duplicate-source-step99.json');
writeFileSync(duplicateSourcePath, `${JSON.stringify(duplicateSource, null, 2)}\n`);
const duplicateTeacher = JSON.parse(readFileSync(frames[0].teacherManifestPath, 'utf8'));
duplicateTeacher.source.nativeSimStepCount = 99;
duplicateTeacher.source.nativeManifestPath = duplicateSourcePath;
duplicateTeacher.source.nativeManifestSha256 = sha(readFileSync(duplicateSourcePath));
const duplicateTeacherPath = join(scratch, 'duplicate-teacher-step99.json');
writeFileSync(duplicateTeacherPath, `${JSON.stringify(duplicateTeacher, null, 2)}\n`);
const duplicateOut = join(scratch, 'duplicate-failed');
let duplicateFailed = false;
try {
  execFileSync('python3', [
    trainer,
    '--train-frame', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}`,
    '--validation-frame', `${duplicateSourcePath}:${duplicateTeacherPath}`,
    '--test-frame', `${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
    '--out-dir', duplicateOut,
    '--scaffold-grid', String(scaffoldGrid),
    '--hidden-width', '6',
    '--epochs', '2',
    '--batch-size', '8',
  ], { stdio: 'pipe' });
} catch {
  duplicateFailed = true;
}
assert.equal(duplicateFailed, true, 'duplicate artifacts under distinct step metadata fail split validation');
const duplicateFailure = JSON.parse(readFileSync(join(duplicateOut, 'manifest.json'), 'utf8'));
assert.equal(duplicateFailure.status, 'failed');
assert.equal(duplicateFailure.failurePhase, 'split-validation');
assert.match(duplicateFailure.error, /duplicate/i);

const calibrationPath = join(scratch, 'fixed-source-delta-calibration.json');
execFileSync('python3', [
  calibrationTrainer,
  '--calibration-transition', `${frames[0].sourceManifestPath}:${frames[1].sourceManifestPath}`,
  '--test-transition', `${frames[1].sourceManifestPath}:${frames[2].sourceManifestPath}`,
  '--target-grid', String(teacherGrid),
  '--scale-quantile', '0.995',
  '--coverage-quantile', '0',
  '--output', calibrationPath,
], { stdio: 'pipe' });
const calibration = JSON.parse(readFileSync(calibrationPath, 'utf8'));
assert.equal(calibration.authority, 'source-manifests-only-fixed-threshold-v0');
assert.equal(calibration.targetErrorRankingUsed, false);
assert.equal(calibration.runtimeTopK, false);
assert.equal(calibration.dynamicPercentile, false);
assert.equal(calibration.hiddenCandidateCap, false);
assert.equal(calibration.pairs['96-97'].candidateCount, teacherGrid ** 3);

const fineOut = join(scratch, 'fine-out');
execFileSync('python3', [
  fineTrainer,
  '--coarse-manifest', join(outDir, 'manifest.json'),
  '--calibration', calibrationPath,
  '--train-transition', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}:${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
  '--test-transition', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}:${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
  '--out-dir', fineOut,
  '--hidden-width', '5',
  '--epochs', '4',
  '--batch-size', '64',
  '--seed', '53',
], { stdio: 'pipe' });

const fine = JSON.parse(readFileSync(join(fineOut, 'manifest.json'), 'utf8'));
assert.equal(fine.schema, 'kaminos.volume.sparse-temporal-front-detail-probe.v0');
assert.equal(fine.identity, 'fixed-source-gated-temporal-front-detail-student-v0');
assert.equal(fine.status, 'captured');
assert.equal(fine.failurePhase, null);
assert.equal(fine.admission.identity, 'fixed-full-source-delta-envelope-trilinear-v1');
assert.equal(fine.admission.runtimeTruthUsed, false);
assert.equal(fine.admission.targetErrorRankingUsed, false);
assert.equal(fine.admission.runtimeTopK, false);
assert.equal(fine.admission.dynamicPercentile, false);
assert.equal(fine.admission.hiddenCandidateCap, false);
assert.equal(fine.admission.train.exactCandidateCountParity, true);
assert.equal(fine.admission.test.exactCandidateCountParity, true);
assert.equal(fine.admission.test.candidateCount, teacherGrid ** 3);
assert.equal(fine.features.currentSourceFieldCount, 17);
assert.equal(fine.features.sourceDeltaFieldCount, 17);
assert.deepEqual(fine.features.sourceFieldChannelOrder, [...fluidChannels, 'frontTopology']);
assert.equal(fine.student.candidateOnly, true);
assert.equal(fine.student.hiddenWidth, 5);
assert.equal(fine.frameRoles.trainTransition, '96-97');
assert.equal(fine.frameRoles.testTransition, '97-98');
assert.equal(fine.coarseScaffold.manifestSha256, sha(readFileSync(join(outDir, 'manifest.json'))));
assert.equal(typeof fine.coarseScaffold.frontGain, 'number');
assert.equal(fine.coarseScaffold.frontGain, report.front.calibration.gain);
assert.equal(fine.checkpoint.replay.outputParity, true);
assert.equal(fine.checkpoint.replay.sourceBindingParity, true);
assert.equal(typeof fine.held.spatial.relativeErrorReductionVsCoarse, 'number');
assert.equal(typeof fine.held.temporal.relativeErrorReductionVsCoarse, 'number');
assert.equal(typeof fine.held.temporal.correlation, 'number');
assert.equal(typeof fine.held.coarseSpatial.correlation, 'number');
assert.equal(typeof fine.held.coarseSpatial.explainedEnergy, 'number');
assert.equal(typeof fine.held.composedSpatial.correlation, 'number');
assert.equal(typeof fine.held.composedSpatial.energyRetention, 'number');
assert.equal(typeof fine.held.composedSpatial.explainedEnergy, 'number');
assert.equal(typeof fine.held.composedTemporal.correlation, 'number');
assert.equal(typeof fine.held.composedTemporal.explainedEnergy, 'number');
assert.equal(fine.runtimeProjection.identity, 'arithmetic-only-candidate-detail-head-projection-v0');
assert.equal(fine.runtimeProjection.candidateCount, teacherGrid ** 3);
assert.equal(fine.runtimeProjection.inputFeatureCount, 50);
assert.equal(fine.runtimeProjection.hiddenWidth, 5);
assert.equal(fine.runtimeProjection.measuredGpuRuntime, null);
assert.equal(fine.runtimeProjection.combinedWithCoarse.measuredGpuRuntime, null);
assert.equal(fine.runtimeProjection.capped, false);
assert.equal(fine.outputs.heldDetail.shape[0], teacherGrid);
assert.ok(existsSync(fine.outputs.heldDetail.path));

const spoofedCoarse = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
spoofedCoarse.inputs.bindings.train.featureSha256 = 'f'.repeat(64);
const spoofedCoarsePath = join(scratch, 'spoofed-coarse-manifest.json');
writeFileSync(spoofedCoarsePath, `${JSON.stringify(spoofedCoarse, null, 2)}\n`);
const spoofedCoarseOut = join(scratch, 'spoofed-coarse-failed');
let spoofedCoarseFailed = false;
try {
  execFileSync('python3', [
    fineTrainer,
    '--coarse-manifest', spoofedCoarsePath,
    '--calibration', calibrationPath,
    '--train-transition', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}:${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
    '--test-transition', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}:${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
    '--out-dir', spoofedCoarseOut,
  ], { stdio: 'pipe' });
} catch {
  spoofedCoarseFailed = true;
}
assert.equal(spoofedCoarseFailed, true, 'coarse manifest/checkpoint binding divergence fails sparse load');
const spoofedCoarseFailure = JSON.parse(readFileSync(join(spoofedCoarseOut, 'manifest.json'), 'utf8'));
assert.equal(spoofedCoarseFailure.failurePhase, 'coarse-load');
assert.match(spoofedCoarseFailure.error, /checkpoint bindings/i);

const targetRankedCalibration = JSON.parse(readFileSync(calibrationPath, 'utf8'));
targetRankedCalibration.targetErrorRankingUsed = true;
const targetRankedCalibrationPath = join(scratch, 'target-ranked-calibration.json');
writeFileSync(targetRankedCalibrationPath, `${JSON.stringify(targetRankedCalibration, null, 2)}\n`);
const targetRankedOut = join(scratch, 'target-ranked-failed');
let targetRankedFailed = false;
try {
  execFileSync('python3', [
    fineTrainer,
    '--coarse-manifest', join(outDir, 'manifest.json'),
    '--calibration', targetRankedCalibrationPath,
    '--train-transition', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}:${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
    '--test-transition', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}:${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
    '--out-dir', targetRankedOut,
  ], { stdio: 'pipe' });
} catch {
  targetRankedFailed = true;
}
assert.equal(targetRankedFailed, true, 'target-ranked calibration fails before model fit');
const targetRankedFailure = JSON.parse(readFileSync(join(targetRankedOut, 'manifest.json'), 'utf8'));
assert.equal(targetRankedFailure.failurePhase, 'calibration-load');
assert.match(targetRankedFailure.error, /source-only authority/i);

const selfConsistentWrongCalibration = JSON.parse(readFileSync(calibrationPath, 'utf8'));
selfConsistentWrongCalibration.channelScales = selfConsistentWrongCalibration.channelScales.map((value) => value * 2);
selfConsistentWrongCalibration.threshold /= 2;
const selfConsistentWrongCalibrationPath = join(scratch, 'self-consistent-wrong-calibration.json');
writeFileSync(
  selfConsistentWrongCalibrationPath,
  `${JSON.stringify(selfConsistentWrongCalibration, null, 2)}\n`,
);
const selfConsistentWrongOut = join(scratch, 'self-consistent-wrong-failed');
let selfConsistentWrongFailed = false;
try {
  execFileSync('python3', [
    fineTrainer,
    '--coarse-manifest', join(outDir, 'manifest.json'),
    '--calibration', selfConsistentWrongCalibrationPath,
    '--train-transition', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}:${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
    '--test-transition', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}:${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
    '--out-dir', selfConsistentWrongOut,
  ], { stdio: 'pipe' });
} catch {
  selfConsistentWrongFailed = true;
}
assert.equal(
  selfConsistentWrongFailed,
  true,
  'self-consistent but producer-rule-incoherent calibration fails before model fit',
);
const selfConsistentWrongFailure = JSON.parse(
  readFileSync(join(selfConsistentWrongOut, 'manifest.json'), 'utf8'),
);
assert.equal(selfConsistentWrongFailure.failurePhase, 'source-gate-replay');
assert.match(selfConsistentWrongFailure.error, /recomputed.*scale|scale.*recomputed/i);

const badCalibration = JSON.parse(readFileSync(calibrationPath, 'utf8'));
badCalibration.pairs['97-98'].candidateCount -= 1;
const badCalibrationPath = join(scratch, 'bad-calibration.json');
writeFileSync(badCalibrationPath, `${JSON.stringify(badCalibration, null, 2)}\n`);
const fineFailedOut = join(scratch, 'fine-failed');
let fineFailed = false;
try {
  execFileSync('python3', [
    fineTrainer,
    '--coarse-manifest', join(outDir, 'manifest.json'),
    '--calibration', badCalibrationPath,
    '--train-transition', `${frames[0].sourceManifestPath}:${frames[0].teacherManifestPath}:${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}`,
    '--test-transition', `${frames[1].sourceManifestPath}:${frames[1].teacherManifestPath}:${frames[2].sourceManifestPath}:${frames[2].teacherManifestPath}`,
    '--out-dir', fineFailedOut,
  ], { stdio: 'pipe' });
} catch {
  fineFailed = true;
}
assert.equal(fineFailed, true, 'fixed source gate mismatch fails before model fit');
const fineFailure = JSON.parse(readFileSync(join(fineFailedOut, 'manifest.json'), 'utf8'));
assert.equal(fineFailure.status, 'failed');
assert.equal(fineFailure.failurePhase, 'source-gate-replay');
assert.match(fineFailure.error, /candidate count/i);

console.log('volume coarse support/front scaffold contracts passed');
