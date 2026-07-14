import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-moving-phase-contract-'));
const outDir = join(fixture, 'witness');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const camera = {
  viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  controls: [1, 1, 1, 4],
};

function writeRows(label, positions, authority) {
  const features = new Float32Array(positions.length * 16);
  const splats = new Float32Array(positions.length * 12);
  positions.forEach((position, row) => {
    for (let channel = 0; channel < 16; channel += 1) features[row * 16 + channel] = 1 + row + channel * 0.01;
    splats.set([...position, 0, 1, 0.5, 0.15, 0.75, 0.22, 0.22, 0, 1], row * 12);
  });
  const featureBytes = Buffer.from(features.buffer);
  const splatBytes = Buffer.from(splats.buffer);
  const featurePath = join(fixture, `${label}.features.f32`);
  const splatPath = join(fixture, `${label}.splats.f32`);
  writeFileSync(featurePath, featureBytes);
  writeFileSync(splatPath, splatBytes);
  return {
    candidates: { path: featurePath, bytes: featureBytes.length, sha256: hash(featureBytes), count: positions.length, strideFloats: 16, dtype: 'float32-le' },
    splats: { path: splatPath, bytes: splatBytes.length, sha256: hash(splatBytes), count: positions.length, strideFloats: 12, dtype: 'float32-le', authority },
  };
}

const referencePositions = [
  [[-0.45, 0, 0], [0.2, 0.2, 0]],
  [[-0.25, 0.05, 0], [0.2, 0.2, 0]],
  [[-0.05, 0.1, 0], [0.2, 0.4, 0]],
  [[0.15, 0.15, 0], [0.4, 0.4, 0]],
];
const predictedPositions = [
  referencePositions[0],
  [[-0.25, 0, 0], [0.2, 0.2, 0]],
  [[-0.05, 0, 0], [0.2, 0.4, 0]],
  [[0.15, 0, 0], [0.4, 0.4, 0]],
];
const referenceFrames = referencePositions.map((positions, index) => ({
  id: `frame-${index}`,
  controlledStepFrameIndex: index,
  controlledStepDeltaMs: 160,
  requestedRoute: 'fixture://moving-phase',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  modelIdentity: 'fixture-model',
  sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  fallbackReason: null,
  camera,
  ...writeRows(`reference-${index}`, positions, 'intercepted-live-boundary-splat-buffer-post-compaction-v0'),
}));
const corpusPath = join(fixture, 'phase-corpus.json');
const corpusBytes = Buffer.from(JSON.stringify({
  schema: 'kaminos-boundary-splat-phase-candidate-corpus-v0',
  authority: 'live-simulator-controlled-step-selected-candidate-features-v0',
  requestedRoute: 'fixture://moving-phase',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  frames: referenceFrames,
}));
writeFileSync(corpusPath, corpusBytes);

const predictionFrames = predictedPositions.map((positions, index) => ({
  step: index,
  referenceFrameId: `frame-${index}`,
  controlFrameId: 'frame-0',
  ...writeRows(`prediction-${index}`, positions, 'learned-local-grid-transport-plus-residual-churn-v0'),
}));
const predictionsPath = join(fixture, 'transport-predictions.json');
const modelPath = join(fixture, 'transport-model.json');
const modelBytes = Buffer.from(JSON.stringify({
  schema: 'kaminos-boundary-splat-phase-transport-model-v0',
  fixture: true,
}));
writeFileSync(modelPath, modelBytes);
const predictionDocument = {
  schema: 'kaminos-boundary-splat-phase-transport-predictions-v0',
  status: 'completed',
  manifest: { path: corpusPath, bytes: corpusBytes.length, sha256: hash(corpusBytes) },
  model: { path: modelPath, schema: 'kaminos-boundary-splat-phase-transport-model-v0', sha256: hash(modelBytes) },
  route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  temporal: {
    authority: 'recurrent-one-controlled-step-local-grid-continuation-v0',
    controlledStepDeltaMs: 160,
    sourceFrameId: 'frame-0',
    heldoutReferenceFrameIds: referenceFrames.map(frame => frame.id),
  },
  frames: predictionFrames,
};

function runWitness(document, label) {
  const casePredictionsPath = join(fixture, `${label}-transport-predictions.json`);
  const caseOutDir = join(fixture, label);
  writeFileSync(casePredictionsPath, JSON.stringify(document));
  const result = spawnSync(process.execPath, [
    'boundary-splat-moving-phase-witness.mjs',
    '--manifest', corpusPath,
    '--predictions', casePredictionsPath,
    '--out-dir', caseOutDir,
    '--width', '96',
    '--height', '72',
    '--frames-per-step', '2',
    '--fps', '6',
    '--grid-step', '0.2',
    '--partial-flow-debug-gain', '0.625',
  ], { cwd: root, encoding: 'utf8' });
  return { result, report: JSON.parse(readFileSync(join(caseOutDir, 'moving-phase-witness.json'), 'utf8')) };
}

function expectIdentityFailure(document, label, errorPattern) {
  const { result, report } = runWitness(document, label);
  assert.notEqual(result.status, 0, `${label} provenance lie was accepted`);
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'manifest-validation');
  assert.match(report.error, errorPattern);
}

const missingManifest = structuredClone(predictionDocument);
delete missingManifest.manifest;
expectIdentityFailure(missingManifest, 'missing-manifest', /prediction corpus identity is missing/);

const staleManifest = structuredClone(predictionDocument);
staleManifest.manifest.sha256 = '0'.repeat(64);
expectIdentityFailure(staleManifest, 'stale-manifest', /prediction corpus hash mismatch/);

const missingModel = structuredClone(predictionDocument);
delete missingModel.model;
expectIdentityFailure(missingModel, 'missing-model', /prediction model identity is missing/);

const staleModel = structuredClone(predictionDocument);
staleModel.model.sha256 = 'f'.repeat(64);
expectIdentityFailure(staleModel, 'stale-model', /prediction model hash mismatch/);

writeFileSync(predictionsPath, JSON.stringify(predictionDocument));

const result = spawnSync(process.execPath, [
  'boundary-splat-moving-phase-witness.mjs',
  '--manifest', corpusPath,
  '--predictions', predictionsPath,
  '--out-dir', outDir,
  '--width', '96',
  '--height', '72',
  '--frames-per-step', '2',
  '--fps', '6',
  '--grid-step', '0.2',
  '--partial-flow-debug-gain', '0.625',
], { cwd: root, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);

const report = JSON.parse(readFileSync(join(outDir, 'moving-phase-witness.json'), 'utf8'));
assert.equal(report.schema, 'kaminos-boundary-splat-moving-phase-witness-v0');
assert.equal(report.status, 'completed');
assert.equal(report.source.manifest.sha256, hash(corpusBytes));
assert.equal(report.source.model.sha256, hash(modelBytes));
assert.equal(report.source.model.schema, 'kaminos-boundary-splat-phase-transport-model-v0');
assert.equal(report.playback.frameCount, 7);
assert.equal(report.playback.requestedFps, 6);
assert.equal(report.playback.effectiveFps, 6);
assert.equal(report.playback.simulatedDurationSeconds, 0.48);
assert.ok(report.playback.encodedDurationSeconds >= 1);
assert.equal(report.playback.loops, false);
assert.equal(report.roles.reference.frameHashes.length, 7);
assert.equal(report.roles.control.frameHashes.length, 7);
assert.equal(report.roles.predicted.frameHashes.length, 7);
assert.ok(new Set(report.roles.reference.frameHashes).size > 1);
assert.equal(new Set(report.roles.control.frameHashes).size, 1);
assert.ok(new Set(report.roles.predicted.frameHashes).size > 1);
assert.equal(report.partialFlowDebug.requestedGain, 0.625);
assert.equal(report.partialFlowDebug.effectiveGain, 0.625);
assert.deepEqual(report.partialFlowDebug.roles, ['reference', 'control', 'predicted']);
assert.equal(report.partialFlowDebug.frameCount, 7);
assert.equal(report.partialFlowDebug.effectiveFps, 6);
assert.equal(report.artifacts.beautyComparison.probe.frameCount, 7);
assert.equal(report.artifacts.partialDebugComparison.probe.frameCount, 7);
assert.equal(report.artifacts.beautyComparison.probe.width, 288);
assert.equal(report.temporalDiagnostics.authority, 'isolated-raster-envelope-and-frequency-separation-v0');
assert.deepEqual(Object.keys(report.temporalDiagnostics.roles), ['reference', 'control', 'predicted']);
for (const role of Object.values(report.temporalDiagnostics.roles)) {
  assert.equal(role.frames.length, 7);
  assert.equal(role.transitions.length, 6);
  assert.ok(role.frames.every(frame => frame.envelope.areaPixels > 0));
  assert.ok(role.frames.every(frame => Number.isFinite(frame.envelope.centroidXNormalized)));
  assert.ok(role.frames.every(frame => Number.isFinite(frame.spatialDetailEnergy)));
}
assert.ok(report.temporalDiagnostics.roles.reference.transitions.some(row => row.totalMotionEnergy > 0));
assert.ok(report.temporalDiagnostics.roles.predicted.transitions.some(row => row.highFrequencyMotionEnergy > 0));
assert.ok(report.temporalDiagnostics.roles.control.transitions.every(row => row.totalMotionEnergy === 0));
assert.equal(report.temporalDiagnostics.roles.control.summary.envelopeAreaRatioEndToStart, 1);
assert.match(readFileSync(join(outDir, 'inspection-guide.html'), 'utf8'), /Reference: exact held-out simulator states/);
assert.match(readFileSync(join(outDir, 'inspection-guide.html'), 'utf8'), /Prediction: recurrent learned local-grid transport/);
assert.match(readFileSync(join(outDir, 'inspection-guide.html'), 'utf8'), /Low-frequency envelope diagnostics/);

console.log('boundary splat moving phase witness contracts passed');
