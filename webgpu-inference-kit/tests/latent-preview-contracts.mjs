import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

const { createWebGpuLatentPreview, latentPreviewShader, projectLatentPreview } = kit;
assert.equal(typeof createWebGpuLatentPreview, 'function', 'the kit must expose createWebGpuLatentPreview');
assert.equal(typeof latentPreviewShader, 'function', 'the kit must expose latentPreviewShader');
assert.equal(typeof projectLatentPreview, 'function', 'the kit must expose the CPU reference projectLatentPreview');

// CPU reference: rgb = z . W + b in -1..1, mapped to bytes the way WGSL pack4x8unorm rounds.
{
  const channels = 2;
  const weights = [1, 0, 0, 0, 1, 0]; // channel 0 -> red, channel 1 -> green
  const bias = [0, 0, 0.5];
  const latent = new Float32Array([1, -1, 0, 0, 5, 0.5]); // three pixels
  const rgba = projectLatentPreview({ latent, channels, weights, bias, pixels: 3 });
  assert.ok(rgba instanceof Uint8ClampedArray);
  assert.deepEqual([...rgba], [
    255, 0, 191, 255, // r = 1 -> 255, g = -1 -> 0, b = 0.5 -> floor(0.5 + 0.75 * 255) = 191
    128, 128, 191, 255, // 0 -> floor(0.5 + 127.5) = 128
    255, 191, 191, 255, // r = 5 clamps to 255; g = 0.5 -> 191
  ]);
}

// Shape validation fails loud instead of producing a wrong map.
await assert.rejects(() => createWebGpuLatentPreview({ device: fakeDevice().device, channels: 2, weights: [1, 2, 3], bias: [0, 0, 0], maxPixels: 4 }),
  /weights must hold channels \* 3/);
await assert.rejects(() => createWebGpuLatentPreview({ device: fakeDevice().device, channels: 2, weights: [1, 0, 0, 0, 1, 0], bias: [0, 0], maxPixels: 4 }),
  /bias must hold 3/);
await assert.rejects(() => createWebGpuLatentPreview({ device: fakeDevice().device, channels: 0, weights: [], bias: [0, 0, 0], maxPixels: 4 }),
  /channels must be a positive integer/);

// The shader reads channels-last f32 latents and writes one packed RGBA8 word per pixel.
{
  const code = latentPreviewShader();
  assert.match(code, /pack4x8unorm/);
  assert.match(code, /var<storage, read> z: array<f32>/);
  assert.match(code, /var<storage, read_write> out: array<u32>/);
}

// Readback: encode returns a take() for after submission, never blocks, and skips when every slot
// is still being read; a slot frees once its pixels are copied out.
{
  const fake = fakeDevice();
  const preview = await createWebGpuLatentPreview({ device: fake.device, channels: 2, weights: [1, 0, 0, 0, 1, 0], bias: [0, 0, 0], maxPixels: 16, slots: 2 });
  assert.equal(fake.asyncPipelines, 1, 'the pipeline is compiled asynchronously at creation');
  const latent = fake.device.createBuffer({ size: 128, usage: 0 });
  const enc = fake.encoder();
  const take1 = preview.encode(enc, latent, { width: 4, height: 4 });
  const take2 = preview.encode(enc, latent, { width: 4, height: 4 });
  assert.equal(typeof take1, 'function');
  assert.equal(typeof take2, 'function');
  assert.equal(preview.encode(enc, latent, { width: 4, height: 4 }), null, 'with both slots busy the preview is skipped');
  assert.equal(enc.dispatches, 2);
  assert.deepEqual(enc.copies.map(c => c.size), [64, 64]);
  const image = await take1();
  assert.equal(image.width, 4); assert.equal(image.height, 4);
  assert.equal(image.rgba.length, 64);
  assert.equal(typeof preview.encode(enc, latent, { width: 4, height: 4 }), 'function', 'a slot frees after its take resolves');
  assert.throws(() => preview.encode(enc, latent, { width: 8, height: 8 }), /exceeds maxPixels/);
  await take2();
  preview.destroy();
  assert.ok(fake.destroyed >= 4, 'destroy frees the matrix, uniform, output and slot buffers');
}

console.log('latent-preview contracts passed');

function fakeDevice() {
  const state = { asyncPipelines: 0, destroyed: 0 };
  const device = {
    queue: { writeBuffer() {} },
    createBuffer({ size }) {
      const bytes = new Uint8Array(size);
      return {
        size,
        mapAsync: async () => {},
        getMappedRange: (offset = 0, length = size - offset) => bytes.buffer.slice(offset, offset + length),
        unmap() {},
        destroy() { state.destroyed++; },
      };
    },
    createShaderModule: ({ code }) => ({ code }),
    createComputePipelineAsync: async () => { state.asyncPipelines++; return { getBindGroupLayout: () => ({}) }; },
    createComputePipeline() { throw new Error('the preview pipeline must not compile synchronously'); },
    createBindGroup: () => ({}),
  };
  return {
    device,
    get asyncPipelines() { return state.asyncPipelines; },
    get destroyed() { return state.destroyed; },
    encoder() {
      const enc = { dispatches: 0, copies: [] };
      enc.beginComputePass = () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() { enc.dispatches++; }, end() {} });
      enc.copyBufferToBuffer = (src, srcOffset, dst, dstOffset, size) => { enc.copies.push({ size }); };
      return enc;
    },
  };
}
