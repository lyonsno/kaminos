import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const witnessUrl = new URL('../boundary-splat-alternating-anchor-witness.mjs', import.meta.url);
const witness = await import(witnessUrl);

const artifact = (name, hash) => ({
  path: `/tmp/${name}.splats.f32`,
  bytes: 48,
  sha256: hash.repeat(64),
  count: 1,
  strideFloats: 12,
  dtype: 'float32-le',
});
const exactFrame = index => ({
  id: `frame-${index}`,
  controlledStepFrameIndex: index,
  controlledStepDeltaMs: 16.667,
  simStepCount: 100 + index,
  sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  fallbackReason: null,
  camera: {
    viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    controls: [1, 1, 1, 3.4],
  },
  candidates: { ...artifact(`exact-${index}-candidates`, String(index + 1)), strideFloats: 16, bytes: 64 },
  splats: {
    ...artifact(`exact-${index}`, String(index + 1)),
    authority: 'intercepted-live-boundary-splat-buffer-post-compaction-v0',
  },
});

const manifestFrames = Array.from({ length: 5 }, (_, index) => exactFrame(index));
const predictionFrames = manifestFrames.map((frame, index) => ({
  displayFrameIndex: index,
  referenceFrameId: frame.id,
  sourceFrameId: `frame-${index % 2 === 0 ? index : index - 1}`,
  roleAuthority: index % 2 === 0
    ? 'exact-natural-full-rate-anchor-v0'
    : 'causal-one-step-prediction-from-prior-exact-anchor-v0',
  candidates: frame.candidates,
  splats: index % 2 === 0 ? frame.splats : artifact(`causal-${index}`, 'a'),
}));
const oraclePairs = [1, 3].map(index => ({
  sourceFrameId: `frame-${index - 1}`,
  targetFrameId: `frame-${index}`,
  oraclePredicted: {
    candidates: manifestFrames[index].candidates,
    splats: artifact(`oracle-${index}`, 'b'),
  },
}));

const rolePlan = witness.buildAlternatingRolePlan(manifestFrames, predictionFrames, oraclePairs);
assert.equal(rolePlan.length, 5);
assert.deepEqual(rolePlan.map(row => row.displayFrameIndex), [0, 1, 2, 3, 4]);
assert.equal(rolePlan[1].natural.state, manifestFrames[1], 'natural odd must be the exact odd simulator state');
assert.equal(rolePlan[1].hold.state, manifestFrames[0], 'hold odd must reuse the prior exact even state');
assert.equal(rolePlan[1].causal.state, predictionFrames[1], 'causal odd must use the frozen prediction artifact');
assert.equal(rolePlan[1].oracle.state, oraclePairs[0].oraclePredicted, 'oracle odd must use the exact-support upper bound');
assert.equal(rolePlan[1].interpolated.left, manifestFrames[0]);
assert.equal(rolePlan[1].interpolated.right, manifestFrames[2]);
assert.equal(rolePlan[1].interpolated.fraction, 0.5);
assert.equal(rolePlan[1].interpolated.noncausal, true);
assert.equal(rolePlan[1].natural.authority, 'exact-simulator-state-every-display-frame-v0');
assert.equal(rolePlan[1].hold.authority, 'prior-exact-even-anchor-byte-repeated-v0');
assert.equal(rolePlan[1].causal.authority, 'causal-one-step-prediction-from-prior-exact-anchor-v0');
assert.equal(rolePlan[1].oracle.authority, 'exact-target-support-world-position-offline-upper-bound-v0');
assert.equal(rolePlan[1].interpolated.authority, 'noncausal-exact-neighbor-interpolation-v0');
assert.equal(rolePlan[2].natural.state, manifestFrames[2]);
assert.equal(rolePlan[2].hold.state, manifestFrames[2]);
assert.equal(rolePlan[2].causal.state, manifestFrames[2]);
assert.equal(rolePlan[2].oracle.state, manifestFrames[2]);
assert.equal(rolePlan[2].interpolated.state, manifestFrames[2]);

assert.doesNotThrow(() => witness.validateAlternatingRolePlan(rolePlan));
const counterfeitNatural = structuredClone(rolePlan);
counterfeitNatural[1].natural.state = counterfeitNatural[1].hold.state;
assert.throws(
  () => witness.validateAlternatingRolePlan(counterfeitNatural),
  /natural full-rate control must bind the exact display-frame state/,
  'a sample-held middle panel must not masquerade as natural full-rate control',
);
const counterfeitHold = structuredClone(rolePlan);
counterfeitHold[1].hold.state = {
  ...counterfeitHold[1].hold.state,
  splats: artifact('not-the-prior-anchor', 'c'),
};
assert.throws(
  () => witness.validateAlternatingRolePlan(counterfeitHold),
  /hold control must byte-repeat the prior exact anchor/,
);
const targetFedCausal = structuredClone(rolePlan);
targetFedCausal[1].causal.sourceFrameId = 'frame-1';
assert.throws(
  () => witness.validateAlternatingRolePlan(targetFedCausal),
  /causal odd frame must source only the prior exact anchor/,
);

assert.deepEqual(
  witness.validateAlternatingPlayback(241, 16.667),
  {
    frameCount: 241,
    controlledStepDeltaMs: 16.667,
    fps: 1000 / 16.667,
    durationSeconds: (240 * 16.667) / 1000,
    minimumDurationSeconds: 4,
    frameCap: null,
  },
);
assert.throws(
  () => witness.validateAlternatingPlayback(239, 16.667),
  /at least four seconds/,
  'the moving witness must not silently shrink below the operator inspection horizon',
);
assert.throws(
  () => witness.validateAlternatingPlayback(241, 160),
  /fine display cadence/,
  'the old +160 ms checkpoint must not masquerade as alternate-display-frame inference',
);

const root = await mkdtemp(join(tmpdir(), 'alternating-anchor-witness-contract-'));
try {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const writeJsonIdentity = async (name, document) => {
    const path = join(root, name);
    const bytes = Buffer.from(`${JSON.stringify(document)}\n`);
    await writeFile(path, bytes);
    return { path, bytes: bytes.byteLength, sha256: hash(bytes) };
  };
  const writeFloatArtifact = async (name, values, strideFloats, authority = undefined) => {
    const path = join(root, name);
    const typed = new Float32Array(values);
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    await writeFile(path, bytes);
    return {
      path,
      bytes: bytes.byteLength,
      sha256: hash(bytes),
      count: typed.length / strideFloats,
      strideFloats,
      dtype: 'float32-le',
      ...(authority ? { authority } : {}),
    };
  };
  const featureOrder = [
    'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
    'material.density', 'material.heat', 'material.fuel', 'material.detail',
    'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
    'micro.x', 'micro.y', 'micro.z', 'micro.w',
  ];
  const camera = manifestFrames[0].camera;
  const exactFrames = [];
  const alternatingFrames = [];
  const pairs = [];
  for (let index = 0; index < 241; index += 1) {
    const candidate = await writeFloatArtifact(
      `exact-${index}.features.f32`,
      Array.from({ length: 16 }, (_, channel) => index * 0.001 + channel * 0.01),
      16,
    );
    const exactSplat = await writeFloatArtifact(
      `exact-${index}.splats.f32`,
      [Math.sin(index / 25) * 0.08, Math.cos(index / 31) * 0.04, 0, 1, 0.9, 0.35, 0.08, 0.95, 0.18, 0.18, 0, 0],
      12,
      'intercepted-live-boundary-splat-buffer-post-compaction-v0',
    );
    const exact = {
      id: `frame-${index}`,
      controlledStepFrameIndex: index,
      controlledStepDeltaMs: 16.667,
      simStepCount: 500 + index,
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
      fallbackReason: null,
      camera,
      candidates: candidate,
      splats: exactSplat,
    };
    exactFrames.push(exact);
    if (index % 2 === 0) {
      alternatingFrames.push({
        displayFrameIndex: index,
        referenceFrameId: exact.id,
        sourceFrameId: exact.id,
        roleAuthority: 'exact-natural-full-rate-anchor-v0',
        candidates: candidate,
        splats: { ...exactSplat, authority: 'exact-natural-full-rate-anchor-v0' },
      });
    } else {
      const causalSplat = await writeFloatArtifact(
        `causal-${index}.splats.f32`,
        [Math.sin(index / 25) * 0.075, Math.cos(index / 31) * 0.035, 0, 1, 0.86, 0.32, 0.07, 0.9, 0.18, 0.18, 0, 0],
        12,
        'causal-one-step-prediction-from-prior-exact-anchor-v0',
      );
      alternatingFrames.push({
        displayFrameIndex: index,
        referenceFrameId: exact.id,
        sourceFrameId: `frame-${index - 1}`,
        roleAuthority: 'causal-one-step-prediction-from-prior-exact-anchor-v0',
        candidates: candidate,
        splats: causalSplat,
      });
      const oracleSplat = await writeFloatArtifact(
        `oracle-${index}.splats.f32`,
        [Math.sin(index / 25) * 0.079, Math.cos(index / 31) * 0.039, 0, 1, 0.89, 0.34, 0.08, 0.94, 0.18, 0.18, 0, 0],
        12,
        'oracle-correspondence-transport-plus-frozen-splat-residual-v0',
      );
      pairs.push({
        sourceFrameId: `frame-${index - 1}`,
        targetFrameId: exact.id,
        oraclePredicted: {
          candidates: { ...candidate, authority: 'oracle-correspondence-transport-plus-frozen-splat-residual-v0' },
          splats: oracleSplat,
        },
      });
    }
  }
  const manifest = {
    schema: 'kaminos-boundary-splat-phase-candidate-corpus-v0',
    featureOrder,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    requestedRoute: 'http://127.0.0.1:18218/?volume_resolution=160',
    frames: exactFrames,
  };
  const manifestIdentity = await writeJsonIdentity('phase-corpus.json', manifest);
  const trainingManifest = await writeJsonIdentity('training-corpus.json', { corpus: 'separate-training' });
  const transportModel = await writeJsonIdentity('transport-model.json', { model: 'transport' });
  const stateModel = await writeJsonIdentity('state-model.json', { model: 'state' });
  const predictions = {
    schema: 'kaminos-boundary-splat-phase-transport-predictions-v0',
    status: 'completed',
    manifest: manifestIdentity,
    modelTrainingManifest: trainingManifest,
    model: { ...transportModel, schema: 'kaminos-boundary-splat-phase-transport-model-v0' },
    destinationStateModel: { ...stateModel, schema: 'kaminos-boundary-splat-phase-destination-state-model-v0' },
    route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
    temporal: {
      authority: 'alternating-exact-anchor-causal-odd-projection-v0',
      controlledStepDeltaMs: 16.667,
      exactAnchorParity: 'even',
      heldoutTargetParity: 'odd',
      targetFramesAvailableToPredictor: false,
      producedSequenceRoles: ['exact-even-anchor', 'causal-odd-prediction'],
      naturalFullRateControl: {
        authority: 'exact-controlled-step-corpus-all-display-frames-v0',
        visible: true,
        frameIds: exactFrames.map(frame => frame.id),
        frameCount: exactFrames.length,
        sourceManifest: manifestIdentity,
        simulatorAdvancedEveryDisplayFrame: true,
      },
      holdControlAuthority: 'prior-exact-even-anchor-byte-repeated-on-odd-display-frames-v0',
      interpolationAuthority: 'noncausal-exact-neighbor-interpolation-v0',
      oracleScaffoldAuthority: 'exact-target-support-world-position-offline-upper-bound-v0',
      inferenceCorpusSeenDuringTraining: false,
    },
    frames: alternatingFrames,
  };
  const predictionIdentity = await writeJsonIdentity('transport-predictions.json', predictions);
  const oracle = {
    schema: 'kaminos-boundary-splat-phase-appearance-transport-evaluation-v0',
    status: 'completed',
    route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
    evaluationManifest: manifestIdentity,
    temporal: { controlledStepDeltaMs: 16.667, pairCap: null, sampleCap: null },
    pairs,
  };
  const oracleIdentity = await writeJsonIdentity('oracle-evaluation.json', oracle);
  const outDir = join(root, 'witness');
  const report = await witness.writeAlternatingAnchorWitness(
    manifestIdentity.path,
    predictionIdentity.path,
    oracleIdentity.path,
    { outDir, width: 32, height: 32 },
  );
  assert.equal(report.status, 'completed');
  assert.equal(report.playback.frameCount, 241);
  assert.equal(report.playback.frameCap, null);
  assert.equal(report.roles.natural.source, 'exact-inference-manifest');
  assert.equal(report.roles.hold.byteRepeatsPriorExactAnchorOnOddFrames, true);
  assert.equal(report.roles.causal.targetFramesAvailableToPredictor, false);
  assert.equal(report.roles.interpolated.noncausal, true);
  assert.equal((await readFile(join(outDir, 'alternating-anchor-five-role.mp4'))).byteLength > 0, true);

  const badPredictions = structuredClone(predictions);
  badPredictions.temporal.naturalFullRateControl.frameIds[1] = 'frame-0';
  const badPredictionIdentity = await writeJsonIdentity('bad-predictions.json', badPredictions);
  const badOutDir = join(root, 'bad-witness');
  const stalePrimary = join(badOutDir, 'alternating-anchor-five-role.mp4');
  await mkdir(badOutDir, { recursive: true });
  await writeFile(stalePrimary, 'stale');
  await assert.rejects(
    witness.writeAlternatingAnchorWitness(
      manifestIdentity.path,
      badPredictionIdentity.path,
      oracleIdentity.path,
      { outDir: badOutDir, width: 32, height: 32 },
    ),
    /natural full-rate frame identity mismatch/,
  );
  const failure = JSON.parse(await readFile(join(badOutDir, 'alternating-anchor-witness-report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'input-validation');
  assert.equal(failure.primaryOutputExists, false);
  await assert.rejects(readFile(stalePrimary), { code: 'ENOENT' });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat alternating-anchor witness contracts passed');
