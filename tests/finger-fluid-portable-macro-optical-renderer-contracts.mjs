import assert from 'node:assert/strict';

import * as renderer from '../finger-fluid-portable-macro-optical-renderer.js';

const snapshot = {
  schema: 'kaminos.finger-fluid.portable-macro-upload-snapshot.v1',
  geometryIdentity: 'hill-geometry-a',
  terrainId: 'hill-a',
  sourceHandleId: 'hill-source-a',
  source: {
    requested: 'hill/live',
    effective: 'hill/live',
    producerId: 'hill',
    producerRevision: 'hill-revision-a',
  },
  producerRevision: 'runtime-a',
  fluidEpoch: 7,
  terrainEpoch: 3,
  width: 3,
  height: 3,
  sampleCount: 9,
  worldMetersPerUnit: 2,
  physicalMaterial: {
    densityKgM3: 998.2,
    dynamicViscosityPaS: 0.001,
    absorptionPerMeter: [0.18, 0.055, 0.025],
  },
  mappedDepth: new Float64Array([
    0, 0.3, 0,
    0.25, 0.8, 0.4,
    0, 0.35, 0,
  ]),
  mappedMomentumU: new Float64Array(9),
  mappedMomentumV: new Float64Array(9),
  materialMasses: {
    water: new Float64Array(9).fill(1),
  },
  supportPosition: new Float64Array([
    -1, 0, -1, 0, 0, -1, 1, 0, -1,
    -1, 0, 0, 0, 0, 0, 1, 0, 0,
    -1, 0, 1, 0, 0, 1, 1, 0, 1,
  ]),
  tangentU: new Float64Array([
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]),
  tangentV: new Float64Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]),
  normal: new Float64Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]),
  jacobian: new Float64Array(9).fill(1),
  supportVelocity: new Float64Array(27),
  confidence: 1,
  dirtyRegions: [],
};

const expectedIdentity = {
  geometryIdentity: 'hill-geometry-a',
  terrainId: 'hill-a',
  sourceHandleId: 'hill-source-a',
  source: {
    requested: 'hill/live',
    effective: 'hill/live',
    producerId: 'hill',
    producerRevision: 'hill-revision-a',
  },
  producerRevision: 'runtime-a',
  terrainEpoch: 3,
  fluidEpoch: 7,
};

const hostFrame = {
  frameId: 'hill-camera-frame-a',
  width: 1280,
  height: 720,
  camera: {
    view: new Float32Array(16).fill(0).map((_, index) => (
      index % 5 === 0 ? 1 : 0
    )),
    viewProjection: new Float32Array(16).fill(0).map((_, index) => (
      index % 5 === 0 ? 1 : 0
    )),
    inverseViewProjection: new Float32Array(16).fill(0).map((_, index) => (
      index % 5 === 0 ? 1 : 0
    )),
    positionWorld: [0, 4, 6],
    nearMeters: 0.1,
    farMeters: 2000,
  },
  sceneColor: {
    authority: 'host_live_frame',
    attachmentId: 'scene-color-a',
    frameId: 'hill-camera-frame-a',
    width: 1280,
    height: 720,
    format: 'rgba16float',
    colorSpace: 'linear_hdr',
  },
  sceneDepth: {
    authority: 'host_live_frame',
    attachmentId: 'scene-depth-a',
    frameId: 'hill-camera-frame-a',
    width: 1280,
    height: 720,
    format: 'r32float',
    encoding: 'linear_view_depth_meters',
  },
  environment: {
    authority: 'host_live_frame',
    attachmentId: 'environment-a',
    frameId: 'hill-camera-frame-a',
    width: 1024,
    height: 512,
    format: 'rgba16float',
    mapping: 'equirectangular_world_radiance',
  },
  target: {
    authority: 'host_live_frame',
    attachmentId: 'target-a',
    frameId: 'hill-camera-frame-a',
    width: 1280,
    height: 720,
    format: 'bgra8unorm',
  },
};

assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA,
  'kaminos.finger-fluid.portable-macro-optical-renderer.v0',
);
assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
  'kaminos/finger-fluid/portable-macro-screen-space-optics-v0',
);
assert.equal(
  typeof renderer.createFingerFluidPortableMacroOpticalRenderPlan,
  'function',
);
assert.equal(
  typeof renderer.createWebGPUFingerFluidPortableMacroOpticalRenderer,
  'function',
);

const plan = renderer.createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot,
  expectedIdentity,
  hostFrame,
});

assert.equal(plan.schema, renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA);
assert.deepEqual(plan.route, {
  requested: renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
  effective: renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
  fallback: null,
});
assert.equal(plan.source.geometryIdentity, expectedIdentity.geometryIdentity);
assert.equal(plan.source.sourceHandleId, expectedIdentity.sourceHandleId);
assert.deepEqual(plan.source.terrain, expectedIdentity.source);
assert.equal(plan.source.terrainEpoch, expectedIdentity.terrainEpoch);
assert.equal(plan.source.fluidEpoch, expectedIdentity.fluidEpoch);
assert.equal(plan.host.frameId, hostFrame.frameId);
assert.equal(plan.host.sceneColor.colorSpace, 'linear_hdr');
assert.equal(plan.host.sceneDepth.encoding, 'linear_view_depth_meters');
assert.equal(plan.host.environment.mapping, 'equirectangular_world_radiance');
assert.equal(plan.vertexStrideFloats, 12);
assert.equal(plan.vertexCount, snapshot.sampleCount);
assert.equal(plan.vertices.length, snapshot.sampleCount * plan.vertexStrideFloats);
assert.equal(plan.indexCount, 24);
assert.equal(plan.indices.length, plan.indexCount);
assert.equal(plan.wetSampleCount, 5);
assert.ok(plan.drawableWetTriangleCount > 0);
assert.equal(plan.blank, false);
assert.equal(plan.partial, false);
assert.deepEqual(plan.absorptionPerMeter, snapshot.physicalMaterial.absorptionPerMeter);
assert.ok(
  Array.from(
    plan.vertices.slice(
      4 * plan.vertexStrideFloats,
      4 * plan.vertexStrideFloats + 3,
    ),
  ).every((value, index) => Math.abs(value - [0, 0.4, 0][index]) < 1e-6),
  'mapped depth is converted through Jacobian and world scale into the surface position',
);
assert.ok(
  Math.abs(plan.vertices[4 * plan.vertexStrideFloats + 6] - 0.8) < 1e-6,
  'physical depth in meters remains available to the optical shader',
);
assert.doesNotThrow(
  () => renderer.createFingerFluidPortableMacroOpticalRenderPlan({
    snapshot: {
      ...snapshot,
      physicalMaterial: {
        ...snapshot.physicalMaterial,
        dynamicViscosityPaS: null,
      },
    },
    expectedIdentity,
    hostFrame,
  }),
  'the optical renderer must not require optional viscosity that it does not consume',
);

function expectFailure(mutator, phase, messagePattern) {
  const candidateSnapshot = {
    ...snapshot,
    source: { ...snapshot.source },
    physicalMaterial: {
      ...snapshot.physicalMaterial,
      absorptionPerMeter: [...snapshot.physicalMaterial.absorptionPerMeter],
    },
  };
  const candidateIdentity = {
    ...expectedIdentity,
    source: { ...expectedIdentity.source },
  };
  const candidateHost = {
    ...hostFrame,
    camera: { ...hostFrame.camera },
    sceneColor: { ...hostFrame.sceneColor },
    sceneDepth: { ...hostFrame.sceneDepth },
    environment: { ...hostFrame.environment },
    target: { ...hostFrame.target },
  };
  mutator({
    snapshot: candidateSnapshot,
    expectedIdentity: candidateIdentity,
    hostFrame: candidateHost,
  });
  assert.throws(
    () => renderer.createFingerFluidPortableMacroOpticalRenderPlan({
      snapshot: candidateSnapshot,
      expectedIdentity: candidateIdentity,
      hostFrame: candidateHost,
    }),
    (error) => {
      assert.match(error.message, messagePattern);
      assert.equal(
        error.report.schema,
        'kaminos.finger-fluid.portable-macro-optical-renderer-failure.v0',
      );
      assert.equal(error.report.failurePhase, phase);
      assert.equal(error.report.primaryOutputWritten, false);
      assert.ok(error.report.lastTrustworthyEvidence);
      return true;
    },
  );
}

expectFailure(
  ({ expectedIdentity: identity }) => {
    identity.terrainEpoch = 4;
  },
  'validate-source-identity',
  /terrain epoch/i,
);
expectFailure(
  ({ snapshot: candidate }) => {
    candidate.source.effective = 'fallback/source';
    candidate.source.fallbackStatus = 'legacy_preview';
  },
  'validate-source-identity',
  /terrain source.*stale|substituted|fallback/i,
);
expectFailure(
  ({ snapshot: candidate }) => {
    candidate.normal = new Float64Array(3);
  },
  'validate-source-geometry',
  /normal/i,
);
expectFailure(
  ({ snapshot: candidate }) => {
    candidate.confidence = Number.NaN;
  },
  'validate-source-geometry',
  /confidence/i,
);
expectFailure(
  ({ snapshot: candidate }) => {
    candidate.mappedDepth = new Float64Array(9);
  },
  'build-surface-mesh',
  /blank/i,
);
expectFailure(
  ({ snapshot: candidate }) => {
    candidate.supportPosition = new Float64Array(candidate.sampleCount * 3);
  },
  'build-surface-mesh',
  /degenerate|drawable/i,
);
expectFailure(
  ({ hostFrame: host }) => {
    host.camera.view = new Float32Array(15);
  },
  'validate-host-attachments',
  /camera view/i,
);
expectFailure(
  ({ hostFrame: host }) => {
    host.sceneDepth.frameId = 'stale-frame';
  },
  'validate-host-attachments',
  /scene depth.*frame/i,
);
expectFailure(
  ({ hostFrame: host }) => {
    host.sceneColor.authority = 'fallback';
  },
  'validate-host-attachments',
  /scene color.*authority/i,
);
expectFailure(
  ({ hostFrame: host }) => {
    delete host.environment;
  },
  'validate-host-attachments',
  /environment/i,
);
expectFailure(
  ({ hostFrame: host }) => {
    host.target.height = 719;
  },
  'validate-host-attachments',
  /target.*extent/i,
);
assert.throws(
  () => renderer.createFingerFluidPortableMacroOpticalRenderPlan({
    snapshot,
    expectedIdentity,
    hostFrame,
    requestedRoute: 'bad/route',
  }),
  error => (
    error.report.requestedRoute === 'bad/route'
    && error.report.effectiveRoute === null
  ),
  'unsupported route evidence must preserve the exact caller request',
);

const attachmentView = Object.freeze({});
const validAttachments = {
  target: { ...hostFrame.target, view: attachmentView },
  sceneColor: { ...hostFrame.sceneColor, view: attachmentView },
  sceneDepth: { ...hostFrame.sceneDepth, view: attachmentView },
  environment: { ...hostFrame.environment, view: attachmentView },
};
assert.doesNotThrow(
  () => renderer.validateFingerFluidPortableMacroOpticalRenderAttachments({
    plan,
    ...validAttachments,
  }),
);
assert.throws(
  () => renderer.validateFingerFluidPortableMacroOpticalRenderAttachments({
    plan,
    ...validAttachments,
    sceneDepth: {
      ...validAttachments.sceneDepth,
      frameId: 'stale-frame',
    },
  }),
  /scene depth.*stale|scene depth.*substituted/i,
  'frame-B GPU resources must fail before rendering under a frame-A plan',
);
assert.throws(
  () => renderer.validateFingerFluidPortableMacroOpticalRenderAttachments({
    plan,
    ...validAttachments,
    pipelineFormat: 'rgba8unorm',
  }),
  error => (
    error.report.failurePhase === 'validate-pipeline-target-format'
    && /target.*pipeline.*format/i.test(error.message)
    && error.report.primaryOutputWritten === false
  ),
  'target format must match the renderer pipeline before command encoding',
);

console.log('finger fluid portable macro optical renderer contracts passed');
