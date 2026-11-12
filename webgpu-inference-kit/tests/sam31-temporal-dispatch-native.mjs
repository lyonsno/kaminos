// kaminos-test: manual - requires the installed shader-herder and Apple hardware
import assert from 'node:assert/strict';
import { withKaminosGpu, withGpuErrorScopes } from '../../tools/shader-herder.mjs';
import { TEMPORAL_SPATIAL_ASSEMBLY_WGSL, TEMPORAL_POINTER_POSITION_WGSL } from '../src/sam31-temporal-memory-bank-phase-program.js';

async function execute(ctx, code, arrays, outputIndex) {
  const { device, GPUBufferUsage: U, GPUMapMode: M } = ctx;
  const buffers = [];
  let readback;
  try {
    return await withGpuErrorScopes(device, 'sam31-temporal-dispatch', async () => {
      const module = await ctx.compileShaderModule({ code, label: 'sam31-temporal-production' });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      for (let index = 0; index < arrays.length; index++) {
        const data = arrays[index];
        const buffer = device.createBuffer({ size: data.byteLength, usage: U.COPY_DST | U.COPY_SRC | (index === arrays.length - 1 ? U.UNIFORM : U.STORAGE) });
        buffers.push(buffer);
        device.queue.writeBuffer(buffer, 0, data);
      }
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
      readback = device.createBuffer({ size: arrays[outputIndex].byteLength, usage: U.COPY_DST | U.MAP_READ });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(2, 2, 2);
      pass.end();
      encoder.copyBufferToBuffer(buffers[outputIndex], 0, readback, 0, arrays[outputIndex].byteLength);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(M.READ);
      return new Float32Array(readback.getMappedRange().slice(0));
    });
  } finally {
    readback?.destroy();
    for (const buffer of buffers) buffer.destroy();
  }
}

// Eight small workgroups force x/y/z flattening without a large model fixture.
const spatial = { batch: 2, frames: 3, tokens: 17, channels: 4 };
const spatialTotal = spatial.batch * spatial.frames * spatial.tokens * spatial.channels;
const values = Float32Array.from({ length: spatialTotal }, (_, i) => i + 1);
const positions = Float32Array.from(values, value => value * 0.5);
const embeddings = Float32Array.from({ length: 3 * spatial.channels }, (_, i) => i * 2);
const temporalIndices = new Float32Array([2, 0, 1]);
const spatialExpected = [new Float32Array(spatialTotal), new Float32Array(spatialTotal)];
for (let f = 0; f < spatial.frames; f++) for (let b = 0; b < spatial.batch; b++) for (let t = 0; t < spatial.tokens; t++) for (let c = 0; c < spatial.channels; c++) {
  const source = ((f * spatial.batch + b) * spatial.tokens + t) * spatial.channels + c;
  const target = ((b * spatial.frames + f) * spatial.tokens + t) * spatial.channels + c;
  spatialExpected[0][target] = values[source];
  spatialExpected[1][target] = positions[source] + embeddings[temporalIndices[f] * spatial.channels + c];
}
const spatialArrays = [values, positions, embeddings, temporalIndices, new Float32Array(spatialTotal).fill(-999), new Float32Array(spatialTotal).fill(-999), new Uint32Array([2, 3, 17, 4, 51, spatialTotal])];

const pointer = { batch: 2, frames: 3, multiplex: 9, channels: 8, spatialTokens: 3, maxFrames: 8 };
const pointerTotal = pointer.batch * pointer.frames * pointer.multiplex * pointer.channels;
const memoryTokens = pointer.spatialTokens + pointer.frames * pointer.multiplex;
const relative = new Float32Array([-2, 0, 5]);
const weights = new Float32Array(pointer.channels ** 2);
for (let c = 0; c < pointer.channels; c++) weights[c * pointer.channels + c] = 1;
const bias = Float32Array.from({ length: pointer.channels }, (_, c) => c * 0.25);
const pointerExpected = new Float32Array(pointer.batch * memoryTokens * pointer.channels).fill(-999);
for (let b = 0; b < pointer.batch; b++) for (let f = 0; f < pointer.frames; f++) for (let p = 0; p < pointer.multiplex; p++) for (let c = 0; c < pointer.channels; c++) {
  const half = pointer.channels / 2;
  const exponent = 2 * Math.floor((c % half) / 2) / half;
  const angle = relative[f] / (pointer.maxFrames - 1) / 10000 ** exponent;
  const target = (b * memoryTokens + pointer.spatialTokens + f * pointer.multiplex + p) * pointer.channels + c;
  pointerExpected[target] = bias[c] + (c < half ? Math.sin(angle) : Math.cos(angle));
}
const pointerArrays = [relative, weights, bias, new Float32Array(pointerExpected.length).fill(-999), new Uint32Array([2, 3, 9, 8, 3, memoryTokens, 8, pointerTotal])];
function close(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 2e-6, `element ${i}: ${actual[i]} != ${expected[i]}`);
}
function brokenIndex(code) {
  const correct = 'gid.x + gid.y * dispatch_grid.x * 64u + gid.z * dispatch_grid.x * dispatch_grid.y * 64u';
  const changed = code.replace(correct, 'gid.x');
  if (changed === code) throw new Error('Index fault was not installed');
  return changed;
}
await withKaminosGpu(async ctx => {
  for (const [index, expected] of [[4, spatialExpected[0]], [5, spatialExpected[1]]]) close(await execute(ctx, TEMPORAL_SPATIAL_ASSEMBLY_WGSL, spatialArrays, index), expected);
  close(await execute(ctx, TEMPORAL_POINTER_POSITION_WGSL, pointerArrays, 3), pointerExpected);
  await assert.rejects(async () => close(await execute(ctx, brokenIndex(TEMPORAL_SPATIAL_ASSEMBLY_WGSL), spatialArrays, 4), spatialExpected[0]), { name: 'AssertionError' });
  await assert.rejects(async () => close(await execute(ctx, brokenIndex(TEMPORAL_POINTER_POSITION_WGSL), pointerArrays, 3), pointerExpected), { name: 'AssertionError' });
  console.log('SAM production spatial/pointer shaders cover 3D dispatch, preserve spatial prefix, and reject missing y/z indexing');
}, { wgslSources: [TEMPORAL_SPATIAL_ASSEMBLY_WGSL, TEMPORAL_POINTER_POSITION_WGSL].map(code => ({ code, entryPoint: 'main' })) });
