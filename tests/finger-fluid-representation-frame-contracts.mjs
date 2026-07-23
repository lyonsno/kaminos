import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const webgpuCore = await import(`${root}/finger-fluid-webgpu-core.js`);

assert.equal(
  typeof webgpuCore.validateFingerFluidOpticalRepresentationFrame,
  'function',
  'the optical renderer must expose a source-honest FluidRepresentationFrame consumer',
);

const canonicalFrame = {
  schema: 'kaminos.fluid-representation-frame.v1',
  requestedRoute: 'kaminos-fluid-representation-frame-v1',
  effectiveRoute: 'kaminos-fluid-representation-frame-v1',
  fallbackReason: null,
  sourceRevision: 'test-source-revision',
  fluidEpoch: 41,
  terrainEpoch: 17,
  physicalMetersPerWorldUnit: 2,
  cameraIndependent: true,
  residencyAuthority: 'simulation-physical-event-hysteresis-v1',
  completeness: 'complete',
  confidence: 0.9,
  representations: {
    macro: { available: true, source: 'macro-surface-depth-state' },
    local: { available: true, source: 'pbf-particle-interface-buffers' },
    parcel: { available: false, source: null },
  },
};

const expectedIdentity = {
  sourceRevision: canonicalFrame.sourceRevision,
  fluidEpoch: canonicalFrame.fluidEpoch,
  terrainEpoch: canonicalFrame.terrainEpoch,
};
const accepted = webgpuCore.validateFingerFluidOpticalRepresentationFrame(canonicalFrame, expectedIdentity);
assert.equal(accepted.schema, canonicalFrame.schema);
assert.equal(accepted.requestedRoute, accepted.effectiveRoute);
assert.deepEqual(accepted.availableRepresentations, ['macro', 'local']);

assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(canonicalFrame),
  /expected.*identity/i,
  'optics must not accept a frame when the caller cannot bind its revision and epochs',
);
assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(canonicalFrame, {
    ...expectedIdentity,
    sourceRevision: '   ',
  }),
  /expected.*identity/i,
  'a whitespace-only expected producer revision is blank identity',
);
assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(
    { ...canonicalFrame, fluidEpoch: canonicalFrame.fluidEpoch - 1 },
    expectedIdentity,
  ),
  /stale.*fluid epoch/i,
  'a complete frame from a stale fluid epoch must fail before optical rendering',
);
assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(
    { ...canonicalFrame, sourceRevision: 'substituted-source-revision' },
    expectedIdentity,
  ),
  /source revision disagreement/i,
  'a substituted producer revision must fail even when the frame is otherwise complete',
);
assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(
    { ...canonicalFrame, sourceRevision: '   ' },
    expectedIdentity,
  ),
  /source revision.*missing/i,
  'a whitespace-only observed producer revision is blank identity',
);
assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(
    { ...canonicalFrame, terrainEpoch: canonicalFrame.terrainEpoch - 1 },
    expectedIdentity,
  ),
  /stale.*terrain epoch/i,
  'a complete frame from a stale terrain epoch must fail before optical rendering',
);

for (const [label, mutate, pattern] of [
  [
    'fallback route',
    (frame) => ({ ...frame, fallbackReason: 'local-debug-provider' }),
    /fallback/i,
  ],
  [
    'missing fallback identity',
    (frame) => {
      const { fallbackReason: _fallbackReason, ...withoutFallbackIdentity } = frame;
      return withoutFallbackIdentity;
    },
    /fallback/i,
  ],
  [
    'substituted effective route',
    (frame) => ({ ...frame, effectiveRoute: 'legacy-particle-only' }),
    /route/i,
  ],
  [
    'partial frame',
    (frame) => ({ ...frame, completeness: 'partial' }),
    /complete/i,
  ],
  [
    'camera-owned residency',
    (frame) => ({ ...frame, residencyAuthority: 'camera-screen-tiles' }),
    /residency/i,
  ],
  [
    'missing physical scale',
    (frame) => ({ ...frame, physicalMetersPerWorldUnit: 0 }),
    /physical scale/i,
  ],
  [
    'invalid confidence',
    (frame) => ({ ...frame, confidence: 1.1 }),
    /confidence/i,
  ],
  [
    'available representation without source identity',
    (frame) => ({
      ...frame,
      representations: {
        ...frame.representations,
        macro: { available: true, source: '' },
      },
    }),
    /source/i,
  ],
  [
    'available representation with whitespace-only source identity',
    (frame) => ({
      ...frame,
      representations: {
        ...frame.representations,
        macro: { available: true, source: '   ' },
      },
    }),
    /source/i,
  ],
  [
    'blank representation set',
    (frame) => ({
      ...frame,
      representations: {
        macro: { available: false, source: null },
        local: { available: false, source: null },
        parcel: { available: false, source: null },
      },
    }),
    /representation/i,
  ],
]) {
  assert.throws(
    () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(mutate(canonicalFrame), expectedIdentity),
    pattern,
    `${label} must fail before optical rendering`,
  );
}

console.log('finger fluid representation frame contracts passed');
