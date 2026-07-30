import assert from 'node:assert/strict';

import * as renderer from '../finger-fluid-portable-macro-optical-renderer.js';

const snapshot = {
  schema: 'kaminos.finger-fluid.portable-macro-upload-snapshot.v1',
  geometryIdentity: 'hill-geometry-a',
  terrainId: 'hill-a',
  topologyId: 'hill-topology-a',
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
  wetBoundary: {
    schema: 'kaminos.fluid.macro-wet-boundary.v1',
    route: {
      requested: 'kaminos/fluid/macro-wet-boundary',
      effective: 'kaminos/fluid/macro-wet-boundary',
    },
    sourceAuthority: 'live_runtime',
    fallbackStatus: 'none',
    terrainEpoch: 3,
    fluidEpoch: 7,
    topologyId: 'hill-topology-a',
    effectiveDryDepthMeters: 0.1,
    effectiveWetActivationDepthMeters: 0.12,
    physicalDepthMeters: new Float64Array([
      0, 0.3, 0,
      0.25, 0.8, 0.4,
      0, 0.35, 0,
    ]),
    signedDryMarginMeters: new Float64Array([
      -0.1, 0.2, -0.1,
      0.15, 0.7, 0.3,
      -0.1, 0.25, -0.1,
    ]),
    wetState: new Uint8Array([
      0, 1, 0,
      1, 1, 1,
      0, 1, 0,
    ]),
    cells: {
      indexing: 'row-major-quad-v1',
      width: 2,
      height: 2,
      stableId: new Uint32Array([0, 1, 2, 3]),
      activeState: new Uint8Array([1, 1, 1, 1]),
      generation: new Uint32Array([0, 0, 0, 0]),
    },
    boundaryGeneration: 0,
    boundaryId: 'hill-topology-a:boundary:0',
    reset: {
      generation: 0,
      id: 'hill-topology-a:reset:0:3->3:initial:initial',
      kind: 'initial',
      previousTerrainEpoch: 3,
      terrainEpoch: 3,
      remapReceiptId: null,
      shockId: null,
      boundaryGeneration: 0,
      discontinuous: true,
    },
    derivation: {
      physicalDepth: 'mappedDepth / supportGeometry.jacobian',
      signedMargin: 'physicalDepthMeters - effectiveDryDepthMeters',
      hysteresis: 'schmitt-trigger-v1',
    },
    complete: true,
  },
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

const CONTINUOUS_PATCH_ROUTE =
  'kaminos/finger-fluid/portable-macro-continuous-patch-v0';

assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA,
  'kaminos.finger-fluid.portable-macro-optical-renderer.v0',
);
assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
  'kaminos/finger-fluid/portable-macro-screen-space-optics-v0',
);
assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE,
  'kaminos/finger-fluid/portable-macro-regular-grid-debug-v0',
);
assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
  'kaminos/finger-fluid/portable-macro-wet-boundary-clipped-v0',
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
  requestedTopologyRoute:
    renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE,
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
assert.deepEqual(plan.topology.route, {
  requested: renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE,
  effective: renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE,
  fallback: null,
});
assert.equal(plan.topology.boundary, null);
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

const continuousPlan = renderer.createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot,
  expectedIdentity,
  hostFrame,
  requestedTopologyRoute: CONTINUOUS_PATCH_ROUTE,
});
assert.equal(
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_CONTINUOUS_PATCH_ROUTE,
  CONTINUOUS_PATCH_ROUTE,
);
assert.deepEqual(continuousPlan.topology.route, {
  requested: CONTINUOUS_PATCH_ROUTE,
  effective: CONTINUOUS_PATCH_ROUTE,
  fallback: null,
});
assert.equal(continuousPlan.topology.reconstruction.position, 'shared-c1-hermite-patch-v0');
assert.equal(continuousPlan.topology.reconstruction.normal, 'analytic-position-derivative-v0');
assert.equal(continuousPlan.topology.reconstruction.coverage, 'fragment-signed-wet-margin-aa-v0');
assert.equal(continuousPlan.topology.reconstruction.subdivisionsPerCell, 4);
assert.equal(continuousPlan.topology.reconstruction.stableCarrier, true);
assert.equal(continuousPlan.vertexCount, 81);
assert.equal(continuousPlan.indexCount, 384);
assert.ok(
  Array.from({ length: continuousPlan.vertexCount }, (_, index) => (
    continuousPlan.vertices[index * continuousPlan.vertexStrideFloats + 11]
  )).some(value => value < 0),
  'the stable carrier retains dry signed margin for fragment-path wet coverage',
);
assert.ok(
  Array.from({ length: continuousPlan.vertexCount }, (_, index) => (
    continuousPlan.vertices[index * continuousPlan.vertexStrideFloats + 11]
  )).some(value => value > 0),
  'the stable carrier retains wet signed margin for fragment-path wet coverage',
);
assert.ok(
  Array.from({ length: continuousPlan.vertexCount }, (_, index) => {
    const offset = index * continuousPlan.vertexStrideFloats + 3;
    return Math.abs(Math.hypot(
      continuousPlan.vertices[offset],
      continuousPlan.vertices[offset + 1],
      continuousPlan.vertices[offset + 2],
    ) - 1) < 1e-5;
  }).every(Boolean),
  'continuous patch normals are normalized analytic position derivatives',
);

const evolvedContinuousSnapshot = {
  ...snapshot,
  mappedDepth: new Float64Array([
    0, 0.42, 0,
    0.33, 0.65, 0.48,
    0, 0.28, 0,
  ]),
  wetBoundary: {
    ...snapshot.wetBoundary,
    physicalDepthMeters: new Float64Array([
      0, 0.42, 0,
      0.33, 0.65, 0.48,
      0, 0.28, 0,
    ]),
    signedDryMarginMeters: new Float64Array([
      -0.1, 0.32, -0.1,
      0.23, 0.55, 0.38,
      -0.1, 0.18, -0.1,
    ]),
  },
};
const evolvedContinuousPlan = renderer.createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot: evolvedContinuousSnapshot,
  expectedIdentity,
  hostFrame,
  requestedTopologyRoute: CONTINUOUS_PATCH_ROUTE,
});
assert.equal(evolvedContinuousPlan.vertexCount, continuousPlan.vertexCount);
assert.equal(evolvedContinuousPlan.indexCount, continuousPlan.indexCount);
assert.deepEqual(
  evolvedContinuousPlan.indices,
  continuousPlan.indices,
  'evolving wet state updates fields without rebuilding visible interior topology',
);

const clippedPlan = renderer.createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot,
  expectedIdentity,
  hostFrame,
  requestedTopologyRoute:
    renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
});

assert.deepEqual(clippedPlan.topology.route, {
  requested: renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
  effective: renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
  fallback: null,
});
assert.equal(clippedPlan.topology.boundary.id, snapshot.wetBoundary.boundaryId);
assert.equal(clippedPlan.topology.boundary.resetId, snapshot.wetBoundary.reset.id);
assert.equal(clippedPlan.topology.boundary.generation, 0);
assert.equal(clippedPlan.topology.boundary.route.requested, 'kaminos/fluid/macro-wet-boundary');
assert.equal(clippedPlan.topology.boundary.route.effective, 'kaminos/fluid/macro-wet-boundary');
assert.equal(clippedPlan.topology.boundary.fallbackStatus, 'none');
assert.equal(
  clippedPlan.topology.ambiguityResolution.route,
  'asymptotic-decider-stable-cell-v1',
);
assert.ok(clippedPlan.topology.shorelineCrossingCount > 0);
assert.ok(clippedPlan.topology.clippedCellCount > 0);
assert.equal(clippedPlan.topology.minimumOutputSignedMarginMeters, 0);
assert.ok(clippedPlan.vertexCount > 0);
assert.ok(clippedPlan.indexCount > 0);
assert.equal(clippedPlan.indexCount % 3, 0);
assert.ok(
  Array.from({ length: clippedPlan.vertexCount }, (_, index) => (
    clippedPlan.vertices[index * clippedPlan.vertexStrideFloats + 1]
  )).every(value => value >= 0.05 - 1e-6),
  'clipped shoreline geometry must never retain a dry corner below the exact dry threshold',
);
assert.ok(
  Array.from({ length: clippedPlan.vertexCount }, (_, index) => (
    clippedPlan.vertices[index * clippedPlan.vertexStrideFloats + 11]
  )).every(value => value === 1),
  'every clipped output vertex is owned by the wet optical surface',
);
assert.ok(
  Array.from({ length: clippedPlan.vertexCount }, (_, index) => {
    const offset = index * clippedPlan.vertexStrideFloats + 3;
    return Math.abs(Math.hypot(
      clippedPlan.vertices[offset],
      clippedPlan.vertices[offset + 1],
      clippedPlan.vertices[offset + 2],
    ) - 1) < 1e-5;
  }).every(Boolean),
  'clipped output normals are reconstructed and normalized',
);

const ambiguousSnapshot = {
  ...snapshot,
  width: 2,
  height: 2,
  sampleCount: 4,
  mappedDepth: new Float64Array([0.2, 0.02, 0.02, 0.2]),
  mappedMomentumU: new Float64Array(4),
  mappedMomentumV: new Float64Array(4),
  supportPosition: new Float64Array([
    -1, 0, -1, 1, 0, -1,
    -1, 0, 1, 1, 0, 1,
  ]),
  tangentU: new Float64Array([
    1, 0, 0, 1, 0, 0,
    1, 0, 0, 1, 0, 0,
  ]),
  tangentV: new Float64Array([
    0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1,
  ]),
  normal: new Float64Array([
    0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0,
  ]),
  jacobian: new Float64Array(4).fill(1),
  supportVelocity: new Float64Array(12),
  wetBoundary: {
    ...snapshot.wetBoundary,
    physicalDepthMeters: new Float64Array([0.2, 0.02, 0.02, 0.2]),
    signedDryMarginMeters: new Float64Array([0.1, -0.08, -0.08, 0.1]),
    wetState: new Uint8Array([1, 0, 0, 1]),
    cells: {
      indexing: 'row-major-quad-v1',
      width: 1,
      height: 1,
      stableId: new Uint32Array([0]),
      activeState: new Uint8Array([1]),
      generation: new Uint32Array([0]),
    },
  },
};
const ambiguousPlan = renderer.createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot: ambiguousSnapshot,
  expectedIdentity,
  hostFrame,
  requestedTopologyRoute:
    renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
});
assert.equal(ambiguousPlan.topology.ambiguityResolution.ambiguousCellCount, 1);
assert.equal(ambiguousPlan.topology.ambiguityResolution.stableCellTieBreakCount, 1);
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
    wetBoundary: {
      ...snapshot.wetBoundary,
      route: { ...snapshot.wetBoundary.route },
      cells: { ...snapshot.wetBoundary.cells },
      reset: { ...snapshot.wetBoundary.reset },
      derivation: { ...snapshot.wetBoundary.derivation },
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

function expectClippedFailure(mutator, phase, messagePattern) {
  const candidateSnapshot = {
    ...snapshot,
    source: { ...snapshot.source },
    physicalMaterial: {
      ...snapshot.physicalMaterial,
      absorptionPerMeter: [...snapshot.physicalMaterial.absorptionPerMeter],
    },
    wetBoundary: {
      ...snapshot.wetBoundary,
      route: { ...snapshot.wetBoundary.route },
      cells: { ...snapshot.wetBoundary.cells },
      reset: { ...snapshot.wetBoundary.reset },
      derivation: { ...snapshot.wetBoundary.derivation },
    },
  };
  mutator(candidateSnapshot);
  assert.throws(
    () => renderer.createFingerFluidPortableMacroOpticalRenderPlan({
      snapshot: candidateSnapshot,
      expectedIdentity,
      hostFrame,
      requestedTopologyRoute:
        renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
    }),
    (error) => {
      assert.match(error.message, messagePattern);
      assert.equal(error.report.failurePhase, phase);
      assert.equal(error.report.primaryOutputWritten, false);
      assert.equal(
        error.report.requestedTopologyRoute,
        renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
      );
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
assert.throws(
  () => renderer.createFingerFluidPortableMacroOpticalRenderPlan({
    snapshot,
    expectedIdentity,
    hostFrame,
    requestedTopologyRoute: 'bad/topology-route',
  }),
  error => (
    error.report.requestedTopologyRoute === 'bad/topology-route'
    && error.report.effectiveTopologyRoute === null
  ),
  'unsupported topology evidence must preserve the exact caller request',
);
expectClippedFailure(
  candidate => {
    delete candidate.wetBoundary;
  },
  'validate-wet-boundary',
  /wet boundary.*missing/i,
);
expectClippedFailure(
  candidate => {
    candidate.wetBoundary.terrainEpoch = 2;
  },
  'validate-wet-boundary',
  /wet boundary.*epoch/i,
);
expectClippedFailure(
  candidate => {
    candidate.wetBoundary.route.effective = 'fallback/wet-boundary';
    candidate.wetBoundary.fallbackStatus = 'legacy';
  },
  'validate-wet-boundary',
  /wet boundary.*route|fallback/i,
);
expectClippedFailure(
  candidate => {
    candidate.wetBoundary.wetState = new Uint8Array(9);
  },
  'validate-wet-boundary',
  /wet state.*margin|disagrees/i,
);
expectClippedFailure(
  candidate => {
    candidate.mappedDepth = new Float64Array(9);
    candidate.wetBoundary.physicalDepthMeters = new Float64Array(9);
    candidate.wetBoundary.signedDryMarginMeters = new Float64Array(9).fill(-0.1);
    candidate.wetBoundary.wetState = new Uint8Array(9);
    candidate.wetBoundary.cells.activeState = new Uint8Array(4);
  },
  'build-clipped-shoreline-mesh',
  /blank/i,
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

globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = {
  UNIFORM: 1,
  COPY_DST: 2,
  VERTEX: 4,
  INDEX: 8,
};
const fakeDevice = {
  createShaderModule: descriptor => descriptor,
  createBindGroupLayout: descriptor => descriptor,
  createPipelineLayout: descriptor => descriptor,
  createRenderPipeline: descriptor => descriptor,
  createBuffer: descriptor => ({ ...descriptor, destroy() {} }),
  createSampler: descriptor => descriptor,
  createBindGroup: descriptor => descriptor,
  queue: { writeBuffer() {} },
};
const fakeCommandEncoder = {
  beginRenderPass() {
    return {
      setPipeline() {},
      setBindGroup() {},
      setVertexBuffer() {},
      setIndexBuffer() {},
      drawIndexed() {},
      end() {},
    };
  },
};
const webgpuRenderer = renderer.createWebGPUFingerFluidPortableMacroOpticalRenderer({
  device: fakeDevice,
});
const clippedRenderEvidence = webgpuRenderer.render({
  plan: clippedPlan,
  commandEncoder: fakeCommandEncoder,
  ...validAttachments,
});
assert.equal(
  clippedRenderEvidence.requestedTopologyRoute,
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
);
assert.equal(
  clippedRenderEvidence.effectiveTopologyRoute,
  renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
);
assert.equal(clippedRenderEvidence.topologyFallback, null);
assert.deepEqual(clippedRenderEvidence.topology, {
  boundaryId: snapshot.wetBoundary.boundaryId,
  resetId: snapshot.wetBoundary.reset.id,
  edgeCrossingRoute: clippedPlan.topology.edgeCrossingRoute,
  shorelineCrossingCount: clippedPlan.topology.shorelineCrossingCount,
  clippedCellCount: clippedPlan.topology.clippedCellCount,
  ambiguityRoute: 'asymptotic-decider-stable-cell-v1',
  reconstruction: null,
});
assert.throws(
  () => renderer.validateFingerFluidPortableMacroOpticalRenderAttachments({
    plan: clippedPlan,
    ...validAttachments,
    sceneDepth: {
      ...validAttachments.sceneDepth,
      frameId: 'stale-frame',
    },
  }),
  error => (
    error.report.requestedTopologyRoute
      === renderer.KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE
    && error.report.effectiveTopologyRoute === null
    && error.report.primaryOutputWritten === false
  ),
  'pre-output attachment failure must preserve the exact requested clipped topology',
);
webgpuRenderer.destroy();

console.log('finger fluid portable macro optical renderer contracts passed');
