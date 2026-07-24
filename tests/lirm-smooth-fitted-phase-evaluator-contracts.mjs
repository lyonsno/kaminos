import assert from 'node:assert/strict';

const fitted = await import('../lirm-reference-fitted-armature-core.mjs');

for (const name of [
  'createSmoothFittedProxyRigProbeBinding',
  'createSmoothFittedProxyRigCyclePose',
  'evaluateSmoothFittedProxyRigPhase',
]) {
  assert.equal(typeof fitted[name], 'function', `expected arbitrary-phase export ${name}`);
}

const donorSha256 = `sha256:${'7'.repeat(64)}`;
const registration = {
  schema: 'kaminos.lirm-fitted-proxy-rig-registration.v0',
  sourceCandidateId: 'phase-evaluator-fixture',
  sourcePacketSha256: `sha256:${'8'.repeat(64)}`,
  armatureProgramId: 'kaminos.fixture.phase-evaluator.v0',
  donorSha256,
  stationCount: 7,
  manualControlCount: 0,
  headDirection: '-Z',
  stations: Array.from({ length: 7 }, (_, index) => ({
    id: `station-${String(index).padStart(2, '0')}`,
    sourcePrimitiveId: `fixture:proxy-${index}`,
    t: index / 6,
    position: { x: 0, y: 0, z: 0.6 - index * 0.2 },
    radius: { x: 0.15, y: 0.12, z: 0.12 },
  })),
};

const positions = [
  0.16, -0.12, 0.42,
  -0.16, -0.12, 0.42,
  0.15, -0.13, -0.42,
  -0.15, -0.13, -0.42,
  0.08, 0.1, 0.18,
  -0.08, 0.1, -0.18,
];
const binding = fitted.createSmoothFittedProxyRigBinding({
  positions,
  registration,
  sampleCount: 96,
});
const contactAtlas = {
  schema: 'kaminos.creature-contact-atlas.v0',
  version: 0,
  castId: 'phase-evaluator-fixture',
  castHash: donorSha256.slice('sha256:'.length),
  registrationHash: 'fixture-registration-hash',
  motionClass: 'elongated-crawler',
  authority: 'exact-cast-consumer-derived-contact-v0',
  vertexCount: positions.length / 3,
  patches: [
    { id: 'front-left', axialRegion: 'front', side: 'left', phaseOffset: 0, vertexIndices: [0], weights: [1] },
    { id: 'front-right', axialRegion: 'front', side: 'right', phaseOffset: 0.5, vertexIndices: [1], weights: [1] },
    { id: 'rear-left', axialRegion: 'rear', side: 'left', phaseOffset: 0.5, vertexIndices: [2], weights: [1] },
    { id: 'rear-right', axialRegion: 'rear', side: 'right', phaseOffset: 0, vertexIndices: [3], weights: [1] },
  ],
};
const probeBinding = fitted.createSmoothFittedProxyRigProbeBinding({
  binding,
  contactAtlas,
  contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
});
assert.equal(probeBinding.schema, 'kaminos.lirm-smooth-fitted-probe-binding.v0');
assert.deepEqual(probeBinding.probes.map(probe => probe.id), [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
]);

const identityRoot = {
  schema: 'kaminos.creature-root-frame.v0',
  origin: { x: 0, y: 0, z: 0 },
  lateral: { x: 1, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 0, y: 0, z: 1 },
};
const amplitude = 0.18;
const rest = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase: 0,
  amplitude,
  rootFrame: identityRoot,
});
assert.equal(rest.schema, 'kaminos.lirm-smooth-fitted-phase-packet.v0');
assert.equal(rest.effectiveRoute, 'kaminos/fitted-proxy-rig/arbitrary-phase-plus-semantic-probes-v0');
assert.equal(rest.pose.fromPreset, 'rest');
assert.equal(rest.pose.toPreset, 'c-bend');
assert.equal(rest.pose.mix, 0);
assert.deepEqual([...rest.bodyPositions], positions);
assert.deepEqual([...rest.worldPositions], positions);
assert.deepEqual(rest.probes.map(probe => probe.id), probeBinding.probes.map(probe => probe.id));
assert.ok(rest.probes.every(probe => [
  ...probe.bodyPosition,
  ...probe.worldPosition,
  ...probe.bodyNormal,
  ...probe.worldNormal,
].every(Number.isFinite)));

const wrapped = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase: 1,
  amplitude,
  rootFrame: identityRoot,
});
assert.deepEqual([...wrapped.bodyPositions], [...rest.bodyPositions], 'phase one must wrap exactly to phase zero');
assert.deepEqual(wrapped.probes, rest.probes, 'probe packet must wrap exactly with body phase');

for (const [phase, preset] of [
  [1 / 6, 'c-bend'],
  [3 / 6, 's-bend'],
  [5 / 6, 'asymmetric'],
]) {
  const cycle = fitted.evaluateSmoothFittedProxyRigPhase({
    binding,
    probeBinding,
    phase,
    amplitude,
    rootFrame: identityRoot,
  });
  const endpointPose = fitted.createSmoothFittedProxyRigPose({ registration, preset, amplitude });
  const endpoint = fitted.deformSmoothFittedProxyRigBinding({ binding, pose: endpointPose });
  assert.deepEqual([...cycle.bodyPositions], [...endpoint], `${preset} cycle endpoint drifted`);
}

const midpoint = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase: 1 / 12,
  amplitude,
  rootFrame: identityRoot,
});
const cEndpoint = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase: 1 / 6,
  amplitude,
  rootFrame: identityRoot,
});
const endpointLinearMidpoint = rest.bodyPositions.map(
  (value, index) => value + (cEndpoint.bodyPositions[index] - value) * 0.5,
);
const nonlinearDelta = Math.max(...midpoint.bodyPositions.map(
  (value, index) => Math.abs(value - endpointLinearMidpoint[index]),
));
assert.ok(nonlinearDelta > 1e-6, `midphase collapsed to endpoint vertex interpolation: ${nonlinearDelta}`);
assert.deepEqual(
  [...fitted.evaluateSmoothFittedProxyRigPhase({
    binding,
    probeBinding,
    phase: 1 / 12,
    amplitude,
    rootFrame: identityRoot,
  }).bodyPositions],
  [...midpoint.bodyPositions],
  'same phase must be exactly deterministic',
);

const translatedRoot = {
  schema: 'kaminos.creature-root-frame.v0',
  origin: { x: 3, y: 4, z: 5 },
  lateral: { x: 0, y: 0, z: -1 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 1, y: 0, z: 0 },
};
const world = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase: 1 / 12,
  amplitude,
  rootFrame: translatedRoot,
});
assert.deepEqual([...world.bodyPositions], [...midpoint.bodyPositions], 'root frame must not mutate body-local pose');
for (let index = 0; index < world.bodyPositions.length; index += 3) {
  const x = world.bodyPositions[index];
  const y = world.bodyPositions[index + 1];
  const z = world.bodyPositions[index + 2];
  assert.deepEqual(
    [...world.worldPositions.slice(index, index + 3)],
    [3 + z, 4 + y, 5 - x],
    'root frame did not map body coordinates into world coordinates',
  );
}

assert.throws(
  () => fitted.createSmoothFittedProxyRigProbeBinding({
    binding,
    contactAtlas: { ...contactAtlas, castHash: 'wrong-cast' },
    contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
  }),
  /cast hash mismatch/,
);
assert.throws(
  () => fitted.createSmoothFittedProxyRigProbeBinding({
    binding,
    contactAtlas: {
      ...contactAtlas,
      patches: [{ ...contactAtlas.patches[0], vertexIndices: [binding.vertexCount] }],
    },
    contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
  }),
  /vertex index/,
);

process.stdout.write('lirm smooth fitted arbitrary-phase evaluator contracts passed\n');
