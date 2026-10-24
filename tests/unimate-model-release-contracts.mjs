// kaminos-test: node
import assert from 'node:assert/strict';
import { UniMateDenoiser } from '../models/unimate/unimate-denoiser.js';
import { T5Encoder } from '../models/unimate/unimate-t5.js';

// Actual producer allocation ownership, with a device recording buffer destruction.
const buffers = [];
const previousBuffer = globalThis.GPUBuffer;
const previousMapMode = globalThis.GPUMapMode;
class Buffer {
  constructor(descriptor) { this.size = descriptor.size; this.destroyed = false; buffers.push(this); }
  destroy() { this.destroyed = true; }
  async mapAsync() { throw new Error('fixture readback failed'); }
}
globalThis.GPUBuffer = Buffer;
globalThis.GPUMapMode = { READ: 1 };
const device = { queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} }, createBuffer: d => new Buffer(d),
  createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
    copyBufferToBuffer() {}, finish: () => ({}) }),
  createShaderModule: () => ({}), createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
  createBindGroup: () => ({}) };
const manifest = { model: { latent_dim: 512, num_heads: 8, ff_size: 2048, attention: 'graph', text_cond: 'adaln' },
  tensors: [{ name: 'depth_embedding.weight', shape: [2, 1] }],
  config: { feed_forward_proj: 'gated-gelu', d_model: 768, num_heads: 12, d_kv: 64, d_ff: 2048, num_layers: 12, layer_norm_epsilon: 1e-6 } };
try {
  const weight = device.createBuffer({ size: 256 });
  const den = new UniMateDenoiser(device, manifest, new Map([['weight', { buffer: weight }]]));
  den.io = { input: den.buf(4) }; den.st = { nested: [den.buf(4)] }; den.f = { output: den.buf(4) }; den.tmp = [den.buf(4)];
  den.op('LINEAR', [den.io.input], [['u', 1]], [1]);
  const configuration = buffers.slice(2);
  den.release();
  assert(configuration.every(buffer => buffer.destroyed), 'reconfiguration releases program uniforms as well as tensor buffers');
  assert.equal(weight.destroyed, false, 'configuration release retains weights');
  den.destroy(); den.destroy();
  assert(buffers.every(buffer => buffer.destroyed), 'final destruction releases persistent weights and dummy buffer');
  assert.equal(den.pipelines.size, 0);

  const t5Weight = device.createBuffer({ size: 256 });
  const t5 = new T5Encoder(device, manifest, new Map([['shared', { buffer: t5Weight }]]), new Float32Array(1), {});
  t5.destroy(); t5.destroy();
  assert(buffers.every(buffer => buffer.destroyed), 'T5 releases persistent weights and dummy buffer');
  assert.equal(t5.pipelines.size, 0);
  const tiny = { ...manifest, config: { ...manifest.config, d_model: 1, num_heads: 1, d_kv: 1, d_ff: 1, num_layers: 0 },
    relative_buckets: { min_distance: 0, buckets: [0] } };
  const weights = new Map(['shared', 'final_layer_norm'].map(name => [name, { buffer: device.createBuffer({ size: 256 }) }]));
  const failing = new T5Encoder(device, tiny, weights, new Float32Array(1), { encode: () => [0] });
  const transientStart = buffers.length;
  await assert.rejects(failing.encode('Walk.'), /fixture readback failed/);
  assert(buffers.slice(transientStart).every(buffer => buffer.destroyed), 'failed encoding retires every temporary allocation');
  failing.destroy();
  console.log('UniMate model buffer ownership and destruction: pass');
} finally { globalThis.GPUBuffer = previousBuffer; globalThis.GPUMapMode = previousMapMode; }
