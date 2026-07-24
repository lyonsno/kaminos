import assert from 'node:assert/strict';

const fitted = await import('../lirm-reference-fitted-armature-core.mjs');

assert.equal(
  typeof fitted.evaluateSmoothFittedProxyRigContactPhase,
  'function',
  'expected smooth contact-realization evaluator export',
);

const donorSha256 = `sha256:${'7'.repeat(64)}`;
const registration = {
  schema: 'kaminos.lirm-fitted-proxy-rig-registration.v0',
  sourceCandidateId: 'contact-realization-fixture',
  sourcePacketSha256: `sha256:${'8'.repeat(64)}`,
  armatureProgramId: 'kaminos.fixture.contact-realization.v0',
  donorSha256,
  stationCount: 9,
  manualControlCount: 0,
  headDirection: '-Z',
  stations: Array.from({ length: 9 }, (_, index) => ({
    id: `station-${String(index).padStart(2, '0')}`,
    sourcePrimitiveId: `fixture:proxy-${index}`,
    t: index / 8,
    position: { x: 0, y: 0, z: 0.8 - index * 0.2 },
    radius: { x: 0.15, y: 0.12, z: 0.12 },
  })),
};
const positions = [
  0.16, -0.12, 0.55,
  -0.16, -0.12, 0.55,
  0.15, -0.13, -0.55,
  -0.15, -0.13, -0.55,
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
  castId: 'contact-realization-fixture',
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
assert.throws(
  () => fitted.createSmoothFittedProxyRigProbeBinding({
    binding,
    contactAtlas: {
      ...contactAtlas,
      patches: contactAtlas.patches.map((patch, index) => (
        index < 2
          ? {
              ...patch,
              influenceVertexIndices: [0],
              influenceWeights: [1],
            }
          : patch
      )),
    },
    contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
  }),
  /rigid carrier core vertex 0 belongs to both front-left and front-right/,
);
assert.throws(
  () => fitted.createSmoothFittedProxyRigProbeBinding({
    binding,
    contactAtlas: {
      ...contactAtlas,
      patches: contactAtlas.patches.map((patch, index) => (
        index === 0
          ? {
              ...patch,
              influenceVertexIndices: [0],
              influenceWeights: [0.05],
            }
          : patch
      )),
    },
    contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
  }),
  /front-left has no body-side attachment samples/,
);
const probeBinding = fitted.createSmoothFittedProxyRigProbeBinding({
  binding,
  contactAtlas,
  contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
});
const rootFrame = {
  schema: 'kaminos.creature-root-frame.v0',
  origin: { x: 0, y: 0, z: 0 },
  lateral: { x: 1, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 0, y: 0, z: 1 },
};
const phase = 0.08;
const amplitude = 0.18;
const baseline = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase,
  amplitude,
  rootFrame,
});
const baselineById = new Map(baseline.probes.map(probe => [probe.id, probe]));
const correctionById = new Map([
  ['front-left', -0.08],
  ['front-right', 0],
  ['rear-left', 0],
  ['rear-right', 0.065],
]);
const stateById = new Map([
  ['front-left', 'stance'],
  ['front-right', 'swing'],
  ['rear-left', 'swing'],
  ['rear-right', 'stance'],
]);
const constraints = {
  schema: 'kaminos.motion-contact-constraints.v0',
  id: 'contact-realization-fixture:constraints',
  authority: 'world-space-contact-resolution',
  phase: phase * Math.PI * 2,
  patches: baseline.probes.map(probe => {
    const correction = correctionById.get(probe.id);
    const terrainPoint = [...probe.worldPosition];
    terrainPoint[1] += correction;
    return {
      id: probe.id,
      contactState: stateById.get(probe.id),
      cycle: 0,
      probeWorldPosition: [...probe.worldPosition],
      terrainPoint,
      terrainNormal: [0, 1, 0],
      signedDistance: -correction,
      inBounds: true,
    };
  }),
};

const realized = fitted.evaluateSmoothFittedProxyRigContactPhase({
  binding,
  probeBinding,
  phase,
  amplitude,
  rootFrame,
  constraints,
  clearance: 0,
  correctionGain: 0.92,
  iterationCount: 3,
});
assert.equal(realized.schema, 'kaminos.lirm-smooth-fitted-contact-phase-packet.v0');
assert.equal(
  realized.effectiveRoute,
  'kaminos/fitted-proxy-rig/appendage-local-carrier-contact-v1',
);
assert.equal(
  realized.contactRealization.authority,
  'appendage-local-rigid-carriers-plus-bounded-rigid-body-fit',
);
assert.equal(realized.contactRealization.directVertexTranslationCount, 0);
assert.equal(realized.contactRealization.carrierTransformCount, 4);
assert.equal(realized.contactRealization.iterationCount, 3);
assert.equal(
  Object.hasOwn(realized.contactRealization, 'influenceRadius'),
  false,
  'appendage-local carrier receipts must not advertise the retired global influence radius',
);
assert.equal(realized.contactRealization.patches.length, 4);
assert.ok(realized.contactRealization.maximumStationOffset <= 0.25);
assert.ok(realized.contactRealization.bodyResidual.rotationAngle <= 0.5);
assert.ok(
  Math.hypot(...realized.contactRealization.bodyResidual.translation) <= 0.12,
);

const realizedById = new Map(realized.probes.map(probe => [probe.id, probe]));
for (const id of ['front-left', 'rear-right']) {
  const baselineProbe = baselineById.get(id);
  const realizedProbe = realizedById.get(id);
  const targetY = baselineProbe.worldPosition[1] + correctionById.get(id);
  const baselineResidual = Math.abs(baselineProbe.worldPosition[1] - targetY);
  const realizedResidual = Math.abs(realizedProbe.worldPosition[1] - targetY);
  assert.ok(
    realizedResidual < baselineResidual * 0.45,
    `${id} stance residual did not materially converge: ${realizedResidual} >= ${baselineResidual}`,
  );
}

for (const id of ['front-right', 'rear-left']) {
  const baselineProbe = baselineById.get(id);
  const realizedProbe = realizedById.get(id);
  const displacement = Math.hypot(
    ...realizedProbe.worldPosition.map((value, axis) => value - baselineProbe.worldPosition[axis]),
  );
  assert.ok(displacement < 0.075, `${id} swing patch moved excessively: ${displacement}`);
}

const repeated = fitted.evaluateSmoothFittedProxyRigContactPhase({
  binding,
  probeBinding,
  phase,
  amplitude,
  rootFrame,
  constraints,
  clearance: 0,
  correctionGain: 0.92,
  iterationCount: 3,
});
assert.deepEqual(
  [...repeated.worldPositions],
  [...realized.worldPositions],
  'contact realization must be deterministic',
);

assert.throws(
  () => fitted.evaluateSmoothFittedProxyRigContactPhase({
    binding,
    probeBinding,
    phase,
    amplitude,
    rootFrame,
    constraints: {
      ...constraints,
      patches: constraints.patches.slice(0, -1),
    },
  }),
  /exactly the bound probes/,
);

process.stdout.write('lirm smooth fitted contact realization contracts passed\n');
