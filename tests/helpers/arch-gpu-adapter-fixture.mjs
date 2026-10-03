import fs from 'node:fs';

export const profile = { columns: 5, rows: 4, bounds: { min: [-1, 0], max: [1, 1.6] },
  occupancy: Array.from({ length: 20 }, (_, i) => i % 5 === 0 || i % 5 === 4 || i >= 15) };

// This substitutes acquisition failures, not native physics or wire contracts.
export async function adapterFixture(fault = null) {
  const buffers = [], destroyedAttributes = [], attributes = [];
  class FakeEngine {
    constructor(device, config) {
      this.config = config; this.jointCount = 0; this.jointRecordsData = new Float32Array(config.maxBodies * 8 * 44);
      this.stats = { pairDispatchTruncated: false }; this.maxCandidatePairs = config.maxBodies * (config.maxBodies - 1) / 2;
    }
    setAvbdPreventPenetratingNormalDropout(value) { this.prevent = value; }
    getAvbdPreventPenetratingNormalDropout() { return this.prevent; }
    getSubsteps() { return this.config.substeps; }
    addBody() {}
    addFixedJoint() { return this.jointCount++; }
    addSphericalJoint() { return this.jointCount++; }
    setInitialJointActive() {}
    setGravity(value) { this.config.gravity = value; }
    getGravity() { return this.config.gravity; }
    getStats() { return this.stats; }
    dispose(renderer) { for (const attribute of attributes) renderer.backend.destroyAttribute(attribute); }
    step() {
      if (!this.positions) {
        this.positions = { isStorageBufferAttribute: true }; this.rotation = { isStorageBufferAttribute: true };
        attributes.push(this.positions, this.rotation);
      }
    }
    getResidentAttributes() { return Object.fromEntries(['positions', 'quaternions', 'velocities', 'angularVelocities', 'joints'].map(name => [name, this.positions])); }
  }
  const device = {
    createBuffer(descriptor) {
      const buffer = { ...descriptor, destroyed: 0, destroy() { this.destroyed++; },
        async mapAsync() { if (fault === 'readback') throw new Error('injected readback rejection'); },
        getMappedRange() { return new ArrayBuffer(this.size); }, unmap() {} };
      buffers.push(buffer); return buffer;
    },
    queue: { writeBuffer() {}, submit() {} },
    createShaderModule: () => ({ async getCompilationInfo() { return { messages: fault === 'compilation' ? [{ type: 'error', message: 'injected compilation rejection' }] : [] }; } }),
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}), createBindGroup: () => ({}),
    async createComputePipelineAsync() { if (fault === 'pipeline') throw new Error('injected pipeline rejection'); return {}; },
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), copyBufferToBuffer() {}, finish: () => ({}) }),
  };
  const renderer = { backend: { isWebGPUBackend: true, device, get: () => ({ buffer: {} }), destroyAttribute: attribute => destroyedAttributes.push(attribute) } };
  Object.assign(globalThis, { GPUBufferUsage: { COPY_DST: 1, STORAGE: 2, UNIFORM: 4, COPY_SRC: 8, MAP_READ: 16 }, GPUShaderStage: { COMPUTE: 1 }, GPUMapMode: { READ: 1 } });
  globalThis.__archAdapterTestEngine = { ArchGpuEngine: FakeEngine, ENGINE_REVISION: 'synthetic-acquisition-only' };
  const url = new URL('../../structural-material-arch-gpu.js', import.meta.url);
  const source = fs.readFileSync(url, 'utf8')
    .replace("import * as THREE from 'three';", `import * as THREE from '${import.meta.resolve('three')}';`)
    .replace("import { ArchGpuEngine, ENGINE_REVISION } from './dist/structural-material-arch-gpu-engine.js';", 'const { ArchGpuEngine, ENGINE_REVISION } = globalThis.__archAdapterTestEngine;')
    .replaceAll("'./structural-material-arch-gpu-fixture.js'", JSON.stringify(new URL('../../structural-material-arch-gpu-fixture.js', import.meta.url).href))
    .replaceAll("'./structural-material-arch-gpu-kernels.js'", JSON.stringify(new URL('../../structural-material-arch-gpu-kernels.js', import.meta.url).href));
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${fault ?? 'success'}`);
  return { module, renderer, buffers, attributes, destroyedAttributes };
}
