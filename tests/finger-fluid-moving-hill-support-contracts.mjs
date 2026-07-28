import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert.equal(
  typeof fingerFluidCore.createFingerFluidSupportContactIdentity,
  'function',
  'particle ownership must publish an inert support identity instead of the mutable provider',
);
assert.equal(
  typeof fingerFluidCore.failFingerFluidWebGPUInitialization,
  'function',
  'post-device initialization failures must share one provider/device cleanup primitive',
);
assert.equal(
  typeof fingerFluidCore.failFingerFluidWebGPURuntimeOperation,
  'function',
  'post-construction runtime failures must share one solver/device cleanup primitive',
);
assert.equal(
  typeof fingerFluidCore.createFingerFluidWebGPURuntimeLifecycle,
  'function',
  'device loss and completed teardown must be represented by distinct lifecycle state',
);

let resolveLifecycleDeviceLoss;
const lifecycleDeviceLoss = new Promise(resolveLoss => {
  resolveLifecycleDeviceLoss = resolveLoss;
});
let observedDeviceLoss = null;
const lifecycle = fingerFluidCore.createFingerFluidWebGPURuntimeLifecycle({
  deviceLost: lifecycleDeviceLoss,
  onDeviceLost(info) {
    observedDeviceLoss = info;
  },
});
assert.equal(lifecycle.stopped, false);
assert.equal(lifecycle.beginTeardown(), true);
assert.equal(lifecycle.beginTeardown(), false, 'normal teardown must remain idempotent');

let resolvePreTeardownDeviceLoss;
const preTeardownDeviceLoss = new Promise(resolveLoss => {
  resolvePreTeardownDeviceLoss = resolveLoss;
});
const lossBeforeTeardownLifecycle = fingerFluidCore.createFingerFluidWebGPURuntimeLifecycle({
  deviceLost: preTeardownDeviceLoss,
});
resolvePreTeardownDeviceLoss({ reason: 'destroyed', message: 'test device loss' });
await preTeardownDeviceLoss;
await Promise.resolve();
assert.equal(lossBeforeTeardownLifecycle.stopped, true);
assert.equal(
  lossBeforeTeardownLifecycle.beginTeardown(),
  true,
  'device loss must stop runtime work without suppressing the first owned-resource teardown',
);
assert.equal(lossBeforeTeardownLifecycle.beginTeardown(), false);

resolveLifecycleDeviceLoss({ reason: 'destroyed', message: 'post-teardown loss' });
await lifecycleDeviceLoss;
await Promise.resolve();
assert.equal(lifecycle.stopped, true);
assert.deepEqual(observedDeviceLoss, {
  reason: 'destroyed',
  message: 'post-teardown loss',
});

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
const supportContactIdentity = fingerFluidCore.createFingerFluidSupportContactIdentity(
  provider,
  { device },
);
assert.equal(Object.isFrozen(supportContactIdentity), true);
assert.equal(supportContactIdentity.route, movingHillRoute);
assert.equal(supportContactIdentity.sourceId, identity.sourceId);
assert.equal(supportContactIdentity.terrainEpoch, nextIdentity.terrainEpoch);
assert.equal(supportContactIdentity.deviceMatchesSolver, true);
assert.equal(
  Object.hasOwn(supportContactIdentity, 'provider'),
  false,
  'the ownership descriptor must not expose the provider update/release authority',
);
assert.equal(typeof supportContactIdentity.update, 'undefined');
assert.equal(typeof supportContactIdentity.release, 'undefined');

let cleanupReleaseCount = 0;
let cleanupDestroyCount = 0;
const unavailable = fingerFluidCore.failFingerFluidWebGPUInitialization({
  provider: {
    release() {
      cleanupReleaseCount += 1;
    },
  },
  device: {
    destroy() {
      cleanupDestroyCount += 1;
    },
  },
  reason: 'moving-Hill bind group rejected',
  details: { phase: 'compute-bind-group' },
});
assert.equal(cleanupReleaseCount, 1);
assert.equal(cleanupDestroyCount, 1);
assert.equal(unavailable.available, false);
assert.match(unavailable.reason, /moving-Hill bind group rejected/i);
assert.deepEqual(unavailable.phase, 'compute-bind-group');
let runtimeCleanupCount = 0;
let runtimeDeviceDestroyCount = 0;
assert.throws(
  () => fingerFluidCore.failFingerFluidWebGPURuntimeOperation({
    destroyRuntime() {
      runtimeCleanupCount += 1;
    },
    device: {
      destroy() {
        runtimeDeviceDestroyCount += 1;
      },
    },
    phase: 'configure-render-extent',
    error: new Error('screen-space bind group rejected'),
  }),
  error => {
    assert.equal(error.failurePhase, 'configure-render-extent');
    assert.match(error.message, /screen-space bind group rejected/i);
    return true;
  },
);
assert.equal(runtimeCleanupCount, 1);
assert.equal(runtimeDeviceDestroyCount, 1);
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
  /function failFingerFluidInitialization\([\s\S]*failFingerFluidWebGPUInitialization\(\{[\s\S]*provider:\s*movingHillSupportProvider,[\s\S]*device,[\s\S]*reason,[\s\S]*details,[\s\S]*\}\)/,
  'every unavailable exit after provider allocation must release moving-Hill resources before destroying the device',
);
assert.match(
  source,
  /let computeBindGroup;\s*try \{\s*computeBindGroup = device\.createBindGroup\([\s\S]*\);\s*\} catch \(error\) \{\s*return failFingerFluidInitialization\(`WebGPU compute bind group validation failed:/,
  'a provider resource rejected during bind-group creation must release the provider and destroy the device',
);
assert.match(
  source,
  /function failFingerFluidInitialization\([\s\S]*?\n  \}\s*try \{\s*const context = canvas\.getContext\('webgpu'\);[\s\S]*?return runtimeApi;\s*\} catch \(error\) \{\s*return failFingerFluidInitialization\(\s*`WebGPU post-provider initialization failed:/,
  'every constructor allocation after provider ownership transfers must share one cleanup boundary',
);
const ensureExtentSource = source.slice(
  source.indexOf('function ensureExtent('),
  source.indexOf('function writeDynamicReflectionSceneParams()'),
);
assert.match(
  ensureExtentSource,
  /try \{[\s\S]*context\.configure\([\s\S]*device\.createBindGroup\([\s\S]*\} catch \(error\) \{\s*return failFingerFluidWebGPURuntimeOperation\(\{[\s\S]*destroyRuntime:\s*destroy,[\s\S]*device,[\s\S]*phase:\s*'configure-render-extent',[\s\S]*error,[\s\S]*\}\);/,
  'first-resize allocation failures must tear down the runtime and device before surfacing the error',
);
const ownershipDescriptorSource = source.slice(
  source.indexOf('function getParticleOwnershipDescriptor()'),
  source.indexOf('function getDebugState()'),
);
assert.match(
  ownershipDescriptorSource,
  /createFingerFluidSupportContactIdentity\(\s*movingHillSupportProvider,\s*\{\s*device\s*\},?\s*\)/,
);
assert.doesNotMatch(
  ownershipDescriptorSource,
  /provider:\s*movingHillSupportProvider/,
  'particle ownership must not transfer mutable moving-support provider authority',
);
assert.doesNotMatch(
  ownershipDescriptorSource,
  /runtime:\s*runtimeApi/,
  'consumer-facing ownership descriptors must not expose runtime teardown authority',
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

const servedWitnessFiles = new Map([
  [
    '/finger-fluid-moving-hill-support-witness.html',
    new URL('../finger-fluid-moving-hill-support-witness.html', import.meta.url),
  ],
  [
    '/finger-fluid-moving-hill-support-witness.js',
    new URL('../finger-fluid-moving-hill-support-witness.js', import.meta.url),
  ],
  [
    '/finger-fluid-webgpu-core.js',
    new URL('../finger-fluid-webgpu-core.js', import.meta.url),
  ],
]);
const sourceServer = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const sourceFile = servedWitnessFiles.get(pathname);
  if (!sourceFile) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': pathname.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : 'text/javascript; charset=utf-8',
  });
  response.end(readFileSync(sourceFile));
});
sourceServer.listen(0, '127.0.0.1');
await once(sourceServer, 'listening');

const spawnFailureRoot = mkdtempSync(resolve(tmpdir(), 'moving-hill-spawn-failure-'));
const spawnFailureReport = resolve(spawnFailureRoot, 'failure.json');
const spawnFailureOutput = resolve(spawnFailureRoot, 'failure.png');
const sourcePort = sourceServer.address().port;
const witnessRunner = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../finger-fluid-moving-hill-support-witness.mjs', import.meta.url)),
    '--url',
    `http://127.0.0.1:${sourcePort}/finger-fluid-moving-hill-support-witness.html?composed_revision=${'f'.repeat(40)}`,
    '--out',
    spawnFailureOutput,
    '--report',
    spawnFailureReport,
    '--debug-port',
    '9593',
  ],
  {
    env: {
      ...process.env,
      KAMINOS_CHROME: '/definitely/missing/kaminos-test-chrome',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
let spawnFailureStderr = '';
witnessRunner.stderr.on('data', chunk => {
  spawnFailureStderr += chunk.toString();
});
const [spawnFailureExitCode] = await once(witnessRunner, 'close');
sourceServer.close();
await once(sourceServer, 'close');

const spawnFailureReportExists = existsSync(spawnFailureReport);
const spawnFailureEvidence = spawnFailureReportExists
  ? JSON.parse(readFileSync(spawnFailureReport, 'utf8'))
  : null;
rmSync(spawnFailureRoot, { recursive: true, force: true });

assert.notEqual(spawnFailureExitCode, 0, 'a missing browser executable must fail the witness');
assert.equal(
  spawnFailureReportExists,
  true,
  `a browser launch failure must still write a durable report; stderr:\n${spawnFailureStderr}`,
);
assert.equal(spawnFailureEvidence.ok, false);
assert.equal(spawnFailureEvidence.failure_phase, 'launch-browser');
assert.equal(spawnFailureEvidence.primary_output_written, false);
assert.equal(spawnFailureEvidence.lastTrustworthyEvidence.phase, 'bind-served-source');
assert.match(spawnFailureEvidence.error, /ENOENT|spawn/i);

console.log('finger fluid moving-Hill support contracts passed');
