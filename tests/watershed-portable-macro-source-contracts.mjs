import assert from 'node:assert/strict';

import { createTerrainFluidFrame } from '@kaminos/fluid-contracts';
import {
  PORTABLE_MACRO_SOURCE_CAPABILITY,
  PORTABLE_MACRO_SOURCE_ROUTE,
  PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA,
  createKaminosFluidRuntime,
  validatePortableMacroSourceHandle,
  validatePortableMacroSourceSnapshot,
} from '@kaminos/fluid-webgpu';

function makeAnalyticTerrain({
  priorEpoch = 0,
  currentEpoch = 1,
  motionClass = 'stable',
  bedHeight = [0.1, 0.2, 0.3, 0.4],
  jacobian = [1, 1, 1, 1],
} = {}) {
  const width = 2;
  const height = 2;
  const sampleCount = width * height;
  return createTerrainFluidFrame({
    requestedRoute: 'kaminos/test/analytic-saddle-terrain',
    effectiveRoute: 'kaminos/test/analytic-saddle-terrain',
    producerId: 'analytic-saddle-producer',
    producerRevision: `analytic-saddle-${currentEpoch}`,
    requestedSourceId: 'analytic-saddle-live',
    effectiveSourceId: 'analytic-saddle-live',
    worldMetersPerUnit: 1,
    gravity: [0, -9.81, 0],
    terrainId: 'analytic-saddle',
    supportClass: 'heightfield',
    transformId: 'analytic-saddle-to-world-v1',
    priorEpoch,
    currentEpoch,
    motionClass,
    grid: {
      width,
      height,
      spacing: [0.5, 0.25],
      origin: [2, 3, 4],
    },
    fields: {
      bedHeight: Float64Array.from(bedHeight),
      worldPosition: new Float64Array([
        10, 11, 12,
        13, 14, 15,
        16, 17, 18,
        19, 20, 21,
      ]),
      jacobian: Float64Array.from(jacobian),
      gradient: new Float64Array(sampleCount * 2),
      tangentU: new Float64Array(jacobian.flatMap(value => [Math.sqrt(value), 0, 0])),
      tangentV: new Float64Array(jacobian.flatMap(value => [0, 0, Math.sqrt(value)])),
      normal: new Float64Array(Array.from({ length: sampleCount }, () => [0, 1, 0]).flat()),
      supportVelocity: new Float64Array(sampleCount * 3),
      valid: new Uint8Array(sampleCount).fill(1),
    },
    dirtyRegions: [{ x: 0, y: 0, width, height }],
    complete: true,
  });
}

const terrain = makeAnalyticTerrain();
const runtime = createKaminosFluidRuntime({
  terrainFrame: terrain,
  depth: new Float64Array([0.4, 0.3, 0.2, 0.1]),
  momentumU: new Float64Array([0.04, 0.03, 0.02, 0.01]),
  momentumV: new Float64Array([0.01, 0.02, 0.03, 0.04]),
  materialMasses: {
    temperature: new Float64Array([0.4, 0.3, 0.2, 0.1]),
  },
  producerRevision: 'portable-source-test-revision',
});

const handle = runtime.retainPortableMacroSource({
  sourceHandleId: 'analytic-saddle-source-handle-1',
  requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
  effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
});
assert.equal(validatePortableMacroSourceHandle(handle), handle);
assert.equal(Object.isFrozen(handle), true, 'the consumer handle cannot have its methods or descriptor replaced');
assert.equal(Object.isFrozen(handle.descriptor), true, 'the source descriptor is immutable');
assert.equal(handle.descriptor.capability, PORTABLE_MACRO_SOURCE_CAPABILITY);
assert.deepEqual(handle.descriptor.route, {
  requested: PORTABLE_MACRO_SOURCE_ROUTE,
  effective: PORTABLE_MACRO_SOURCE_ROUTE,
});
assert.deepEqual(handle.descriptor.representationRoute, {
  requested: 'kaminos/fluid/representation-frame',
  effective: 'kaminos/fluid/representation-frame',
});
assert.equal(handle.descriptor.sourceAuthority, 'live_runtime');
assert.equal(handle.descriptor.fallbackStatus, 'none');
assert.equal(handle.descriptor.ownershipIdentity, 'macro-local-parcel-exclusive-v1');
assert.equal(handle.descriptor.supportGeometry.transformId, terrain.transformId);
assert.equal(handle.descriptor.supportGeometry.worldMetersPerUnit, 1);
assert.equal(handle.descriptor.supportGeometry.sampleCount, 4);
assert.deepEqual(handle.descriptor.wetBoundary, {
  schema: 'kaminos.fluid.macro-wet-boundary.v1',
  route: {
    requested: 'kaminos/fluid/macro-wet-boundary',
    effective: 'kaminos/fluid/macro-wet-boundary',
  },
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  effectiveDryDepthMeters: 1e-8,
  effectiveWetActivationDepthMeters: 2e-8,
  hysteresis: 'schmitt-trigger-v1',
});
assert.equal(handle.descriptor.lifetime.releasePolicy, 'explicit-release-v1');
assert.doesNotMatch(
  JSON.stringify(handle.descriptor),
  /hill|lerms|camera|projection|viewport|screenSpace/i,
  'the portable producer descriptor cannot acquire world-specific or optical authority',
);

const first = handle.read({
  minimumTerrainEpoch: 1,
  minimumFluidEpoch: 0,
});
assert.equal(validatePortableMacroSourceSnapshot(first, {
  expectedSourceHandleId: handle.descriptor.sourceHandleId,
  minimumTerrainEpoch: 1,
  minimumFluidEpoch: 0,
}), first);
assert.equal(first.schema, PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA);
assert.equal(first.terrainEpoch, 1);
assert.equal(first.fluidEpoch, 0);
assert.deepEqual(Array.from(first.supportGeometry.worldPosition), [
  10, 11, 12,
  13, 14, 15,
  16, 17, 18,
  19, 20, 21,
]);
assert.deepEqual(Array.from(first.macro.mappedDepth), [0.4, 0.3, 0.2, 0.1]);
assert.deepEqual(Array.from(first.macro.mappedMomentumU), [0.04, 0.03, 0.02, 0.01]);
assert.deepEqual(Array.from(first.macro.mappedMomentumV), [0.01, 0.02, 0.03, 0.04]);
assert.deepEqual(Array.from(first.macro.materialMasses.temperature), [0.4, 0.3, 0.2, 0.1]);
assert.equal(first.supportGeometry.geometryId, 'analytic-saddle-to-world-v1:terrain-1');
assert.deepEqual(first.dirtyRegions, [{ x: 0, y: 0, width: 2, height: 2 }]);
assert.equal(Object.hasOwn(first, 'camera'), false);
assert.equal(Object.hasOwn(first, 'projection'), false);

const boundaryTerrain = makeAnalyticTerrain();
const boundaryRuntime = createKaminosFluidRuntime({
  terrainFrame: boundaryTerrain,
  depth: new Float64Array([0.4, 0, 3e-8, 0]),
  producerRevision: 'portable-boundary-test-revision',
  dryDepthThresholdMeters: 1e-8,
  wetActivationDepthThresholdMeters: 2e-8,
});
const boundaryHandle = boundaryRuntime.retainPortableMacroSource({
  sourceHandleId: 'analytic-boundary-source-handle-1',
});
const boundaryFirst = boundaryHandle.read();
assert.equal(boundaryFirst.wetBoundary.schema, 'kaminos.fluid.macro-wet-boundary.v1');
assert.deepEqual(boundaryFirst.wetBoundary.route, {
  requested: 'kaminos/fluid/macro-wet-boundary',
  effective: 'kaminos/fluid/macro-wet-boundary',
});
assert.equal(boundaryFirst.wetBoundary.sourceAuthority, 'live_runtime');
assert.equal(boundaryFirst.wetBoundary.fallbackStatus, 'none');
assert.equal(boundaryFirst.wetBoundary.effectiveDryDepthMeters, 1e-8);
assert.equal(boundaryFirst.wetBoundary.effectiveWetActivationDepthMeters, 2e-8);
assert.deepEqual(Array.from(boundaryFirst.wetBoundary.physicalDepthMeters), [0.4, 0, 3e-8, 0]);
assert.ok(
  Array.from(boundaryFirst.wetBoundary.signedDryMarginMeters)
    .every((value, index) => Math.abs(value - [0.4 - 1e-8, -1e-8, 2e-8, -1e-8][index]) <= 1e-15),
  'signed dry margins retain physical-meter threshold arithmetic',
);
assert.deepEqual(Array.from(boundaryFirst.wetBoundary.wetState), [1, 0, 1, 0]);
assert.deepEqual(Array.from(boundaryFirst.wetBoundary.cells.stableId), [0]);
assert.deepEqual(Array.from(boundaryFirst.wetBoundary.cells.activeState), [1]);
assert.deepEqual(Array.from(boundaryFirst.wetBoundary.cells.generation), [0]);
assert.equal(boundaryFirst.wetBoundary.cells.indexing, 'row-major-quad-v1');
assert.equal(boundaryFirst.wetBoundary.boundaryGeneration, 0);
assert.equal(
  boundaryFirst.wetBoundary.boundaryId,
  `${boundaryFirst.supportGeometry.topologyId}:boundary:0`,
);
assert.deepEqual(boundaryFirst.wetBoundary.reset, {
  generation: 0,
  id: `${boundaryFirst.supportGeometry.topologyId}:reset:0:0->1:initial:initial`,
  kind: 'initial',
  previousTerrainEpoch: 0,
  terrainEpoch: 1,
  remapReceiptId: null,
  shockId: null,
  boundaryGeneration: 0,
  discontinuous: true,
});

const boundaryTerrainRemapped = makeAnalyticTerrain({
  priorEpoch: 1,
  currentEpoch: 2,
  motionClass: 'ordinary_morph',
  jacobian: [1, 1, 2, 1],
});
const boundaryRemapReceipt = boundaryRuntime.updateTerrain({
  terrainFrame: boundaryTerrainRemapped,
  mode: 'ordinary_morph',
});
const boundaryRemapped = boundaryHandle.read({ minimumTerrainEpoch: 2 });
assert.equal(boundaryRemapped.wetBoundary.physicalDepthMeters[2], 1.5e-8);
assert.equal(
  boundaryRemapped.wetBoundary.wetState[2],
  1,
  'a producer-activated sample remains wet inside the hysteresis band',
);
assert.equal(boundaryRemapped.wetBoundary.reset.generation, 1);
assert.equal(boundaryRemapped.wetBoundary.reset.kind, 'ordinary_morph');
assert.equal(boundaryRemapped.wetBoundary.reset.previousTerrainEpoch, 1);
assert.equal(boundaryRemapped.wetBoundary.reset.terrainEpoch, 2);
assert.equal(boundaryRemapped.wetBoundary.reset.remapReceiptId, boundaryRemapReceipt.receiptId);
assert.equal(
  boundaryRemapped.wetBoundary.reset.boundaryGeneration,
  boundaryRemapped.wetBoundary.boundaryGeneration,
);
assert.equal(boundaryRemapped.wetBoundary.reset.discontinuous, true);
assert.equal(boundaryRemapped.wetBoundary.terrainEpoch, 2);
assert.equal(boundaryRemapped.wetBoundary.fluidEpoch, boundaryRemapped.fluidEpoch);
assert.ok(
  boundaryRemapped.wetBoundary.cells.generation[0] > boundaryFirst.wetBoundary.cells.generation[0],
  'terrain remap resets active-boundary identity even when the wet mask survives hysteresis',
);
assert.throws(
  () => validatePortableMacroSourceSnapshot({
    ...boundaryRemapped,
    wetBoundary: {
      ...boundaryRemapped.wetBoundary,
      reset: { ...boundaryFirst.wetBoundary.reset },
      boundaryGeneration: boundaryFirst.wetBoundary.boundaryGeneration,
      boundaryId: boundaryFirst.wetBoundary.boundaryId,
      cells: {
        ...boundaryRemapped.wetBoundary.cells,
        generation: Uint32Array.from(boundaryFirst.wetBoundary.cells.generation),
      },
    },
  }),
  /wet boundary terrain transition identity mismatch/,
  'a current terrain epoch cannot validate with pre-remap reset and generation identity',
);

for (const [label, mutation, pattern] of [
  [
    'missing boundary state',
    snapshot => ({ ...snapshot, wetBoundary: undefined }),
    /wet boundary descriptor is required/,
  ],
  [
    'missing physical threshold',
    snapshot => ({
      ...snapshot,
      wetBoundary: { ...snapshot.wetBoundary, effectiveDryDepthMeters: undefined },
    }),
    /effectiveDryDepthMeters must be finite/,
  ],
  [
    'wet mask below dry threshold',
    snapshot => ({
      ...snapshot,
      wetBoundary: {
        ...snapshot.wetBoundary,
        wetState: Uint8Array.from(snapshot.wetBoundary.wetState, (value, index) => index === 3 ? 1 : value),
      },
    }),
    /wetState\[3\].*dry threshold/,
  ],
  [
    'dry mask above activation threshold',
    snapshot => ({
      ...snapshot,
      wetBoundary: {
        ...snapshot.wetBoundary,
        wetState: Uint8Array.from(snapshot.wetBoundary.wetState, (value, index) => index === 0 ? 0 : value),
      },
    }),
    /wetState\[0\].*activation threshold/,
  ],
  [
    'stale boundary epoch',
    snapshot => ({
      ...snapshot,
      wetBoundary: { ...snapshot.wetBoundary, terrainEpoch: snapshot.terrainEpoch - 1 },
    }),
    /wet boundary terrain epoch mismatch/,
  ],
  [
    'fallback boundary route',
    snapshot => ({
      ...snapshot,
      wetBoundary: {
        ...snapshot.wetBoundary,
        route: {
          requested: snapshot.wetBoundary.route.requested,
          effective: 'fixture/macro-wet-boundary',
        },
        fallbackStatus: 'fallback',
      },
    }),
    /wet boundary effective route mismatch|wet boundary fallback/,
  ],
  [
    'partial cell identity',
    snapshot => ({
      ...snapshot,
      wetBoundary: {
        ...snapshot.wetBoundary,
        cells: {
          ...snapshot.wetBoundary.cells,
          stableId: new Uint32Array(0),
        },
      },
    }),
    /wetBoundary\.cells\.stableId length/,
  ],
  [
    'missing reset identity',
    snapshot => ({
      ...snapshot,
      wetBoundary: {
        ...snapshot.wetBoundary,
        reset: { ...snapshot.wetBoundary.reset, id: '' },
      },
    }),
    /wetBoundary\.reset\.id must be a non-empty string/,
  ],
]) {
  assert.throws(
    () => validatePortableMacroSourceSnapshot(mutation(boundaryRemapped)),
    pattern,
    `${label} cannot validate as complete producer boundary truth`,
  );
}

first.macro.mappedDepth[0] = 999;
first.supportGeometry.worldPosition[0] = 999;
const independentRead = handle.read();
assert.equal(independentRead.macro.mappedDepth[0], 0.4, 'a consumer cannot mutate producer state through a read snapshot');
assert.equal(independentRead.supportGeometry.worldPosition[0], 10, 'a consumer cannot mutate producer support through a read snapshot');

const changedSameEpochSupport = {
  ...terrain,
  fields: {
    ...terrain.fields,
    worldPosition: Float64Array.from(terrain.fields.worldPosition),
  },
};
changedSameEpochSupport.fields.worldPosition[0] += 1;
assert.throws(
  () => runtime.step({ terrainFrame: changedSameEpochSupport, deltaSeconds: 1 / 240 }),
  /same-epoch terrain frame .* changed/,
  'absolute support positions cannot change without a new terrain epoch',
);

runtime.step({ terrainFrame: terrain, deltaSeconds: 1 / 240 });
const advanced = handle.read({ minimumFluidEpoch: 1 });
assert.equal(advanced.fluidEpoch, 1, 'one retained source handle follows the committed live fluid epoch');
assert.equal(advanced.terrainEpoch, 1);

assert.throws(
  () => handle.read({ minimumTerrainEpoch: 2 }),
  error => {
    assert.match(error.message, /stale terrain epoch/);
    assert.equal(error.report.status, 'failed');
    assert.equal(error.report.phase, 'read-live-source');
    assert.equal(error.report.sourceHandleId, 'analytic-saddle-source-handle-1');
    assert.equal(error.report.lastTrustworthyEvidence, 'descriptor-validated');
    return true;
  },
  'a stale source read fails with a report instead of returning authoritative-looking old data',
);

assert.throws(
  () => validatePortableMacroSourceSnapshot({
    ...advanced,
    supportGeometry: { ...advanced.supportGeometry, worldPosition: undefined },
  }),
  /supportGeometry\.worldPosition must be a typed array/,
  'a partial support source cannot validate',
);
assert.throws(
  () => validatePortableMacroSourceSnapshot({
    ...advanced,
    camera: { position: [0, 0, 0] },
  }),
  /camera-owned state/,
  'camera state cannot contaminate producer source truth',
);
assert.throws(
  () => validatePortableMacroSourceSnapshot({
    ...advanced,
    sourceAuthority: 'cached_fixture',
    fallbackStatus: 'fallback',
    producer: {
      revision: 'forged',
      runtimeRoute: 'fixture/runtime',
      method: 'fixture-method',
    },
  }),
  /source authority|fallback|runtime route/,
  'a forged fallback snapshot cannot validate as live producer truth',
);
assert.throws(
  () => validatePortableMacroSourceSnapshot({
    ...advanced,
    source: {
      ...advanced.source,
      effective: 'cached-analytic-saddle',
    },
  }),
  /effective source mismatch/,
  'a fallback terrain source cannot hide behind the portable source route',
);
assert.throws(
  () => validatePortableMacroSourceHandle(Object.freeze({
    descriptor: { ...handle.descriptor },
    read: handle.read,
    release: handle.release,
  })),
  /descriptor must be immutable/,
  'a mutable descriptor substitution cannot impersonate the retained source handle',
);
assert.throws(
  () => validatePortableMacroSourceHandle(Object.freeze({ descriptor: handle.descriptor })),
  /read function/,
  'a partial source handle cannot validate',
);

const terrainWithoutWorldPosition = makeAnalyticTerrain();
delete terrainWithoutWorldPosition.fields.worldPosition;
const runtimeWithoutWorldPosition = createKaminosFluidRuntime({
  terrainFrame: terrainWithoutWorldPosition,
  depth: new Float64Array(4),
  producerRevision: 'missing-support-position-test',
});
assert.throws(
  () => runtimeWithoutWorldPosition.retainPortableMacroSource({
    sourceHandleId: 'missing-world-position-handle',
  }),
  error => {
    assert.match(error.message, /explicit world-position support/);
    assert.equal(error.report.status, 'failed');
    assert.equal(error.report.phase, 'retain-source');
    return true;
  },
  'portable retention fails before output when the terrain source omits absolute support positions',
);

for (const [label, options, pattern] of [
  [
    'fallback route',
    {
      sourceHandleId: 'fallback-route-handle',
      requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      effectiveRoute: 'fixture/portable-macro-source',
    },
    /effective portable source route mismatch/,
  ],
  [
    'world-specific route',
    {
      sourceHandleId: 'world-specific-route-handle',
      requestedRoute: 'lerms/hill-of-hills/portable-source',
      effectiveRoute: 'lerms/hill-of-hills/portable-source',
    },
    /requested portable source route mismatch/,
  ],
  [
    'unsupported capability',
    {
      sourceHandleId: 'unsupported-capability-handle',
      requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      requestedCapability: 'kaminos.fluid.screen-space-water.v0',
      effectiveCapability: 'kaminos.fluid.screen-space-water.v0',
    },
    /unsupported portable source capability/,
  ],
  [
    'blank source handle',
    {
      sourceHandleId: '',
      requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
    },
    /sourceHandleId must be a non-empty string/,
  ],
  [
    'camera-owned producer state',
    {
      sourceHandleId: 'camera-contaminated-handle',
      requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      camera: { position: [0, 0, 0] },
    },
    /camera-owned state/,
  ],
  [
    'optical material metadata',
    {
      sourceHandleId: 'optical-material-metadata-handle',
      requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      physicalMaterial: {
        densityKgM3: 997,
        absorptionPerMeter: [0.05, 0.02, 0.01],
        shader: { entryPoint: 'forbidden' },
      },
    },
    /unsupported physical material field: shader/,
  ],
  [
    'mutable material metadata',
    {
      sourceHandleId: 'mutable-material-metadata-handle',
      requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
      physicalMaterial: {
        densityKgM3: 997,
        absorptionPerMeter: [0.05, 0.02, 0.01],
        lookup: new Float32Array([1]),
      },
    },
    /unsupported physical material field: lookup/,
  ],
]) {
  assert.throws(
    () => runtime.retainPortableMacroSource(options),
    error => {
      assert.match(error.message, pattern, label);
      assert.equal(error.report.status, 'failed', `${label} retains a failure report`);
      assert.equal(error.report.phase, 'retain-source', `${label} records its failure phase`);
      assert.equal(error.report.lastTrustworthyEvidence, 'runtime-identity-validated');
      return true;
    },
    `${label} fails before a handle publishes`,
  );
}

assert.equal(handle.release(), true);
assert.equal(handle.release(), false, 'release is idempotent');
assert.deepEqual(handle.status, {
  state: 'released',
  readGeneration: 3,
});
assert.throws(
  () => handle.read(),
  error => {
    assert.match(error.message, /has been released/);
    assert.equal(error.report.phase, 'read-live-source');
    assert.equal(error.report.lastTrustworthyEvidence, 'source-handle-released');
    return true;
  },
  'released source handles cannot retain hidden access to producer state',
);

console.log('watershed portable macro source contracts passed');
