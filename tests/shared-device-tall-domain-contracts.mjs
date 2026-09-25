import assert from 'node:assert/strict';
import { requestKaminosSharedWebGpuDevice } from '../volume-core.js';

// The shared host device replaces the device the volume prototype would
// otherwise request for itself. Current main simulates a tall 1x2x1 domain
// (size x 2*size x size), so the shared device must admit the prototype's own
// storage capacity, not the older cubic fluid size. Exercises the real export
// with a fake adapter; this tests Kaminos policy, not WebGPU conformance.

const TALL_FLUID_BYTES_AT_160 = 160 * 320 * 160 * 16 * 4; // 524,288,000
const CUBIC_FLUID_BYTES_AT_160 = 160 * 160 * 160 * 16 * 4; // 262,144,000
assert.equal(TALL_FLUID_BYTES_AT_160, 524288000);
// Largest per-cell buffer the prototype sizes for itself: flow-kernel
// descriptors at 100 floats per cell over the tallest supported domain.
const PROTOTYPE_REQUESTED_BYTES = 160 * 320 * 160 * 100 * 4;

let requests = [];
let destroys = 0;
const baseLimits = Object.freeze({
  maxBufferSize: 4294967296,
  maxStorageBufferBindingSize: 4294967292,
  maxStorageBuffersPerShaderStage: 12,
  maxStorageBuffersInFragmentStage: 8,
  maxStorageBuffersInVertexStage: 8,
  minStorageBufferOffsetAlignment: 32,
  minUniformBufferOffsetAlignment: 256,
});
function fakeAdapter(limits = baseLimits, features = ['timestamp-query', 'shader-f16']) {
  return {
    limits: { ...limits },
    features: new Set(features),
    info: { vendor: 'test' },
    async requestDevice(descriptor = {}) {
      requests.push(descriptor);
      return {
        queue: { submit() {} },
        limits: { ...limits, ...(descriptor.requiredLimits || {}) },
        features: new Set(descriptor.requiredFeatures || []),
        destroy() { destroys += 1; },
      };
    },
  };
}
function installGpu(adapter) {
  Object.defineProperty(globalThis.navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => adapter },
  });
}

// Ordinary host (no composition module): every supported tall grid's fluid
// buffer must bind on the shared device.
installGpu(fakeAdapter());
requests = [];
let shared = await requestKaminosSharedWebGpuDevice();
assert.equal(requests.length, 1, 'one host device acquisition');
let granted = requests[0].requiredLimits || {};
assert.ok(granted.maxStorageBufferBindingSize >= TALL_FLUID_BYTES_AT_160,
  `tall 160 fluid binding must fit the shared device: granted ${granted.maxStorageBufferBindingSize}, cubic legacy ${CUBIC_FLUID_BYTES_AT_160}`);
assert.equal(granted.maxStorageBufferBindingSize, Math.min(baseLimits.maxBufferSize, baseLimits.maxStorageBufferBindingSize, PROTOTYPE_REQUESTED_BYTES),
  'shared device admits the same storage capacity the prototype requests for its own device');
assert.equal(granted.maxBufferSize, granted.maxStorageBufferBindingSize,
  'buffer size and binding size are provisioned together, as the prototype does');
assert.ok(granted.maxStorageBuffersPerShaderStage >= 10, 'boundary-splat compute layouts need ten storage buffers');
assert.equal(shared.queue, shared.device.queue);

// Composition requirement above the volume request still wins.
const sf3dBytes = 905969664;
const smallCaps = { ...baseLimits, maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824 };
installGpu(fakeAdapter(smallCaps));
requests = [];
await requestKaminosSharedWebGpuDevice({ bufferRequirements: { maxBufferSize: sf3dBytes, maxStorageBufferBindingSize: sf3dBytes } });
granted = requests[0].requiredLimits;
assert.equal(granted.maxStorageBufferBindingSize, 1073741824, 'clamped volume request on a 1 GiB adapter');
assert.ok(granted.maxBufferSize >= sf3dBytes && granted.maxStorageBufferBindingSize >= sf3dBytes, 'SF3D requirement admitted');

// A small adapter is clamped exactly as the prototype clamps its own device.
const tinyCaps = { ...baseLimits, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728 };
installGpu(fakeAdapter(tinyCaps));
requests = [];
await requestKaminosSharedWebGpuDevice();
assert.equal(requests[0].requiredLimits.maxStorageBufferBindingSize, 134217728, 'clamped to adapter support');
assert.equal(requests[0].requiredLimits.maxBufferSize, 134217728);

// SAM host requirements compose onto the same device: features are unioned,
// max* limits take the larger value, alignment min* limits take the smaller.
installGpu(fakeAdapter());
requests = [];
let hostAdapter = null;
shared = await requestKaminosSharedWebGpuDevice({
  hostRequirements: async adapter => {
    hostAdapter = adapter;
    return { requiredFeatures: ['shader-f16'], requiredLimits: { maxStorageBuffersPerShaderStage: 12, minStorageBufferOffsetAlignment: 32 } };
  },
});
assert.equal(hostAdapter, shared.adapter, 'host requirements are derived from the acquisition adapter');
granted = requests[0];
assert.deepEqual([...granted.requiredFeatures].sort(), ['shader-f16', 'timestamp-query']);
assert.equal(granted.requiredLimits.maxStorageBuffersPerShaderStage, 12);
assert.equal(granted.requiredLimits.minStorageBufferOffsetAlignment, 32);
assert.ok(granted.requiredLimits.maxStorageBufferBindingSize >= TALL_FLUID_BYTES_AT_160, 'SAM composition keeps the volume capacity');
await assert.rejects(requestKaminosSharedWebGpuDevice({ hostRequirements: { requiredFeatures: ['texture-compression-astc'] } }), /feature/i);

// A supplied adapter is used as-is (SAM needs the adapter before acquisition).
const supplied = fakeAdapter();
installGpu(null);
requests = [];
shared = await requestKaminosSharedWebGpuDevice({ adapter: supplied });
assert.equal(shared.adapter, supplied);

// Effective device below a requested limit is retired and refused.
const lying = fakeAdapter();
lying.requestDevice = async descriptor => ({ queue: {}, limits: { ...baseLimits, maxStorageBufferBindingSize: 134217728 },
  features: new Set(descriptor.requiredFeatures || []), destroy() { destroys += 1; } });
destroys = 0;
await assert.rejects(requestKaminosSharedWebGpuDevice({ adapter: lying }), /effective/);
assert.equal(destroys, 1, 'retire unusable owned device');

console.log('shared device tall-domain contracts passed');
