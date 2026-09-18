import assert from 'node:assert/strict';
import * as kit from '../src/index.js';

const model = { requiredFeatures: ['shader-f16'], requiredLimits: { maxBufferSize: 905969664, maxStorageBufferBindingSize: 905969664, minUniformBufferOffsetAlignment: 64 } };
const renderer = { requiredFeatures: ['shader-f16'], requiredLimits: { maxBufferSize: 262144000, maxStorageBuffersPerShaderStage: 12, maxSampledTexturesPerShaderStage: 16, minUniformBufferOffsetAlignment: 256 } };
const adapter = {
  features: new Set(['shader-f16', 'timestamp-query']),
  limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824, maxStorageBuffersPerShaderStage: 16, maxSampledTexturesPerShaderStage: 32, minUniformBufferOffsetAlignment: 32 },
};

// The existing descriptor ignores model requirements; this is the pre-fix falsifier.
const request = kit.createWebGpuDeviceRequest(adapter, { requirements: model });
assert.ok(request.requiredFeatures.includes('shader-f16'), 'required model features must reach requestDevice');

for (const name of ['minUniformBufferOffsetAlignment', 'minStorageBufferOffsetAlignment']) {
  for (const value of [0, 192, 3, 4294967296, 4294967297, 2 ** 40]) {
    const requirements = { requiredLimits: { [name]: value } };
    assert.throws(() => kit.composeWebGpuDeviceRequirements([requirements]), /power of two/, `${name} rejects ${value}`);
    assert.throws(() => kit.validateWebGpuDeviceRequirements(adapter, requirements), /power of two/);
    assert.throws(() => kit.createWebGpuDeviceRequest(adapter, { requirements }), /power of two/);
  }
  for (const value of [1, 32, 256, 2147483648]) {
    assert.equal(kit.composeWebGpuDeviceRequirements([{ requiredLimits: { [name]: value } }]).requiredLimits[name], value);
  }
}

const composed = kit.composeWebGpuDeviceRequirements([model, renderer]);
assert.deepEqual(composed.requiredFeatures, ['shader-f16']);
assert.equal(composed.requiredLimits.maxBufferSize, 905969664);
assert.equal(composed.requiredLimits.maxStorageBuffersPerShaderStage, 12);
assert.equal(composed.requiredLimits.minUniformBufferOffsetAlignment, 64);
assert.equal(model.requiredLimits.minUniformBufferOffsetAlignment, 64, 'source descriptor unchanged');
assert.equal(renderer.requiredLimits.minUniformBufferOffsetAlignment, 256);
assert.deepEqual(kit.composeWebGpuDeviceRequirements([composed, renderer]), composed, 'composition is idempotent');
assert.equal(kit.validateWebGpuDeviceRequirements(adapter, composed).ok, true);

const descriptor = kit.createWebGpuDeviceRequest(adapter, { requirements: composed });
assert.deepEqual(descriptor.requiredFeatures, ['shader-f16', 'timestamp-query']);
assert.equal(descriptor.requiredLimits.maxStorageBuffersPerShaderStage, 12);
assert.equal(descriptor.requiredLimits.minUniformBufferOffsetAlignment, 64);
assert.throws(() => kit.createWebGpuDeviceRequest(adapter, { timestampQuery: 'disable', requirements: { requiredFeatures: ['timestamp-query'] } }), /timestamp-query.*disable/);
assert.throws(() => kit.createWebGpuDeviceRequest({ ...adapter, features: new Set() }, { requirements: model }), /shader-f16/);
assert.throws(() => kit.createWebGpuDeviceRequest(adapter, { requirements: { requiredLimits: { maxBufferSize: 4294967296 } } }), /maxBufferSize/);
assert.throws(() => kit.createWebGpuDeviceRequest(adapter, { requirements: { requiredLimits: { maxBuffferSize: 1 } } }), /maxBuffferSize/);

// Device capabilities can be worse than the adapter's and can live on a prototype.
const borrowed = { features: new Set(), limits: Object.create({ maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728, maxStorageBuffersPerShaderStage: 8, maxSampledTexturesPerShaderStage: 16, minUniformBufferOffsetAlignment: 256 }) };
const validation = kit.validateWebGpuDeviceRequirements(borrowed, composed);
assert.equal(validation.ok, false);
for (const key of ['shader-f16', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage', 'minUniformBufferOffsetAlignment']) {
  assert.match(validation.errors.join('\n'), new RegExp(key));
}
assert.equal(kit.validateWebGpuDeviceRequirements({ ...adapter, limits: Object.create(adapter.limits) }, composed).ok, true);
assert.equal(kit.validateWebGpuDeviceRequirements({}, composed).ok, false);
for (const requirements of [{ requiredFeatures: 'shader-f16' }, { requiredFeatures: [42] }, { requiredLimits: { maxBufferSize: NaN } }, { requiredLimits: { maxBufferSize: -1 } }, { requiredLimits: { minUnknownLimit: 4 } }]) {
  assert.throws(() => kit.composeWebGpuDeviceRequirements([requirements]));
}

let requested;
const context = await kit.requestBrowserWebGpuDevice({ async requestAdapter() {
  return { ...adapter, async requestDevice(value) {
    requested = value;
    return { features: new Set(value.requiredFeatures), limits: value.requiredLimits };
  } };
} }, { requirements: composed });
assert.equal(requested.requiredLimits.maxStorageBuffersPerShaderStage, 12);
assert.equal(kit.validateWebGpuDeviceRequirements(context.device, composed).ok, true);

let destroyed = false;
await assert.rejects(kit.requestBrowserWebGpuDevice({ async requestAdapter() {
  return { ...adapter, async requestDevice() { return { ...borrowed, destroy() { destroyed = true; } }; } };
} }, { requirements: composed }), /effective device.*requirements/);
assert.equal(destroyed, true, 'failed kit-owned acquisition releases only the newly created device');
console.log('device requirements contracts passed');
