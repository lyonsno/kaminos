import assert from 'node:assert/strict';

import {
  PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES,
  PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
  WEBGPU_BUFFER_USAGE,
  assertAuthoritativeRouteReceipt,
  createPyroRgbIntermediateDecoderPhaseProgram,
  createPyroRgbIntermediateDecoderRouteDefinition,
  createPyroRgbIntermediateDecoderRouteReceipt,
  createRouteInvocationRequest,
  createRouteWorkerResult,
  createWebGpuInferenceRuntime,
  validateRouteDefinition,
  validateRouteInvocationRequest,
  validateRouteWorkerResult,
} from '../src/index.js';

const calls = {
  shaderModules: [],
  bindGroupLayouts: [],
  bindGroups: [],
  computePipelines: [],
  commandEncoders: [],
  dispatches: [],
  submissions: [],
};

let nowMs = 10;
const now = () => {
  nowMs += 1;
  return nowMs;
};

const queue = {
  writeBuffer(buffer, offset, data) {
    const view = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    buffer.data.set(view, offset);
  },
  submit(commandBuffers) {
    calls.submissions.push(commandBuffers);
  },
};

const device = {
  queue,
  features: new Set(['shader-f16']),
  limits: { maxBufferSize: 1024 * 1024 * 1024 },
  createBuffer(descriptor) {
    return {
      descriptor,
      data: new Uint8Array(descriptor.size),
      async mapAsync() {},
      getMappedRange(offset = 0, size = descriptor.size - offset) {
        return this.data.slice(offset, offset + size).buffer;
      },
      unmap() {},
    };
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
    return {
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
        return { label: descriptor.label };
      },
    };
  },
};

const route = createPyroRgbIntermediateDecoderRouteDefinition({
  model: {
    revision: 'local-debug-tiny',
    weightsHash: 'sha256:weights',
    dtype: 'fp32',
  },
  kernel: {
    profile: 'tiny-3x3-carrier-decoder-wgsl-v0',
    commit: 'test',
  },
});

assert.equal(PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID, 'pyro.rgb-intermediate-decoder.webgpu-local.v0');
assert.deepEqual(PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES, [
  'hot-core',
  'fire-body',
  'smoke-body',
  'edge-breakup',
  'radiance-gain',
  'confidence-alpha',
]);
assert.equal(route.routeId, PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['carrier-planes', 'decoder-weights']);
assert.deepEqual(route.requiredOutputRoles, PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES);
assert.deepEqual(route.requiredStages, ['decode-intermediate-fields', 'readback-intermediate-fields']);
assert.equal(route.scheduler.requestedScheduler.mode, 'cooperative');
assert.equal(validateRouteDefinition(route).ok, true);

const request = createRouteInvocationRequest(route, {
  requestId: 'req:pyro-decoder-smoke',
  inputs: {
    'carrier-planes': {
      artifactId: 'tensor:carrier-planes',
      sha256: 'sha256:carrier',
      shape: [12, 128, 128],
    },
    'decoder-weights': {
      artifactId: 'tensor:decoder-weights',
      sha256: 'sha256:weights',
      shape: [6, 12, 3, 3],
    },
  },
  outputs: Object.fromEntries(PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES.map(role => [
    role,
    { artifactId: `tensor:${role}`, shape: [128, 128] },
  ])),
  routeConfig: {
    inputChannels: 12,
    outputChannels: 6,
    resolution: [128, 128],
  },
});
assert.equal(validateRouteInvocationRequest(request, route).ok, true);

const backend = {
  kind: 'webgpu-local',
  runtime: 'browser',
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  features: ['shader-f16'],
  requestedFeatures: [],
  limits: { maxBufferSize: 4294967296 },
  timestampQuery: 'unavailable',
};
const profile = {
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'staged-submits',
  timingSource: 'queue-submit-wait',
  requiredStages: ['decode-intermediate-fields', 'readback-intermediate-fields'],
  stages: [
    { name: 'decode-intermediate-fields', ms: 0.7 },
    { name: 'readback-intermediate-fields', ms: 0.2 },
  ],
  stageNames: ['decode-intermediate-fields', 'readback-intermediate-fields'],
  totalMs: 0.9,
};

const receipt = createPyroRgbIntermediateDecoderRouteReceipt({
  inputs: {
    carrierPlanes: request.inputs.find(input => input.role === 'carrier-planes'),
    decoderWeights: request.inputs.find(input => input.role === 'decoder-weights'),
  },
  outputs: Object.fromEntries(PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES.map(role => [
    role.replaceAll('-', ''),
    { artifactId: `tensor:${role}`, sha256: `sha256:${role}`, shape: [128, 128] },
  ])),
  backend,
  model: {
    revision: 'local-debug-tiny',
    weightsHash: 'sha256:weights',
    dtype: 'fp32',
  },
  kernel: route.kernel,
  profile,
});

assert.equal(receipt.requestedRouteId, PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID);
assert.equal(receipt.effectiveRouteId, PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID);
assert.equal(receipt.model.id, 'kaminos/pyro-rgb-intermediate-decoder');
assert.equal(receipt.outputs.length, 6);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt));

const result = createRouteWorkerResult(route, { request, receipt });
assert.equal(validateRouteWorkerResult(result, route).ok, true);

const runtime = await createWebGpuInferenceRuntime({
  routeId: PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
  runtimeLabel: 'pyro-decoder-contract',
  device,
  queue,
  adapterName: 'Pyro Fake Adapter',
  browser: 'Node fake',
  kernel: route.kernel,
  requiredStages: route.requiredStages,
  now,
});
const carrierPlanes = runtime.createTensor({
  name: 'pyro.carrier-planes',
  shape: [12, 8, 8],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
const decoderWeights = runtime.createTensor({
  name: 'pyro.decoder-weights',
  shape: [6, 12, 3, 3],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
const decoderBias = runtime.createTensor({
  name: 'pyro.decoder-bias',
  shape: [6],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
const intermediateFields = runtime.createTensor({
  name: 'pyro.intermediate-fields',
  shape: [6, 8, 8],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
});
const decoderParams = runtime.createUniformBuffer({
  label: 'pyro.decoder.params',
  schema: [
    { name: 'width', type: 'u32' },
    { name: 'height', type: 'u32' },
    { name: 'inputChannels', type: 'u32' },
    { name: 'outputChannels', type: 'u32' },
  ],
  values: {
    width: 8,
    height: 8,
    inputChannels: 12,
    outputChannels: 6,
  },
});

const program = createPyroRgbIntermediateDecoderPhaseProgram({
  runtime,
  carrierPlanes,
  decoderWeights,
  decoderBias,
  decoderParams,
  intermediateFields,
  width: 8,
  height: 8,
  inputChannels: 12,
  outputChannels: 6,
});

assert.equal(program.name, 'pyro.rgb-intermediate-decoder.tiny-3x3');
assert.deepEqual(program.phaseNames ?? program.phases.map(phase => phase.name), [
  'decode-intermediate-fields',
  'readback-intermediate-fields',
]);
assert.deepEqual(program.phases[0].kernel.bindings.map(binding => binding.name), [
  'carrierPlanes',
  'decoderWeights',
  'decoderBias',
  'decoderParams',
  'intermediateFields',
]);
assert.deepEqual(program.phases[0].dispatch, [1, 1, 6]);
assert.match(calls.shaderModules[0].code, /workgroup_size\(8,\s*8,\s*1\)/);
assert.match(calls.shaderModules[0].code, /3x3 carrier decoder/);
assert.match(calls.shaderModules[0].code, /decoderWeights/);

console.log('pyro rgb decoder route contracts passed');
