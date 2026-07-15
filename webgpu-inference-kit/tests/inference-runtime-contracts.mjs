import assert from 'node:assert/strict';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_INFERENCE_RUNTIME_SCHEMA,
  createCooperativeYield,
  createWebGpuInferenceRuntime,
  createWebGpuResourceCaches,
} from '../src/index.js';

const calls = {
  shaderModules: [],
  computePipelines: [],
  buffers: [],
  writes: [],
  reads: [],
  destroyedBuffers: [],
  submittedWorkDone: 0,
};

let nowMs = 100;
const now = () => {
  nowMs += 2.5;
  return nowMs;
};

const queue = {
  writeBuffer(buffer, offset, data, dataOffset, size) {
    calls.writes.push({ buffer, offset, byteLength: data.byteLength, dataOffset, size });
  },
  async onSubmittedWorkDone() {
    calls.submittedWorkDone += 1;
  },
};

const device = {
  label: 'test-device',
  features: new Set(['shader-f16']),
  limits: {
    maxBufferSize: 1024 * 1024 * 1024,
    maxStorageBufferBindingSize: 512 * 1024 * 1024,
    minStorageBufferOffsetAlignment: 256,
  },
  queue,
  createShaderModule(descriptor) {
    calls.shaderModules.push(descriptor);
    return { kind: 'shader-module', descriptor };
  },
  createComputePipeline(descriptor) {
    calls.computePipelines.push(descriptor);
    return { kind: 'compute-pipeline', descriptor };
  },
  createBuffer(descriptor) {
    const buffer = {
      kind: 'buffer',
      descriptor,
      async mapAsync() {},
      getMappedRange() {
        calls.reads.push(descriptor.label);
        return new Uint8Array([1, 2, 3, 4]).buffer;
      },
      unmap() {},
      destroy() {
        calls.destroyedBuffers.push(descriptor.label);
      },
    };
    calls.buffers.push(descriptor);
    return buffer;
  },
};

const caches = createWebGpuResourceCaches(device);
const moduleA = caches.getShaderModule('sam3-mask-decoder', '@compute fn main() {}');
const moduleB = caches.getShaderModule('sam3-mask-decoder', '@compute fn main() {}');
assert.equal(moduleA, moduleB);
assert.equal(calls.shaderModules.length, 1);

const pipelineA = caches.getComputePipeline('sam3-mask-decoder', {
  compute: { module: moduleA, entryPoint: 'main' },
});
const pipelineB = caches.getComputePipeline('sam3-mask-decoder', {
  compute: { module: moduleA, entryPoint: 'main' },
});
assert.equal(pipelineA, pipelineB);
assert.equal(calls.computePipelines.length, 1);

const nativeLikeModuleA = Object.create(null);
const nativeLikeModuleB = Object.create(null);
caches.getComputePipeline('same-label-native-module', {
  layout: 'auto',
  compute: { module: nativeLikeModuleA, entryPoint: 'main' },
});
caches.getComputePipeline('same-label-native-module', {
  layout: 'auto',
  compute: { module: nativeLikeModuleB, entryPoint: 'main' },
});
assert.equal(calls.computePipelines.length, 3);

const adapter = {
  features: new Set(['shader-f16']),
  limits: device.limits,
};

const runtime = await createWebGpuInferenceRuntime({
  routeId: 'sam3.segment-anything.webgpu-local.v0',
  runtimeLabel: 'sam3-port-smoke-runtime',
  device,
  queue,
  adapter,
  adapterName: 'Test WebGPU Adapter',
  browser: 'Node contract fake',
  kernel: {
    profile: 'sam3-mask-decoder-minimal',
    commit: 'abc1234',
  },
  requiredStages: ['encode-image', 'decode-mask'],
  now,
  yield: createCooperativeYield({
    queue,
    waitForSubmittedWorkDone: true,
    sleep: async ms => {
      assert.equal(ms, 0);
    },
  }),
});

assert.equal(runtime.schema, WEBGPU_INFERENCE_RUNTIME_SCHEMA);
assert.equal(runtime.routeId, 'sam3.segment-anything.webgpu-local.v0');
assert.equal(runtime.backendIdentity.adapterName, 'Test WebGPU Adapter');
assert.deepEqual(runtime.backendIdentity.features, ['shader-f16']);

const weights = runtime.createBuffer({
  label: 'sam3-mask-decoder.weights',
  size: 16,
  usage: 0x80,
});
runtime.writeBuffer(weights, new Uint8Array([1, 2, 3, 4]));
assert.equal(calls.buffers.length, 1);
assert.equal(calls.writes.length, 1);
assert.equal(calls.writes[0].byteLength, 4);

const stageResult = await runtime.runStage('encode-image', async stage => {
  const stageModule = stage.getShaderModule('sam3-image-encoder', '@compute fn main() {}');
  stage.getComputePipeline('sam3-image-encoder', {
    compute: { module: stageModule, entryPoint: 'main' },
  });
  await stage.yieldToBrowser({ reason: 'between-encoder-tiles' });
  return 'encoded';
}, { tiles: 4 });

assert.equal(stageResult, 'encoded');
assert.equal(calls.submittedWorkDone, 1);

await runtime.runStage('decode-mask', async () => 'decoded');

const profile = runtime.finishProfile({
  evidence: { mode: 'live', source: 'sam3-port-contract-test' },
});

assert.equal(profile.schema, 'kaminos.webgpu-runtime-profile.v0');
assert.equal(profile.routeId, 'sam3.segment-anything.webgpu-local.v0');
assert.deepEqual(profile.profile.stageNames, ['encode-image', 'decode-mask']);
assert.equal(profile.profile.stages[0].metadata.tiles, 4);
assert.equal(profile.profile.stages[0].metadata.yields.length, 1);
assert.equal(profile.profile.stages[0].metadata.yields[0].reason, 'between-encoder-tiles');
assert.equal(profile.profile.timingSource, 'host-stage-timer');
assert.equal(profile.kernel.profile, 'sam3-mask-decoder-minimal');

const residentSource = new Float32Array([1, 2, 3, 4]);
let residentDestroyCount = 0;
const residentBuffer = {
  label: 'resident.encoder.weight',
  destroy() { residentDestroyCount += 1; },
};
const buffersBeforeResidentTensor = calls.buffers.length;
const writesBeforeResidentTensor = calls.writes.length;
const residentRuntime = await createWebGpuInferenceRuntime({
  routeId: 'sam31.resident-tensor-contract.webgpu-local.v0',
  device,
  queue,
  adapter,
  adapterName: 'Test WebGPU Adapter',
  kernel: { profile: 'sam31-resident-tensor-contract-v0' },
  requiredStages: ['load-resident'],
  residentTensorResolver(tensorInput) {
    assert.equal(tensorInput.sourceData, residentSource);
    return {
      buffer: residentBuffer,
      bufferOffset: 0,
      dtype: 'f32',
      shape: [4],
      byteLength: 16,
      usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      sourceData: residentSource,
      resourceId: 'sam31.static:encoder.weight',
    };
  },
});
const residentTensor = residentRuntime.createTensor({
  name: 'sam31.encoder.weight',
  shape: [4],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
  sourceData: residentSource,
});
assert.equal(residentTensor.buffer, residentBuffer);
assert.equal(residentTensor.ownsBuffer, false);
assert.equal(calls.buffers.length, buffersBeforeResidentTensor, 'resident tensors must not allocate invocation buffers');
residentRuntime.uploadTensor(residentTensor, residentSource);
assert.equal(calls.writes.length, writesBeforeResidentTensor, 'resident tensors must not re-upload authenticated bytes');
const misalignedResidentRuntime = await createWebGpuInferenceRuntime({
  routeId: 'sam31.misaligned-resident-tensor-contract.webgpu-local.v0',
  device,
  queue,
  adapter,
  adapterName: 'Test WebGPU Adapter',
  kernel: { profile: 'sam31-misaligned-resident-tensor-contract-v0' },
  requiredStages: [],
  residentTensorResolver(tensorInput) {
    return {
      buffer: residentBuffer,
      bufferOffset: 4,
      dtype: 'f32',
      shape: [3],
      byteLength: 12,
      usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      sourceData: tensorInput.sourceData,
    };
  },
});
assert.throws(
  () => misalignedResidentRuntime.createTensor({
    name: 'sam31.absolute-position.without-cls',
    shape: [3],
    dtype: 'f32',
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
    sourceData: residentSource.subarray(1),
  }),
  /minStorageBufferOffsetAlignment|storage buffer offset alignment/i,
  'resident subviews must fail before bind-group creation when their offset is illegal on the effective adapter',
);
misalignedResidentRuntime.dispose();
assert.throws(
  () => residentRuntime.uploadTensor(residentTensor, Float32Array.from(residentSource)),
  /resident tensor source identity mismatch/i,
);
assert.deepEqual(residentRuntime.dispose(), {
  disposed: true,
  ownedBufferCount: 0,
  ownedBufferBytes: 0,
  destroyedBufferCount: 0,
});
assert.equal(residentDestroyCount, 0, 'invocation runtime disposal must not destroy resident model resources');

const disposal = runtime.dispose();
assert.deepEqual(disposal, {
  disposed: true,
  ownedBufferCount: 1,
  ownedBufferBytes: 16,
  destroyedBufferCount: 1,
});
assert.deepEqual(calls.destroyedBuffers, ['sam3-mask-decoder.weights']);
assert.deepEqual(runtime.dispose(), disposal, 'runtime disposal must be idempotent');
assert.throws(
  () => runtime.createBuffer({ label: 'after-dispose', size: 4, usage: 0x80 }),
  /runtime is disposed/,
  'disposed runtimes must not silently allocate new buffers',
);

await assert.rejects(
  () => createWebGpuInferenceRuntime({
    routeId: 'missing-context.webgpu-local.v0',
    kernel: { profile: 'bad' },
  }),
  /device.*gpu/i,
);

await assert.rejects(
  () => createWebGpuInferenceRuntime({
    routeId: 'missing-backend-identity.webgpu-local.v0',
    device,
    queue,
    kernel: { profile: 'identity-required' },
    requiredStages: ['stage'],
  }),
  /adapterName|backendIdentity|adapter identity/i,
);

console.log('inference runtime contracts passed');
