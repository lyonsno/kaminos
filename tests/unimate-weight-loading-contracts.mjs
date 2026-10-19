// kaminos-test: node
import assert from 'node:assert/strict';
import { tensorFloat32Bytes } from '../models/unimate/unimate-weights.js';
import { UniMateDenoiser } from '../models/unimate/unimate-denoiser.js';
import { CooperativeUniMateDenoiser } from '../models/unimate/unimate-cooperative.js';
import { T5Encoder } from '../models/unimate/unimate-t5.js';

const manifest = {
  model: { latent_dim: 512, num_heads: 8, ff_size: 2048, attention: 'graph', text_cond: 'adaln' },
  config: { feed_forward_proj: 'gated-gelu' },
  tensors: [
    { name: 'depth_embedding.weight', shape: [1, 4], offset: 0, byteLength: 8, dtype: 'float16' },
    { name: 'relative_attention_bias', shape: [1, 4], offset: 8, byteLength: 8, dtype: 'float16' },
  ],
};
const bytes = new Uint16Array([0, 0x8000, 1, 0x3c00, 0x7c00, 0xfc00, 0x7e00, 0x3555]).buffer;
function fakeDevice({ failAt = null } = {}) {
  const made = [];
  return { made, createBuffer(d) {
    if (made.length === failAt) throw new Error('allocation failed');
    const buffer = { bytes: new Uint8Array(d.size), destroyed: false, mapped: !!d.mappedAtCreation,
      getMappedRange() { return this.bytes.buffer; }, unmap() { this.mapped = false; }, destroy() { this.destroyed = true; } };
    made.push(buffer); return buffer;
  } };
}
for (const Model of [UniMateDenoiser, CooperativeUniMateDenoiser, T5Encoder]) {
  const device = fakeDevice(), events = [];
  const options = { yieldToBrowser: async () => events.push(device.made.length) };
  const model = Model === T5Encoder
    ? await Model.create(device, manifest, bytes, { pieces: [], scores: [] }, options)
    : await Model.create(device, manifest, bytes, options);
  assert(events.length > 0, `${Model.name} offers a browser task before loading finishes`);
  for (const t of manifest.tensors) {
    const b = model.w.get(t.name).buffer;
    assert.deepEqual(b.bytes.subarray(0, t.byteLength * 2), tensorFloat32Bytes(bytes, t), `${Model.name} preserves every FP32 byte`);
    assert.equal(b.mapped, false);
  }
}
// A single embedding tensor is much larger than a frame's CPU budget. Yield within it too.
{
  const half = Uint16Array.from({ length: 2 ** 20 + 3 }, (_, i) => i & 0xffff);
  const t = { name: 'depth_embedding.weight', shape: [half.length, 1], offset: 0, byteLength: half.byteLength, dtype: 'float16' };
  const device = fakeDevice(); let yields = 0;
  const model = await CooperativeUniMateDenoiser.create(device, { ...manifest, tensors: [t] }, half.buffer, { yieldToBrowser: async () => yields++ });
  assert(yields >= 2, 'one large tensor yields within its conversion, not only after it');
  assert.deepEqual(model.w.get(t.name).buffer.bytes.subarray(0, half.length * 4), tensorFloat32Bytes(half.buffer, t));
}
// FP32 tensors retain their values too, and a failed load retires its partial buffers.
{
  const t = { name: 'depth_embedding.weight', shape: [1, 4], offset: 0, byteLength: 16 };
  const data = new Float32Array([1, -0, -2, Infinity]).buffer, device = fakeDevice();
  const model = await UniMateDenoiser.create(device, { ...manifest, tensors: [t] }, data, { yieldToBrowser: async () => {} });
  assert.deepEqual(model.w.get(t.name).buffer.bytes.subarray(0, 16), new Uint8Array(data));
  const failing = fakeDevice({ failAt: 1 });
  await assert.rejects(CooperativeUniMateDenoiser.create(failing, manifest, bytes, { yieldToBrowser: async () => {} }), /allocation failed/);
  assert(failing.made.every(b => b.destroyed), 'failed upload releases all partially allocated weights');
}
console.log('weight loading contracts: pass');
