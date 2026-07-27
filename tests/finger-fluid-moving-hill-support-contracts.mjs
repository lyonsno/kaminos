import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as fingerFluidCore from '../finger-fluid-webgpu-core.js';

const source = readFileSync(
  new URL('../finger-fluid-webgpu-core.js', import.meta.url),
  'utf8',
);
const browserWitnessSource = readFileSync(
  new URL('../finger-fluid-moving-hill-support-witness.js', import.meta.url),
  'utf8',
);
const browserWitnessRunnerSource = readFileSync(
  new URL('../finger-fluid-moving-hill-support-witness.mjs', import.meta.url),
  'utf8',
);

const movingHillRoute = 'lerms/hill-of-hills/gpu-moving-support-contact-v0';
const movingHillExecution = 'gpu_same_device_moving_hill_signed_distance_v0';
const providerSchema = 'kaminos.finger-fluid.moving-hill-support-contact-provider.v0';

assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
  movingHillRoute,
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_EXECUTION,
  movingHillExecution,
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_PROVIDER_SCHEMA,
  providerSchema,
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE,
  'kaminos/finger-fluid/analytic-support-contact-diagnostic-v0',
  'the built-in toy support must remain an explicitly named diagnostic route',
);
assert.equal(
  typeof fingerFluidCore.createFingerFluidMovingHillSupportContactProvider,
  'function',
  'Kaminos must publish a device-bound adapter for the canonical LERMS terrain frame',
);
assert.equal(
  typeof fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider,
  'function',
  'the solver must fail closed before pipeline creation on a false Hill provider',
);

const buffers = [];
const writes = [];
const textures = [];
const textureWrites = [];
const device = {
  queue: {
    writeBuffer(buffer, offset, data) {
      writes.push({
        buffer,
        offset,
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(),
      });
    },
    writeTexture(destination, data, layout, extent) {
      textureWrites.push({
        destination,
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(),
        layout,
        extent,
      });
    },
  },
  createBuffer(descriptor) {
    const buffer = {
      ...descriptor,
      device,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    buffers.push(buffer);
    return buffer;
  },
  createTexture(descriptor) {
    const view = { texture: null };
    const texture = {
      ...descriptor,
      device,
      view,
      destroyed: false,
      createView() {
        view.texture = texture;
        return view;
      },
      destroy() {
        this.destroyed = true;
      },
    };
    textures.push(texture);
    return texture;
  },
};

globalThis.GPUBufferUsage = {
  STORAGE: 1 << 0,
  COPY_DST: 1 << 1,
  UNIFORM: 1 << 2,
};
globalThis.GPUTextureUsage = {
  TEXTURE_BINDING: 1 << 0,
  COPY_DST: 1 << 1,
};

const terrainFrame = {
  schema: 'kaminos.fluid.terrain-fluid-frame.v1',
  route: 'lerms/hill-of-hills/terrain-fluid-frame-v1',
  producer: {
    id: 'hill-of-hills',
    revision: 'a'.repeat(40),
  },
  source: {
    requested: 'hill-scene-17',
    effective: 'hill-scene-17',
  },
  worldMetersPerUnit: 1,
  gravity: [0, -9.81, 0],
  terrainId: 'hill-of-hills-live-17',
  supportClass: 'heightfield',
  transformId: 'hill-transform-23',
  priorEpoch: 41,
  currentEpoch: 42,
  motionClass: 'deforming_heightfield',
  shockId: null,
  grid: {
    width: 2,
    height: 2,
    spacing: [0.5, 0.75],
    origin: [-1, 0, -2],
  },
  fields: {
    worldPosition: new Float64Array([
      -1, 0.1, -2,
      -0.5, 0.2, -2,
      -1, 0.3, -1.25,
      -0.5, 0.4, -1.25,
    ]),
    bedHeight: new Float64Array([0.1, 0.2, 0.3, 0.4]),
    jacobian: new Float64Array([1, 1, 1, 1]),
    gradient: new Float64Array([
      0.1, 0.2,
      0.2, 0.3,
      0.3, 0.4,
      0.4, 0.5,
    ]),
    tangentU: new Float64Array([
      1, 0, 0,
      1, 0, 0,
      1, 0, 0,
      1, 0, 0,
    ]),
    tangentV: new Float64Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    normal: new Float64Array([
      -0.1, 0.97, -0.2,
      -0.2, 0.93, -0.3,
      -0.3, 0.87, -0.4,
      -0.4, 0.78, -0.5,
    ]),
    supportVelocity: new Float64Array([
      0.01, 0.02, 0.03,
      0.04, 0.05, 0.06,
      0.07, 0.08, 0.09,
      0.10, 0.11, 0.12,
    ]),
    valid: new Uint8Array([1, 1, 1, 1]),
  },
  dirtyRegions: [{ x: 0, y: 0, width: 2, height: 2 }],
  complete: true,
  expectedSampleCount: 4,
  actualSampleCount: 4,
};

const identity = {
  sourceId: 'hill-scene-17',
  terrainId: terrainFrame.terrainId,
  terrainEpoch: 42,
  supportEpoch: 57,
  remapEpoch: 58,
  stale: false,
  fallbackRoute: null,
};

const provider = fingerFluidCore.createFingerFluidMovingHillSupportContactProvider({
  device,
  terrainFrame,
  identity,
});

assert.equal(provider.schema, providerSchema);
assert.equal(provider.route, movingHillRoute);
assert.equal(provider.owner, 'lerms_hill_of_hills');
assert.equal(provider.execution, movingHillExecution);
assert.equal(provider.device, device);
assert.equal(provider.queue, device.queue);
assert.equal(provider.sampleCount, 4);
assert.equal(provider.sampleStrideFloats, 8);
assert.equal(textures.length, 1, 'moving support must allocate one sampled-field texture');
assert.equal(provider.sampleTexture, textures[0]);
assert.equal(provider.sampleTextureView, textures[0].view);
assert.equal(provider.paramsBuffer, buffers[0]);
assert.equal(provider.terrainId, terrainFrame.terrainId);
assert.equal(provider.terrainEpoch, 42);
assert.equal(provider.supportEpoch, 57);
assert.equal(provider.remapEpoch, 58);
assert.equal(provider.stale, false);
assert.equal(provider.fallbackRoute, null);
assert.equal(textureWrites.length, 1, 'the provider must upload one two-layer support texture');
assert.equal(textureWrites[0].destination.texture, provider.sampleTexture);
assert.deepEqual(textureWrites[0].extent, { width: 2, height: 2, depthOrArrayLayers: 2 });
assert.equal(textureWrites[0].layout.bytesPerRow, 256, 'support rows satisfy WebGPU upload alignment');
assert.equal(writes.length, 1, 'the provider must upload metric/epoch parameters separately');
assert.equal(writes[0].buffer, provider.paramsBuffer);

const nextTerrainFrame = {
  ...terrainFrame,
  priorEpoch: terrainFrame.currentEpoch,
  currentEpoch: terrainFrame.currentEpoch + 1,
  fields: {
    ...terrainFrame.fields,
    bedHeight: new Float64Array([0.15, 0.25, 0.35, 0.45]),
    normal: new Float64Array([
      -0.12, 0.96, -0.22,
      -0.22, 0.92, -0.32,
      -0.32, 0.86, -0.42,
      -0.42, 0.77, -0.52,
    ]),
    supportVelocity: new Float64Array([
      0.11, 0.12, 0.13,
      0.14, 0.15, 0.16,
      0.17, 0.18, 0.19,
      0.20, 0.21, 0.22,
    ]),
  },
};
const nextIdentity = {
  ...identity,
  terrainEpoch: nextTerrainFrame.currentEpoch,
  supportEpoch: identity.supportEpoch + 1,
  remapEpoch: identity.remapEpoch,
};

assert.equal(
  typeof provider.update,
  'function',
  'the provider must advance a deforming Hill in place without rebuilding the solver',
);
assert.equal(
  provider.update({
    terrainFrame: nextTerrainFrame,
    identity: nextIdentity,
  }),
  provider,
);
assert.equal(provider.terrainEpoch, 43);
assert.equal(provider.supportEpoch, 58);
assert.equal(provider.remapEpoch, 58);
assert.equal(provider.writeTick, 1);
assert.equal(provider.sampleTexture, textures[0], 'moving support updates must preserve GPU texture identity');
assert.equal(provider.sampleTextureView, textures[0].view, 'moving support updates must preserve GPU texture-view identity');
assert.equal(provider.paramsBuffer, buffers[0], 'moving support updates must preserve parameter buffer identity');
assert.equal(textureWrites.length, 2, 'each moving support epoch must upload one two-layer texture');
assert.equal(textureWrites[1].destination.texture, provider.sampleTexture);
assert.equal(writes.length, 2, 'each moving support epoch must upload parameters');
assert.equal(writes[1].buffer, provider.paramsBuffer);
assert.equal(
  new Float32Array(textureWrites[1].data.buffer)[0],
  Math.fround(nextTerrainFrame.fields.bedHeight[0]),
  'the next terrain epoch must replace the authoritative support height',
);
assert.throws(
  () => provider.update({
    terrainFrame: nextTerrainFrame,
    identity: nextIdentity,
  }),
  /terrain epoch must advance/i,
  'a repeated terrain epoch must not masquerade as fresh moving support',
);
assert.throws(
  () => provider.update({
    terrainFrame: {
      ...nextTerrainFrame,
      currentEpoch: nextTerrainFrame.currentEpoch + 1,
    },
    identity: {
      ...nextIdentity,
      terrainEpoch: nextIdentity.terrainEpoch + 1,
      supportEpoch: nextIdentity.supportEpoch - 1,
    },
  }),
  /support epoch must not regress/i,
);
assert.throws(
  () => provider.update({
    terrainFrame: {
      ...nextTerrainFrame,
      currentEpoch: nextTerrainFrame.currentEpoch + 1,
      grid: {
        ...nextTerrainFrame.grid,
        spacing: [0.25, 0.75],
      },
    },
    identity: {
      ...nextIdentity,
      terrainEpoch: nextIdentity.terrainEpoch + 1,
      supportEpoch: nextIdentity.supportEpoch + 1,
    },
  }),
  /grid topology changed/i,
  'a remapped grid must force explicit provider reconstruction instead of corrupting buffer interpretation',
);

assert.equal(
  fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider(provider, { device }),
  provider,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider(null, { device }),
  /moving Hill support provider is missing/i,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider(
    { ...provider, device: {} },
    { device },
  ),
  /GPU device/i,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider(
    { ...provider, stale: true },
    { device },
  ),
  /stale/i,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider(
    { ...provider, fallbackRoute: 'toy-floor' },
    { device },
  ),
  /fallback/i,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidMovingHillSupportContactProvider(
    { ...provider, sampleTexture: null },
    { device },
  ),
  /sample texture/i,
);
assert.throws(
  () => fingerFluidCore.createFingerFluidMovingHillSupportContactProvider({
    device,
    terrainFrame: {
      ...terrainFrame,
      complete: false,
    },
    identity,
  }),
  /complete/i,
  'a partial canonical terrain frame must not become authoritative GPU support',
);
assert.throws(
  () => fingerFluidCore.createFingerFluidMovingHillSupportContactProvider({
    device,
    terrainFrame: {
      ...terrainFrame,
      fields: {
        ...terrainFrame.fields,
        valid: new Uint8Array([1, 1, 0, 1]),
      },
    },
    identity,
  }),
  /valid/i,
  'invalid support samples must fail before the solver can silently lose terrain',
);

assert.match(source, /movingHillSupportContactProviderFactory/);
assert.match(source, /await movingHillSupportContactProviderFactory\(\{\s*device,\s*queue:\s*device\.queue/s);
assert.match(source, /@group\(0\)\s*@binding\(12\).*movingHillSupportSamples:\s*texture_2d_array<f32>/);
assert.match(source, /@group\(0\)\s*@binding\(13\).*movingHillSupportParams/);
assert.match(source, /fn movingHillSupportContactFrame\(/);
assert.match(source, /supportVelocity/);
assert.match(source, /signedDistance/);
assert.match(source, /source:\s*\{\s*repository:\s*'kaminos'/s);
assert.match(source, /visibilityAuthority:\s*'gpu_descriptor_texture_without_host_readback'/);
assert.match(source, /hostReadbackVisibility:\s*false/);
assert.match(source, /supportContact,\s*\n\s*\};/);
assert.match(source, /fallbackRoute:\s*movingHillSupportProvider\.fallbackRoute/);
assert.match(
  source,
  /visibilityAuthority:\s*movingHillSupportProvider\?\.visibilityAuthority\s*\?\?\s*'gpu_descriptor_without_host_readback'/,
  'the analytic diagnostic route must publish its GPU visibility authority without dereferencing a missing Hill provider',
);
assert.match(
  source,
  /function failFingerFluidInitialization\([\s\S]*movingHillSupportProvider\?\.release\?\.\(\);[\s\S]*device\.destroy\(\);/,
  'every unavailable exit after provider allocation must release moving-Hill resources before destroying the device',
);

assert.match(browserWitnessSource, /synthetic_canonical_frame_contract_witness_not_lerms_source_authority/);
assert.match(browserWitnessSource, /sourceAuthority:\s*'synthetic_fixture_only'/);
assert.match(browserWitnessSource, /composed_revision must be an exact 40-character lowercase Git revision/);
assert.match(browserWitnessSource, /supportContactRoute:\s*KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE/);
assert.match(browserWitnessSource, /movingHillSupportContactProviderFactory\(\{\s*device\s*\}\)/);
assert.match(browserWitnessSource, /provider\.update\(\{/);
assert.match(browserWitnessSource, /support\.fallbackRoute !== null/);
assert.match(browserWitnessSource, /support\.deviceMatchesSolver !== true/);
assert.match(browserWitnessSource, /support\.hostReadbackVisibility !== false/);
assert.match(browserWitnessRunnerSource, /served source differs from local checkout/);
assert.match(browserWitnessRunnerSource, /effective URL differs from requested URL/);
assert.match(browserWitnessRunnerSource, /fallback route rejected/);
assert.match(browserWitnessRunnerSource, /same-device support authority rejected/);
assert.match(browserWitnessRunnerSource, /stale moving-Hill epoch evidence rejected/);
assert.match(browserWitnessRunnerSource, /captured moving-Hill output is blank or partial/);
assert.match(browserWitnessRunnerSource, /primary_output_written:\s*primaryOutputWritten/);
assert.match(browserWitnessRunnerSource, /failure_phase:\s*phase/);
assert.match(browserWitnessRunnerSource, /lastTrustworthyEvidence/);

console.log('finger fluid moving-Hill support contracts passed');
