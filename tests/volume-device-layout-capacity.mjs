// Startup regression: the real pipeline descriptors must fit the device
// requested by ensureGpu. This is a CPU contract check, not native GPU proof.
// WebGPU binding-slot limits count all visible entries across a pipeline layout:
// https://www.w3.org/TR/webgpu/#abstract-opdef-exceeds-the-binding-slot-limits
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const ensureGpuStart = source.indexOf('async function ensureGpu()');
assert.ok(ensureGpuStart >= 0, 'exercise the production device initialization');
const section = (startText, endText) => {
  const start = source.indexOf(startText, ensureGpuStart);
  const end = source.indexOf(endText, start);
  assert.ok(start >= ensureGpuStart && end > start, `production section exists: ${startText}`);
  return source.slice(start, end);
};
const requestStart = source.indexOf('const requiredLimits = {};', ensureGpuStart);
const requestCallStart = source.indexOf('device = await adapter.requestDevice(', requestStart);
const requestCallEnd = source.indexOf(';\n', requestCallStart);
assert.ok(requestStart >= ensureGpuStart && requestCallStart > requestStart && requestCallEnd > requestCallStart,
  'production request-device descriptor handoff exists');
const requestPath = source.slice(requestStart, requestCallEnd + 1);
const layouts = section('bindGroupLayout = device.createBindGroupLayout({', "device.pushErrorScope('validation');");
const stages = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const pipelines = [];
runInNewContext(layouts, {
  GPUShaderStage: stages,
  BOUNDARY_SIDECAR_IDENTITY: 'boundary-sidecar',
  BOUNDARY_SPLAT_RENDERER_IDENTITY: 'boundary-splats',
  device: {
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => {
      pipelines.push(descriptor);
      return descriptor;
    },
  },
});
assert.ok(pipelines.some(layout => layout.label === 'kaminos pressure tiered jacobi pipeline layout'),
  'include the pipeline that failed native startup');

const counts = pipelines.flatMap(layout => Object.entries(stages).map(([stage, bit]) => ({
  pipeline: layout.label,
  stage,
  count: layout.bindGroupLayouts.flatMap(group => group.entries).filter(entry =>
    (entry.visibility & bit) && ['storage', 'read-only-storage'].includes(entry.buffer?.type)).length,
})));
const minimumCapacity = Math.max(...counts.map(row => row.count));
assert.ok(minimumCapacity > 0, 'the production layouts contain storage bindings');

const requestDeviceForCapacity = async capacity => {
  let receivedDescriptor;
  const adapter = {
    limits: { maxStorageBuffersPerShaderStage: capacity, maxStorageBufferBindingSize: 268435456 },
    features: { has: () => false },
    requestDevice: async descriptor => {
      receivedDescriptor = descriptor;
      const storageLimit = descriptor?.requiredLimits?.maxStorageBuffersPerShaderStage ?? 8;
      return { limits: { maxStorageBuffersPerShaderStage: storageLimit } };
    },
  };
  const result = await runInNewContext(`(async () => {
    let device;
    ${requestPath}
    return { deviceDescriptor, device };
  })()`, { adapter, maxRequestedFluidBufferBytes: 134217728 });
  assert.equal(receivedDescriptor, result.deviceDescriptor,
    'the descriptor assembled from production limits is the one sent to adapter.requestDevice');
  const granted = result.device.limits.maxStorageBuffersPerShaderStage;
  assert.ok(granted <= capacity, 'never request capacity beyond the adapter');
  return { descriptor: result.deviceDescriptor, granted };
};

for (const capacity of [minimumCapacity, 32]) {
  const { descriptor, granted } = await requestDeviceForCapacity(capacity);
  assert.equal(descriptor.requiredLimits.maxStorageBuffersPerShaderStage, capacity,
    `request the adapter-supported storage capacity ${capacity}`);
  for (const row of counts) {
    assert.ok(row.count <= granted,
      `${row.pipeline} ${row.stage} needs ${row.count} storage bindings, but device receives ${granted} (adapter ${capacity})`);
  }
}

const insufficientCapacity = minimumCapacity - 1;
const { granted: insufficientGrant } = await requestDeviceForCapacity(insufficientCapacity);
const unsupportedLayouts = counts.filter(row => row.count > insufficientGrant);
assert.ok(unsupportedLayouts.length > 0,
  `an adapter with ${insufficientCapacity} slots cannot satisfy the production ${minimumCapacity}-binding layout`);
assert.ok(unsupportedLayouts.some(row => row.count === minimumCapacity),
  'the known under-capacity case fails specifically at the maximum production binding count');
console.log(`PASS: ${pipelines.length} production layouts and requestDevice handoff at capacities ${minimumCapacity}/32; capacity ${insufficientCapacity} is correctly recognized as insufficient; maximum storage bindings ${minimumCapacity}`);
