import assert from 'node:assert/strict';

import {
  KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
  PORTABLE_MACRO_SOURCE_ROUTE,
  createKaminosFluidRuntime,
} from '@kaminos/fluid-webgpu';
import {
  createTerrainFluidFrame,
} from '../node_modules/@kaminos/fluid-webgpu/node_modules/@kaminos/fluid-contracts/index.js';

const root = new URL('..', import.meta.url).pathname;
const webgpuCore = await import(`${root}/finger-fluid-webgpu-core.js`);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

assert.equal(
  typeof webgpuCore.createFingerFluidPortableMacroGeometryProvider,
  'function',
  'the optical core must expose a host-independent macro geometry provider',
);

const actualTerrain = createTerrainFluidFrame({
  requestedRoute: 'kaminos/test/analytic-saddle-terrain',
  effectiveRoute: 'kaminos/test/analytic-saddle-terrain',
  producerId: 'analytic-saddle-producer',
  producerRevision: 'analytic-saddle-7',
  requestedSourceId: 'analytic-saddle-live',
  effectiveSourceId: 'analytic-saddle-live',
  worldMetersPerUnit: 1,
  gravity: [0, -9.81, 0],
  terrainId: 'analytic-saddle',
  supportClass: 'heightfield',
  transformId: 'analytic-saddle-to-world-v1',
  priorEpoch: 6,
  currentEpoch: 7,
  motionClass: 'stable',
  grid: {
    width: 2,
    height: 2,
    spacing: [2, 3],
    origin: [10, 4, -8],
  },
  fields: {
    bedHeight: new Float64Array([0, 0, 0, 0]),
    worldPosition: new Float64Array([
      10, 4, -8,
      12, 5, -8,
      10, 4, -5,
      12, 6, -5,
    ]),
    jacobian: new Float64Array([6, 2, 1, 3]),
    gradient: new Float64Array(8),
    tangentU: new Float64Array([
      2, 0, 0,
      2, 0, 0,
      1, 0, 0,
      3, 0, 0,
    ]),
    tangentV: new Float64Array([
      0, 0, 3,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    normal: new Float64Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    supportVelocity: new Float64Array([
      0.25, 0, 0,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ]),
    valid: new Uint8Array([1, 1, 1, 1]),
  },
  dirtyRegions: [{ x: 0, y: 0, width: 2, height: 2 }],
  complete: true,
});
const actualRuntime = createKaminosFluidRuntime({
  terrainFrame: actualTerrain,
  depth: new Float64Array([0.6, 0.4, 0, 0.3]),
  momentumU: new Float64Array([0.1, 0.2, 0, 0.3]),
  momentumV: new Float64Array([0.05, 0.1, 0, 0.15]),
  materialMasses: {
    water: new Float64Array([598.2, 398.8, 0, 299.1]),
  },
  producerRevision: KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision,
});
const actualSourceHandle = actualRuntime.retainPortableMacroSource({
  sourceHandleId: 'analytic-saddle-optical-source-7-0',
  requestedRoute: PORTABLE_MACRO_SOURCE_ROUTE,
  effectiveRoute: PORTABLE_MACRO_SOURCE_ROUTE,
});
const actualProvider = webgpuCore.createFingerFluidPortableMacroGeometryProvider({
  sourceHandle: actualSourceHandle,
  expectedIdentity: {
    packageDescriptor: KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
    artifactRevision: KAMINOS_FLUID_PACKAGE_DESCRIPTOR.artifactRevision,
    producerRevision: KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision,
    fluidEpoch: actualRuntime.identity.fluidEpoch,
    terrainEpoch: actualRuntime.identity.terrainEpoch,
    source: {
      requested: 'analytic-saddle-live',
      effective: 'analytic-saddle-live',
      producerId: 'analytic-saddle-producer',
      producerRevision: 'analytic-saddle-7',
    },
  },
});
assert.equal(actualProvider.package.version, '0.3.0');
assert.equal(actualProvider.source.handleId, 'analytic-saddle-optical-source-7-0');
assert.deepEqual(actualProvider.source.terrain, {
  requested: 'analytic-saddle-live',
  effective: 'analytic-saddle-live',
  producerId: 'analytic-saddle-producer',
  producerRevision: 'analytic-saddle-7',
});
assert.equal(actualProvider.geometry.terrainId, 'analytic-saddle');
assert.equal(actualProvider.geometry.producerId, 'analytic-saddle-producer');
assert.equal(actualProvider.geometry.producerRevision, 'analytic-saddle-7');
assert.equal(
  actualProvider.geometry.runtimeProducerRevision,
  KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision,
);
assert.ok(Math.abs(actualProvider.sampleSurface(0).mappedDepth - 3.6) < 1e-12);
assert.ok(Math.abs(actualProvider.sampleSurface(0).physicalDepthMeters - 0.6) < 1e-12);
assert.deepEqual(actualProvider.sampleSurface(0).supportVelocity, [0.25, 0, 0]);
assert.deepEqual(actualProvider.sampleSurface(0).materialMasses, { water: 598.2 });
assert.equal(actualSourceHandle.status.readGeneration, 1);

const width = 2;
const height = 2;
const sampleCount = width * height;
const producerRevision = 'portable-producer-v2';
const canonicalRuntimeRoute = 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1';
const grid = {
  width,
  height,
  spacing: [2, 3],
  origin: [10, 4, -8],
};
const packageDescriptor = {
  schema: 'kaminos.fluid.package-descriptor.v1',
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  packageName: '@kaminos/fluid-webgpu',
  packageVersion: '0.3.0',
  artifactRevision: '@kaminos/fluid-webgpu@0.3.0',
  runtimeRevision: producerRevision,
  runtimeRoute: canonicalRuntimeRoute,
  representationRoutes: ['kaminos/fluid/representation-frame'],
  sourceRoutes: ['kaminos/fluid/portable-macro-source'],
};
const representationFrame = {
  schema: 'kaminos.fluid.representation-frame.v1',
  route: {
    requested: 'kaminos/fluid/representation-frame',
    effective: 'kaminos/fluid/representation-frame',
  },
  producerRevision,
  fluidEpoch: 11,
  terrainEpoch: 7,
  complete: true,
  ownershipIdentity: 'macro-local-parcel-exclusive-v1',
  grid,
  expectedSampleCount: sampleCount,
  macro: {
    grid,
    method: 'portable-mapped-water-v2',
    mappedDepth: new Float64Array([0.2, 0.4, 0, 0.6]),
    mappedMomentumU: new Float64Array([0.1, 0.2, 0, 0.3]),
    mappedMomentumV: new Float64Array([0.05, 0.1, 0, 0.15]),
    materialMasses: {
      water: new Float64Array([199.4, 398.8, 0, 598.2]),
    },
  },
  local: { count: 0, supportScale: 0, sourceBuffer: null },
  parcels: { count: 0, sourceBuffer: null },
  physicalMaterial: {
    densityKgM3: 997,
    dynamicViscosityPaS: 0.00089,
    absorptionPerMeter: [0.05, 0.02, 0.01],
  },
  dirtyRegions: [{ x: 0, y: 0, width, height }],
};
const supportPosition = new Float64Array([
  10, 4, -8,
  12, 5, -8,
  10, 4, -5,
  12, 6, -5,
]);
const tangentU = new Float64Array([
  2, 0, 0,
  1, 0, 0,
  1, 0, 0,
  1, 0, 0,
]);
const tangentV = new Float64Array([
  0, 0, 3,
  0, 0, 1,
  0, 0, 1,
  0, 0, 1,
]);
const normal = new Float64Array([
  0, 1, 0,
  0, 1, 0,
  0, 1, 0,
  0, 1, 0,
]);
const jacobian = new Float64Array([1, 2, 1, 3]);
const supportGeometry = {
  schema: 'kaminos.fluid.portable-support-geometry.v1',
  route: {
    requested: 'kaminos/fluid/portable-support-geometry',
    effective: 'kaminos/fluid/portable-support-geometry',
  },
  capability: 'mapped-support-world-surface-v1',
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  producer: {
    id: 'analytic-portable-host',
    revision: 'analytic-plane-v1',
  },
  geometryIdentity: 'analytic-plane:terrain-7',
  transformIdentity: 'analytic-plane-to-world-v1',
  producerRevision,
  fluidEpoch: 11,
  terrainEpoch: 7,
  worldMetersPerUnit: 1,
  grid,
  fields: {
    supportPosition,
    tangentU,
    tangentV,
    normal,
    jacobian,
  },
  sourceHandle: {
    schema: 'kaminos.fluid.portable-source-handle.v1',
    id: 'analytic-plane-frame-11',
    revision: 'analytic-plane-v1',
    lifetime: 'frame_epoch',
    complete: true,
  },
  dirtyRegions: [{ x: 0, y: 0, width, height }],
  complete: true,
  expectedSampleCount: sampleCount,
};
const terrainSourceIdentity = {
  requested: 'analytic-plane-live',
  effective: 'analytic-plane-live',
  producerId: 'analytic-portable-host',
  producerRevision: 'analytic-plane-v1',
};
const expectedIdentity = {
  packageDescriptor,
  artifactRevision: packageDescriptor.artifactRevision,
  producerRevision,
  fluidEpoch: 11,
  terrainEpoch: 7,
  source: terrainSourceIdentity,
};

const retainedSourceDescriptor = deepFreeze({
  schema: 'kaminos.fluid.portable-macro-source-handle.v1',
  route: {
    requested: 'kaminos/fluid/portable-macro-source',
    effective: 'kaminos/fluid/portable-macro-source',
  },
  requestedCapability: 'kaminos.fluid.portable-macro-source.v1',
  effectiveCapability: 'kaminos.fluid.portable-macro-source.v1',
  capability: 'kaminos.fluid.portable-macro-source.v1',
  sourceHandleId: 'analytic-plane-frame-11',
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  representationRoute: {
    requested: 'kaminos/fluid/representation-frame',
    effective: 'kaminos/fluid/representation-frame',
  },
  producer: {
    revision: producerRevision,
    runtimeRoute: canonicalRuntimeRoute,
    method: 'portable-mapped-water-v2',
  },
  ownershipIdentity: 'macro-local-parcel-exclusive-v1',
  supportGeometry: {
    topologyId: 'analytic-plane-grid-v1',
    terrainId: 'analytic-plane',
    supportClass: 'heightfield',
    transformId: 'analytic-plane-to-world-v1',
    coordinateSpace: 'world_meters',
    worldMetersPerUnit: 1,
    mapping: 'explicit-world-position-buffer-v1',
    positionSource: 'terrain-fluid-frame.fields.worldPosition',
    sampleCount,
  },
  physicalMaterial: representationFrame.physicalMaterial,
  lifetime: {
    releasePolicy: 'explicit-release-v1',
    retainedTerrainEpoch: 7,
    retainedFluidEpoch: 11,
  },
});
let sourceReadCount = 0;
const retainedSourceHandle = Object.freeze({
  descriptor: retainedSourceDescriptor,
  read(options = {}) {
    assert.equal(options.minimumTerrainEpoch, 7);
    assert.equal(options.minimumFluidEpoch, 11);
    sourceReadCount += 1;
    return {
      schema: 'kaminos.fluid.portable-macro-source-snapshot.v1',
      route: { ...retainedSourceDescriptor.route },
      requestedCapability: retainedSourceDescriptor.requestedCapability,
      effectiveCapability: retainedSourceDescriptor.effectiveCapability,
      capability: retainedSourceDescriptor.capability,
      sourceHandleId: retainedSourceDescriptor.sourceHandleId,
      sourceAuthority: 'live_runtime',
      fallbackStatus: 'none',
      representationRoute: { ...retainedSourceDescriptor.representationRoute },
      producer: { ...retainedSourceDescriptor.producer },
      ownershipIdentity: retainedSourceDescriptor.ownershipIdentity,
      terrainEpoch: 7,
      fluidEpoch: 11,
      source: { ...terrainSourceIdentity },
      supportGeometry: {
        geometryId: 'analytic-plane:terrain-7',
        topologyId: 'analytic-plane-grid-v1',
        terrainId: 'analytic-plane',
        supportClass: 'heightfield',
        transformId: 'analytic-plane-to-world-v1',
        coordinateSpace: 'world_meters',
        worldMetersPerUnit: 1,
        mapping: 'explicit-world-position-buffer-v1',
        positionSource: 'terrain-fluid-frame.fields.worldPosition',
        sampleCount,
        grid,
        worldPosition: Float64Array.from(supportPosition),
        tangentU: Float64Array.from(tangentU),
        tangentV: Float64Array.from(tangentV),
        normal: Float64Array.from(normal),
        jacobian: Float64Array.from(jacobian),
        supportVelocity: new Float64Array(sampleCount * 3),
      },
      macro: {
        method: 'portable-mapped-water-v2',
        mappedDepth: Float64Array.from(representationFrame.macro.mappedDepth),
        mappedMomentumU: Float64Array.from(representationFrame.macro.mappedMomentumU),
        mappedMomentumV: Float64Array.from(representationFrame.macro.mappedMomentumV),
        materialMasses: {
          water: Float64Array.from(representationFrame.macro.materialMasses.water),
        },
      },
      physicalMaterial: {
        ...representationFrame.physicalMaterial,
        absorptionPerMeter: [...representationFrame.physicalMaterial.absorptionPerMeter],
      },
      confidence: 1,
      dirtyRegions: [{ x: 0, y: 0, width, height }],
      complete: true,
    };
  },
  release() {
    throw new Error('optical provider cannot take source-release custody');
  },
});

const retainedProvider = webgpuCore.createFingerFluidPortableMacroGeometryProvider({
  sourceHandle: retainedSourceHandle,
  expectedIdentity,
});
assert.equal(sourceReadCount, 1, 'provider admission takes one current live-source snapshot');
const substitutedRuntimeRoute = 'kaminos/fluid/substituted-portable-macro-v9';
const substitutedRuntimeProducer = {
  ...retainedSourceDescriptor.producer,
  runtimeRoute: substitutedRuntimeRoute,
};
assert.throws(
  () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
    sourceHandle: retainedHandleWith({
      descriptorOverrides: { producer: substitutedRuntimeProducer },
      snapshotOverrides: { producer: substitutedRuntimeProducer },
    }),
    expectedIdentity: {
      ...expectedIdentity,
      packageDescriptor: {
        ...packageDescriptor,
        runtimeRoute: substitutedRuntimeRoute,
      },
    },
  }),
  /package runtime route|runtime route is unsupported/i,
  'package, handle, and snapshot cannot substitute the published runtime route together',
);
assert.throws(
  () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
    sourceHandle: retainedHandleWith({
      snapshotOverrides: {
        source: {
          ...terrainSourceIdentity,
          producerId: 'substituted-terrain-producer',
        },
      },
    }),
    expectedIdentity,
  }),
  /source.*producer.*disagreement/i,
  'snapshot terrain-source provenance cannot be substituted behind a canonical retained handle',
);
assert.throws(
  () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
    representationFrame,
    supportGeometry,
    expectedIdentity,
  }),
  /source handle.*required/i,
  'the optical provider cannot admit a duplicate direct-frame support ABI beside the retained source handle',
);
assert.equal(retainedProvider.geometry.sourceHandleId, 'analytic-plane-frame-11');
assert.equal(retainedProvider.geometry.sourceHandleLifetime, 'explicit-release-v1');
assert.deepEqual(retainedProvider.source.route, retainedSourceDescriptor.route);
assert.equal(retainedProvider.source.capability, 'kaminos.fluid.portable-macro-source.v1');
assert.equal(retainedProvider.source.schema, 'kaminos.fluid.portable-macro-source-handle.v1');
assert.deepEqual(retainedProvider.source.terrain, terrainSourceIdentity);
assert.equal(retainedProvider.sampleSurface(1).physicalDepthMeters, 0.2);
assert.throws(
  () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
    sourceHandle: retainedSourceHandle,
    expectedIdentity: {
      ...expectedIdentity,
      packageDescriptor: {
        ...packageDescriptor,
        sourceRoutes: [],
      },
    },
  }),
  /package.*portable.*source route/i,
  'a package cannot advertise portable source bytes without publishing the canonical source route',
);

const shallowFrozenSourceDescriptor = Object.freeze({
  ...retainedSourceDescriptor,
  route: { ...retainedSourceDescriptor.route },
});
assert.throws(
  () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
    sourceHandle: Object.freeze({
      descriptor: shallowFrozenSourceDescriptor,
      read: retainedSourceHandle.read,
      release: retainedSourceHandle.release,
    }),
    expectedIdentity,
  }),
  /descriptor.*immutable|recursively frozen/i,
  'mutable nested descriptor identity cannot impersonate a retained source handle',
);

function retainedHandleWith({
  descriptorOverrides = {},
  snapshotOverrides = {},
  readError = null,
} = {}) {
  const descriptor = deepFreeze({
    ...retainedSourceDescriptor,
    ...descriptorOverrides,
  });
  return Object.freeze({
    descriptor,
    read(options) {
      if (readError) throw readError;
      return {
        ...retainedSourceHandle.read(options),
        ...snapshotOverrides,
      };
    },
    release: retainedSourceHandle.release,
  });
}

const canonicalSnapshot = retainedSourceHandle.read({
  minimumTerrainEpoch: 7,
  minimumFluidEpoch: 11,
});
const canonicalSupportGeometry = canonicalSnapshot.supportGeometry;

function assertProviderFailureReport(label, sourceHandle, {
  pattern,
  phase,
  lastTrustworthyEvidence,
}) {
  let failure = null;
  try {
    webgpuCore.createFingerFluidPortableMacroGeometryProvider({
      sourceHandle,
      expectedIdentity,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error, `${label} must throw before portable optical reconstruction`);
  assert.match(failure.message, pattern, `${label} must preserve its specific failure reason`);
  assert.equal(
    failure.report?.schema,
    'kaminos.finger-fluid.portable-macro-geometry-failure.v1',
    `${label} must publish a structured provider failure report`,
  );
  assert.equal(failure.report.phase, phase, `${label} must identify its failure phase`);
  assert.equal(failure.report.sourceHandleId, 'analytic-plane-frame-11');
  assert.equal(
    failure.report.lastTrustworthyEvidence,
    lastTrustworthyEvidence,
    `${label} must name its last trustworthy evidence`,
  );
  assert.equal(Object.isFrozen(failure.report), true, `${label} failure evidence must be immutable`);
}

for (const [label, sourceHandle, expectation] of [
  [
    'stale live snapshot report',
    retainedHandleWith({ snapshotOverrides: { terrainEpoch: 6 } }),
    {
      pattern: /epoch disagreement/i,
      phase: 'validate-source-snapshot',
      lastTrustworthyEvidence: 'source-snapshot-read',
    },
  ],
  [
    'fallback live snapshot report',
    retainedHandleWith({ snapshotOverrides: { fallbackStatus: 'legacy_preview' } }),
    {
      pattern: /fallback/i,
      phase: 'validate-source-snapshot',
      lastTrustworthyEvidence: 'source-snapshot-read',
    },
  ],
  [
    'partial live snapshot report',
    retainedHandleWith({ snapshotOverrides: { complete: false } }),
    {
      pattern: /incomplete/i,
      phase: 'validate-source-snapshot',
      lastTrustworthyEvidence: 'source-snapshot-read',
    },
  ],
  [
    'camera-contaminated live snapshot report',
    retainedHandleWith({ snapshotOverrides: { camera: { position: [0, 0, 0] } } }),
    {
      pattern: /camera-owned/i,
      phase: 'validate-source-snapshot',
      lastTrustworthyEvidence: 'source-snapshot-read',
    },
  ],
  [
    'unsupported support geometry report',
    retainedHandleWith({
      snapshotOverrides: {
        supportGeometry: {
          ...canonicalSupportGeometry,
          jacobian: new Float64Array([1, 0, 1, 3]),
        },
      },
    }),
    {
      pattern: /jacobian/i,
      phase: 'validate-support-geometry',
      lastTrustworthyEvidence: 'source-snapshot-identity-validated',
    },
  ],
]) {
  assertProviderFailureReport(label, sourceHandle, expectation);
}

for (const [label, snapshotOverrides] of [
  [
    'camera state nested under support geometry',
    {
      supportGeometry: {
        ...canonicalSupportGeometry,
        camera: { position: [0, 0, 0] },
      },
    },
  ],
  [
    'viewport state nested under macro payload',
    {
      macro: {
        ...canonicalSnapshot.macro,
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  [
    'projection state nested under producer identity',
    {
      producer: {
        ...canonicalSnapshot.producer,
        projection: 'perspective',
      },
    },
  ],
]) {
  assert.throws(
    () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
      sourceHandle: retainedHandleWith({ snapshotOverrides }),
      expectedIdentity,
    }),
    error => (
      /camera-owned/i.test(error.message)
      && error.report?.phase === 'validate-source-snapshot'
      && error.report?.lastTrustworthyEvidence === 'source-snapshot-read'
    ),
    `${label} must fail before portable optical reconstruction`,
  );
}

for (const [label, sourceHandle, pattern] of [
  [
    'fallback descriptor',
    retainedHandleWith({ descriptorOverrides: { fallbackStatus: 'legacy_preview' } }),
    /fallback/i,
  ],
  [
    'fallback source route',
    retainedHandleWith({
      descriptorOverrides: {
        route: {
          requested: 'kaminos/fluid/portable-macro-source',
          effective: 'fixture/portable-macro-source',
        },
      },
    }),
    /route disagreement/i,
  ],
  [
    'unsupported source capability',
    retainedHandleWith({
      descriptorOverrides: {
        requestedCapability: 'kaminos.fluid.screen-space-water.v0',
        effectiveCapability: 'kaminos.fluid.screen-space-water.v0',
        capability: 'kaminos.fluid.screen-space-water.v0',
      },
    }),
    /capability/i,
  ],
  [
    'stale live snapshot',
    retainedHandleWith({ snapshotOverrides: { terrainEpoch: 6 } }),
    /epoch disagreement/i,
  ],
  [
    'fallback live snapshot',
    retainedHandleWith({ snapshotOverrides: { fallbackStatus: 'legacy_preview' } }),
    /fallback/i,
  ],
  [
    'partial live snapshot',
    retainedHandleWith({ snapshotOverrides: { complete: false } }),
    /incomplete/i,
  ],
  [
    'camera-contaminated live snapshot',
    retainedHandleWith({ snapshotOverrides: { camera: { position: [0, 0, 0] } } }),
    /camera-owned/i,
  ],
  [
    'substituted live source handle',
    retainedHandleWith({ snapshotOverrides: { sourceHandleId: 'substituted-source' } }),
    /handle identity/i,
  ],
  [
    'partial live support geometry',
    retainedHandleWith({
      snapshotOverrides: {
        supportGeometry: {
          ...canonicalSupportGeometry,
          worldPosition: undefined,
        },
      },
    }),
    /world position.*sample count/i,
  ],
  [
    'non-unit live support normal',
    retainedHandleWith({
      snapshotOverrides: {
        supportGeometry: {
          ...canonicalSupportGeometry,
          normal: new Float64Array([
            0, 2, 0,
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
          ]),
        },
      },
    }),
    /normal.*unit/i,
  ],
  [
    'nonpositive live support Jacobian',
    retainedHandleWith({
      snapshotOverrides: {
        supportGeometry: {
          ...canonicalSupportGeometry,
          jacobian: new Float64Array([1, 0, 1, 3]),
        },
      },
    }),
    /jacobian/i,
  ],
]) {
  assert.throws(
    () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
      sourceHandle,
      expectedIdentity,
    }),
    pattern,
    `${label} must fail before portable optical reconstruction`,
  );
}

for (const [label, packageOverrides, pattern] of [
  ['producer fallback package', { fallbackStatus: 'legacy' }, /fallback/i],
  ['substituted producer package version', { packageVersion: '9.9.9' }, /package version/i],
  [
    'substituted producer artifact',
    { artifactRevision: '@kaminos/fluid-webgpu@substituted' },
    /artifact revision/i,
  ],
]) {
  assert.throws(
    () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
      sourceHandle: retainedSourceHandle,
      expectedIdentity: {
        ...expectedIdentity,
        packageDescriptor: {
          ...packageDescriptor,
          ...packageOverrides,
        },
      },
    }),
    pattern,
    `${label} must fail before portable optical reconstruction`,
  );
}

const producerReadFailure = Object.assign(new Error('released portable source'), {
  report: Object.freeze({
    schema: 'kaminos.fluid.portable-macro-source-failure.v1',
    status: 'failed',
    phase: 'read-live-source',
    sourceHandleId: 'analytic-plane-frame-11',
    lastTrustworthyEvidence: 'source-handle-released',
  }),
});
assert.throws(
  () => webgpuCore.createFingerFluidPortableMacroGeometryProvider({
    sourceHandle: retainedHandleWith({ readError: producerReadFailure }),
    expectedIdentity,
  }),
  error => error === producerReadFailure && error.report.phase === 'read-live-source',
  'producer pre-output failure must retain its durable phase and last trustworthy evidence',
);

const provider = retainedProvider;

assert.equal(provider.schema, 'kaminos.finger-fluid.portable-macro-geometry-provider.v1');
assert.deepEqual(provider.route, {
  requested: 'kaminos/finger-fluid/portable-macro-geometry-provider',
  effective: 'kaminos/finger-fluid/portable-macro-geometry-provider',
});
assert.equal(provider.capability, 'kaminos.fluid.portable-macro-source.v1');
assert.equal(provider.hostIndependent, true);
assert.equal(provider.package.version, '0.3.0', 'compatibility is capability-based rather than pinned to v0.2.1');
assert.equal(provider.package.runtimeRoute, canonicalRuntimeRoute);
assert.equal(provider.geometry.identity, 'analytic-plane:terrain-7');
assert.equal(provider.geometry.transformIdentity, 'analytic-plane-to-world-v1');
assert.equal(provider.geometry.terrainId, 'analytic-plane');
assert.equal(provider.geometry.producerId, 'analytic-portable-host');
assert.equal(provider.geometry.producerRevision, 'analytic-plane-v1');
assert.equal(provider.geometry.runtimeProducerRevision, producerRevision);
assert.equal(provider.geometry.sourceHandleId, 'analytic-plane-frame-11');
assert.equal(provider.sampleCount, sampleCount);
assert.equal(provider.confidence, 1);
assert.deepEqual(provider.dirtyRegions, [{ x: 0, y: 0, width, height }]);
assert.equal(Object.isFrozen(provider), true);
assert.equal(Object.isFrozen(provider.dirtyRegions), true);
assert.equal(Object.isFrozen(provider.dirtyRegions[0]), true);
assert.equal(Object.hasOwn(provider, 'camera'), false);
assert.equal(Object.hasOwn(provider.geometry, 'fields'), false, 'mutable producer arrays are not public provider state');
assert.doesNotMatch(JSON.stringify(provider), /hill|lerms/i);

assert.deepEqual(provider.sampleSurface(0), {
  index: 0,
  wet: true,
  mappedDepth: 0.2,
  physicalDepthMeters: 0.2,
  supportPosition: [10, 4, -8],
  surfacePosition: [10, 4.2, -8],
  normal: [0, 1, 0],
  tangentU: [2, 0, 0],
  tangentV: [0, 0, 3],
  jacobian: 1,
  supportVelocity: [0, 0, 0],
  mappedMomentum: [0.1, 0.05],
  materialMasses: { water: 199.4 },
});
assert.deepEqual(
  provider.sampleSurface(1),
  {
    index: 1,
    wet: true,
    mappedDepth: 0.4,
    physicalDepthMeters: 0.2,
    supportPosition: [12, 5, -8],
    surfacePosition: [12, 5.2, -8],
    normal: [0, 1, 0],
    tangentU: [1, 0, 0],
    tangentV: [0, 0, 1],
    jacobian: 2,
    supportVelocity: [0, 0, 0],
    mappedMomentum: [0.2, 0.1],
    materialMasses: { water: 398.8 },
  },
  'mapped depth is converted through J before world-space reconstruction',
);
assert.equal(provider.sampleSurface(2).wet, false);

const upload = provider.createUploadSnapshot();
assert.equal(upload.schema, 'kaminos.finger-fluid.portable-macro-upload-snapshot.v1');
assert.equal(upload.sampleCount, sampleCount);
assert.equal(upload.terrainId, 'analytic-plane');
assert.deepEqual(upload.source, terrainSourceIdentity);
assert.deepEqual(Array.from(upload.mappedDepth), [0.2, 0.4, 0, 0.6]);
assert.deepEqual(Array.from(upload.supportPosition), Array.from(supportPosition));
assert.deepEqual(Array.from(upload.supportVelocity), Array(sampleCount * 3).fill(0));
assert.deepEqual(Array.from(upload.materialMasses.water), [199.4, 398.8, 0, 598.2]);
assert.deepEqual(upload.dirtyRegions, [{ x: 0, y: 0, width, height }]);
assert.equal(upload.confidence, 1);
assert.deepEqual(
  Array.from(upload.tangentU.subarray(0, 3)),
  [2, 0, 0],
  'metric tangent magnitude must survive provider admission and upload',
);

representationFrame.macro.mappedDepth[0] = 99;
supportPosition[0] = 99;
jacobian[0] = 99;
assert.equal(provider.sampleSurface(0).mappedDepth, 0.2, 'producer mutation cannot substitute accepted depth');
assert.deepEqual(provider.sampleSurface(0).supportPosition, [10, 4, -8], 'producer mutation cannot substitute geometry');
assert.equal(provider.createUploadSnapshot().mappedDepth[0], 0.2);

assert.throws(
  () => provider.sampleSurface(-1),
  /sample index/i,
);
assert.throws(
  () => provider.sampleSurface(sampleCount),
  /sample index/i,
);

console.log('finger fluid portable support geometry contracts passed');
