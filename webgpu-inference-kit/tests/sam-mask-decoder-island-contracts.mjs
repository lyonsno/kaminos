import assert from 'node:assert/strict';

import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  assertAuthoritativeRouteWorkerResult,
  createRouteInvocationRequest,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskDecoderIslandRouteReceipt,
  createSam3MaskProjectionCpuOracle,
  runSam3MaskDecoderIslandRoute,
  validateRouteDefinition,
  validateRouteInvocationRequest,
  validateRouteWorkerResult,
} from '../src/index.js';

function makeFakeWebGpuDevice() {
  const calls = {
    shaderModules: [],
    computePipelines: [],
    bindGroups: [],
    buffers: [],
    writes: [],
    passes: [],
    copies: [],
    submitted: [],
    submittedWorkDone: 0,
  };

  const queue = {
    writeBuffer(buffer, offset, data, dataOffset = 0, size = undefined) {
      calls.writes.push({ label: buffer.descriptor.label, offset, byteLength: data.byteLength, dataOffset, size });
    },
    submit(commandBuffers) {
      calls.submitted.push(commandBuffers);
    },
    async onSubmittedWorkDone() {
      calls.submittedWorkDone += 1;
    },
  };

  const device = {
    label: 'sam-test-device',
    features: new Set(['shader-f16']),
    limits: {
      maxBufferSize: 1024 * 1024 * 1024,
      maxStorageBufferBindingSize: 512 * 1024 * 1024,
    },
    queue,
    createShaderModule(descriptor) {
      calls.shaderModules.push(descriptor);
      return { kind: 'shader-module', descriptor };
    },
    createComputePipeline(descriptor) {
      calls.computePipelines.push(descriptor);
      return {
        kind: 'compute-pipeline',
        descriptor,
        getBindGroupLayout(index) {
          return { kind: 'bind-group-layout', index, pipelineLabel: descriptor.label };
        },
      };
    },
    createBindGroup(descriptor) {
      calls.bindGroups.push(descriptor);
      return { kind: 'bind-group', descriptor };
    },
    createBuffer(descriptor) {
      const mapped = new ArrayBuffer(descriptor.size);
      const buffer = {
        kind: 'buffer',
        descriptor,
        async mapAsync() {},
        getMappedRange() {
          return mapped;
        },
        unmap() {},
      };
      calls.buffers.push(descriptor);
      return buffer;
    },
    createCommandEncoder(descriptor = {}) {
      const commands = [];
      return {
        beginComputePass(passDescriptor = {}) {
          const pass = {
            descriptor: passDescriptor,
            setPipeline(pipeline) {
              commands.push({ type: 'setPipeline', label: pipeline.descriptor.label });
            },
            setBindGroup(index, bindGroup) {
              commands.push({ type: 'setBindGroup', index, entries: bindGroup.descriptor.entries.length });
            },
            dispatchWorkgroups(x, y = 1, z = 1) {
              commands.push({ type: 'dispatchWorkgroups', x, y, z });
            },
            end() {
              commands.push({ type: 'endComputePass' });
            },
          };
          calls.passes.push(pass);
          return pass;
        },
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
          calls.copies.push({
            source: source.descriptor.label,
            destination: destination.descriptor.label,
            sourceOffset,
            destinationOffset,
            size,
          });
          commands.push({ type: 'copyBufferToBuffer', size });
        },
        finish() {
          return { kind: 'command-buffer', descriptor, commands };
        },
      };
    },
  };

  return { device, queue, calls };
}

const route = createSam3MaskDecoderIslandRouteDefinition({
  kernel: { profile: 'sam3-mask-projection-threshold-v0', commit: 'abc1234' },
});

assert.equal(route.routeId, SAM3_MASK_DECODER_ISLAND_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-decoder-tensors', 'sam3-decoder-weights']);
assert.deepEqual(route.requiredOutputRoles, ['mask-logits', 'mask-binary']);
assert.deepEqual(route.optionalOutputRoles, ['mask-overlay']);
assert.deepEqual(route.requiredStages, [
  'load-decoder-tensors',
  'decode-mask',
  'threshold-mask',
  'readback-mask',
]);
assert.equal(validateRouteDefinition(route).ok, true);

const request = createRouteInvocationRequest(route, {
  requestId: 'req:sam3-mask-island-orb',
  inputs: {
    'source-image': {
      artifactId: 'image:evil-orb',
      sha256: 'sha256:source-image',
      shape: [64, 64, 3],
    },
    'sam3-decoder-tensors': {
      artifactId: 'sam3-tensors:evil-orb:text-orb',
      sha256: 'sha256:tensor-packet',
      shape: [1],
    },
    'sam3-decoder-weights': {
      artifactId: 'sam3-weights:mask-projection',
      sha256: 'sha256:weight-packet',
      shape: [1],
    },
  },
  outputs: {
    'mask-logits': { artifactId: 'sam3-mask-logits:evil-orb', shape: [1, 1, 2, 2] },
    'mask-binary': { artifactId: 'sam3-mask-binary:evil-orb', shape: [1, 1, 2, 2] },
  },
  routeConfig: {
    upstream: 'mlx-oracle-export',
    promptHash: 'sha256:prompt-text',
    threshold: 0,
  },
});

assert.equal(validateRouteInvocationRequest(request, route).ok, true);

const projection = createSam3MaskProjectionCpuOracle({
  hyperInput: new Float32Array([2, -1]),
  upscaledEmbedding: new Float32Array([
    1, 2, 3, 4,
    5, 6, 7, 8,
  ]),
  shape: {
    batch: 1,
    maskTokens: 1,
    channels: 2,
    height: 2,
    width: 2,
  },
});
assert.deepEqual(Array.from(projection.maskLogits), [-3, -2, -1, 0]);
assert.deepEqual(Array.from(projection.binaryMask), [0, 0, 0, 0]);

const { device, queue, calls } = makeFakeWebGpuDevice();
const result = await runSam3MaskDecoderIslandRoute({
  request,
  device,
  queue,
  adapterName: 'Fake Apple WebGPU Adapter',
  browser: 'Node fake WebGPU',
  kernel: route.kernel,
  model: {
    revision: 'mlx-community/sam3-image-mask-island',
    weightsHash: 'sha256:weight-packet',
    dtype: 'fp32',
  },
  tensors: {
    hyperInput: projection.inputs.hyperInput,
    upscaledEmbedding: projection.inputs.upscaledEmbedding,
    shape: projection.shape,
  },
});

assert.equal(result.schema, 'kaminos.webgpu-route-result.v0');
assert.equal(result.routeId, SAM3_MASK_DECODER_ISLAND_ROUTE_ID);
assert.equal(result.status, 'real');
assert.equal(validateRouteWorkerResult(result, route).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteWorkerResult(result, route));
assert.deepEqual(
  result.receipt.timings.profile.stageNames,
  ['load-decoder-tensors', 'decode-mask', 'threshold-mask', 'readback-mask'],
);
assert.equal(result.receipt.model.id, 'facebook/sam3');
assert.match(result.receipt.outputs.find(output => output.role === 'mask-logits').sha256, /^sha256:/);
assert.match(result.receipt.outputs.find(output => output.role === 'mask-binary').sha256, /^sha256:/);
assert.ok(calls.shaderModules.some(module => module.label === 'sam3.mask-projection'));
assert.ok(calls.shaderModules.some(module => module.label === 'sam3.threshold-mask'));
assert.ok(calls.computePipelines.some(pipeline => pipeline.label === 'sam3.mask-projection'));
assert.ok(calls.computePipelines.some(pipeline => pipeline.label === 'sam3.threshold-mask'));
assert.equal(calls.submitted.length, 2);
assert.equal(calls.copies.length, 2);
assert.equal(calls.submittedWorkDone, 3);

const defaultModelDevice = makeFakeWebGpuDevice();
const defaultModelResult = await runSam3MaskDecoderIslandRoute({
  request,
  device: defaultModelDevice.device,
  queue: defaultModelDevice.queue,
  adapterName: 'Fake Apple WebGPU Adapter',
  browser: 'Node fake WebGPU',
  kernel: route.kernel,
  tensors: {
    hyperInput: projection.inputs.hyperInput,
    upscaledEmbedding: projection.inputs.upscaledEmbedding,
    shape: projection.shape,
  },
});
assert.equal(defaultModelResult.receipt.model.revision, 'mlx-oracle-upstream-mask-island');
assert.equal(validateRouteWorkerResult(defaultModelResult, route).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteWorkerResult(defaultModelResult, route));

assert.throws(
  () => createSam3MaskDecoderIslandRouteReceipt({
    sourceImage: request.inputs[0],
    tensorPacket: request.inputs[1],
    weightsPacket: request.inputs[2],
    outputs: {
      maskLogits: { artifactId: 'missing-hash', sha256: '', shape: [1, 1, 2, 2] },
      binaryMask: { artifactId: 'binary', sha256: 'sha256:binary', shape: [1, 1, 2, 2] },
    },
    backend: result.receipt.backend,
    model: result.receipt.model,
    kernel: result.receipt.kernel,
    profile: result.receipt.timings.profile,
  }),
  /maskLogits output must include sha256/,
);

console.log('sam mask decoder island contracts passed');
