import assert from 'node:assert/strict';
import { attentionCases, attentionFixture, attentionOracle, runAttentionCases } from './sam-attention-browser-cases.mjs';

// This double exercises the actual runner's buffer lifetime, not WGSL arithmetic.
const spec = attentionCases[0];
const expected = Float32Array.from(attentionOracle(spec, attentionFixture(spec)));
const saved = Object.fromEntries(['navigator', 'GPUBufferUsage', 'GPUMapMode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8, UNIFORM: 16 };
globalThis.GPUMapMode = { READ: 1 };

function gpu(writeMode) {
  const device = {
    createBuffer({ size, usage }) { return { size, usage, data: new ArrayBuffer(size), getMappedRange() { return this.data; }, unmap() {}, async mapAsync() {}, destroy() {} }; },
    pushErrorScope() {}, async popErrorScope() { return null; }, destroy() {},
    createShaderModule({ code }) { return { code, async getCompilationInfo() { return { messages: [] }; } }; },
    async createComputePipelineAsync({ compute }) { return { code: compute.module.code, getBindGroupLayout() {} }; },
    createBindGroup({ entries }) { return entries; },
    createCommandEncoder() {
      const commands = [];
      return {
        beginComputePass() {
          let pipeline, bindings;
          return { setPipeline(value) { pipeline = value; }, setBindGroup(_, value) { bindings = value; }, dispatchWorkgroups() {
            commands.push(() => {
              const output = bindings.at(-2).resource.buffer;
              const count = pipeline.code === 'baseline' || writeMode === 'complete' ? expected.length : writeMode === 'none' ? 0 : writeMode === 'tail' ? expected.length - 1 : expected.length / spec.domains;
              new Float32Array(output.data).set(expected.subarray(0, count));
            });
          }, end() {} };
        },
        copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) { commands.push(() => new Uint8Array(target.data, targetOffset, size).set(new Uint8Array(source.data, sourceOffset, size))); },
        finish() { return commands; },
      };
    },
    queue: {
      writeBuffer(buffer, offset, values) {
        assert.ok(buffer.usage & GPUBufferUsage.COPY_DST, 'sentinel upload requires COPY_DST');
        new Uint8Array(buffer.data, offset, values.byteLength).set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
      },
      submit(commands) { for (const command of commands.flat()) command(); },
      async onSubmittedWorkDone() {},
    },
  };
  return { async requestAdapter() { return { info: { isFallbackAdapter: false }, async requestDevice() { return device; } }; } };
}

try {
  for (const mode of ['none', 'tail', 'domain']) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: gpu(mode) } });
    await assert.rejects(runAttentionCases({ [spec.shader]: 'baseline' }, { [spec.shader]: 'candidate' }, () => { throw new Error('accepted corrupted candidate'); }), /nonfinite attention value/, `${mode} writes must not inherit baseline output`);
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: gpu('complete') } });
  await assert.rejects(runAttentionCases({ [spec.shader]: 'baseline' }, { [spec.shader]: 'candidate' }, ({ result }) => {
    assert.deepEqual(result.candidate.values, Array.from(expected));
    throw new Error('checked complete candidate');
  }), /checked complete candidate/);
} finally {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log('SAM attention write-completeness contracts passed');
