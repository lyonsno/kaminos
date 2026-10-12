import assert from 'node:assert/strict';
import {requestKaminosSharedWebGpuDevice} from '../volume-core.js';

// This executes the actual host acquisition seam. The fake device establishes
// caller policy and ordering only, not native memory capacity/conformance.
const limits = {
  maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824,
  maxStorageBuffersPerShaderStage: 12,
  maxStorageBuffersInFragmentStage: 8, maxStorageBuffersInVertexStage: 8,
};
let nativeRequests = 0, destroys = 0, acquisitionCalls = 0;
const device = {
  limits, features: new Set(['timestamp-query']), queue: {submit() {}},
  destroy() { destroys++; },
};
const adapter = {
  limits, features: device.features,
  async requestDevice() { nativeRequests++; return device; },
};
let observedDescriptor;
const acquireDevice = async (actualAdapter, descriptor) => {
  acquisitionCalls++;
  assert.equal(actualAdapter, adapter, 'guard sees the actual resolved adapter');
  observedDescriptor = descriptor;
  const acquired = await actualAdapter.requestDevice(descriptor);
  acquired.guardInstalledBeforeExposure = true;
  return acquired;
};
const shared = await requestKaminosSharedWebGpuDevice({adapter, acquireDevice});
assert.equal(acquisitionCalls, 1, 'actual host acquisition must use caller instrumentation, not bypass it');
assert.equal(nativeRequests, 1, 'one device, no unguarded fallback');
assert.equal(shared.device, device);
assert.equal(shared.device.guardInstalledBeforeExposure, true);
assert.deepEqual(observedDescriptor.requiredLimits, shared.requiredLimits);
assert.deepEqual(observedDescriptor.requiredFeatures, shared.requiredFeatures);

nativeRequests = 0;
await assert.rejects(requestKaminosSharedWebGpuDevice({adapter, acquireDevice: async () => {
  throw new Error('caller acquisition refused');
}}), /caller acquisition refused/);
assert.equal(nativeRequests, 0, 'refusal cannot fall back to uninstrumented acquisition');
for (const invalid of [null, {}, true, 1]) {
  await assert.rejects(requestKaminosSharedWebGpuDevice({adapter, acquireDevice: invalid}), /acquireDevice.*function/);
}
assert.equal(nativeRequests, 0, 'malformed instrumentation fails before native acquisition');

destroys = 0;
await assert.rejects(requestKaminosSharedWebGpuDevice({adapter, acquireDevice: async () => ({
  ...device, limits: {...limits, maxBufferSize: 1},
})}), /effective.*maxBufferSize/);
assert.equal(destroys, 1, 'existing effective-limit validation retires guarded unusable device');
await requestKaminosSharedWebGpuDevice({adapter});
assert.equal(nativeRequests, 1, 'ordinary acquisition is unchanged when no guard is supplied');
console.log('shared-device acquisition owner contracts passed');
