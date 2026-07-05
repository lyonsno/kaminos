import assert from 'node:assert/strict';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_SHADER_STAGE,
  WEBGPU_TENSOR_SCHEMA,
  createWebGpuInferenceRuntime,
  packUniforms,
} from '../src/index.js';

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
    calls.writes.push({
      label: buffer.descriptor.label,
      offset,
      byteLength: data.byteLength,
      dataOffset,
      size,
    });
  },
  submit(commandBuffers) {
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
    const buffer = {
      descriptor,
      async mapAsync() {},
      getMappedRange() {
        calls.reads.push(descriptor.label);
        return new Uint8Array(descriptor.size).buffer;
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
    return {
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
        return { label: descriptor.label };
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

const profile = runtime.finishProfile({
  evidence: { mode: 'live', source: 'runtime-primitives-contract' },
});

assert.deepEqual(profile.profile.stageNames, ['mask-attention']);
assert.equal(profile.profile.stages[0].metadata.kernelName, 'sam3.mask-attention');
assert.equal(profile.profile.stages[0].metadata.dispatch[0], 8);
assert.equal(profile.profile.stages[0].metadata.tiles, 64);

console.log('runtime primitives contracts passed');
