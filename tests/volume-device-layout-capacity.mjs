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
const provisioning = section('const requiredLimits = {};', 'const requiredFeatures =');
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

for (const capacity of [minimumCapacity, 32]) {
  const requiredLimits = runInNewContext(`${provisioning}\nrequiredLimits`, {
    adapter: { limits: { maxStorageBuffersPerShaderStage: capacity, maxStorageBufferBindingSize: 268435456 } },
    maxRequestedFluidBufferBytes: 134217728,
  });
  const granted = requiredLimits.maxStorageBuffersPerShaderStage ?? 8;
  for (const row of counts) {
    assert.ok(row.count <= granted,
      `${row.pipeline} ${row.stage} needs ${row.count} storage bindings, but device requests ${granted} (adapter ${capacity})`);
  }
  assert.ok(granted <= capacity, 'never request capacity beyond the adapter');
}
console.log(`PASS: ${pipelines.length} production pipeline layouts fit the requested device; maximum storage bindings ${minimumCapacity}`);
