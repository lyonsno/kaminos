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
      jacobian: new Float64Array(sampleCount).fill(1),
      gradient: new Float64Array(sampleCount * 2),
      tangentU: new Float64Array(Array.from({ length: sampleCount }, () => [1, 0, 0]).flat()),
      tangentV: new Float64Array(Array.from({ length: sampleCount }, () => [0, 0, 1]).flat()),
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
  2, 3.1, 4,
  2.5, 3.2, 4,
  2, 3.3, 4.25,
  2.5, 3.4, 4.25,
]);
assert.deepEqual(Array.from(first.macro.mappedDepth), [0.4, 0.3, 0.2, 0.1]);
assert.deepEqual(Array.from(first.macro.mappedMomentumU), [0.04, 0.03, 0.02, 0.01]);
assert.deepEqual(Array.from(first.macro.mappedMomentumV), [0.01, 0.02, 0.03, 0.04]);
assert.deepEqual(Array.from(first.macro.materialMasses.temperature), [0.4, 0.3, 0.2, 0.1]);
assert.equal(first.supportGeometry.geometryId, 'analytic-saddle-to-world-v1:terrain-1');
assert.deepEqual(first.dirtyRegions, [{ x: 0, y: 0, width: 2, height: 2 }]);
assert.equal(Object.hasOwn(first, 'camera'), false);
assert.equal(Object.hasOwn(first, 'projection'), false);

first.macro.mappedDepth[0] = 999;
first.supportGeometry.worldPosition[0] = 999;
const independentRead = handle.read();
assert.equal(independentRead.macro.mappedDepth[0], 0.4, 'a consumer cannot mutate producer state through a read snapshot');
assert.equal(independentRead.supportGeometry.worldPosition[0], 2, 'a consumer cannot mutate producer support through a read snapshot');

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
