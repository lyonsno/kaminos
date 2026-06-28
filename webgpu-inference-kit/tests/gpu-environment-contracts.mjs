import assert from 'node:assert/strict';

import {
  createWebGpuBackendIdentity,
  createWebGpuDeviceRequest,
  validateWebGpuBackendIdentity,
} from '../src/index.js';

const adapter = {
  features: new Set(['timestamp-query', 'shader-f16']),
  limits: {
    maxBufferSize: 4294967296,
    maxStorageBufferBindingSize: 2147483648,
    maxComputeWorkgroupStorageSize: 65536,
    maxComputeInvocationsPerWorkgroup: 1024,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeWorkgroupSizeY: 1024,
  },
};

const request = createWebGpuDeviceRequest(adapter, { timestampQuery: 'prefer' });
assert.deepEqual(request.requiredFeatures, ['timestamp-query']);
assert.equal(request.timestampQuery, 'requested');
assert.equal(request.requiredLimits.maxBufferSize, adapter.limits.maxBufferSize);
assert.equal(request.requiredLimits.maxStorageBufferBindingSize, adapter.limits.maxStorageBufferBindingSize);

const noTimestamp = createWebGpuDeviceRequest({ ...adapter, features: new Set(['shader-f16']) }, { timestampQuery: 'prefer' });
assert.deepEqual(noTimestamp.requiredFeatures, []);
assert.equal(noTimestamp.timestampQuery, 'unavailable');

const identity = createWebGpuBackendIdentity({
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  requestedFeatures: request.requiredFeatures,
  effectiveFeatures: ['timestamp-query', 'shader-f16'],
  limits: request.requiredLimits,
  timestampQuery: request.timestampQuery,
});

assert.equal(identity.kind, 'webgpu-local');
assert.equal(identity.runtime, 'browser');
assert.deepEqual(identity.features, ['shader-f16', 'timestamp-query']);
assert.equal(validateWebGpuBackendIdentity(identity).ok, true);

const missingEffectiveFeatures = {
  ...identity,
  features: [],
};
const missingResult = validateWebGpuBackendIdentity(missingEffectiveFeatures);
assert.equal(missingResult.ok, false);
assert.match(missingResult.errors.join('\n'), /features/);

const fakeTimestamp = {
  ...identity,
  timestampQuery: 'requested',
  requestedFeatures: [],
};
const fakeTimestampResult = validateWebGpuBackendIdentity(fakeTimestamp);
assert.equal(fakeTimestampResult.ok, false);
assert.match(fakeTimestampResult.errors.join('\n'), /timestamp-query/);

console.log('gpu environment contracts passed');
