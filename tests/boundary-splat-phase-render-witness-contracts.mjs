import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileBoundarySplatAttributeModel } from '../boundary-splat-attribute-model.mjs';

import {
  alignBoundarySplatRowsByWorldPosition,
  renderBoundarySplatRowsPng,
  validateBoundarySplatPhaseRenderFrame,
  writeBoundarySplatPhaseRenderWitness,
} from '../boundary-splat-phase-render-witness.mjs';

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
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat phase render witness contracts passed');
