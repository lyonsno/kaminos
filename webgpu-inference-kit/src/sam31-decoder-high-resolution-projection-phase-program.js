import {
  assertAuthoritativeRouteWorkerResult,
  createRouteWorkerResult,
  defineWebGpuRoute,
} from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE } from './runtime-primitives.js';
import { createKernelProfileMetadata, createRouteKernelProfileMetadata } from './kernel-profile.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';
import { createWebGpuRouteBackpressureProfile, createWebGpuRouteSchedulerProfile } from './scheduler-backpressure.js';

export const SAM31_DECODER_HIGH_RESOLUTION_PROJECTION_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.decoder-high-resolution-projection.phase-program.webgpu-local.v0';

const REQUIRED_STAGES = [
  'load-decoder-high-resolution-projection-tensors',
  'decoder-high-resolution-project-s0',
  'decoder-high-resolution-project-s1',
  'readback-decoder-high-resolution-projections',
];
const INPUT_ROLES = [
  'source-image',
  'sam31-decoder-high-resolution-feature-0',
  'sam31-decoder-high-resolution-feature-1',
  'sam31-decoder-high-resolution-projection-weights',
];
const OUTPUT_ROLES = [
  { key: 'highResolutionS0', role: 'sam31-decoder-high-resolution-s0', required: true },
  { key: 'highResolutionS1', role: 'sam31-decoder-high-resolution-s1', required: true },
];

const PROJECTION_WGSL = `
struct ProjectionDims {
  batch: u32,
  height: u32,
  width: u32,
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
};
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ProjectionDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let x = index % dims.width;
  let y = (index / dims.width) % dims.height;
  let output_channel = (index / (dims.width * dims.height)) % dims.output_channels;
  let batch = index / (dims.output_channels * dims.width * dims.height);
  let input_base = ((batch * dims.height + y) * dims.width + x) * dims.input_channels;
  let weight_base = output_channel * dims.input_channels;
  var sum = bias[output_channel];
  for (var input_channel = 0u; input_channel < dims.input_channels; input_channel = input_channel + 1u) {
    sum += input_values[input_base + input_channel] * weight[weight_base + input_channel];
  }
  output_values[index] = sum;
}
`;

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function float32(value, name, length) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  if (value.length !== length) throw new Error(`${name} length ${value.length} does not match ${length}`);
  return value;
}

function normalizeInputs(input = {}) {
  const shape = {
    batch: positiveInteger(input.shape?.batch, 'shape.batch'),
    feature0Height: positiveInteger(input.shape?.feature0Height, 'shape.feature0Height'),
    feature0Width: positiveInteger(input.shape?.feature0Width, 'shape.feature0Width'),
    feature1Height: positiveInteger(input.shape?.feature1Height, 'shape.feature1Height'),
    feature1Width: positiveInteger(input.shape?.feature1Width, 'shape.feature1Width'),
    inputChannels: positiveInteger(input.shape?.inputChannels, 'shape.inputChannels'),
    s0Channels: positiveInteger(input.shape?.s0Channels, 'shape.s0Channels'),
    s1Channels: positiveInteger(input.shape?.s1Channels, 'shape.s1Channels'),
  };
  const feature0 = float32(input.feature0, 'feature0', shape.batch * shape.feature0Height * shape.feature0Width * shape.inputChannels);
  const feature1 = float32(input.feature1, 'feature1', shape.batch * shape.feature1Height * shape.feature1Width * shape.inputChannels);
  const weights = {
    s0: {
      weight: float32(input.weights?.s0?.weight, 'weights.s0.weight', shape.s0Channels * shape.inputChannels),
      bias: float32(input.weights?.s0?.bias, 'weights.s0.bias', shape.s0Channels),
    },
    s1: {
      weight: float32(input.weights?.s1?.weight, 'weights.s1.weight', shape.s1Channels * shape.inputChannels),
      bias: float32(input.weights?.s1?.bias, 'weights.s1.bias', shape.s1Channels),
    },
  };
  return { shape, feature0, feature1, weights };
}

function projectBhWcToNchw(input, batch, height, width, inputChannels, outputChannels, weights) {
  const output = new Float32Array(batch * outputChannels * height * width);
  for (let b = 0; b < batch; b += 1) {
    for (let outputChannel = 0; outputChannel < outputChannels; outputChannel += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const inputBase = ((b * height + y) * width + x) * inputChannels;
          let sum = weights.bias[outputChannel];
          for (let inputChannel = 0; inputChannel < inputChannels; inputChannel += 1) sum += input[inputBase + inputChannel] * weights.weight[outputChannel * inputChannels + inputChannel];
          output[((b * outputChannels + outputChannel) * height + y) * width + x] = sum;
        }
      }
    }
  }
  return output;
}

export function createSam31DecoderHighResolutionProjectionPhaseProgramCpuOracle(input) {
  const { shape, feature0, feature1, weights } = normalizeInputs(input);
  return {
    shape,
    highResolutionS0: projectBhWcToNchw(feature0, shape.batch, shape.feature0Height, shape.feature0Width, shape.inputChannels, shape.s0Channels, weights.s0),
    highResolutionS1: projectBhWcToNchw(feature1, shape.batch, shape.feature1Height, shape.feature1Width, shape.inputChannels, shape.s1Channels, weights.s1),
  };
}

function createDefaultScheduler() {
  const chunks = Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.startsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage.startsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.startsWith('readback') })),
      notes: 'SAM3.1 decoder high-resolution projection yields around upload, each 1x1 branch projection, and readback.',
    },
  });
}

export function createSam31DecoderHighResolutionProjectionPhaseProgramRouteDefinition(input = {}) {
  const metadata = createRouteKernelProfileMetadata(input, { defaultProfile: 'sam31-decoder-high-resolution-projection-phase-program-v0', requiredStages: REQUIRED_STAGES, timingSource: 'queue-submit-wait' });
  return defineWebGpuRoute({
    routeId: SAM31_DECODER_HIGH_RESOLUTION_PROJECTION_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: 'facebook/sam3.1', revision: input.model?.revision || 'sam31-browser-decoder-high-resolution-projection', dtype: 'fp32' },
    kernel: metadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(({ role }) => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: metadata.requiredStages,
    timingSource: metadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createWebGpuRouteBackpressureProfile({ requestedBudget: 'visible-wait', effectiveBudget: 'visible-wait', memoryExclusivity: 'shared', warmCacheState: 'unknown' }),
    worker: input.worker || { exportName: 'runSam31DecoderHighResolutionProjectionPhaseProgramRoute', upstreamBoundary: 'browser-sam31-propagation-fpn-levels-0-1-to-multiplex-decoder-high-resolution-features' },
  });
}

export function createSam31DecoderHighResolutionProjectionPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_DECODER_HIGH_RESOLUTION_PROJECTION_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM31_DECODER_HIGH_RESOLUTION_PROJECTION_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: 'facebook/sam3.1', revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam31-decoder-high-resolution-feature-0', input.feature0),
      createRouteReceiptInputArtifact('sam31-decoder-high-resolution-feature-1', input.feature1),
      createRouteReceiptInputArtifact('sam31-decoder-high-resolution-projection-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam31DecoderHighResolutionProjectionPhaseProgramRoute(input = {}) {
  if (!input.request) throw new Error('request is required');
  const route = input.route || createSam31DecoderHighResolutionProjectionPhaseProgramRouteDefinition({ kernel: input.kernel, model: input.model });
  const normalized = normalizeInputs(input.tensors || {});
  const { shape, feature0, feature1, weights } = normalized;
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const feature0Artifact = roleArtifact(input.request.inputs, 'sam31-decoder-high-resolution-feature-0');
  const feature1Artifact = roleArtifact(input.request.inputs, 'sam31-decoder-high-resolution-feature-1');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam31-decoder-high-resolution-projection-weights');
  const runtime = await createWebGpuInferenceRuntime({
    routeId: route.routeId,
    runtimeLabel: input.runtimeLabel || 'sam31-decoder-high-resolution-projection-phase-program',
    device: input.device, queue: input.queue, adapter: input.adapter, adapterName: input.adapterName, browser: input.browser,
    backendIdentity: input.backendIdentity, kernel: input.kernel || route.kernel, requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait', waitForSubmittedWorkDone: true, yieldMs: 0, now: input.now,
    residentTensorResolver: input.residentTensorResolver,
  });
  let gpu = null;
  await runtime.runStage(REQUIRED_STAGES[0], async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage, sourceData = undefined) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage, ...(sourceData ? { sourceData } : {}) });
    const uniform = (name, height, width, outputChannels) => stage.createUniformBuffer({
      label: name,
      schema: [
        { name: 'batch', type: 'u32' }, { name: 'height', type: 'u32' }, { name: 'width', type: 'u32' },
        { name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' },
      ],
      values: { batch: shape.batch, height, width, input_channels: shape.inputChannels, output_channels: outputChannels, total_output: shape.batch * outputChannels * height * width },
    });
    gpu = {
      feature0: tensor('sam31.high-resolution.feature-0', [shape.batch, shape.feature0Height, shape.feature0Width, shape.inputChannels], readonly),
      feature1: tensor('sam31.high-resolution.feature-1', [shape.batch, shape.feature1Height, shape.feature1Width, shape.inputChannels], readonly),
      s0Weight: tensor('sam31.high-resolution.s0.weight', [shape.s0Channels, shape.inputChannels], readonly, weights.s0.weight),
      s0Bias: tensor('sam31.high-resolution.s0.bias', [shape.s0Channels], readonly, weights.s0.bias),
      s1Weight: tensor('sam31.high-resolution.s1.weight', [shape.s1Channels, shape.inputChannels], readonly, weights.s1.weight),
      s1Bias: tensor('sam31.high-resolution.s1.bias', [shape.s1Channels], readonly, weights.s1.bias),
      s0: tensor('sam31.high-resolution.s0', [shape.batch, shape.s0Channels, shape.feature0Height, shape.feature0Width]),
      s1: tensor('sam31.high-resolution.s1', [shape.batch, shape.s1Channels, shape.feature1Height, shape.feature1Width]),
      s0Dims: uniform('sam31.high-resolution.s0-dims', shape.feature0Height, shape.feature0Width, shape.s0Channels),
      s1Dims: uniform('sam31.high-resolution.s1-dims', shape.feature1Height, shape.feature1Width, shape.s1Channels),
    };
    for (const [resource, values] of [['feature0', feature0], ['feature1', feature1], ['s0Weight', weights.s0.weight], ['s0Bias', weights.s0.bias], ['s1Weight', weights.s1.weight], ['s1Bias', weights.s1.bias]]) stage.uploadTensor(gpu[resource], values);
  }, { shape, inputLayout: 'B,H,W,C', outputLayout: 'B,C,H,W' });
  const bindTensor = (name, access = 'read-only-storage') => ({ name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = name => ({ name, resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const kernels = { projection: { code: PROJECTION_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('dims')] } };
  for (const spec of [
    { name: REQUIRED_STAGES[1], input: 'feature0', weight: 's0Weight', bias: 's0Bias', output: 's0', dims: 's0Dims', total: shape.batch * shape.s0Channels * shape.feature0Height * shape.feature0Width },
    { name: REQUIRED_STAGES[2], input: 'feature1', weight: 's1Weight', bias: 's1Bias', output: 's1', dims: 's1Dims', total: shape.batch * shape.s1Channels * shape.feature1Height * shape.feature1Width },
  ]) {
    const program = runtime.defineProgram({
      name: `sam31.high-resolution.${spec.name}`,
      tensors: { input: gpu[spec.input], weight: gpu[spec.weight], bias: gpu[spec.bias], output: gpu[spec.output] },
      uniforms: { dims: gpu[spec.dims] }, kernels,
      phases: [{ name: spec.name, kernel: 'projection', dispatch: [workgroups(spec.total)], yieldAfter: true }],
      metadata: { routeId: route.routeId, inputLayout: 'B,H,W,C', outputLayout: 'B,C,H,W' },
    });
    await runtime.runProgram(program);
  }
  const readback = await runtime.runStage(REQUIRED_STAGES[3], async stage => ({
    highResolutionS0: await stage.readTensor(gpu.s0),
    highResolutionS1: await stage.readTensor(gpu.s1),
  }), { outputRoles: OUTPUT_ROLES.map(output => output.role) });
  const outputs = {
    highResolutionS0: { artifactId: roleArtifact(input.request.outputs, OUTPUT_ROLES[0].role).artifactId, sha256: await sha256Hex(readback.highResolutionS0), shape: [shape.batch, shape.s0Channels, shape.feature0Height, shape.feature0Width] },
    highResolutionS1: { artifactId: roleArtifact(input.request.outputs, OUTPUT_ROLES[1].role).artifactId, sha256: await sha256Hex(readback.highResolutionS1), shape: [shape.batch, shape.s1Channels, shape.feature1Height, shape.feature1Width] },
  };
  const receipt = createSam31DecoderHighResolutionProjectionPhaseProgramRouteReceipt({
    sourceImage, feature0: feature0Artifact, feature1: feature1Artifact, weights: weightsArtifact, outputs,
    backend: runtime.backendIdentity, model: { revision: input.model?.revision || route.model.revision, weightsHash: input.model?.weightsHash },
    kernel: input.kernel || runtime.kernel, profile: runtime.profile,
  });
  const authoritative = assertAuthoritativeRouteWorkerResult(createRouteWorkerResult(route, { request: input.request, receipt }), route);
  if (input.includeReadback === true) authoritative.debugReadback = { mode: 'explicit-debug-evidence', highResolutionS0: Array.from(new Float32Array(readback.highResolutionS0)), highResolutionS1: Array.from(new Float32Array(readback.highResolutionS1)) };
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
