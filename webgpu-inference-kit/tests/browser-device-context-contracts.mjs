import assert from 'node:assert/strict';

import {
  requestBrowserWebGpuDevice,
  validateWebGpuBackendIdentity,
} from '../src/index.js';

let requestedAdapterOptions = null;
let requestedDeviceDescriptor = null;

const adapter = {
  info: { description: 'Apple Metal 3' },
  features: new Set(['shader-f16', 'timestamp-query']),
  limits: {
    maxBufferSize: 4294967296,
    maxStorageBufferBindingSize: 2147483648,
    maxComputeWorkgroupStorageSize: 65536,
    maxComputeInvocationsPerWorkgroup: 1024,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeWorkgroupSizeY: 1024,
  },
  async requestDevice(descriptor) {
    requestedDeviceDescriptor = descriptor;
    return {
      label: descriptor.label,
      features: new Set(descriptor.requiredFeatures),
      limits: descriptor.requiredLimits,
    };
  },
};

const gpu = {
  async requestAdapter(options) {
    requestedAdapterOptions = options;
    return adapter;
  },
};

const context = await requestBrowserWebGpuDevice(gpu, {
  adapterOptions: { powerPreference: 'high-performance' },
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  label: 'moge-depth-normal-route',
  timestampQuery: 'prefer',
});

assert.deepEqual(requestedAdapterOptions, { powerPreference: 'high-performance' });
assert.deepEqual(requestedDeviceDescriptor.requiredFeatures, ['timestamp-query']);
assert.equal(requestedDeviceDescriptor.requiredLimits.maxBufferSize, adapter.limits.maxBufferSize);
assert.equal(context.device.label, 'moge-depth-normal-route');
assert.equal(context.deviceRequest.timestampQuery, 'requested');
assert.equal(context.backendIdentity.kind, 'webgpu-local');
assert.equal(context.backendIdentity.adapterName, 'Apple M4 Max');
assert.deepEqual(context.backendIdentity.requestedFeatures, ['timestamp-query']);
assert.deepEqual(context.backendIdentity.features, ['timestamp-query']);
assert.equal(validateWebGpuBackendIdentity(context.backendIdentity).ok, true);

assert.throws(
  () => requestBrowserWebGpuDevice(null),
  /gpu.requestAdapter/,
);

await assert.rejects(
  () => requestBrowserWebGpuDevice({ async requestAdapter() { return null; } }),
  /WebGPU adapter unavailable/,
);

console.log('browser device context contracts passed');
