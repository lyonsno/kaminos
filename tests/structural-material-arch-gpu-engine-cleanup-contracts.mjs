import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ArchGpuEngine, ENGINE_REVISION } from '../dist/structural-material-arch-gpu-engine.js';
import { profile } from './helpers/arch-gpu-adapter-fixture.mjs';

// Execute the pinned engine's resource constructors; this device does not simulate GPU physics.
Object.assign(globalThis, {
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 },
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }, GPUMapMode: { READ: 1, WRITE: 2 },
});

async function acquisition(fault) {
  const buffers = [], attributes = new Map(), destroyedAttributes = [], engines = [];
  const device = {
    limits: { maxStorageBuffersPerShaderStage: 16, maxComputeWorkgroupStorageSize: 32768 }, features: new Set(),
    createBuffer(descriptor) {
      if (fault === 'partial-stage' && descriptor.label === 'Broadphase Candidate Uniforms') throw new Error('injected partial-stage rejection');
      const buffer = { ...descriptor, destroyed: 0, destroy() { this.destroyed++; },
        async mapAsync() { if (fault === 'readback' && this.label === 'Arch operator pose readback') throw new Error('injected readback rejection'); },
        getMappedRange() { return new ArrayBuffer(this.size); }, unmap() {} };
      buffers.push(buffer); return buffer;
    },
    queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
    createShaderModule: descriptor => ({ async getCompilationInfo() { return { messages: fault === 'compilation' && descriptor.label === 'Arch resident interaction and fracture' ? [{ type: 'error', message: 'injected compilation rejection' }] : [] }; } }),
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}), createBindGroup: () => ({}),
    createComputePipeline: () => ({}), async createComputePipelineAsync() { if (fault === 'pipeline') throw new Error('injected pipeline rejection'); return {}; },
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
      copyBufferToBuffer() {}, finish: () => ({}) }),
  };
  const backend = { isWebGPUBackend: true, device,
    get(attribute) { return attributes.get(attribute) ?? {}; },
    createStorageAttribute(attribute) {
      if (!attributes.has(attribute)) attributes.set(attribute, { buffer: device.createBuffer({ label: attribute.name || 'Engine storage attribute', size: attribute.array.byteLength }) });
      return attributes.get(attribute);
    },
    destroyAttribute(attribute) { attributes.get(attribute).buffer.destroy(); attributes.delete(attribute); destroyedAttributes.push(attribute); },
  };
  const renderer = { backend, compute() {
    const engine = engines.at(-1);
    for (const owner of [engine, ...Object.values(engine).filter(value => value && typeof value === 'object' && !ArrayBuffer.isView(value))]) {
      for (const value of Object.values(owner)) if (value?.isStorageBufferAttribute || value?.isIndirectStorageBufferAttribute) backend.createStorageAttribute(value);
    }
  } };
  class ObservedEngine extends ArchGpuEngine { constructor(...args) { super(...args); engines.push(this); } }
  globalThis.__archOwnedEngine = { ArchGpuEngine: ObservedEngine, ENGINE_REVISION };
  const source = fs.readFileSync(new URL('../structural-material-arch-gpu.js', import.meta.url), 'utf8')
    .replace("import * as THREE from 'three';", `import * as THREE from '${import.meta.resolve('three')}';`)
    .replace("import { ArchGpuEngine, ENGINE_REVISION } from './dist/structural-material-arch-gpu-engine.js';", 'const { ArchGpuEngine, ENGINE_REVISION } = globalThis.__archOwnedEngine;')
    .replaceAll("'./structural-material-arch-gpu-fixture.js'", JSON.stringify(new URL('../structural-material-arch-gpu-fixture.js', import.meta.url).href))
    .replaceAll("'./structural-material-arch-gpu-kernels.js'", JSON.stringify(new URL('../structural-material-arch-gpu-kernels.js', import.meta.url).href));
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#engine-owner-${fault ?? 'success'}`);
  if (fault) await assert.rejects(module.createGpuArchCollapse(profile, renderer, { gravityRampSeconds: 0 }), new RegExp(`injected ${fault} rejection`));
  else {
    const model = await module.createGpuArchCollapse(profile, renderer, { gravityRampSeconds: 0 });
    assert.ok(engines[0].avbdState.bodySolveOutputPoseAttr.isStorageBufferAttribute, 'exercise actual nested AVBD ownership');
    assert.ok(destroyedAttributes.length === 0, 'successful acquisition has not been disposed early');
    model.dispose(); model.dispose();
    await assert.rejects(model.step(), /disposed/);
    assert.throws(() => engines[0].step(1 / 60, renderer), /disposed/, 'disposed engine cannot reacquire through a later step');
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(buffers.length > (fault === 'partial-stage' ? 0 : 6), 'real pinned engine acquires resources beyond the adapter, including a partial stage');
  assert.ok(buffers.every(buffer => buffer.destroyed === 1), `${fault ?? 'success'} must release every actual engine and adapter buffer exactly once; ${buffers.filter(buffer => buffer.destroyed !== 1).length} escaped`);
  assert.equal(attributes.size, 0, 'no nested allocated storage attributes remain');
  if (engines[0].broadPhase) {
    assert.equal(engines[0].broadPhase.gpuBVHs.length, 0, 'all-pairs engine must not start unused async BVH acquisition');
    assert.equal(engines[0].broadPhase.prewarmInFlight, null);
  }
  return { fault: fault ?? 'success', allocated: buffers.length, destroyed: buffers.reduce((sum, buffer) => sum + buffer.destroyed, 0), attributesDestroyed: destroyedAttributes.length };
}

const evidence = [];
for (const fault of ['compilation', 'pipeline', 'readback', 'partial-stage', null]) evidence.push(await acquisition(fault));
console.log(JSON.stringify({ engineRevision: ENGINE_REVISION, resourceOwnership: evidence }));
