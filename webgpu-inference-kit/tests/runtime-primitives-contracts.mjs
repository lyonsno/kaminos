import assert from 'node:assert/strict';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_SHADER_STAGE,
  WEBGPU_TENSOR_SCHEMA,
  createLinearDispatch,
  createWebGpuInferenceRuntime,
  packUniforms,
} from '../src/index.js';

assert.deepEqual(
  createLinearDispatch(64 * 65_535, { workgroupSize: 64, maxWorkgroupsPerDimension: 65_535 }),
  [65_535],
  'linear dispatch must preserve a legal one-dimensional boundary launch',
);

const firstTiledDispatch = createLinearDispatch(64 * 65_535 + 1, {
  workgroupSize: 64,
  maxWorkgroupsPerDimension: 65_535,
});
assert.deepEqual(firstTiledDispatch, [256, 256], 'the first oversized launch must tile across two legal dimensions');
assert.ok(firstTiledDispatch[0] <= 65_535 && firstTiledDispatch[1] <= 65_535);
assert.ok(firstTiledDispatch[0] * firstTiledDispatch[1] * 64 >= 64 * 65_535 + 1);

for (const [name, totalInvocations] of [
  ['448px ViT mlpFc1', 1_024 * 4_736],
  ['1008px ViT mlpFc1', 5_184 * 4_736],
]) {
  const dispatch = createLinearDispatch(totalInvocations, {
    workgroupSize: 64,
    maxWorkgroupsPerDimension: 65_535,
  });
  assert.equal(dispatch.length, 2, `${name} must use a two-dimensional dispatch`);
  assert.ok(dispatch.every(dimension => dimension <= 65_535), `${name} dispatch dimensions must respect the device limit`);
  assert.ok(dispatch[0] * dispatch[1] * 64 >= totalInvocations, `${name} dispatch must cover every logical invocation`);
  assert.ok((dispatch[0] * dispatch[1] - Math.ceil(totalInvocations / 64)) < dispatch[0], `${name} dispatch must add less than one row of tail workgroups`);
}

assert.throws(() => createLinearDispatch(0), /totalInvocations.*positive integer/);
assert.throws(() => createLinearDispatch(64, { workgroupSize: 0 }), /workgroupSize.*positive integer/);
assert.throws(
  () => createLinearDispatch(65, { workgroupSize: 1, maxWorkgroupsPerDimension: 8 }),
  /exceeds.*two-dimensional.*capacity/,
);

const calls = {
  buffers: [],
  writes: [],
  reads: [],
  shaderModules: [],
  bindGroupLayouts: [],
  pipelineLayouts: [],
  bindGroups: [],
  computePipelines: [],
  commandEncoders: [],
  copies: [],
  passes: [],
  dispatches: [],
  submissions: [],
};

let nowMs = 200;
const now = () => {
  nowMs += 1.25;
  return nowMs;
};

const queue = {
  writeBuffer(buffer, offset, data, dataOffset, size) {
    if (offset % 4 !== 0) throw new Error('writeBuffer offset must be multiple of 4');
    const view = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const sourceOffset = dataOffset || 0;
    const writeSize = size ?? (view.byteLength - sourceOffset);
    if (writeSize % 4 !== 0) throw new Error('writeBuffer size must be multiple of 4');
    buffer.data.set(view.subarray(sourceOffset, sourceOffset + writeSize), offset);
    calls.writes.push({
      label: buffer.descriptor.label,
      offset,
      byteLength: data.byteLength,
      dataOffset,
      size,
    });
  },
  submit(commandBuffers) {
    for (const commandBuffer of commandBuffers) {
      for (const copy of commandBuffer.copies || []) {
        copy.destination.data.set(
          copy.source.data.subarray(copy.sourceOffset, copy.sourceOffset + copy.size),
          copy.destinationOffset,
        );
      }
    }
    calls.submissions.push(commandBuffers);
  },
};

const device = {
  features: new Set(['shader-f16']),
  limits: {
    maxBufferSize: 1024 * 1024 * 1024,
    maxStorageBufferBindingSize: 512 * 1024 * 1024,
  },
  queue,
  createBuffer(descriptor) {
    const data = new Uint8Array(descriptor.size);
    const buffer = {
      descriptor,
      data,
      async mapAsync(_mode, offset = 0, size = descriptor.size - offset) {
        if ((descriptor.usage & WEBGPU_BUFFER_USAGE.mapRead) === 0) {
          throw new Error(`buffer ${descriptor.label} missing MAP_READ usage`);
        }
        if (offset % 8 !== 0) throw new Error('map offset must be multiple of 8');
        if (size % 4 !== 0) throw new Error('map size must be multiple of 4');
      },
      getMappedRange(offset = 0, size = descriptor.size - offset) {
        calls.reads.push(descriptor.label);
        return data.slice(offset, offset + size).buffer;
      },
      unmap() {},
    };
    calls.buffers.push(descriptor);
    return buffer;
  },
  createShaderModule(descriptor) {
    calls.shaderModules.push(descriptor);
    return { descriptor };
  },
  createBindGroupLayout(descriptor) {
    calls.bindGroupLayouts.push(descriptor);
    return { descriptor };
  },
  createPipelineLayout(descriptor) {
    calls.pipelineLayouts.push(descriptor);
    return { descriptor };
  },
  createBindGroup(descriptor) {
    calls.bindGroups.push(descriptor);
    return { descriptor };
  },
  createComputePipeline(descriptor) {
    calls.computePipelines.push(descriptor);
    return { descriptor };
  },
  createCommandEncoder(descriptor) {
    calls.commandEncoders.push(descriptor);
    const copies = [];
    return {
      copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
        if (sourceOffset % 4 !== 0) throw new Error('copy sourceOffset must be multiple of 4');
        if (destinationOffset % 4 !== 0) throw new Error('copy destinationOffset must be multiple of 4');
        if (size % 4 !== 0) throw new Error('copy size must be multiple of 4');
        calls.copies.push({
          sourceLabel: source.descriptor.label,
          destinationLabel: destination.descriptor.label,
          sourceOffset,
          destinationOffset,
          size,
        });
        copies.push({ source, sourceOffset, destination, destinationOffset, size });
      },
      beginComputePass(passDescriptor) {
        calls.passes.push(passDescriptor);
        return {
          setPipeline(pipeline) {
            calls.passes.at(-1).pipeline = pipeline;
          },
          setBindGroup(index, bindGroup) {
            calls.passes.at(-1).bindGroup = { index, bindGroup };
          },
          dispatchWorkgroups(x, y, z) {
            calls.dispatches.push({ x, y, z });
          },
          end() {
            calls.passes.at(-1).ended = true;
          },
        };
      },
      finish() {
        return { label: descriptor.label, copies };
      },
    };
  },
};

const runtime = await createWebGpuInferenceRuntime({
  routeId: 'sam3.segment-anything.webgpu-local.v0',
  runtimeLabel: 'runtime-primitives-test',
  device,
  queue,
  adapterName: 'Test Adapter',
  browser: 'Node fake',
  kernel: { profile: 'sam3-attention-tile-v0' },
  requiredStages: ['mask-attention'],
  now,
});

const imageEmbedding = runtime.createTensor({
  name: 'sam3.image-embedding',
  shape: [1, 256, 64, 64],
  dtype: 'f16',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});

assert.equal(imageEmbedding.schema, WEBGPU_TENSOR_SCHEMA);
assert.equal(imageEmbedding.elements, 1048576);
assert.equal(imageEmbedding.byteLength, 2097152);
assert.deepEqual(imageEmbedding.strides, [1048576, 4096, 64, 1]);
assert.equal(calls.buffers.at(-1).label, 'sam3.image-embedding');

runtime.uploadTensor(imageEmbedding, new Uint16Array(imageEmbedding.elements));
assert.equal(calls.writes.at(-1).label, 'sam3.image-embedding');
assert.equal(calls.writes.at(-1).byteLength, imageEmbedding.byteLength);

assert.throws(
  () => runtime.uploadTensor(imageEmbedding, new Uint16Array(3)),
  /byteLength.*tensor/i,
);

const uniforms = packUniforms([
  { name: 'width', type: 'u32' },
  { name: 'height', type: 'u32' },
  { name: 'threshold', type: 'f32' },
  { name: 'scale', type: 'vec2<f32>' },
], {
  width: 64,
  height: 64,
  threshold: 0.5,
  scale: [2, 4],
});

assert.equal(uniforms.byteLength, 32);
assert.deepEqual(uniforms.fields.map(field => [field.name, field.offset, field.byteLength]), [
  ['width', 0, 4],
  ['height', 4, 4],
  ['threshold', 8, 4],
  ['scale', 16, 8],
]);
assert.equal(new Uint32Array(uniforms.buffer, 0, 1)[0], 64);
assert.equal(new Float32Array(uniforms.buffer, 16, 2)[1], 4);

const params = runtime.createUniformBuffer({
  label: 'sam3.mask-attention.params',
  schema: uniforms.schema,
  values: {
    width: 64,
    height: 64,
    threshold: 0.25,
    scale: [1, 1],
  },
});
assert.equal(params.byteLength, 32);
params.update({ width: 32, height: 64, threshold: 0.5, scale: [2, 2] });
assert.equal(calls.writes.at(-1).label, 'sam3.mask-attention.params');
assert.equal(calls.writes.at(-1).byteLength, 32);

const outputMask = runtime.createTensor({
  name: 'sam3.output-mask',
  shape: [1, 1, 64, 64],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
});
new Float32Array(outputMask.buffer.data.buffer).set([0.125, 0.5, 0.875]);

const oneByteMask = runtime.createTensor({
  name: 'sam3.one-byte-mask',
  shape: [1],
  dtype: 'u8',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
assert.equal(oneByteMask.byteLength, 1);
runtime.uploadTensor(oneByteMask, new Uint8Array([197]));

const mappableReadbackBuffer = device.createBuffer({
  label: 'sam3.offset-readback',
  size: 8,
  usage: WEBGPU_BUFFER_USAGE.mapRead | WEBGPU_BUFFER_USAGE.copyDst,
});
mappableReadbackBuffer.data.set([1, 2, 3, 4, 9, 8, 7, 6]);
const offsetReadback = runtime.createTensor({
  name: 'sam3.offset-readback-view',
  shape: [1],
  dtype: 'u32',
  buffer: mappableReadbackBuffer,
  bufferOffset: 4,
  usage: WEBGPU_BUFFER_USAGE.mapRead | WEBGPU_BUFFER_USAGE.copyDst,
});

const offsetUploadBuffer = device.createBuffer({
  label: 'sam3.offset-upload',
  size: 8,
  usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
const offsetUpload = runtime.createTensor({
  name: 'sam3.offset-upload-view',
  shape: [4],
  dtype: 'u8',
  buffer: offsetUploadBuffer,
  bufferOffset: 4,
  usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
runtime.uploadTensor(offsetUpload, new Uint8Array([9, 8, 7, 6]));
assert.deepEqual([...offsetUploadBuffer.data], [0, 0, 0, 0, 9, 8, 7, 6]);

const sharedSmallUploadBuffer = device.createBuffer({
  label: 'sam3.shared-small-upload',
  size: 8,
  usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
sharedSmallUploadBuffer.data.set([1, 2, 3, 4, 5, 6, 7, 8]);
const sharedSmallUpload = runtime.createTensor({
  name: 'sam3.shared-small-upload-view',
  shape: [1],
  dtype: 'u8',
  buffer: sharedSmallUploadBuffer,
  bufferOffset: 4,
  usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
assert.throws(
  () => runtime.uploadTensor(sharedSmallUpload, new Uint8Array([99])),
  /caller-owned.*padding/i,
);
assert.deepEqual([...sharedSmallUploadBuffer.data], [1, 2, 3, 4, 5, 6, 7, 8]);

const reservedSmallUpload = runtime.createTensor({
  name: 'sam3.reserved-small-upload-view',
  shape: [1],
  dtype: 'u8',
  buffer: sharedSmallUploadBuffer,
  bufferOffset: 4,
  paddingReserved: true,
  usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
runtime.uploadTensor(reservedSmallUpload, new Uint8Array([99]));
assert.deepEqual([...sharedSmallUploadBuffer.data], [1, 2, 3, 4, 99, 0, 0, 0]);

const kernel = runtime.defineComputeKernel({
  name: 'sam3.mask-attention',
  code: '@compute @workgroup_size(8, 8, 1) fn main() {}',
  entryPoint: 'main',
  bindings: [
    { name: 'imageEmbedding', resource: imageEmbedding, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
    { name: 'params', resource: params, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
    { name: 'outputMask', resource: outputMask, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
  ],
});

assert.equal(calls.bindGroupLayouts.length, 1);
assert.equal(calls.bindGroupLayouts[0].entries.length, 3);
assert.equal(calls.bindGroupLayouts[0].entries[0].buffer.type, 'read-only-storage');
assert.equal(calls.bindGroups.length, 1);
assert.equal(calls.computePipelines.length, 1);

await runtime.runKernel(kernel, {
  stage: 'mask-attention',
  dispatch: [8, 8, 1],
  metadata: { tiles: 64 },
});

assert.deepEqual(calls.dispatches.at(-1), { x: 8, y: 8, z: 1 });
assert.equal(calls.submissions.length, 1);

const outputReadback = await runtime.readTensor(outputMask);
assert.deepEqual(new Float32Array(outputReadback, 0, 3), new Float32Array([0.125, 0.5, 0.875]));
assert.equal(calls.copies.at(-1).sourceLabel, 'sam3.output-mask');
assert.equal(calls.copies.at(-1).destinationLabel, 'sam3.output-mask.readback');
assert.equal(calls.reads.at(-1), 'sam3.output-mask.readback');
assert.equal(calls.submissions.length, 2);

const oneByteReadback = await runtime.readTensor(oneByteMask);
assert.deepEqual([...new Uint8Array(oneByteReadback)], [197]);
assert.equal(calls.buffers.find(buffer => buffer.label === 'sam3.one-byte-mask').size, 4);
assert.equal(calls.copies.at(-1).sourceLabel, 'sam3.one-byte-mask');
assert.equal(calls.copies.at(-1).size, 4);

const offsetReadbackBytes = await runtime.readTensor(offsetReadback);
assert.deepEqual([...new Uint8Array(offsetReadbackBytes)], [9, 8, 7, 6]);

const profile = runtime.finishProfile({
  evidence: { mode: 'live', source: 'runtime-primitives-contract' },
});

assert.deepEqual(profile.profile.stageNames, ['mask-attention']);
assert.equal(profile.profile.stages[0].metadata.kernelName, 'sam3.mask-attention');
assert.equal(profile.profile.stages[0].metadata.dispatch[0], 8);
assert.equal(profile.profile.stages[0].metadata.tiles, 64);

console.log('runtime primitives contracts passed');
