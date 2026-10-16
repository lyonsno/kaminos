// kaminos-test: node
// KleinPipeline.destroy() releases every GPU buffer the pipeline owns and leaves the device to its
// owner: an application that lends Klein its device can drop the model and keep rendering, or load
// another model, on the same device. Runs on a fake device that counts live buffers.
import assert from 'node:assert/strict';

import { KleinPipeline } from '../models/flux2-klein/klein-pipeline.js';
import { KleinTextEncoder } from '../models/flux2-klein/klein-text-encoder.js';
import { KleinTransformer } from '../models/flux2-klein/klein-transformer.js';
import { KleinVaeDecoder } from '../models/flux2-klein/klein-vae.js';
import { createWebGpuLatentPreview } from '../webgpu-inference-kit/src/core.js';

globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 };

function fakeDevice() {
  const live = new Set();
  const device = {
    destroyed: false,
    destroy() { this.destroyed = true; },
    limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 31 },
    queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {} },
    createBuffer({ size }) {
      const buffer = { size, destroy() { live.delete(buffer); }, mapAsync: async () => {}, getMappedRange: () => new ArrayBuffer(size), unmap() {} };
      live.add(buffer);
      return buffer;
    },
    createShaderModule: ({ code }) => ({ code }),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
      copyBufferToBuffer() {}, finish: () => ({}) }),
  };
  return { device, live };
}

// A pipeline holding one of everything it can own: both models' weights and activations, the
// decoder's weights, input and working buffers, the live-preview machinery and the prompt cache.
async function loadedPipeline(device) {
  const pipeline = new KleinPipeline(device, { textEncoderUrl: 'te', transformerUrl: 'dit', vaeUrl: 'vae' });
  const bytes = async () => new ArrayBuffer(1024);
  pipeline.textEncoder = new KleinTextEncoder(device, { layers: 1, taps: [0], bundles: { layer00: { file: 'te.bin', tensors: [] } },
    config: { hidden_size: 8, num_attention_heads: 2, num_key_value_heads: 1, intermediate_size: 16, rope_theta: 1e6 } });
  await pipeline.textEncoder.loadBundles(bytes);
  pipeline.textEncoder.allocate(4);
  pipeline.transformer = new KleinTransformer(device, { bundles: { globals: { file: 'dit.bin', tensors: [] } },
    config: { num_attention_heads: 2, attention_head_dim: 128, mlp_ratio: 3, joint_attention_dim: 8 } });
  await pipeline.transformer.loadBundles(bytes);
  pipeline.transformer.allocate(4, 4);
  pipeline.vae = new KleinVaeDecoder(device, { config: { batch_norm_eps: 1e-4 },
    bundle: { file: 'vae.bin', tensors: [{ name: 'bn.running_mean', offset: 0 }, { name: 'bn.running_var', offset: 512 }] } });
  await pipeline.vae.load(new ArrayBuffer(1024));
  pipeline.vae.allocate(2, 2);
  pipeline.preview = await createWebGpuLatentPreview({ device, channels: 32, weights: new Array(96).fill(0), bias: [0, 0, 0], maxPixels: 16 });
  pipeline.previewInput = device.createBuffer({ size: 64 });
  pipeline.promptCache = { key: 'prompt', buffer: device.createBuffer({ size: 64 }) };
  return pipeline;
}

{
  const { device, live } = fakeDevice();
  const pipeline = await loadedPipeline(device);
  assert.ok(live.size > 20, `the loaded fake pipeline should hold many buffers (holds ${live.size})`);
  assert.equal(typeof pipeline.destroy, 'function', 'KleinPipeline must offer destroy()');
  await pipeline.destroy();
  assert.equal(live.size, 0, `destroy() must release every buffer the pipeline owns (${live.size} still live)`);
  assert.equal(device.destroyed, false, 'destroy() must leave the borrowed device alone');
  await pipeline.destroy(); // a second call is a no-op
  await assert.rejects(() => pipeline.generate({ prompt: 'a train' }), /destroyed/, 'a destroyed pipeline refuses to generate');

  // The device stays usable: a new pipeline loads on it and releases cleanly in turn.
  const again = await loadedPipeline(device);
  assert.ok(live.size > 20);
  await again.destroy();
  assert.equal(live.size, 0);
}

console.log('klein pipeline release contracts passed');
