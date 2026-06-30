import assert from 'node:assert/strict';

import {
  createWebGpuRuntimeProfile,
  createWebGpuRuntimeProfileInput,
  validateWebGpuRuntimeProfile,
} from '../src/index.js';

const backend = {
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  requestedFeatures: ['timestamp-query'],
  effectiveFeatures: ['shader-f16', 'timestamp-query'],
  limits: {
    maxBufferSize: 4294967296,
    maxStorageBufferBindingSize: 2147483648,
  },
  timestampQuery: 'requested',
};

const stagedProfile = {
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'staged-submits',
  timingSource: 'queue-submit-wait',
  requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
  stages: [
    { name: 'backbone', ms: 1000.04 },
    { name: 'decoder-heads', ms: 850.01 },
    { name: 'output-readback', ms: 2.02 },
  ],
};

const runtimeInput = createWebGpuRuntimeProfileInput({
  routeId: 'moge.depth-normal.webgpu-local.v0',
  runtimeLabel: 'chrome-webgpu-apple-metal',
  backend,
  kernel: {
    profile: 'conv-transpose2d-stride2',
    commit: 'a1bf4d3',
  },
  profile: stagedProfile,
  evidence: {
    mode: 'live',
    source: 'browser-webgpu-route',
  },
});

assert.equal(runtimeInput.backend.kind, 'webgpu-local');
assert.equal(runtimeInput.backend.runtime, 'browser');
assert.deepEqual(runtimeInput.backend.requestedFeatures, ['timestamp-query']);
assert.deepEqual(runtimeInput.backend.features, ['shader-f16', 'timestamp-query']);
assert.equal(runtimeInput.kernel.profile, 'conv-transpose2d-stride2');
assert.equal(runtimeInput.profile.totalMs, 1852.1);
assert.equal(runtimeInput.evidence.mode, 'live');

const runtimeProfile = createWebGpuRuntimeProfile({
  ...runtimeInput,
  requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
  timingSource: 'queue-submit-wait',
});

assert.equal(runtimeProfile.schema, 'kaminos.webgpu-runtime-profile.v0');
assert.equal(runtimeProfile.routeId, 'moge.depth-normal.webgpu-local.v0');
assert.equal(runtimeProfile.runtimeLabel, 'chrome-webgpu-apple-metal');
assert.equal(runtimeProfile.profile.timingSource, 'queue-submit-wait');
assert.equal(runtimeProfile.timingSource, 'queue-submit-wait');
assert.deepEqual(runtimeProfile.requiredStages, ['backbone', 'decoder-heads', 'output-readback']);
assert.deepEqual(validateWebGpuRuntimeProfile(runtimeProfile), { ok: true, errors: [] });

const missingIdentity = validateWebGpuRuntimeProfile({
  ...runtimeProfile,
  backend: { ...runtimeProfile.backend, adapterName: '' },
});
assert.equal(missingIdentity.ok, false);
assert.match(missingIdentity.errors.join('\n'), /adapterName/);

assert.throws(
  () => createWebGpuRuntimeProfileInput({
    routeId: 'moge.depth-normal.webgpu-local.v0',
    backend: {
      ...backend,
      requestedFeatures: [],
    },
    kernel: runtimeInput.kernel,
    profile: {
      ...stagedProfile,
      timingSource: 'timestamp-query',
    },
  }),
  /timestamp-query profile must be validated against staged-submit timings|timestamp-query requested state/,
);

const stages = ['backbone'];
const isolated = createWebGpuRuntimeProfile({
  ...runtimeInput,
  requiredStages: stages,
});
stages.push('mutated-after-call');
assert.deepEqual(isolated.requiredStages, ['backbone']);

console.log('runtime profile contracts passed');
