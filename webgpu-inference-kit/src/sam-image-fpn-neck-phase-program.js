import {
  assertAuthoritativeRouteWorkerResult,
  defineWebGpuRoute,
  createRouteWorkerResult,
} from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE } from './runtime-primitives.js';
import {
  createKernelProfileMetadata,
  createRouteKernelProfileMetadata,
} from './kernel-profile.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';
import {
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
} from './scheduler-backpressure.js';

export const SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-fpn-neck.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-fpn-neck-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-fpn-neck-tensors',
  'fpn-neck-transpose-conv-0-scale0',
  'fpn-neck-gelu-0',
  'fpn-neck-transpose-conv-0-scale1',
  'fpn-neck-proj1-0',
  'fpn-neck-proj2-0',
  'fpn-neck-transpose-conv-1',
  'fpn-neck-proj1-1',
  'fpn-neck-proj2-1',
  'fpn-neck-proj1-2',
  'fpn-neck-proj2-2',
  'readback-fpn-neck-features',
];
const INPUT_ROLES = ['source-image', 'vit-backbone-hidden-states', 'sam3-image-fpn-neck-weights'];
const OUTPUT_ROLES = [
  { key: 'fpnNeckFeature0', role: 'fpn-neck-feature-0', required: true },
  { key: 'fpnNeckFeature1', role: 'fpn-neck-feature-1', required: true },
  { key: 'fpnNeckFeature2', role: 'fpn-neck-feature-2', required: true },
];

const TRANSPOSE_CONV2D_WGSL = `
struct FpnConvDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  input_channels: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  kernel_h: u32,
  kernel_w: u32,
  stride: u32,
  padding: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: FpnConvDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let out_c = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[out_c];
  for (var ky = 0u; ky < dims.kernel_h; ky = ky + 1u) {
    if (out_y + dims.padding < ky) { continue; }
    let y_delta = out_y + dims.padding - ky;
    if ((y_delta % dims.stride) != 0u) { continue; }
    let in_y = y_delta / dims.stride;
    if (in_y >= dims.input_height) { continue; }
    for (var kx = 0u; kx < dims.kernel_w; kx = kx + 1u) {
      if (out_x + dims.padding < kx) { continue; }
      let x_delta = out_x + dims.padding - kx;
      if ((x_delta % dims.stride) != 0u) { continue; }
      let in_x = x_delta / dims.stride;
      if (in_x >= dims.input_width) { continue; }
      let input_base = ((batch * dims.input_height + in_y) * dims.input_width + in_x) * dims.input_channels;
      let weight_base = ((out_c * dims.kernel_h + ky) * dims.kernel_w + kx) * dims.input_channels;
      for (var in_c = 0u; in_c < dims.input_channels; in_c = in_c + 1u) {
        sum = sum + input_values[input_base + in_c] * weight[weight_base + in_c];
      }
    }
  }
  output_values[index] = sum;
}
`;

const CONV2D_WGSL = `
struct FpnConvDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  input_channels: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  kernel_h: u32,
  kernel_w: u32,
  stride: u32,
  padding: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: FpnConvDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let out_c = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[out_c];
  for (var ky = 0u; ky < dims.kernel_h; ky = ky + 1u) {
    let in_y_signed = i32(out_y * dims.stride + ky) - i32(dims.padding);
    if (in_y_signed < 0 || in_y_signed >= i32(dims.input_height)) { continue; }
    for (var kx = 0u; kx < dims.kernel_w; kx = kx + 1u) {
      let in_x_signed = i32(out_x * dims.stride + kx) - i32(dims.padding);
      if (in_x_signed < 0 || in_x_signed >= i32(dims.input_width)) { continue; }
      let in_y = u32(in_y_signed);
      let in_x = u32(in_x_signed);
      let input_base = ((batch * dims.input_height + in_y) * dims.input_width + in_x) * dims.input_channels;
      let weight_base = ((out_c * dims.kernel_h + ky) * dims.kernel_w + kx) * dims.input_channels;
      for (var in_c = 0u; in_c < dims.input_channels; in_c = in_c + 1u) {
        sum = sum + input_values[input_base + in_c] * weight[weight_base + in_c];
      }
    }
  }
  output_values[index] = sum;
}
`;

const GELU_WGSL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;

fn gelu_tanh(x: f32) -> f32 {
  return 0.5 * x * (1.0 + tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&output_values)) { return; }
  output_values[index] = gelu_tanh(input_values[index]);
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-fpn-neck-features' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-fpn-neck-features' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-fpn-neck-features' })),
      notes: 'SAM3 image FPN-neck phase program cooperates between transpose-conv, GELU, projection-conv, and readback boundaries for detector-consumed levels 0..2.',
    },
  });
}

function createDefaultBackpressure() {
  return createWebGpuRouteBackpressureProfile({
    requestedBudget: 'visible-wait',
    effectiveBudget: 'visible-wait',
    memoryExclusivity: 'shared',
    warmCacheState: 'unknown',
  });
}

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts)
    ? artifacts.find(entry => entry?.role === role)
    : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function ensureFloat32Array(value, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  return value;
}

function normalizeShape(shape = {}) {
  const out = {
    batch: shape.batch,
    backboneHeight: shape.backboneHeight ?? shape.patchHeight ?? shape.height,
    backboneWidth: shape.backboneWidth ?? shape.patchWidth ?? shape.width,
    backboneChannels: shape.backboneChannels ?? shape.visionHiddenSize,
    fpnHiddenSize: shape.fpnHiddenSize ?? 256,
    levels: shape.levels,
  };
  for (const key of ['batch', 'backboneHeight', 'backboneWidth', 'backboneChannels', 'fpnHiddenSize']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (!Array.isArray(out.levels) || out.levels.length !== 3) throw new Error('shape.levels must describe exactly detector-consumed FPN levels 0, 1, and 2');
  out.levels = out.levels.map((level, index) => {
    if (!Number.isInteger(level.level) || level.level !== index) throw new Error('shape.levels must be ordered levels 0, 1, and 2');
    if (!Number.isInteger(level.height) || level.height <= 0) throw new Error(`shape.levels[${index}].height must be a positive integer`);
    if (!Number.isInteger(level.width) || level.width <= 0) throw new Error(`shape.levels[${index}].width must be a positive integer`);
    return { level: index, scaleFactor: Number(level.scaleFactor), height: level.height, width: level.width };
  });
  return out;
}

function normalizeConvSpec(spec, name) {
  if (!spec || typeof spec !== 'object') throw new Error(`${name} is required`);
  const weight = ensureFloat32Array(spec.weight, `${name}.weight`);
  const bias = ensureFloat32Array(spec.bias, `${name}.bias`);
  const out = {
    weight,
    bias,
    kernelSize: spec.kernelSize,
    stride: spec.stride ?? 1,
    padding: spec.padding ?? 0,
    inChannels: spec.inChannels,
    outChannels: spec.outChannels,
    activation: spec.activation || null,
  };
  for (const key of ['kernelSize', 'stride', 'padding', 'inChannels', 'outChannels']) {
    if (!Number.isInteger(out[key]) || out[key] < 0 || (key !== 'padding' && out[key] === 0)) throw new Error(`${name}.${key} must be a valid integer`);
  }
  const expectedWeights = out.outChannels * out.kernelSize * out.kernelSize * out.inChannels;
  if (weight.length !== expectedWeights) throw new Error(`${name}.weight length ${weight.length} does not match out,kH,kW,in layout (${expectedWeights})`);
  if (bias.length !== out.outChannels) throw new Error(`${name}.bias length ${bias.length} does not match output channels (${out.outChannels})`);
  return out;
}

function normalizeWeights(weights = {}, shape) {
  if (!Array.isArray(weights.levels) || weights.levels.length !== 3) throw new Error('weights.levels must contain detector-consumed FPN levels 0, 1, and 2');
  return {
    levels: weights.levels.map((level, index) => {
      if (!level || level.level !== index) throw new Error('weights.levels must be ordered levels 0, 1, and 2');
      const scaleLayers = (level.scaleLayers || []).map((spec, scaleIndex) => normalizeConvSpec(spec, `weights.levels[${index}].scaleLayers[${scaleIndex}]`));
      const proj1 = normalizeConvSpec(level.proj1, `weights.levels[${index}].proj1`);
      const proj2 = normalizeConvSpec(level.proj2, `weights.levels[${index}].proj2`);
      if (proj1.outChannels !== shape.fpnHiddenSize || proj2.inChannels !== shape.fpnHiddenSize || proj2.outChannels !== shape.fpnHiddenSize) throw new Error(`weights.levels[${index}] projections must use shape.fpnHiddenSize`);
      return { level: index, scaleLayers, proj1, proj2 };
    }),
  };
}

function validateImageFpnNeckInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const backboneHiddenStates = ensureFloat32Array(input.backboneHiddenStates, 'backboneHiddenStates');
  const expectedBackbone = shape.batch * shape.backboneHeight * shape.backboneWidth * shape.backboneChannels;
  if (backboneHiddenStates.length !== expectedBackbone) throw new Error(`backboneHiddenStates length ${backboneHiddenStates.length} does not match shape (${expectedBackbone})`);
  const weights = normalizeWeights(input.weights, shape);
  return { shape, backboneHiddenStates, weights };
}

function gelu(value) {
  return 0.5 * value * (1 + Math.tanh(0.7978845608028654 * (value + 0.044715 * value * value * value)));
}

function convTranspose2d(input, inShape, spec) {
  const outHeight = (inShape.height - 1) * spec.stride - 2 * spec.padding + spec.kernelSize;
  const outWidth = (inShape.width - 1) * spec.stride - 2 * spec.padding + spec.kernelSize;
  const out = new Float32Array(inShape.batch * outHeight * outWidth * spec.outChannels);
  for (let batch = 0; batch < inShape.batch; batch += 1) {
    for (let outY = 0; outY < outHeight; outY += 1) {
      for (let outX = 0; outX < outWidth; outX += 1) {
        for (let outChannel = 0; outChannel < spec.outChannels; outChannel += 1) {
          let sum = spec.bias[outChannel];
          for (let ky = 0; ky < spec.kernelSize; ky += 1) {
            const yDelta = outY + spec.padding - ky;
            if (yDelta < 0 || yDelta % spec.stride !== 0) continue;
            const inY = yDelta / spec.stride;
            if (inY < 0 || inY >= inShape.height) continue;
            for (let kx = 0; kx < spec.kernelSize; kx += 1) {
              const xDelta = outX + spec.padding - kx;
              if (xDelta < 0 || xDelta % spec.stride !== 0) continue;
              const inX = xDelta / spec.stride;
              if (inX < 0 || inX >= inShape.width) continue;
              const inputBase = ((batch * inShape.height + inY) * inShape.width + inX) * inShape.channels;
              const weightBase = ((outChannel * spec.kernelSize + ky) * spec.kernelSize + kx) * spec.inChannels;
              for (let inChannel = 0; inChannel < spec.inChannels; inChannel += 1) {
                sum += input[inputBase + inChannel] * spec.weight[weightBase + inChannel];
              }
            }
          }
          out[((batch * outHeight + outY) * outWidth + outX) * spec.outChannels + outChannel] = sum;
        }
      }
    }
  }
  return { data: out, shape: { batch: inShape.batch, height: outHeight, width: outWidth, channels: spec.outChannels } };
}

function conv2d(input, inShape, spec) {
  const outHeight = Math.floor((inShape.height + 2 * spec.padding - spec.kernelSize) / spec.stride) + 1;
  const outWidth = Math.floor((inShape.width + 2 * spec.padding - spec.kernelSize) / spec.stride) + 1;
  const out = new Float32Array(inShape.batch * outHeight * outWidth * spec.outChannels);
  for (let batch = 0; batch < inShape.batch; batch += 1) {
    for (let outY = 0; outY < outHeight; outY += 1) {
      for (let outX = 0; outX < outWidth; outX += 1) {
        for (let outChannel = 0; outChannel < spec.outChannels; outChannel += 1) {
          let sum = spec.bias[outChannel];
          for (let ky = 0; ky < spec.kernelSize; ky += 1) {
            const inY = outY * spec.stride + ky - spec.padding;
            if (inY < 0 || inY >= inShape.height) continue;
            for (let kx = 0; kx < spec.kernelSize; kx += 1) {
              const inX = outX * spec.stride + kx - spec.padding;
              if (inX < 0 || inX >= inShape.width) continue;
              const inputBase = ((batch * inShape.height + inY) * inShape.width + inX) * inShape.channels;
              const weightBase = ((outChannel * spec.kernelSize + ky) * spec.kernelSize + kx) * spec.inChannels;
              for (let inChannel = 0; inChannel < spec.inChannels; inChannel += 1) {
                sum += input[inputBase + inChannel] * spec.weight[weightBase + inChannel];
              }
            }
          }
          out[((batch * outHeight + outY) * outWidth + outX) * spec.outChannels + outChannel] = sum;
        }
      }
    }
  }
  return { data: out, shape: { batch: inShape.batch, height: outHeight, width: outWidth, channels: spec.outChannels } };
}

function applyGelu(input) {
  const out = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) out[index] = gelu(input[index]);
  return out;
}

export function createSam3ImageFpnNeckPhaseProgramCpuOracle(input) {
  const { shape, backboneHiddenStates, weights } = validateImageFpnNeckInputs(input);
  const levels = [];
  const fpnNeckFeatures = [];
  for (const levelWeights of weights.levels) {
    let current = backboneHiddenStates;
    let currentShape = { batch: shape.batch, height: shape.backboneHeight, width: shape.backboneWidth, channels: shape.backboneChannels };
    for (const scaleLayer of levelWeights.scaleLayers) {
      const scaled = convTranspose2d(current, currentShape, scaleLayer);
      current = scaleLayer.activation === 'gelu' ? applyGelu(scaled.data) : scaled.data;
      currentShape = scaled.shape;
    }
    const proj1 = conv2d(current, currentShape, levelWeights.proj1);
    const proj2 = conv2d(proj1.data, proj1.shape, levelWeights.proj2);
    const expectedLevel = shape.levels[levelWeights.level];
    if (proj2.shape.height !== expectedLevel.height || proj2.shape.width !== expectedLevel.width || proj2.shape.channels !== shape.fpnHiddenSize) throw new Error(`FPN level ${levelWeights.level} output shape mismatch`);
    levels.push({ level: levelWeights.level, shape: [proj2.shape.batch, proj2.shape.height, proj2.shape.width, proj2.shape.channels] });
    fpnNeckFeatures.push(proj2.data);
  }
  return { shape, levels, fpnNeckFeatures };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image FPN-neck outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    fpnNeckFeature0: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-0').artifactId, sha256: hashes.fpnNeckFeature0, shape: [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize] },
    fpnNeckFeature1: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-1').artifactId, sha256: hashes.fpnNeckFeature1, shape: [shape.batch, shape.levels[1].height, shape.levels[1].width, shape.fpnHiddenSize] },
    fpnNeckFeature2: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-2').artifactId, sha256: hashes.fpnNeckFeature2, shape: [shape.batch, shape.levels[2].height, shape.levels[2].width, shape.fpnHiddenSize] },
  };
}

export function createSam3ImageFpnNeckPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('vit-backbone-hidden-states', input.backboneHiddenStates),
      createRouteReceiptInputArtifact('sam3-image-fpn-neck-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImageFpnNeckPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-fpn-neck', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImageFpnNeckPhaseProgramRoute', upstreamBoundary: 'browser-sam3-vit-backbone-to-detector-consumed-fpn-neck-features' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

function convDimsValues(shape, inShape, spec, outShape) {
  return {
    batch: shape.batch,
    input_height: inShape.height,
    input_width: inShape.width,
    input_channels: inShape.channels,
    output_height: outShape.height,
    output_width: outShape.width,
    output_channels: outShape.channels,
    kernel_h: spec.kernelSize,
    kernel_w: spec.kernelSize,
    stride: spec.stride,
    padding: spec.padding,
    total_output: shape.batch * outShape.height * outShape.width * outShape.channels,
  };
}

function transposeConv2dOutShape(inShape, spec) {
  return {
    height: (inShape.height - 1) * spec.stride - (2 * spec.padding) + spec.kernelSize,
    width: (inShape.width - 1) * spec.stride - (2 * spec.padding) + spec.kernelSize,
    channels: spec.outChannels,
  };
}

export async function runSam3ImageFpnNeckPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImageFpnNeckPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const backboneHiddenStatesArtifact = roleArtifact(input.request.inputs, 'vit-backbone-hidden-states');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-image-fpn-neck-weights');
  const { shape, backboneHiddenStates, weights } = validateImageFpnNeckInputs(input.tensors || {});
  const oracleShapes = createSam3ImageFpnNeckPhaseProgramCpuOracle({ backboneHiddenStates, weights, shape }).levels;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-fpn-neck-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
  });

  let tensors = null;
  const backboneShape = { height: shape.backboneHeight, width: shape.backboneWidth, channels: shape.backboneChannels };
  const level0Scale0Shape = transposeConv2dOutShape(backboneShape, weights.levels[0].scaleLayers[0]);
  const level0Scale1Shape = transposeConv2dOutShape(level0Scale0Shape, weights.levels[0].scaleLayers[1]);
  const level1Scale0Shape = transposeConv2dOutShape(backboneShape, weights.levels[1].scaleLayers[0]);
  await runtime.runStage('load-image-fpn-neck-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage });
    const convWeightShape = spec => [spec.outChannels, spec.kernelSize, spec.kernelSize, spec.inChannels];
    const convBiasShape = spec => [spec.outChannels];
    tensors = {
      backbone: tensor('sam3.image-fpn-neck.vit-backbone-hidden-states', [shape.batch, shape.backboneHeight, shape.backboneWidth, shape.backboneChannels]),
      level0Scale0: tensor('sam3.image-fpn-neck.level0.scale0', [shape.batch, level0Scale0Shape.height, level0Scale0Shape.width, level0Scale0Shape.channels]),
      level0Gelu: tensor('sam3.image-fpn-neck.level0.gelu', [shape.batch, level0Scale0Shape.height, level0Scale0Shape.width, level0Scale0Shape.channels]),
      level0Scale2: tensor('sam3.image-fpn-neck.level0.scale2', [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize]),
      level0Proj1: tensor('sam3.image-fpn-neck.level0.proj1', [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize]),
      level0Feature: tensor('sam3.image-fpn-neck.level0.feature', [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize]),
      level1Scale0: tensor('sam3.image-fpn-neck.level1.scale0', [shape.batch, level1Scale0Shape.height, level1Scale0Shape.width, level1Scale0Shape.channels]),
      level1Proj1: tensor('sam3.image-fpn-neck.level1.proj1', [shape.batch, shape.levels[1].height, shape.levels[1].width, shape.fpnHiddenSize]),
      level1Feature: tensor('sam3.image-fpn-neck.level1.feature', [shape.batch, shape.levels[1].height, shape.levels[1].width, shape.fpnHiddenSize]),
      level2Proj1: tensor('sam3.image-fpn-neck.level2.proj1', [shape.batch, shape.levels[2].height, shape.levels[2].width, shape.fpnHiddenSize]),
      level2Feature: tensor('sam3.image-fpn-neck.level2.feature', [shape.batch, shape.levels[2].height, shape.levels[2].width, shape.fpnHiddenSize]),
      convDims: stage.createUniformBuffer({
        label: 'sam3.image-fpn-neck.conv-dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'input_height', type: 'u32' },
          { name: 'input_width', type: 'u32' },
          { name: 'input_channels', type: 'u32' },
          { name: 'output_height', type: 'u32' },
          { name: 'output_width', type: 'u32' },
          { name: 'output_channels', type: 'u32' },
          { name: 'kernel_h', type: 'u32' },
          { name: 'kernel_w', type: 'u32' },
          { name: 'stride', type: 'u32' },
          { name: 'padding', type: 'u32' },
          { name: 'total_output', type: 'u32' },
        ],
        values: convDimsValues(shape, backboneShape, weights.levels[0].scaleLayers[0], level0Scale0Shape),
      }),
    };
    for (const level of weights.levels) {
      for (const [index, scaleLayer] of level.scaleLayers.entries()) {
        tensors[`level${level.level}Scale${index}Weight`] = tensor(`sam3.image-fpn-neck.level${level.level}.scale${index}.weight`, convWeightShape(scaleLayer), readonlyUsage);
        tensors[`level${level.level}Scale${index}Bias`] = tensor(`sam3.image-fpn-neck.level${level.level}.scale${index}.bias`, convBiasShape(scaleLayer), readonlyUsage);
        stage.uploadTensor(tensors[`level${level.level}Scale${index}Weight`], scaleLayer.weight);
        stage.uploadTensor(tensors[`level${level.level}Scale${index}Bias`], scaleLayer.bias);
      }
      for (const [name, spec] of [['Proj1', level.proj1], ['Proj2', level.proj2]]) {
        tensors[`level${level.level}${name}Weight`] = tensor(`sam3.image-fpn-neck.level${level.level}.${name.toLowerCase()}.weight`, convWeightShape(spec), readonlyUsage);
        tensors[`level${level.level}${name}Bias`] = tensor(`sam3.image-fpn-neck.level${level.level}.${name.toLowerCase()}.bias`, convBiasShape(spec), readonlyUsage);
        stage.uploadTensor(tensors[`level${level.level}${name}Weight`], spec.weight);
        stage.uploadTensor(tensors[`level${level.level}${name}Bias`], spec.bias);
      }
    }
    stage.uploadTensor(tensors.backbone, backboneHiddenStates);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-fpn-neck-upload' });
  }, { shape, detectorConsumedLevels: [0, 1, 2], referenceBoundary: 'MLX FPNLayer scale_layers -> proj1 -> proj2 for levels 0..2' });

  const bindTensor = (resource, access = 'read-only-storage') => ({ name: resource.replace(/^tensor:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = resource => ({ name: resource.replace(/^uniform:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const kernels = {
    transposeConv2d: { code: TRANSPOSE_CONV2D_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:weight'), bindTensor('tensor:bias'), bindTensor('tensor:output', 'storage'), bindUniform('uniform:convDims')] },
    conv2d: { code: CONV2D_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:weight'), bindTensor('tensor:bias'), bindTensor('tensor:output', 'storage'), bindUniform('uniform:convDims')] },
    gelu: { code: GELU_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:output', 'storage')] },
  };
  const metadata = { routeId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID, layout: 'B,H,W,C', detectorConsumedLevels: [0, 1, 2] };
  const runKernel = async ({ name, kernel, inputTensor, outputTensor, weightTensor, biasTensor, inShape, outShape, spec }) => {
    tensors.convDims.update(convDimsValues(shape, inShape, spec, outShape));
    const single = runtime.defineProgram({
      name: `sam3.image-fpn-neck.${name}`,
      tensors: { ...tensors, input: tensors[inputTensor], output: tensors[outputTensor], weight: tensors[weightTensor], bias: tensors[biasTensor] },
      uniforms: { convDims: tensors.convDims },
      kernels,
      phases: [{ name, kernel, dispatch: [workgroups(shape.batch * outShape.height * outShape.width * outShape.channels)], yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(single);
  };
  const runGelu = async ({ name, inputTensor, outputTensor, total }) => {
    const single = runtime.defineProgram({
      name: `sam3.image-fpn-neck.${name}`,
      tensors: { ...tensors, input: tensors[inputTensor], output: tensors[outputTensor] },
      uniforms: { convDims: tensors.convDims },
      kernels,
      phases: [{ name, kernel: 'gelu', dispatch: [workgroups(total)], yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(single);
  };

  await runKernel({ name: 'fpn-neck-transpose-conv-0-scale0', kernel: 'transposeConv2d', inputTensor: 'backbone', outputTensor: 'level0Scale0', weightTensor: 'level0Scale0Weight', biasTensor: 'level0Scale0Bias', inShape: backboneShape, outShape: level0Scale0Shape, spec: weights.levels[0].scaleLayers[0] });
  await runGelu({ name: 'fpn-neck-gelu-0', inputTensor: 'level0Scale0', outputTensor: 'level0Gelu', total: shape.batch * level0Scale0Shape.height * level0Scale0Shape.width * level0Scale0Shape.channels });
  await runKernel({ name: 'fpn-neck-transpose-conv-0-scale1', kernel: 'transposeConv2d', inputTensor: 'level0Gelu', outputTensor: 'level0Scale2', weightTensor: 'level0Scale1Weight', biasTensor: 'level0Scale1Bias', inShape: level0Scale0Shape, outShape: level0Scale1Shape, spec: weights.levels[0].scaleLayers[1] });
  await runKernel({ name: 'fpn-neck-proj1-0', kernel: 'conv2d', inputTensor: 'level0Scale2', outputTensor: 'level0Proj1', weightTensor: 'level0Proj1Weight', biasTensor: 'level0Proj1Bias', inShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, spec: weights.levels[0].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-0', kernel: 'conv2d', inputTensor: 'level0Proj1', outputTensor: 'level0Feature', weightTensor: 'level0Proj2Weight', biasTensor: 'level0Proj2Bias', inShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, spec: weights.levels[0].proj2 });
  await runKernel({ name: 'fpn-neck-transpose-conv-1', kernel: 'transposeConv2d', inputTensor: 'backbone', outputTensor: 'level1Scale0', weightTensor: 'level1Scale0Weight', biasTensor: 'level1Scale0Bias', inShape: backboneShape, outShape: level1Scale0Shape, spec: weights.levels[1].scaleLayers[0] });
  await runKernel({ name: 'fpn-neck-proj1-1', kernel: 'conv2d', inputTensor: 'level1Scale0', outputTensor: 'level1Proj1', weightTensor: 'level1Proj1Weight', biasTensor: 'level1Proj1Bias', inShape: level1Scale0Shape, outShape: { height: shape.levels[1].height, width: shape.levels[1].width, channels: shape.fpnHiddenSize }, spec: weights.levels[1].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-1', kernel: 'conv2d', inputTensor: 'level1Proj1', outputTensor: 'level1Feature', weightTensor: 'level1Proj2Weight', biasTensor: 'level1Proj2Bias', inShape: { height: shape.levels[1].height, width: shape.levels[1].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[1].height, width: shape.levels[1].width, channels: shape.fpnHiddenSize }, spec: weights.levels[1].proj2 });
  await runKernel({ name: 'fpn-neck-proj1-2', kernel: 'conv2d', inputTensor: 'backbone', outputTensor: 'level2Proj1', weightTensor: 'level2Proj1Weight', biasTensor: 'level2Proj1Bias', inShape: backboneShape, outShape: { height: shape.levels[2].height, width: shape.levels[2].width, channels: shape.fpnHiddenSize }, spec: weights.levels[2].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-2', kernel: 'conv2d', inputTensor: 'level2Proj1', outputTensor: 'level2Feature', weightTensor: 'level2Proj2Weight', biasTensor: 'level2Proj2Bias', inShape: { height: shape.levels[2].height, width: shape.levels[2].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[2].height, width: shape.levels[2].width, channels: shape.fpnHiddenSize }, spec: weights.levels[2].proj2 });

  const readback = await runtime.runStage('readback-fpn-neck-features', async stage => ({
    fpnNeckFeature0: await stage.readTensor(tensors.level0Feature),
    fpnNeckFeature1: await stage.readTensor(tensors.level1Feature),
    fpnNeckFeature2: await stage.readTensor(tensors.level2Feature),
  }), { outputs: oracleShapes, outputRoles: ['fpn-neck-feature-0', 'fpn-neck-feature-1', 'fpn-neck-feature-2'] });
  const outputs = outputArtifacts(input.request, {
    fpnNeckFeature0: await sha256Hex(readback.fpnNeckFeature0),
    fpnNeckFeature1: await sha256Hex(readback.fpnNeckFeature1),
    fpnNeckFeature2: await sha256Hex(readback.fpnNeckFeature2),
  }, shape);
  const receipt = createSam3ImageFpnNeckPhaseProgramRouteReceipt({
    sourceImage,
    backboneHiddenStates: backboneHiddenStatesArtifact,
    weights: weightsArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      fpnNeckFeature0: Array.from(new Float32Array(readback.fpnNeckFeature0)),
      fpnNeckFeature1: Array.from(new Float32Array(readback.fpnNeckFeature1)),
      fpnNeckFeature2: Array.from(new Float32Array(readback.fpnNeckFeature2)),
    };
  }
  return authoritative;
}
