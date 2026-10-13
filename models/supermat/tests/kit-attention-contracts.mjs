// attentionKernel 'kit-tiled' routes streaming attention through the inference
// kit's register-tiled flash attention with SuperMat's activation storage.
import assert from 'node:assert/strict';
import { createSuperMatOps } from '../supermat-ops.js';
import {
  createWebGpuTiledFlashAttentionShader, flashAttentionParams, flashAttentionDispatch,
} from '../../../webgpu-inference-kit/src/flash-attention-kernel.js';

function recordingDevice() {
  const log = { codes: [], dispatches: [] };
  const buffer = ({ size }) => {
    const bytes = new ArrayBuffer(size);
    return { size, bytes, getMappedRange: () => bytes, unmap() {}, destroy() {} };
  };
  let lastEntries = null;
  const pass = {
    setPipeline() {}, setBindGroup() {}, end() {},
    dispatchWorkgroups: (...groups) => log.dispatches.push({ code: log.codes.at(-1), entries: lastEntries, groups }),
  };
  const device = {
    features: new Set(['shader-f16']), limits: {},
    createShaderModule: ({ code }) => { log.codes.push(code); return {}; },
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: ({ entries }) => { lastEntries = entries; return {}; },
    createBuffer: buffer,
    createCommandEncoder: () => ({ beginComputePass: () => pass }),
  };
  return { device, log };
}

for (const activations of ['f32', 'f16']) {
  const { device, log } = recordingDevice();
  const ops = createSuperMatOps(device, { activations, attentionKernel: 'kit-tiled' });
  const [queries, keys, heads, headDim] = [100, 77, 5, 64];
  const q = ops.alloc([queries, heads * headDim]), k = ops.alloc([keys, heads * headDim]), v = ops.alloc([keys, heads * headDim]);
  const out = await ops.flashAttention({ q, k, v, queries, keys, heads, headDim, scale: 1 / Math.sqrt(headDim) });
  assert.equal(log.dispatches.length, 1);
  const [call] = log.dispatches;
  const storage = activations === 'f16' ? { q: 'f16', k: 'f16', v: 'f16', out: 'f16' } : {};
  assert.equal(call.code, createWebGpuTiledFlashAttentionShader({ headDim, storage }), `${activations}: kit shader with activation storage`);
  assert.deepEqual(call.groups, flashAttentionDispatch({ queryCount: queries, heads }));
  const words = new Uint32Array(call.entries[4].resource.buffer.bytes, 0, 12);
  assert.deepEqual([...words], [...flashAttentionParams({ queryTokens: queries, keyTokens: keys, heads, headDim })]);
  assert.equal(call.entries[3].resource.buffer, out.buffer);
  assert.equal(out.storage, activations);
}

// Head dims other than 64 are admitted on the kit route (multiples of 16 up to 256).
{
  const { device, log } = recordingDevice();
  const ops = createSuperMatOps(device, { attentionKernel: 'kit-tiled' });
  const t = ops.alloc([64, 2 * 128]);
  await ops.flashAttention({ q: t, k: t, v: t, queries: 64, keys: 64, heads: 2, headDim: 128, scale: 1 / Math.sqrt(128) });
  assert.equal(log.dispatches[0].code, createWebGpuTiledFlashAttentionShader({ headDim: 128 }));
  assert.ok(ops.attentionHeadDimSupported(128) && !ops.attentionHeadDimSupported(512));
}

// The kit kernel is the default; the model-owned scalar kernel (head dim 64 only) stays selectable as a
// baseline; unknown kernels fail loudly.
{
  const { device } = recordingDevice();
  assert.equal(createSuperMatOps(device).attentionKernel, 'kit-tiled');
  assert.ok(!createSuperMatOps(device, { attentionKernel: 'scalar' }).attentionHeadDimSupported(128));
  assert.ok(createSuperMatOps(device, { attentionKernel: 'scalar' }).attentionHeadDimSupported(64));
  assert.throws(() => createSuperMatOps(device, { attentionKernel: 'tiled' }), /unknown attention kernel tiled/);
}
console.log('kit attention contracts: passed');
