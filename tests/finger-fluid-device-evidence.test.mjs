import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

// Exercises the real shared-device factory's readout. This fake is a local
// routing fixture; the ordinary browser witness supplies WebGPU conformance.
for (const name of ['GPUBufferUsage', 'GPUTextureUsage', 'GPUShaderStage']) {
  globalThis[name] = new Proxy({}, { get: (_, key) => String(key).length });
}
function device(info) {
  return new Proxy({
    adapterInfo: info,
    limits: { maxStorageBuffersPerShaderStage: 16, maxBufferSize: 2**30,
      maxStorageBufferBindingSize: 2**30, maxComputeWorkgroupsPerDimension: 65535 },
    features: new Set(), lost: new Promise(() => {}),
    queue: { writeBuffer() {}, writeTexture() {} },
  }, { get(target, key) {
    if (key in target) return target[key];
    if (String(key).startsWith('create')) return descriptor => {
      const value = { ...descriptor, createView() { return {}; }, getBindGroupLayout() { return {}; }, destroy() {} };
      return String(key).endsWith('Async') ? Promise.resolve(value) : value;
    };
    if (key === 'destroy') return () => {};
  } });
}
async function runtime(info) {
  return createWebGPUFingerFluidSolver({ webgpuDevice: device(info),
    hostFrameComposition: true, hostFramePipelineIdentity: 'fixture-shared-host',
    presentationMode: 'local_analytic_consumer', particleCount: 1024 });
}
test('shared-device readout reports the originating device without another adapter', async () => {
  const solver = await runtime({ vendor: 'apple', architecture: 'apple-m4',
    device: 'fixture', description: 'fixture device', isFallbackAdapter: false });
  try {
    assert.equal(solver.available, true, JSON.stringify(solver));
    assert.equal(solver.getDebugState().adapterInfo.vendor, 'apple');
    assert.equal(solver.getDebugState().adapterInfo.isFallbackAdapter, false);
    assert.equal(solver.getDebugState().adapterInfo.source, 'GPUDevice.adapterInfo');
  } finally { solver.destroy(); }
});
test('missing device identity remains explicitly unverified', async () => {
  const solver = await runtime(undefined);
  try {
    assert.equal(solver.getDebugState().adapterInfo.vendor, 'unknown');
    assert.equal(solver.getDebugState().adapterInfo.isFallbackAdapter, null);
    assert.equal(solver.getDebugState().adapterInfo.source, 'unavailable');
  } finally { solver.destroy(); }
});
