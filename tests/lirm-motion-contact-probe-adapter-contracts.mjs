import assert from 'node:assert/strict';

const fitted = await import('../lirm-reference-fitted-armature-core.mjs');

assert.equal(
  typeof fitted.evaluateMotionContactProbeRequest,
  'function',
  'expected a portable motion-contact probe producer',
);

const donorSha256 = `sha256:${'7'.repeat(64)}`;
const registration = {
  schema: 'kaminos.lirm-fitted-proxy-rig-registration.v0',
  sourceCandidateId: 'portable-probe-fixture',
  sourcePacketSha256: `sha256:${'8'.repeat(64)}`,
  armatureProgramId: 'kaminos.fixture.portable-probe.v0',
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
  castId: 'portable-probe-fixture',
  castHash: donorSha256.slice('sha256:'.length),
  registrationHash: 'fixture-registration-hash',
  authority: 'exact-cast-consumer-derived-contact-v0',
  vertexCount: positions.length / 3,
  patches: [
    { id: 'front-left', axialRegion: 'front', side: 'left', phaseOffset: 0, vertexIndices: [0], weights: [1] },
    { id: 'front-right', axialRegion: 'front', side: 'right', phaseOffset: 0.5, vertexIndices: [1], weights: [1] },
    { id: 'rear-left', axialRegion: 'rear', side: 'left', phaseOffset: 0.5, vertexIndices: [2], weights: [1] },
    { id: 'rear-right', axialRegion: 'rear', side: 'right', phaseOffset: 0, vertexIndices: [3], weights: [1] },
  ].map(patch => ({
    ...patch,
    influenceVertexIndices: [...patch.vertexIndices],
    influenceWeights: [...patch.weights],
  })),
};
const probeBinding = fitted.createSmoothFittedProxyRigProbeBinding({
  binding,
  contactAtlas,
  contactAtlasSha256: `sha256:${'9'.repeat(64)}`,
});
const supportSurface = {
  id: 'fixture-hill',
  sourceRef: 'lerms:fixture-hill@abc123',
  revision: 'abc123',
};
const body = {
  id: 'portable-probe-body',
  registrationId: 'portable-probe-registration',
  scale: 1.5,
};
const prepass = {
  schema: 'kaminos.motion-support-prepass.v0',
  id: 'portable-probe-prepass',
  authority: 'world-space-support-only',
  supportSurface,
  body,
  rootSurface: [10, 2, 20],
  frame: {
    forward: [0, 0, -1],
    right: [1, 0, 0],
    up: [0, 1, 0],
  },
  support: {
    rootLift: 0.25,
    plannerDisposition: 'local-support',
  },
};
const request = {
  schema: 'kaminos.motion-contact-probe-request.v0',
  id: 'portable-probe-request',
  authority: 'probe-request-only',
  prepassId: prepass.id,
  supportSurface,
  body,
  contactAtlas: {
    schema: contactAtlas.schema,
    castId: contactAtlas.castId,
    castHash: contactAtlas.castHash,
    registrationHash: contactAtlas.registrationHash,
    sha256: `sha256:${'9'.repeat(64)}`,
  },
  poseId: 'molten-low-frequency:cycle-v0',
  phase: 1.3,
  patches: contactAtlas.patches.map(({ id, phaseOffset }) => ({ id, phaseOffset })),
};
const normalization = {
  center: [0.1, -0.2, 0.3],
  scale: 2,
};
const contactPlaneY = -0.4;
const amplitude = 0.18;

const response = fitted.evaluateMotionContactProbeRequest({
  binding,
  probeBinding,
  request,
  prepass,
  normalization,
  contactPlaneY,
  amplitude,
  poseId: request.poseId,
});

assert.equal(response.schema, 'kaminos.motion-contact-probe-set.v0');
assert.equal(response.requestId, request.id);
assert.equal(response.prepassId, prepass.id);
assert.deepEqual(response.supportSurface, request.supportSurface);
assert.deepEqual(response.body, request.body);
assert.deepEqual(response.contactAtlas, request.contactAtlas);
assert.equal(response.poseId, request.poseId);
assert.equal(response.phase, request.phase);
assert.deepEqual(
  response.patches.map(patch => patch.id),
  request.patches.map(patch => patch.id),
);
assert.ok(response.patches.every(patch => Object.keys(patch).sort().join(',') === 'id,worldPosition'));

const identityRoot = {
  schema: 'kaminos.creature-root-frame.v0',
  origin: { x: 0, y: 0, z: 0 },
  lateral: { x: 1, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 0, y: 0, z: 1 },
};
const evaluated = fitted.evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase: request.phase / (Math.PI * 2),
  amplitude,
  rootFrame: identityRoot,
});
const rootOrigin = [
  prepass.rootSurface[0],
  prepass.rootSurface[1] + prepass.support.rootLift - contactPlaneY * body.scale,
  prepass.rootSurface[2],
];
for (const patch of response.patches) {
  const bodyProbe = evaluated.probes.find(probe => probe.id === patch.id);
  const source = bodyProbe.bodyPosition.map(
    (value, axis) => value / normalization.scale + normalization.center[axis],
  );
  assert.deepEqual(patch.worldPosition, [
    rootOrigin[0] + source[0] * body.scale,
    rootOrigin[1] + source[1] * body.scale,
    rootOrigin[2] + source[2] * body.scale,
  ]);
}

const call = (overrides = {}) => fitted.evaluateMotionContactProbeRequest({
  binding,
  probeBinding,
  request,
  prepass,
  normalization,
  contactPlaneY,
  amplitude,
  poseId: request.poseId,
  ...overrides,
});

assert.throws(() => call({ request: { ...request, schema: 'wrong' } }), /request schema/);
assert.throws(() => call({ prepass: { ...prepass, id: 'stale' } }), /prepass identity/);
assert.throws(
  () => call({ request: { ...request, supportSurface: { ...supportSurface, revision: 'stale' } } }),
  /support surface identity/,
);
assert.throws(
  () => call({ request: { ...request, body: { ...body, scale: body.scale + 0.1 } } }),
  /body identity/,
);
for (const invalidScale of [null, '1.5', 0, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => call({
      request: {
        ...request,
        body: { ...body, scale: invalidScale },
      },
      prepass: {
        ...prepass,
        body: { ...body, scale: invalidScale },
      },
    }),
    /body scale/,
    `expected matching malformed body scale ${String(invalidScale)} to fail closed`,
  );
}
assert.throws(
  () => call({ request: { ...request, contactAtlas: { ...request.contactAtlas, castHash: 'stale' } } }),
  /contact atlas identity/,
);
assert.throws(
  () => call({ request: { ...request, poseId: 'wrong-pose' } }),
  /pose identity/,
);
assert.throws(
  () => call({ request: { ...request, patches: request.patches.slice(0, 3) } }),
  /requested patches/,
);
assert.throws(
  () => call({
    request: {
      ...request,
      patches: [...request.patches.slice(0, 3), { ...request.patches[0] }],
    },
  }),
  /unique/,
);
assert.throws(
  () => call({ prepass: { ...prepass, rootSurface: [10, Number.NaN, 20] } }),
  /root surface/,
);
assert.throws(
  () => call({ normalization: { ...normalization, scale: 0 } }),
  /normalization scale/,
);
assert.throws(
  () => call({ contactPlaneY: Number.NaN }),
  /contact plane/,
);

process.stdout.write('lirm motion-contact probe adapter contracts passed\n');
