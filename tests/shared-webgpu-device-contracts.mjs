import assert from 'node:assert/strict';
import { requestKaminosSharedWebGpuDevice } from '../volume-core.js';

const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const calls = [];
const features = new Set(['timestamp-query', 'shader-f16']);
let destroyed = 0;
const adapter = {
  features,
  limits: {
    maxBufferSize: 1_500_000_000,
    maxStorageBufferBindingSize: 1_500_000_000,
    maxStorageBuffersPerShaderStage: 9,
    maxStorageBuffersInFragmentStage: 5,
    maxStorageBuffersInVertexStage: 4,
  },
  async requestDevice(descriptor) {
    calls.push(descriptor);
    return { queue: {}, features, limits: this.limits, destroy() { destroyed += 1; } };
  },
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { gpu: { async requestAdapter() { return adapter; } } },
});

try {
  const requiredLimits = { maxBufferSize: 905_969_664, maxStorageBufferBindingSize: 905_969_664 };
  const hostLimits = { maxStorageBuffersPerShaderStage: 9 };
  const shared = await requestKaminosSharedWebGpuDevice({
    bufferRequirements: requiredLimits,
    requiredFeatures: ['shader-f16'],
    requiredLimits: hostLimits,
  });
  assert.equal(shared.device.queue, shared.queue);
  assert.equal(shared.requiredLimits.maxBufferSize, requiredLimits.maxBufferSize);
  assert.deepEqual(calls[0].requiredFeatures, ['shader-f16', 'timestamp-query']);
  assert.equal(calls[0].requiredLimits.maxBufferSize, requiredLimits.maxBufferSize);
  assert.equal(calls[0].requiredLimits.maxStorageBuffersPerShaderStage, 9);

  await assert.rejects(
    requestKaminosSharedWebGpuDevice({ bufferRequirements: { maxBufferSize: 1_500_000_001 } }),
    /adapter maxBufferSize 1500000000 is below composition buffer requirement 1500000001/,
  );
  await assert.rejects(
    requestKaminosSharedWebGpuDevice({ requiredFeatures: ['unavailable-feature'] }),
    /adapter feature unavailable-feature is unavailable/,
  );
  const requestDevice = adapter.requestDevice;
  adapter.requestDevice = async descriptor => ({ ...(await requestDevice.call(adapter, descriptor)), limits: { ...adapter.limits, maxStorageBuffersPerShaderStage: 8 } });
  await assert.rejects(
    requestKaminosSharedWebGpuDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: 9 } }),
    /effective device maxStorageBuffersPerShaderStage does not satisfy shared-device requirement 9/,
  );
  assert.equal(destroyed, 1, 'retire a device that cannot honor the admitted host limits');
} finally {
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  else delete globalThis.navigator;
}

console.log('shared WebGPU device admission contracts passed');
