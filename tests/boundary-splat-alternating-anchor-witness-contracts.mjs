import assert from 'node:assert/strict';

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

console.log('boundary splat alternating-anchor witness contracts passed');
