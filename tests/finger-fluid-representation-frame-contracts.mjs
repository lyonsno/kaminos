import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
  createKaminosFluidRuntime,
} from '@kaminos/fluid-webgpu';

const root = new URL('..', import.meta.url).pathname;
const webgpuCore = await import(`${root}/finger-fluid-webgpu-core.js`);
const producerRevision = '4a863c6f9886fd113af9bc49a61b436f4dca571c';
const representationRoute = 'kaminos/fluid/representation-frame';
const packageUrl = 'https://raw.githubusercontent.com/lyonsno/kaminos/c6baafabd6ea7413d83abd10e68ac160c0d7f584/artifacts/fluid/kaminos-fluid-webgpu-0.4.0.tgz';
const packageIntegrity = 'sha512-bZ2LaDP7drm+9R1TqopjE9KwJ4++SfjiZ+yW5MZMgYGl/of3a7x7h9X2pgmMUImcjKJGfQGq3AurErHcGFJtLQ==';

assert.equal(
  typeof webgpuCore.validateFingerFluidOpticalRepresentationFrame,
  'function',
  'the optical renderer must expose a source-honest FluidRepresentationFrame consumer',
);

const packageLock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
const installedProducer = packageLock.packages['node_modules/@kaminos/fluid-webgpu'];
assert.equal(installedProducer.version, '0.4.0');
assert.equal(installedProducer.resolved, packageUrl, 'the consumer must pin the immutable producer artifact');
assert.equal(installedProducer.integrity, packageIntegrity, 'the installed producer bytes must match Big Papa\'s receipt');
assert.deepEqual(KAMINOS_FLUID_PACKAGE_DESCRIPTOR, {
  schema: 'kaminos.fluid.package-descriptor.v1',
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  packageName: '@kaminos/fluid-webgpu',
  packageVersion: '0.4.0',
  artifactRevision: '@kaminos/fluid-webgpu@0.4.0',
  runtimeRevision: producerRevision,
  cacheKey: `@kaminos/fluid-webgpu@0.4.0:${producerRevision}`,
  runtimeRoute: 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1',
  representationRoutes: [representationRoute],
  sourceRoutes: [
    'kaminos/fluid/portable-macro-source',
    'kaminos/fluid/macro-wet-boundary',
  ],
  outputRoutes: ['kaminos/fluid/terrain-feedback'],
});

function makeTerrainFrame() {
  const width = 2;
  const height = 2;
  const sampleCount = width * height;
  const tangentU = new Float64Array(sampleCount * 3);
  const tangentV = new Float64Array(sampleCount * 3);
  const normal = new Float64Array(sampleCount * 3);
  for (let index = 0; index < sampleCount; index += 1) {
    tangentU[index * 3] = 1;
    tangentV[index * 3 + 2] = 1;
    normal[index * 3 + 1] = 1;
  }
  return {
    schema: 'kaminos.fluid.terrain-fluid-frame.v1',
    route: { requested: 'test/terrain', effective: 'test/terrain' },
    producer: { id: 'optics-contract-test', revision: 'terrain-test-v1' },
    source: { requested: 'test/heightfield', effective: 'test/heightfield' },
    worldMetersPerUnit: 1,
    gravity: [0, -9.81, 0],
    terrainId: 'optics-contract-terrain',
    supportClass: 'heightfield',
    transformId: 'terrain-to-world-v1',
    priorEpoch: 6,
    currentEpoch: 7,
    motionClass: 'stable',
    shockId: null,
    grid: { width, height, spacing: [0.5, 0.5], origin: [0, 0, 0] },
    fields: {
      bedHeight: new Float64Array(sampleCount),
      jacobian: new Float64Array(sampleCount).fill(1),
      gradient: new Float64Array(sampleCount * 2),
      tangentU,
      tangentV,
      normal,
      supportVelocity: new Float64Array(sampleCount * 3),
      valid: new Uint8Array(sampleCount).fill(1),
    },
    dirtyRegions: [{ x: 0, y: 0, width, height }],
    minimumFilteredSupportScale: null,
    motionSubstepEnvelope: null,
    complete: true,
    expectedSampleCount: sampleCount,
    actualSampleCount: sampleCount,
  };
}

const runtime = createKaminosFluidRuntime({
  terrainFrame: makeTerrainFrame(),
  depth: new Float64Array([0.2, 0.1, 0, 0.3]),
  materialMasses: { sediment: new Float64Array([0.01, 0.02, 0, 0.03]) },
  producerRevision: KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision,
});
const canonicalFrame = runtime.representation({
  physicalMaterial: {
    densityKgM3: 997,
    dynamicViscosityPaS: 0.00089,
    absorptionPerMeter: [0.05, 0.02, 0.01],
  },
});
const expectedIdentity = {
  packageDescriptor: KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
  artifactRevision: '@kaminos/fluid-webgpu@0.4.0',
  producerRevision: runtime.identity.producerRevision,
  fluidEpoch: runtime.identity.fluidEpoch,
  terrainEpoch: runtime.identity.terrainEpoch,
};

const accepted = webgpuCore.validateFingerFluidOpticalRepresentationFrame(
  canonicalFrame,
  expectedIdentity,
);
assert.equal(accepted.schema, 'kaminos.fluid.representation-frame.v1');
assert.deepEqual(accepted.route, { requested: representationRoute, effective: representationRoute });
assert.equal(accepted.package.artifactRevision, '@kaminos/fluid-webgpu@0.4.0');
assert.equal(accepted.package.runtimeRevision, producerRevision);
assert.equal(accepted.producerRevision, producerRevision);
assert.equal(accepted.ownershipIdentity, 'macro-local-parcel-exclusive-v1');
assert.deepEqual(accepted.availableRepresentations, ['macro']);
assert.deepEqual(accepted.macro, {
  method: 'orthogonal-heightfield-hydrostatic-reconstruction-hll-v1',
  width: 2,
  height: 2,
  expectedSampleCount: 4,
  materialKeys: ['sediment'],
});
assert.deepEqual(accepted.physicalMaterial, {
  densityKgM3: 997,
  dynamicViscosityPaS: 0.00089,
  absorptionPerMeter: [0.05, 0.02, 0.01],
});
assert.equal(accepted.dirtyRegionCount, 1);
assert.equal(Object.isFrozen(accepted), true);
assert.equal(Object.isFrozen(accepted.route), true);
assert.equal(Object.isFrozen(accepted.macro), true);
assert.equal(Object.isFrozen(accepted.physicalMaterial.absorptionPerMeter), true);

canonicalFrame.physicalMaterial.absorptionPerMeter[0] = 99;
canonicalFrame.macro.mappedDepth[0] = 99;
assert.equal(accepted.physicalMaterial.absorptionPerMeter[0], 0.05);
assert.equal(Object.hasOwn(accepted.macro, 'mappedDepth'), false, 'the consumer must not retain mutable producer buffers');
assert.equal(Object.hasOwn(accepted, 'residencyAuthority'), false, 'residency policy remains consumer-side');

assert.throws(
  () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(canonicalFrame),
  /expected.*identity/i,
  'the consumer cannot accept a frame without a pinned package/revision/epoch identity',
);

for (const [label, frame, identity, pattern] of [
  [
    'fallback producer package',
    canonicalFrame,
    {
      ...expectedIdentity,
      packageDescriptor: { ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR, fallbackStatus: 'legacy-runtime' },
    },
    /fallback/i,
  ],
  [
    'substituted package artifact',
    canonicalFrame,
    {
      ...expectedIdentity,
      packageDescriptor: { ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR, artifactRevision: '@kaminos/fluid-webgpu@9.9.9' },
    },
    /artifact revision/i,
  ],
  [
    'substituted package version',
    canonicalFrame,
    {
      ...expectedIdentity,
      packageDescriptor: { ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR, packageVersion: '9.9.9' },
    },
    /package version/i,
  ],
  [
    'substituted package runtime route',
    canonicalFrame,
    {
      ...expectedIdentity,
      packageDescriptor: { ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR, runtimeRoute: 'substituted/runtime' },
    },
    /runtime route/i,
  ],
  [
    'blank package artifact',
    canonicalFrame,
    {
      ...expectedIdentity,
      packageDescriptor: { ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR, artifactRevision: '   ' },
    },
    /artifact revision/i,
  ],
  [
    'substituted package runtime',
    canonicalFrame,
    {
      ...expectedIdentity,
      packageDescriptor: { ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR, runtimeRevision: 'substituted-runtime' },
    },
    /runtime revision/i,
  ],
  [
    'blank expected producer revision',
    canonicalFrame,
    { ...expectedIdentity, producerRevision: '   ' },
    /expected.*identity/i,
  ],
  [
    'stale producer revision',
    { ...canonicalFrame, producerRevision: 'stale-producer' },
    expectedIdentity,
    /producer revision/i,
  ],
  [
    'blank observed producer revision',
    { ...canonicalFrame, producerRevision: '   ' },
    expectedIdentity,
    /producer revision.*missing/i,
  ],
  [
    'stale fluid epoch',
    { ...canonicalFrame, fluidEpoch: canonicalFrame.fluidEpoch + 1 },
    expectedIdentity,
    /fluid epoch/i,
  ],
  [
    'stale terrain epoch',
    { ...canonicalFrame, terrainEpoch: canonicalFrame.terrainEpoch + 1 },
    expectedIdentity,
    /terrain epoch/i,
  ],
  [
    'substituted effective route',
    { ...canonicalFrame, route: { requested: representationRoute, effective: 'legacy/particles' } },
    expectedIdentity,
    /route/i,
  ],
  [
    'camera-owned producer state',
    { ...canonicalFrame, viewport: [1280, 720] },
    expectedIdentity,
    /camera-owned/i,
  ],
  [
    'partial frame',
    { ...canonicalFrame, complete: false },
    expectedIdentity,
    /incomplete/i,
  ],
  [
    'wrong ownership',
    { ...canonicalFrame, ownershipIdentity: 'camera-tile-residency' },
    expectedIdentity,
    /ownership/i,
  ],
  [
    'wrong expected sample count',
    { ...canonicalFrame, expectedSampleCount: 3 },
    expectedIdentity,
    /sample count/i,
  ],
  [
    'macro and output grid disagreement',
    {
      ...canonicalFrame,
      grid: { ...canonicalFrame.grid, width: canonicalFrame.grid.width + 1 },
    },
    expectedIdentity,
    /grid|sample count/i,
  ],
  [
    'missing dirty regions',
    { ...canonicalFrame, dirtyRegions: null },
    expectedIdentity,
    /dirty regions/i,
  ],
  [
    'invalid local count',
    { ...canonicalFrame, local: { ...canonicalFrame.local, count: -1 } },
    expectedIdentity,
    /local.*count/i,
  ],
  [
    'populated local representation without source buffer',
    { ...canonicalFrame, local: { ...canonicalFrame.local, count: 1, sourceBuffer: null } },
    expectedIdentity,
    /local.*source buffer/i,
  ],
  [
    'populated parcel representation without source buffer',
    { ...canonicalFrame, parcels: { ...canonicalFrame.parcels, count: 1, sourceBuffer: null } },
    expectedIdentity,
    /parcel.*source buffer/i,
  ],
  [
    'invalid physical density',
    {
      ...canonicalFrame,
      physicalMaterial: { ...canonicalFrame.physicalMaterial, densityKgM3: 0 },
    },
    expectedIdentity,
    /density/i,
  ],
]) {
  assert.throws(
    () => webgpuCore.validateFingerFluidOpticalRepresentationFrame(frame, identity),
    pattern,
    `${label} must fail before optical reconstruction`,
  );
}

console.log('finger fluid canonical representation frame contracts passed');
