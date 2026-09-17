import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the actual exported acquisition function without constructing a GPU
// or importing the browser renderer. This tests our policy, not WebGPU conformance.
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const factorySource = core.match(/export async function requestKaminosSharedWebGpuDevice\([\s\S]*?\n}/)[0];
const requiredBytes = 3 * 96 * 96 * 2 * 4096 * 4;
assert.equal(requiredBytes, 905969664);
let requests = [];
let destroys = 0;
const adapterLimits = {
  maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824,
  maxStorageBuffersPerShaderStage: 12,
  maxStorageBuffersInFragmentStage: 8, maxStorageBuffersInVertexStage: 8,
};
const adapter = {
  limits: {...adapterLimits}, features: new Set(['timestamp-query']),
  async requestDevice(descriptor) {
    requests.push(descriptor);
    return {queue: {submit() {}}, limits: {...descriptor.requiredLimits}, features: new Set(descriptor.requiredFeatures), destroy() { destroys++; }};
  },
};
const acquire = new Function('navigator', 'fluidBufferBytes', 'SUPPORTED_GRID_SIZES', 'KAMINOS_SHARED_WEBGPU_DEVICE_IDENTITY',
  `${factorySource.replace('export ', '')}; return requestKaminosSharedWebGpuDevice;`
)({gpu: {requestAdapter: async () => adapter}}, grid => grid ** 3 * 16 * 4, [32, 160], 'test-device');
const requirements = {maxBufferSize: requiredBytes, maxStorageBufferBindingSize: requiredBytes};
const shared = await acquire({bufferRequirements: requirements});
assert.equal(requests.length, 1, 'one host device acquisition');
assert.equal(requests[0].requiredLimits.maxBufferSize, requiredBytes, 'SF3D intermediate allocation must fit the requested device');
assert.equal(requests[0].requiredLimits.maxStorageBufferBindingSize, requiredBytes, 'SF3D full binding must fit');
assert.equal(requests[0].requiredLimits.maxStorageBuffersPerShaderStage, 12, 'preserve flame capacity');
assert.equal(shared.queue, shared.device.queue);
assert.deepEqual(requirements, {maxBufferSize: requiredBytes, maxStorageBufferBindingSize: requiredBytes}, 'do not mutate module requirements');

requests = [];
adapter.limits.maxStorageBufferBindingSize = requiredBytes - 1;
await assert.rejects(acquire({bufferRequirements: requirements}), /maxStorageBufferBindingSize/);
assert.equal(requests.length, 0, 'refuse before allocation on unsupported adapter');
adapter.limits = {...adapterLimits};
for (const bad of [null, [], {maxBufferSize: NaN}, {maxBufferSize: 0}, {maxBufferSize: 1.5}, {minUniformBufferOffsetAlignment: 16}]) {
  await assert.rejects(acquire({bufferRequirements: bad}), /buffer requirement/i);
}
const requestDevice = adapter.requestDevice;
adapter.requestDevice = async descriptor => ({...(await requestDevice(descriptor)), limits: {maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728}});
await assert.rejects(acquire({bufferRequirements: requirements}), /effective.*maxBufferSize/);
assert.equal(destroys, 1, 'retire owned unusable device');
adapter.requestDevice = requestDevice;
requests = [];
await acquire();
assert.equal(requests[0].requiredLimits.maxStorageBufferBindingSize, 262144000, 'ordinary host retains existing request without a model');
assert.equal(requests[0].requiredLimits.maxBufferSize, undefined);
console.log('SF3D shared-device acquisition contracts passed');
