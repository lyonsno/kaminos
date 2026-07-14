import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileBoundarySplatAttributeModel } from '../boundary-splat-attribute-model.mjs';

import {
  alignBoundarySplatRowsByWorldPosition,
  quotaRankedBirthDecision,
  quotaRankedBirthOpacityScale,
  renderBoundarySplatRowsPng,
  validateBoundarySplatPhaseRenderFrame,
  writeBoundarySplatPhaseRenderWitness,
} from '../boundary-splat-phase-render-witness.mjs';

assert.equal(quotaRankedBirthOpacityScale(0.82, 0.45), 0.45);
assert.equal(quotaRankedBirthOpacityScale(0.23, 0.45), 0.23);
assert.equal(quotaRankedBirthOpacityScale(0.01, 0.45), 0.05);
const belowThresholdRawBirth = 0.23;
const belowThresholdDiagnostic = 0.8;
const belowThresholdDecision = quotaRankedBirthDecision(
  belowThresholdRawBirth,
  belowThresholdDiagnostic,
  0.45,
);
assert.ok(belowThresholdDecision.rankingScore < 0);
assert.equal(belowThresholdDecision.opacityScale, belowThresholdRawBirth);
assert.ok(belowThresholdDecision.opacityScale > 0.05);

function splat(position, color, opacity = 0.75, radius = 0.18) {
  return [
    position[0], position[1], position[2], 1,
    color[0], color[1], color[2], opacity,
    radius, radius, 0.5, 1,
  ];
}

const source = [
  splat([-0.35, -0.1, 0], [1, 0.12, 0.02]),
  splat([0.28, 0.18, 0], [0.08, 0.35, 1]),
];
const target = [
  splat([0.28, 0.18, 0], [0.12, 0.7, 1]),
  splat([-0.35, -0.1, 0], [1, 0.55, 0.04]),
  splat([0.02, 0.5, 0], [1, 0.9, 0.25]),
];

const alignment = alignBoundarySplatRowsByWorldPosition(source, target);
assert.equal(alignment.identityKey, 'world-position-stable-key');
assert.equal(alignment.matched.length, 2, 'world-position alignment preserves both reordered source candidates');
assert.equal(alignment.births.length, 1, 'target-only world position is recorded as a birth');
assert.equal(alignment.deaths.length, 0);
assert.deepEqual(alignment.matched.map(row => [row.sourceIndex, row.targetIndex]), [[0, 1], [1, 0]], 'alignment must not reuse compacted slot order');

const frame = {
  id: 'frame-source',
  requestedRoute: '?kaminos_volume_smoke=1&volume_boundary_splat_mode=learned',
  effectiveRoute: '?kaminos_volume_smoke=1&volume_boundary_splat_mode=learned',
  rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  modelIdentity: 'sha256:test-model',
  sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  fallbackReason: null,
  camera: {
    viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
  },
  splats: {
    count: source.length,
    strideFloats: 12,
    dtype: 'float32-le',
    authority: 'intercepted-live-boundary-splat-buffer-post-compaction-v0',
  },
};
assert.equal(validateBoundarySplatPhaseRenderFrame(frame).id, frame.id);
assert.throws(
  () => validateBoundarySplatPhaseRenderFrame({ ...frame, fallbackReason: 'analytic-fallback' }),
  /fallback/i,
  'render witness must reject fallback evidence',
);
assert.throws(
  () => validateBoundarySplatPhaseRenderFrame({ ...frame, splats: { ...frame.splats, count: 0 } }),
  /positive-count/i,
  'render witness must reject blank splat captures',
);

const rendered = renderBoundarySplatRowsPng(source, frame.camera, {
  width: 96,
  height: 96,
  radiusMultiplier: 1,
  kernelSharpness: 6.5,
});
assert.equal(rendered.png.readUInt32BE(0), 0x89504e47, 'isolated splat witness writes an inspectable PNG');
assert.equal(rendered.width, 96);
assert.equal(rendered.height, 96);
assert.ok(rendered.nonBackgroundPixelCount > 100, 'synthetic splats must produce visible raster support');
assert.ok(rendered.maxLuminance > rendered.backgroundLuminance, 'synthetic splats must be visibly brighter than the background');
assert.equal(rendered.authority, 'isolated-cpu-projected-boundary-splat-raster-v0');

const root = await mkdtemp(join(tmpdir(), 'kaminos-phase-render-contract-'));
try {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const frames = [];
  for (let frameIndex = 0; frameIndex < 7; frameIndex += 1) {
    const features = new Float32Array(3 * 16);
    const splats = new Float32Array(3 * 12);
    for (let row = 0; row < 3; row += 1) {
      for (let feature = 0; feature < 16; feature += 1) {
        features[row * 16 + feature] = row * 0.04 + feature * 0.003 + frameIndex * (0.025 + feature * 0.0005);
      }
      const position = frameIndex === 6 && row === 2
        ? [0.9, 0.55, 0]
        : [-0.45 + row * 0.45, -0.2 + row * 0.22, 0];
      splats.set(splat(position, [0.4 + frameIndex * 0.05, 0.12 + row * 0.12, 0.03]), row * 12);
    }
    const featureBytes = Buffer.from(features.buffer);
    const splatBytes = Buffer.from(splats.buffer);
    const featurePath = join(root, `frame-${frameIndex}.features.f32`);
    const splatPath = join(root, `frame-${frameIndex}.splats.f32`);
    await writeFile(featurePath, featureBytes);
    await writeFile(splatPath, splatBytes);
    frames.push({
      ...frame,
      id: `frame-${frameIndex}`,
      sameBrowserSessionId: 'render-contract-session',
      sameStateCaptureId: `same-state-${frameIndex}`,
      candidates: { path: featurePath, bytes: featureBytes.length, sha256: hash(featureBytes), count: 3, strideFloats: 16, dtype: 'float32-le' },
      splats: { path: splatPath, bytes: splatBytes.length, sha256: hash(splatBytes), count: 3, strideFloats: 12, dtype: 'float32-le', authority: 'intercepted-live-boundary-splat-buffer-post-compaction-v0' },
    });
  }
  const offsets = [-3, -2, -1, 1, 2, 3];
  const manifest = {
    schema: 'kaminos-boundary-splat-phase-candidate-corpus-v0',
    authority: 'live-simulator-controlled-step-selected-candidate-features-v0',
    requestedRoute: frame.requestedRoute,
    effectiveRoute: frame.effectiveRoute,
    featureOrder: [
      'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
      'material.density', 'material.heat', 'material.fuel', 'material.detail',
      'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
      'micro.x', 'micro.y', 'micro.z', 'micro.w',
    ],
    frames,
    temporalAlignment: {
      schema: 'kaminos-boundary-splat-temporal-alignment-v0',
      identityKey: 'world-position-stable-key',
      alignmentMethod: 'world-position-stable-key',
      offsetSteps: offsets,
      supportSemantics: { matched: 'same world position', birth: 'target only', death: 'source only' },
      pairs: offsets.map(offset => ({
        sourceFrameId: 'frame-3',
        targetFrameId: `frame-${3 + offset}`,
        offsetSteps: offset,
        sourceCount: 3,
        targetCount: 3,
        matchedSlots: offset === 3 ? 2 : 3,
        births: offset === 3 ? 1 : 0,
        deaths: offset === 3 ? 1 : 0,
        stableSupportCount: offset === 3 ? 2 : 3,
      })),
    },
  };
  const model = {
    schema: 'kaminos-boundary-splat-attribute-mlp-v0',
    architecture: 'dense-relu-dense',
    features: manifest.featureOrder,
    outputs: ['color.r', 'color.g', 'color.b', 'opacity', 'radius.x', 'radius.y'],
    hiddenSize: 1,
    layers: [
      { inputSize: 16, outputSize: 1, activation: 'relu', weights: Array(16).fill(0), bias: [1] },
      { inputSize: 1, outputSize: 6, activation: 'linear', weights: [1, 0.5, 0.1, -1, 0, 0], bias: [0, 0, 0, 0, 0, 0] },
    ],
    outputRanges: [[0, 1], [0, 1], [0, 1], [0.001, 0.08], [0.2, 2], [0.2, 2]],
  };
  const compiledModel = compileBoundarySplatAttributeModel(model);
  for (const manifestFrame of frames) manifestFrame.modelIdentity = compiledModel.identity;
  const manifestPath = join(root, 'phase-corpus.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const modelPath = join(root, 'model.json');
  await writeFile(modelPath, JSON.stringify(model));
  const reportPath = join(root, 'render-report.json');
  const report = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    offset: 3,
    outDir: root,
    report: reportPath,
    width: 96,
    height: 96,
  });
  assert.equal(report.schema, 'kaminos-boundary-splat-phase-render-witness-v0');
  assert.equal(report.status, 'completed');
  assert.equal(report.phaseModel.holdoutAuthority, 'entire-offset-pair-held-out-v0');
  assert.equal(report.phaseModel.heldOutOffset, 3);
  assert.ok(!report.phaseModel.trainingOffsets.includes(3), 'held-out visual offset must not leak into phase-model training');
  assert.equal(report.phaseModel.calibration.authority, 'training-offset-captured-splat-residual-calibration-v0');
  assert.ok(!report.phaseModel.calibration.offsets.includes(3), 'held-out visual offset must not leak into splat residual calibration');
  assert.equal(report.phaseModel.calibration.scales.length, 9, 'support, color, opacity, shape, and auxiliary splat channels must carry explicit calibration');
  assert.equal(report.alignment.identityKey, 'world-position-stable-key');
  assert.equal(report.alignment.deaths, 1, 'held-out fixture must exercise source-only candidate death handling');
  assert.equal(report.renders.inputSplats.phasePrediction, 3, 'phase prediction must evaluate every source candidate and let predicted support handle deaths');
  assert.equal(report.renders.blocks.join(','), 'identity,phasePrediction,exactTarget');
  for (const artifact of Object.values(report.renders.artifacts)) {
    const bytes = await readFile(artifact.path);
    assert.equal(bytes.readUInt32BE(0), 0x89504e47);
    assert.equal(hash(bytes), artifact.sha256);
  }
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).status, 'completed');

  const spatialFrames = [];
  const stablePositions = [
    [-0.45, -0.2, 0],
    [0.0, 0.02, 0],
    [0.45, 0.24, 0],
  ];
  const birthPosition = [0.9, 0.55, 0];
  for (let frameIndex = 0; frameIndex < 7; frameIndex += 1) {
    const features = new Float32Array(3 * 16);
    const splats = new Float32Array(3 * 12);
    const positions = stablePositions.map(position => [...position]);
    if (frameIndex === 0 || frameIndex === 5 || frameIndex === 6) positions[2] = birthPosition;
    for (let row = 0; row < 3; row += 1) {
      const occupancyBias = positions[row][0] === birthPosition[0] ? 0.45 : 0;
      for (let feature = 0; feature < 16; feature += 1) {
        features[row * 16 + feature] = row * 0.04 + feature * 0.003 + frameIndex * (0.025 + feature * 0.0005) + occupancyBias;
      }
      splats.set(splat(positions[row], [0.36 + frameIndex * 0.05 + occupancyBias, 0.15 + row * 0.13, 0.04]), row * 12);
    }
    const featureBytes = Buffer.from(features.buffer);
    const splatBytes = Buffer.from(splats.buffer);
    const featurePath = join(root, `spatial-frame-${frameIndex}.features.f32`);
    const splatPath = join(root, `spatial-frame-${frameIndex}.splats.f32`);
    await writeFile(featurePath, featureBytes);
    await writeFile(splatPath, splatBytes);
    spatialFrames.push({
      ...frame,
      id: `spatial-frame-${frameIndex}`,
      sameBrowserSessionId: 'render-contract-session',
      sameStateCaptureId: `same-state-spatial-${frameIndex}`,
      candidates: { path: featurePath, bytes: featureBytes.length, sha256: hash(featureBytes), count: 3, strideFloats: 16, dtype: 'float32-le' },
      splats: { path: splatPath, bytes: splatBytes.length, sha256: hash(splatBytes), count: 3, strideFloats: 12, dtype: 'float32-le', authority: 'intercepted-live-boundary-splat-buffer-post-compaction-v0' },
    });
  }
  for (const manifestFrame of spatialFrames) manifestFrame.modelIdentity = compiledModel.identity;
  const spatialManifest = {
    ...manifest,
    frames: spatialFrames,
    temporalAlignment: {
      ...manifest.temporalAlignment,
      pairs: offsets.map(offset => {
        const churn = Math.abs(offset) === 3 || offset === 2;
        return {
          sourceFrameId: 'spatial-frame-3',
          targetFrameId: `spatial-frame-${3 + offset}`,
          offsetSteps: offset,
          sourceCount: 3,
          targetCount: 3,
          matchedSlots: churn ? 2 : 3,
          births: churn ? 1 : 0,
          deaths: churn ? 1 : 0,
          stableSupportCount: churn ? 2 : 3,
        };
      }),
    },
  };
  await writeFile(manifestPath, JSON.stringify(spatialManifest));
  const spatialReportPath = join(root, 'spatial-render-report.json');
  const spatialReport = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    offset: 3,
    outDir: root,
    report: spatialReportPath,
    width: 96,
    height: 96,
    phaseModelFamily: 'spatial-occupancy-ridge-v0',
    occupancyThreshold: 0.35,
  });
  assert.equal(spatialReport.phaseModel.family, 'spatial-occupancy-ridge-v0');
  assert.equal(spatialReport.phaseModel.siteUniverse.authority, 'training-frame-world-position-site-universe-v0');
  assert.equal(spatialReport.phaseModel.occupancy.authority, 'offset-conditioned-spatial-occupancy-ridge-v0');
  assert.equal(spatialReport.alignment.birthSynthesis, 'training-site-spatial-occupancy-synthesis-v0');
  assert.equal(spatialReport.alignment.synthesizedBirths, 1, 'spatial model must synthesize a target-only held-out site from training evidence');
  assert.ok(spatialReport.renders.inputSplats.phasePrediction > spatialReport.renders.inputSplats.identity, 'phase prediction splat count must include synthesized births');
  assert.equal(spatialReport.baselines.currentCopy.pixelMse, spatialReport.pixelMetrics.identityToExactMse);
  assert.equal(spatialReport.baselines.spatialPriorInterpolation.authority, 'nearest-offset-site-prior-interpolation-baseline-v0');
  assert.ok(
    spatialReport.pixelMetrics.phasePredictionToExactMse <= spatialReport.baselines.spatialPriorInterpolation.pixelMse,
    'spatial occupancy model should beat the interpolation/prior baseline on the birth fixture',
  );

  const localGridReportPath = join(root, 'local-grid-render-report.json');
  const localGridReport = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    offset: 3,
    outDir: root,
    report: localGridReportPath,
    width: 96,
    height: 96,
    phaseModelFamily: 'local-grid-occupancy-classifier-v0',
  });
  assert.equal(localGridReport.phaseModel.family, 'local-grid-occupancy-classifier-v0');
  assert.equal(localGridReport.phaseModel.occupancy.authority, 'calibrated-local-grid-logistic-occupancy-classifier-v0');
  assert.equal(localGridReport.phaseModel.occupancy.calibration.authority, 'training-pair-precision-recall-threshold-calibration-v0');
  assert.ok(localGridReport.phaseModel.occupancy.calibration.threshold > 0, 'classifier threshold must be learned from calibration, not left blank');
  assert.ok(localGridReport.phaseModel.occupancy.calibration.birth.precision > 0, 'classifier must report birth-specific calibration for synthesized-site opacity');
  assert.equal(localGridReport.phaseModel.localGrid.authority, 'world-position-neighborhood-source-context-v0');
  assert.ok(localGridReport.phaseModel.localGrid.neighborCount > 0, 'classifier must consume local-grid neighborhood context');
  assert.equal(localGridReport.alignment.birthSynthesis, 'local-grid-classifier-training-site-synthesis-v0');
  assert.equal(localGridReport.metrics.occupancyPrecisionRecall.authority, 'held-out-site-occupancy-pr-v0');
  assert.equal(localGridReport.metrics.birthDeathPrecisionRecall.authority, 'held-out-birth-death-pr-v0');
  assert.ok(localGridReport.metrics.birthDeathPrecisionRecall.birth.recall > 0, 'classifier fixture must recover a held-out target-only birth');
  assert.equal(localGridReport.baselines.advectionPrior.authority, 'zero-velocity-world-site-advection-baseline-v0');
  assert.equal(localGridReport.renders.blocks.join(','), 'identity,spatialPriorInterpolation,advectionPrior,phasePrediction,exactTarget');
  assert.ok(
    localGridReport.pixelMetrics.phasePredictionToExactMse <= localGridReport.baselines.spatialPriorInterpolation.pixelMse,
    'local-grid classifier should beat the spatial-prior baseline on the birth fixture',
  );

  const budgetedReportPath = join(root, 'dense-negative-budgeted-render-report.json');
  const budgetedReport = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    offset: 3,
    outDir: root,
    report: budgetedReportPath,
    width: 96,
    height: 96,
    phaseModelFamily: 'dense-negative-budgeted-local-grid-occupancy-v0',
  });
  assert.equal(budgetedReport.phaseModel.family, 'dense-negative-budgeted-local-grid-occupancy-v0');
  assert.equal(
    budgetedReport.phaseModel.occupancy.trainingUniverse.authority,
    'prediction-site-source-absent-target-absent-negatives-v0',
  );
  assert.ok(
    budgetedReport.phaseModel.occupancy.trainingUniverse.sourceAbsentTargetAbsentNegativeCount > 0,
    'budgeted classifier must train on source-absent target-absent prediction-site negatives',
  );
  assert.equal(budgetedReport.phaseModel.supportBudget.authority, 'training-offset-target-count-support-budget-v0');
  assert.ok(budgetedReport.phaseModel.supportBudget.targetSupportBudget > 0, 'support budget must be learned from training target counts');
  assert.ok(budgetedReport.phaseModel.supportBudget.sourceSurvivalBudget > 0, 'support budget must reserve source-site survivors');
  assert.ok(
    budgetedReport.phaseModel.supportBudget.birthPrecisionBudgetScale > 0,
    'support budget must expose the calibrated birth precision scale used to cap risky births',
  );
  assert.ok(
    budgetedReport.phaseModel.supportBudget.effectiveBirthSupportBudget <= budgetedReport.phaseModel.supportBudget.birthSupportBudget,
    'effective birth budget must not exceed the learned raw birth budget',
  );
  assert.ok(
    budgetedReport.renders.inputSplats.phasePrediction <= budgetedReport.phaseModel.supportBudget.targetSupportBudget,
    'budgeted prediction must not exceed its learned support budget',
  );
  assert.ok(
    budgetedReport.alignment.predictedDeaths < budgetedReport.baselines.currentCopy.inputSplats,
    'budgeted prediction must not spend the whole support budget on births',
  );
  assert.ok(
    budgetedReport.renders.inputSplats.phasePrediction < budgetedReport.baselines.spatialPriorInterpolation.inputSplats,
    'support budget must reduce the overfull spatial-prior site universe',
  );
  assert.ok(
    budgetedReport.pixelMetrics.phasePredictionToExactMse <= budgetedReport.baselines.currentCopy.pixelMse,
    'budgeted dense-negative fixture should beat current-copy identity on rendered pixels',
  );

  const splitHeadReportPath = join(root, 'split-support-heads-render-report.json');
  const splitHeadReport = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    offset: 3,
    outDir: root,
    report: splitHeadReportPath,
    width: 96,
    height: 96,
    phaseModelFamily: 'split-survival-birth-death-local-grid-v0',
  });
  assert.equal(splitHeadReport.phaseModel.family, 'split-survival-birth-death-local-grid-v0');
  assert.equal(
    splitHeadReport.phaseModel.supportHeads.authority,
    'conditional-local-grid-survival-birth-death-heads-v0',
  );
  assert.equal(
    splitHeadReport.phaseModel.supportDecision.authority,
    'split-head-threshold-gated-support-budget-v0',
  );
  assert.equal(splitHeadReport.phaseModel.supportHeads.survival.trainingUniverse, 'source-occupied-sites-v0');
  assert.equal(splitHeadReport.phaseModel.supportHeads.birth.trainingUniverse, 'source-absent-prediction-sites-v0');
  assert.equal(splitHeadReport.phaseModel.supportHeads.death.trainingUniverse, 'source-occupied-sites-v0');
  for (const head of ['survival', 'birth', 'death']) {
    const trainedHead = splitHeadReport.phaseModel.supportHeads[head];
    assert.ok(trainedHead.trainSampleCount > 0, `${head} head must train on its conditional site universe`);
    assert.ok(trainedHead.calibration.threshold > 0, `${head} head threshold must be calibrated from training pairs`);
    assert.ok(
      splitHeadReport.metrics.splitSupportHeads[head].sampleCount > 0,
      `${head} head must expose held-out conditional precision/recall`,
    );
  }
  assert.equal(
    splitHeadReport.metrics.splitSupportHeads.authority,
    'held-out-conditional-support-head-pr-v0',
  );
  assert.ok(
    splitHeadReport.metrics.splitSupportHeads.sourceDecisionDisagreement.sampleCount > 0,
    'split heads must expose survival/death disagreement instead of silently collapsing the decisions',
  );
  assert.equal(splitHeadReport.route.effective, spatialManifest.frames[0].effectiveRoute);
  assert.ok(splitHeadReport.renders.inputSplats.phasePrediction > 0, 'split-head prediction must render nonempty support');

  const quotaRankedReportPath = join(root, 'quota-ranked-support-heads-render-report.json');
  const quotaRankedReport = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    offset: 3,
    outDir: root,
    report: quotaRankedReportPath,
    width: 96,
    height: 96,
    phaseModelFamily: 'quota-ranked-survival-birth-death-local-grid-v0',
  });
  assert.equal(quotaRankedReport.phaseModel.family, 'quota-ranked-survival-birth-death-local-grid-v0');
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.authority,
    'quota-ranked-split-head-support-budget-v0',
  );
  assert.equal(quotaRankedReport.phaseModel.supportDecision.thresholdRole, 'diagnostic-only');
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.sourceScore,
    'calibrated-survival-margin-minus-calibrated-death-margin',
  );
  assert.equal(quotaRankedReport.phaseModel.supportDecision.birthScore, 'calibrated-birth-margin');
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.birthDecisionAuthority,
    'calibrated-margin-ranking-plus-raw-probability-opacity-v0',
  );
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.birthOpacity.authority,
    'raw-birth-head-probability-capped-by-calibrated-precision-v0',
  );
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.birthOpacity.maxAbsAppliedScaleError,
    0,
    'quota-selected birth opacity must follow the named raw-probability rule exactly',
  );
  if (quotaRankedReport.phaseModel.supportDecision.birthOpacity.selectedBirthCount > 0) {
    assert.equal(
      quotaRankedReport.phaseModel.supportDecision.birthOpacity.minimumAppliedScale,
      quotaRankedBirthOpacityScale(
        quotaRankedReport.phaseModel.supportDecision.birthOpacity.minimumRawProbability,
        quotaRankedReport.phaseModel.supportDecision.birthOpacity.calibratedPrecisionCap,
      ),
      'quota-selected birth opacity must be derived from raw probability rather than ranking margin',
    );
  }
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.selectedSourceSupport,
    Math.min(
      quotaRankedReport.phaseModel.supportDecision.sourceCandidateCount,
      quotaRankedReport.phaseModel.supportBudget.effectiveSourceSurvivalBudget,
    ),
    'quota-ranked source selection must fill the learned survival quota without threshold starvation',
  );
  assert.equal(
    quotaRankedReport.phaseModel.supportDecision.selectedBirthSupport,
    Math.min(
      quotaRankedReport.phaseModel.supportDecision.birthCandidateCount,
      quotaRankedReport.phaseModel.supportBudget.effectiveBirthSupportBudget,
      quotaRankedReport.phaseModel.supportBudget.targetSupportBudget
        - quotaRankedReport.phaseModel.supportDecision.selectedSourceSupport,
    ),
    'quota-ranked birth selection must fill the learned birth quota within the target support budget',
  );
  assert.equal(
    quotaRankedReport.phaseModel.supportBudget.effectiveSourceSurvivalBudget,
    Math.min(
      quotaRankedReport.baselines.currentCopy.inputSplats,
      quotaRankedReport.phaseModel.supportBudget.sourceSurvivalBudget,
      quotaRankedReport.phaseModel.supportBudget.targetSupportBudget,
    ),
    'quota-ranked source budget must use the raw corpus-learned survival quota',
  );
  assert.equal(
    quotaRankedReport.phaseModel.supportBudget.effectiveBirthSupportBudget,
    Math.min(
      quotaRankedReport.phaseModel.supportBudget.birthSupportBudget,
      quotaRankedReport.phaseModel.supportBudget.targetSupportBudget
        - quotaRankedReport.phaseModel.supportBudget.effectiveSourceSurvivalBudget,
    ),
    'quota-ranked birth budget must use the raw corpus-learned birth quota after source allocation',
  );
  assert.equal(
    quotaRankedReport.renders.inputSplats.phasePrediction,
    quotaRankedReport.phaseModel.supportDecision.selectedSourceSupport
      + quotaRankedReport.phaseModel.supportDecision.selectedBirthSupport,
  );
  assert.ok(
    quotaRankedReport.renders.inputSplats.phasePrediction
      <= quotaRankedReport.phaseModel.supportBudget.targetSupportBudget,
    'quota-ranked prediction must remain inside the learned target support budget',
  );

  const sharedTrunkModelPath = join(root, 'shared-mlx-phase-churn-model.json');
  const sharedTrunkModel = {
    schema: 'kaminos-phase-churn-shared-mlx-model-v0',
    identity: 'sha256:fixture-shared-mlx-phase-churn-model',
    status: 'completed',
    route: {
      backend: 'mlx',
      device: 'Device(gpu, 0)',
      effectiveRunner: '/private/tmp/kaminos-mlx-residual-venv/bin/python',
      fallbackReason: null,
    },
    manifest: {
      sha256: hash(await readFile(manifestPath)),
    },
    holdout: {
      offset: 3,
      targetFrameId: 'spatial-frame-6',
      trainingOffsets: [-3, -2, -1, 1, 2],
    },
    input: {
      authority: 'exact-local-grid-42-feature-contract-v0',
      featureCount: 42,
      candidateFeatureCount: 16,
      mean: Array(42).fill(0),
      scale: Array(42).fill(1),
    },
    architecture: {
      authority: 'dense-relu-shared-trunk-three-conditional-logit-heads-v0',
      hiddenSize: 1,
      outputOrder: ['survival', 'birth', 'death'],
      layers: [
        {
          role: 'shared-trunk',
          inputSize: 42,
          outputSize: 1,
          activation: 'relu',
          weights: Array(42).fill(0),
          bias: [1],
        },
        {
          role: 'conditional-heads',
          inputSize: 1,
          outputSize: 3,
          activation: 'sigmoid',
          weights: [0, 0, 0],
          bias: [2, 1, -2],
        },
      ],
    },
    objectives: {
      conditionalBce: {
        authority: 'masked-asymmetric-conditional-bce-v0',
        evaluatedSampleCount: 24,
      },
      withinPairRanking: {
        authority: 'within-training-pair-positive-negative-margin-ranking-v0',
        margin: 0.2,
        weight: 0.25,
        evaluatedPairCount: 8,
      },
      adjacentOffsetConsistency: {
        authority: 'same-site-adjacent-offset-label-agreement-consistency-v0',
        weight: 0.08,
        evaluatedPairCount: 6,
      },
    },
    calibration: {
      authority: 'training-pair-conditional-pr-threshold-calibration-v0',
      survival: { threshold: 0.5, precision: 0.8, recall: 0.75, fScore: 0.77, truePositive: 9, falsePositive: 2, falseNegative: 3, sampleCount: 14 },
      birth: { threshold: 0.5, precision: 0.7, recall: 0.6, fScore: 0.64, truePositive: 6, falsePositive: 2, falseNegative: 4, sampleCount: 12 },
      death: { threshold: 0.5, precision: 0.75, recall: 0.7, fScore: 0.72, truePositive: 7, falsePositive: 2, falseNegative: 3, sampleCount: 14 },
    },
    training: {
      authority: 'full-corpus-mini-batch-mlx-adam-v0',
      sampleCount: 24,
      hiddenSampleCap: null,
      headSampleCounts: {
        survival: { sampleCount: 14, positiveCount: 9, negativeCount: 5 },
        birth: { sampleCount: 12, positiveCount: 6, negativeCount: 6 },
        death: { sampleCount: 14, positiveCount: 5, negativeCount: 9 },
      },
      steps: 4,
      batchSize: 8,
      seed: 713,
    },
  };
  await writeFile(sharedTrunkModelPath, JSON.stringify(sharedTrunkModel));
  const sharedTrunkReportPath = join(root, 'shared-mlx-support-heads-render-report.json');
  const sharedTrunkReport = await writeBoundarySplatPhaseRenderWitness(manifestPath, {
    model: modelPath,
    phaseModelArtifact: sharedTrunkModelPath,
    offset: 3,
    outDir: root,
    report: sharedTrunkReportPath,
    width: 96,
    height: 96,
    phaseModelFamily: 'shared-mlx-survival-birth-death-local-grid-v0',
    partialFlowDebugGain: 0.625,
  });
  assert.equal(sharedTrunkReport.phaseModel.family, 'shared-mlx-survival-birth-death-local-grid-v0');
  assert.equal(
    sharedTrunkReport.phaseModel.supportHeads.authority,
    'shared-mlx-local-grid-survival-birth-death-trunk-v0',
  );
  assert.equal(
    sharedTrunkReport.phaseModel.sharedTrunk.architectureAuthority,
    'dense-relu-shared-trunk-three-conditional-logit-heads-v0',
  );
  assert.equal(sharedTrunkReport.phaseModel.sharedTrunk.backend, 'mlx');
  assert.equal(sharedTrunkReport.phaseModel.sharedTrunk.fallbackReason, null);
  assert.equal(sharedTrunkReport.phaseModel.sharedTrunk.training.hiddenSampleCap, null);
  assert.equal(
    sharedTrunkReport.phaseModel.objectives.withinPairRanking.authority,
    'within-training-pair-positive-negative-margin-ranking-v0',
  );
  assert.ok(
    sharedTrunkReport.phaseModel.objectives.withinPairRanking.evaluatedPairCount > 0,
    'shared trunk must prove that within-pair ranking participated in training',
  );
  assert.equal(
    sharedTrunkReport.phaseModel.objectives.adjacentOffsetConsistency.authority,
    'same-site-adjacent-offset-label-agreement-consistency-v0',
  );
  assert.ok(
    sharedTrunkReport.phaseModel.objectives.adjacentOffsetConsistency.evaluatedPairCount > 0,
    'shared trunk must prove that adjacent-offset consistency participated in training',
  );
  assert.equal(
    sharedTrunkReport.phaseModel.supportDecision.authority,
    'shared-trunk-ranked-support-budget-v0',
  );
  assert.equal(
    sharedTrunkReport.diagnostics.partialFlowDebug.authority,
    'display-only-support-flow-debug-mix-v0',
  );
  assert.equal(sharedTrunkReport.diagnostics.partialFlowDebug.requestedGain, 0.625);
  assert.equal(sharedTrunkReport.diagnostics.partialFlowDebug.effectiveGain, 0.625);
  assert.equal(sharedTrunkReport.diagnostics.partialFlowDebug.changesSimulationState, false);
  assert.deepEqual(
    Object.keys(sharedTrunkReport.diagnostics.partialFlowDebug.roles),
    ['reference', 'control', 'predicted'],
  );
  for (const [roleName, role] of Object.entries(sharedTrunkReport.diagnostics.partialFlowDebug.roles)) {
    assert.equal(role.semanticRole, roleName);
    for (const artifact of [role.beauty, role.partial]) {
      const bytes = await readFile(artifact.path);
      assert.equal(bytes.readUInt32BE(0), 0x89504e47);
      assert.equal(hash(bytes), artifact.sha256);
    }
    assert.notEqual(role.partial.sha256, role.beauty.sha256, `${roleName} partial-debug view must remain additive to beauty`);
  }

  const fallbackModelPath = join(root, 'fallback-shared-mlx-phase-churn-model.json');
  await writeFile(fallbackModelPath, JSON.stringify({
    ...sharedTrunkModel,
    route: { ...sharedTrunkModel.route, fallbackReason: 'cpu-fallback' },
  }));
  const fallbackReportPath = join(root, 'fallback-shared-mlx-phase-churn-report.json');
  await assert.rejects(
    writeBoundarySplatPhaseRenderWitness(manifestPath, {
      model: modelPath,
      phaseModelArtifact: fallbackModelPath,
      offset: 3,
      outDir: root,
      report: fallbackReportPath,
      width: 96,
      height: 96,
      phaseModelFamily: 'shared-mlx-survival-birth-death-local-grid-v0',
    }),
    /effective MLX GPU device identity and null fallback/,
    'shared-trunk witness must reject a fallback-trained model artifact',
  );
  const fallbackFailure = JSON.parse(await readFile(fallbackReportPath, 'utf8'));
  assert.equal(fallbackFailure.status, 'failed');
  assert.equal(fallbackFailure.failurePhase, 'phase-model-artifact-validation');
  assert.equal(fallbackFailure.lastTrustworthyEvidence.requestedPhaseModelFamily, 'shared-mlx-survival-birth-death-local-grid-v0');

  const cpuModelPath = join(root, 'cpu-shared-mlx-phase-churn-model.json');
  await writeFile(cpuModelPath, JSON.stringify({
    ...sharedTrunkModel,
    route: { ...sharedTrunkModel.route, device: 'Device(cpu, 0)', fallbackReason: null },
  }));
  const cpuReportPath = join(root, 'cpu-shared-mlx-phase-churn-report.json');
  await assert.rejects(
    writeBoundarySplatPhaseRenderWitness(manifestPath, {
      model: modelPath,
      phaseModelArtifact: cpuModelPath,
      offset: 3,
      outDir: root,
      report: cpuReportPath,
      width: 96,
      height: 96,
      phaseModelFamily: 'shared-mlx-survival-birth-death-local-grid-v0',
    }),
    /effective MLX GPU device identity and null fallback/,
    'shared-trunk witness must reject a CPU MLX artifact even when fallbackReason is null',
  );
  const cpuFailure = JSON.parse(await readFile(cpuReportPath, 'utf8'));
  assert.equal(cpuFailure.status, 'failed');
  assert.equal(cpuFailure.failurePhase, 'phase-model-artifact-validation');
  assert.equal(cpuFailure.lastTrustworthyEvidence.phaseModelArtifactPath, cpuModelPath);

  const invalidGainReportPath = join(root, 'invalid-gain-shared-mlx-phase-churn-report.json');
  await assert.rejects(
    writeBoundarySplatPhaseRenderWitness(manifestPath, {
      model: modelPath,
      phaseModelArtifact: sharedTrunkModelPath,
      offset: 3,
      outDir: root,
      report: invalidGainReportPath,
      width: 96,
      height: 96,
      phaseModelFamily: 'shared-mlx-survival-birth-death-local-grid-v0',
      partialFlowDebugGain: 0.9,
    }),
    /partial flow-debug gain must be finite and within \[0\.50, 0\.75\]/,
  );
  const invalidGainFailure = JSON.parse(await readFile(invalidGainReportPath, 'utf8'));
  assert.equal(invalidGainFailure.status, 'failed');
  assert.equal(invalidGainFailure.failurePhase, 'partial-flow-debug-validation');
  assert.equal(invalidGainFailure.lastTrustworthyEvidence.sharedMlxModelIdentity, sharedTrunkModel.identity);
  assert.ok(invalidGainFailure.lastTrustworthyEvidence.selectedSupportCount > 0);
  assert.equal(invalidGainFailure.lastTrustworthyEvidence.requestedPartialFlowDebugGain, 0.9);

  const staleCorpusModelPath = join(root, 'stale-corpus-shared-mlx-phase-churn-model.json');
  await writeFile(staleCorpusModelPath, JSON.stringify({
    ...sharedTrunkModel,
    manifest: { sha256: 'stale-corpus-sha256' },
  }));
  const staleCorpusReportPath = join(root, 'stale-corpus-shared-mlx-phase-churn-report.json');
  await assert.rejects(
    writeBoundarySplatPhaseRenderWitness(manifestPath, {
      model: modelPath,
      phaseModelArtifact: staleCorpusModelPath,
      offset: 3,
      outDir: root,
      report: staleCorpusReportPath,
      width: 96,
      height: 96,
      phaseModelFamily: 'shared-mlx-survival-birth-death-local-grid-v0',
    }),
    /corpus mismatch/,
    'shared-trunk witness must reject a model trained against a stale corpus',
  );
  const staleCorpusFailure = JSON.parse(await readFile(staleCorpusReportPath, 'utf8'));
  assert.equal(staleCorpusFailure.status, 'failed');
  assert.equal(staleCorpusFailure.failurePhase, 'phase-model-artifact-validation');
  assert.equal(staleCorpusFailure.lastTrustworthyEvidence.phaseModelArtifactPath, staleCorpusModelPath);
  assert.equal(
    budgetedReport.diagnostics.residuals.authority,
    'phase-render-raster-residual-maps-v0',
    'budgeted report must expose residual maps that make subtle phase deltas inspectable',
  );
  assert.equal(
    budgetedReport.diagnostics.churnOverlay.authority,
    'world-position-support-churn-overlay-v0',
    'budgeted report must expose support churn overlays, not only final fire rasters',
  );
  assert.equal(
    budgetedReport.diagnostics.churnOverlay.counts.trueBirth,
    budgetedReport.metrics.birthDeathPrecisionRecall.birth.truePositive,
    'churn overlay counts must be tied to held-out birth/death metrics',
  );
  assert.ok(
    budgetedReport.diagnostics.churnOverlay.counts.falseSupport >= 0,
    'churn overlay must expose false predicted support counts',
  );
  const diagnosticArtifacts = [
    budgetedReport.diagnostics.residuals.artifacts.exactMinusIdentity,
    budgetedReport.diagnostics.residuals.artifacts.exactMinusPrediction,
    budgetedReport.diagnostics.residuals.artifacts.predictionMinusIdentity,
    budgetedReport.diagnostics.churnOverlay.artifacts.supportChurn,
    budgetedReport.diagnostics.churnOverlay.artifacts.missedSupport,
    budgetedReport.diagnostics.churnOverlay.artifacts.falseSupport,
    budgetedReport.diagnostics.churnOverlay.artifacts.trueBirth,
    budgetedReport.diagnostics.churnOverlay.artifacts.trueDeath,
    budgetedReport.diagnostics.inspection.artifacts.contextSheet,
  ];
  for (const artifact of diagnosticArtifacts) {
    const bytes = await readFile(artifact.path);
    assert.equal(bytes.readUInt32BE(0), 0x89504e47);
    assert.equal(hash(bytes), artifact.sha256);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat phase render witness contracts passed');
