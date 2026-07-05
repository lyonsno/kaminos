import assert from 'node:assert/strict';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_PHASE_PROGRAM_SCHEMA,
  WEBGPU_PHASE_PROGRAM_RUN_SCHEMA,
  WEBGPU_SHADER_STAGE,
  createWebGpuInferenceRuntime,
} from '../src/index.js';

const calls = {
  buffers: [],
  writes: [],
  reads: [],
  shaderModules: [],
  bindGroupLayouts: [],
  bindGroups: [],
  computePipelines: [],
  commandEncoders: [],
  copies: [],
  dispatches: [],
  submissions: [],
  yields: [],
};

let nowMs = 10;
const now = () => {
  nowMs += 2;
  return nowMs;
};

const queue = {
  writeBuffer(buffer, offset, data) {
    const view = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    buffer.data.set(view, offset);
    calls.writes.push({ label: buffer.descriptor.label, offset, byteLength: data.byteLength });
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
  queue,
  features: new Set(['shader-f16']),
  limits: { maxBufferSize: 1024 * 1024 * 1024 },
  createBuffer(descriptor) {
    const buffer = {
      descriptor,
      data: new Uint8Array(descriptor.size),
      async mapAsync(_mode, offset = 0, size = descriptor.size - offset) {
        if ((descriptor.usage & WEBGPU_BUFFER_USAGE.mapRead) === 0) {
          throw new Error(`buffer ${descriptor.label} missing MAP_READ usage`);
        }
        if (offset % 8 !== 0) throw new Error('map offset must be multiple of 8');
        if (size % 4 !== 0) throw new Error('map size must be multiple of 4');
      },
      getMappedRange(offset = 0, size = descriptor.size - offset) {
        calls.reads.push(descriptor.label);
        return buffer.data.slice(offset, offset + size).buffer;
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
        calls.copies.push({ sourceLabel: source.descriptor.label, destinationLabel: destination.descriptor.label, size });
        copies.push({ source, sourceOffset, destination, destinationOffset, size });
      },
      beginComputePass() {
        return {
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups(x, y, z) {
            calls.dispatches.push({ x, y, z });
          },
          end() {},
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
  runtimeLabel: 'phase-program-test',
  device,
  queue,
  adapterName: 'Phase Adapter',
  browser: 'Node fake',
  kernel: { profile: 'sam3-phase-program-v0' },
  requiredStages: ['decode-mask', 'readback-mask'],
  now,
  yield: async metadata => {
    calls.yields.push(metadata);
    return {
      reason: metadata.reason,
      waitForSubmittedWorkDone: false,
      requestedYieldMs: 0,
      elapsedMs: 0,
      metadata: metadata.metadata || {},
    };
  },
});

const imageEmbedding = runtime.createTensor({
  name: 'sam3.image-embedding',
  shape: [1, 4, 4, 4],
  dtype: 'f16',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
});
const outputMask = runtime.createTensor({
  name: 'sam3.output-mask',
  shape: [1, 1, 4, 4],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
});
new Float32Array(outputMask.buffer.data.buffer).set([0.25, 0.5, 0.75]);
const params = runtime.createUniformBuffer({
  label: 'sam3.mask.params',
  schema: [
    { name: 'width', type: 'u32' },
    { name: 'height', type: 'u32' },
  ],
  values: { width: 4, height: 4 },
});

const program = runtime.defineProgram({
  name: 'sam3.mask-decoder-program',
  tensors: { imageEmbedding, outputMask },
  uniforms: { params },
  kernels: {
    decodeMask: {
      code: '@compute @workgroup_size(4, 4, 1) fn main() {}',
      entryPoint: 'main',
      bindings: [
        { name: 'imageEmbedding', resource: 'tensor:imageEmbedding', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
        { name: 'params', resource: 'uniform:params', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        { name: 'outputMask', resource: 'tensor:outputMask', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
      ],
    },
  },
  phases: [
    {
      name: 'decode-mask',
      kernel: 'decodeMask',
      dispatch: [1, 1, 1],
      yieldAfter: true,
      metadata: {
        programName: 'spoofed-program',
        phaseName: 'spoofed-phase',
        phaseIndex: 99,
        kernelName: 'spoofed-kernel',
        dispatch: ['fake'],
        bindings: ['fakeBinding'],
        tiles: 1,
      },
    },
    {
      name: 'readback-mask',
      readbacks: [{ name: 'maskBytes', tensor: 'outputMask' }],
      metadata: {
        programName: 'spoofed-program',
        phaseName: 'spoofed-readback',
        phaseIndex: 88,
        readbacks: ['fakeBytes'],
        note: 'caller metadata survives without identity authority',
      },
    },
  ],
  metadata: { route: 'sam3-mask-island' },
});

assert.equal(program.schema, WEBGPU_PHASE_PROGRAM_SCHEMA);
assert.equal(program.name, 'sam3.mask-decoder-program');
assert.deepEqual(program.resourceNames.tensors, ['imageEmbedding', 'outputMask']);
assert.deepEqual(program.resourceNames.uniforms, ['params']);
assert.deepEqual(program.phases.map(phase => [phase.name, phase.kind]), [
  ['decode-mask', 'kernel'],
  ['readback-mask', 'readback'],
]);
assert.equal(program.phases[0].kernel.name, 'decodeMask');
assert.deepEqual(program.phases[0].kernel.bindings.map(binding => binding.name), ['imageEmbedding', 'params', 'outputMask']);

assert.throws(
  () => runtime.defineProgram({
    name: 'bad-program',
    phases: [{ name: 'missing-kernel', kernel: 'missing', dispatch: [1, 1, 1] }],
  }),
  /unknown kernel missing/i,
);

const result = await runtime.runProgram(program);
assert.equal(result.schema, WEBGPU_PHASE_PROGRAM_RUN_SCHEMA);
assert.equal(result.programName, 'sam3.mask-decoder-program');
assert.deepEqual(result.phaseNames, ['decode-mask', 'readback-mask']);
assert.deepEqual(new Float32Array(result.outputs.maskBytes, 0, 3), new Float32Array([0.25, 0.5, 0.75]));
assert.deepEqual(calls.dispatches.at(-1), { x: 1, y: 1, z: 1 });
assert.equal(calls.submissions.length, 2);
assert.equal(calls.yields.at(-1).reason, 'sam3.mask-decoder-program.decode-mask.post-submit');

const profile = runtime.finishProfile({
  evidence: { mode: 'live', source: 'phase-program-contract' },
});
assert.deepEqual(profile.profile.stageNames, ['decode-mask', 'readback-mask']);
assert.equal(profile.profile.stages[0].metadata.programName, 'sam3.mask-decoder-program');
assert.equal(profile.profile.stages[0].metadata.phaseIndex, 0);
assert.equal(profile.profile.stages[0].metadata.kernelName, 'decodeMask');
assert.deepEqual(profile.profile.stages[0].metadata.dispatch, [1, 1, 1]);
assert.deepEqual(profile.profile.stages[0].metadata.bindings, ['imageEmbedding', 'params', 'outputMask']);
assert.equal(profile.profile.stages[0].metadata.tiles, 1);
assert.equal(profile.profile.stages[0].metadata.phaseMetadata.programName, 'spoofed-program');
assert.equal(profile.profile.stages[0].metadata.phaseMetadata.kernelName, 'spoofed-kernel');
assert.equal(profile.profile.stages[0].metadata.yields[0].reason, 'sam3.mask-decoder-program.decode-mask.post-submit');
assert.deepEqual(profile.profile.stages[1].metadata.readbacks, ['maskBytes']);
assert.equal(profile.profile.stages[1].metadata.programName, 'sam3.mask-decoder-program');
assert.equal(profile.profile.stages[1].metadata.phaseName, 'readback-mask');
assert.equal(profile.profile.stages[1].metadata.phaseIndex, 1);
assert.equal(profile.profile.stages[1].metadata.phaseMetadata.readbacks[0], 'fakeBytes');

console.log('phase program contracts passed');
