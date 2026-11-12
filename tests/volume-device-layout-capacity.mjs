// Startup regression: the real pipeline descriptors must fit the device
// requested by ensureGpu. This is a CPU contract check, not native GPU proof.
// WebGPU binding-slot limits count all visible entries across a pipeline layout:
// https://www.w3.org/TR/webgpu/#abstract-opdef-exceeds-the-binding-slot-limits
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {createSplitIntegral} from '../volume-split-integral.mjs';
import { createDistributedSmokeBindings } from '../scene-smoke-reconstruction.mjs';

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
const suppliedDeviceStart = source.indexOf('if (suppliedDevice) {', requestStart);
const standaloneRequestStart = source.indexOf('const requiredFeatures = [];', suppliedDeviceStart);
const requestCallStart = source.indexOf('device = await adapter.requestDevice(', requestStart);
const requestCallEnd = source.indexOf(';\n', requestCallStart);
assert.ok(requestStart >= ensureGpuStart && suppliedDeviceStart > requestStart
  && standaloneRequestStart > suppliedDeviceStart && requestCallStart > standaloneRequestStart
  && requestCallEnd > requestCallStart,
  'production request-device descriptor handoff exists');
const requestPath = source.slice(requestStart, suppliedDeviceStart)
  + source.slice(standaloneRequestStart, requestCallEnd + 1);
const layouts = section('bindGroupLayout = device.createBindGroupLayout({', "device.pushErrorScope('validation');");
const stages = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const pipelines = [];
const context = {
  state: {},
  TRANSPORT_SCHEME_IDENTITY: 'transport',
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
};
runInNewContext(layouts, context);
// Include the actual lazily composed smoke layout that failed native startup.
globalThis.GPUShaderStage = stages;
globalThis.GPUBufferUsage = {UNIFORM:1,COPY_DST:2};
const distributedLayout = createDistributedSmokeBindings({...context.device,createBuffer:()=>({})}).layout;
const layoutMarker='const layout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout,multisampled?ordinaryMultisampleDepthLayout:productRaymarchDepthBindGroupLayout,distributedLayout';
const layoutStart=source.indexOf(layoutMarker);assert.ok(layoutStart>=0,'exercise the actual distributed smoke composition');
const smokeLayout=source.slice(layoutStart,source.indexOf(';',layoutStart)+1);
const splitIntegral=createSplitIntegral({...context.device,createBuffer:()=>({}),createBindGroup:d=>d});
for (const multisampled of [false,true])for(const splitActive of [false,true])runInNewContext(smokeLayout,{...context,distributedLayout,multisampled,splitActive,splitIntegral});
const actualRequirements={VOLUME_STORAGE_BUFFER_BINDING_COUNT:Number(source.match(/const VOLUME_STORAGE_BUFFER_BINDING_COUNT = (\d+);/)[1])};
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
assert.ok(minimumCapacity <= 10, 'composed camera layout must fit the observed native adapter capacity10');

const requestDeviceForCapacity = async capacity => {
  let receivedDescriptor;
  const adapter = {
    limits: { maxStorageBuffersPerShaderStage: capacity, maxStorageBufferBindingSize: 268435456, maxBufferSize: 268435456 },
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
  })()`, { adapter, maxRequestedStorageBufferBytes: 134217728,
    ...actualRequirements });
  assert.equal(receivedDescriptor, result.deviceDescriptor,
    'the descriptor assembled from production limits is the one sent to adapter.requestDevice');
  const granted = result.device.limits.maxStorageBuffersPerShaderStage;
  assert.ok(granted <= capacity, 'never request capacity beyond the adapter');
  return { descriptor: result.deviceDescriptor, granted };
};

for (const capacity of [minimumCapacity, 32]) {
  const { descriptor, granted } = await requestDeviceForCapacity(capacity);
  assert.ok(descriptor.requiredLimits.maxStorageBuffersPerShaderStage >= minimumCapacity,
    `request the production-required storage capacity from adapter ${capacity}`);
  for (const row of counts) {
    assert.ok(row.count <= granted,
      `${row.pipeline} ${row.stage} needs ${row.count} storage bindings, but device receives ${granted} (adapter ${capacity})`);
  }
}

const insufficientCapacity = minimumCapacity - 1;
await assert.rejects(requestDeviceForCapacity(insufficientCapacity),
  /(?:boundary-splat-compute|volume)-layout-storage-buffer-limit/,
  `an adapter with ${insufficientCapacity} slots must reject the production ${minimumCapacity}-binding layout`);
console.log(`PASS: ${pipelines.length} production layouts and requestDevice handoff at capacities ${minimumCapacity}/32; capacity ${insufficientCapacity} rejects before device request; maximum storage bindings ${minimumCapacity}`);
