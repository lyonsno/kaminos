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

export const SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.pixel-decoder.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-pixel-decoder-phase-program-v0';
const INPUT_ROLES = ['source-image', 'sam3-pixel-decoder-tensors', 'sam3-pixel-decoder-weights'];
const OUTPUT_ROLES = [{ key: 'pixelEmbed', role: 'pixel-embed', required: true }];
const PHASE_NAME_EXAMPLES = ['pixel-upsample-add-0', 'pixel-conv3x3-0', 'pixel-groupnorm-stats-0', 'pixel-groupnorm-relu-0'];

const UPSAMPLE_ADD_WGSL = `
struct PixelStageDims {
  batch: u32,
  channels: u32,
  source_height: u32,
  source_width: u32,
  target_height: u32,
  target_width: u32,
  total: u32,
  groups: u32,
};

@group(0) @binding(0) var<storage, read> source_values: array<f32>;
@group(0) @binding(1) var<storage, read> skip_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: PixelStageDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let target_x = (index / dims.channels) % dims.target_width;
  let target_y = (index / (dims.channels * dims.target_width)) % dims.target_height;
  let batch = index / (dims.channels * dims.target_width * dims.target_height);
  let source_y = (target_y * dims.source_height) / dims.target_height;
  let source_x = (target_x * dims.source_width) / dims.target_width;
  let source_index = ((batch * dims.source_height + source_y) * dims.source_width + source_x) * dims.channels + channel;
  output_values[index] = source_values[source_index] + skip_values[index];
}
`;

const CONV3X3_WGSL = `
struct PixelStageDims {
  batch: u32,
  channels: u32,
  source_height: u32,
  source_width: u32,
  target_height: u32,
  target_width: u32,
  total: u32,
  groups: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PixelStageDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let out_channel = index % dims.channels;
  let x = (index / dims.channels) % dims.target_width;
  let y = (index / (dims.channels * dims.target_width)) % dims.target_height;
  let batch = index / (dims.channels * dims.target_width * dims.target_height);
  var sum = bias[out_channel];
  for (var ky = 0u; ky < 3u; ky = ky + 1u) {
    for (var kx = 0u; kx < 3u; kx = kx + 1u) {
      let in_y_signed = i32(y) + i32(ky) - 1;
      let in_x_signed = i32(x) + i32(kx) - 1;
      if (in_y_signed >= 0 && in_x_signed >= 0 && in_y_signed < i32(dims.target_height) && in_x_signed < i32(dims.target_width)) {
        let in_y = u32(in_y_signed);
        let in_x = u32(in_x_signed);
        let input_base = ((batch * dims.target_height + in_y) * dims.target_width + in_x) * dims.channels;
        let weight_base = ((out_channel * 3u + ky) * 3u + kx) * dims.channels;
        for (var in_channel = 0u; in_channel < dims.channels; in_channel = in_channel + 1u) {
          sum = sum + input_values[input_base + in_channel] * weight[weight_base + in_channel];
        }
      }
    }
  }
  output_values[index] = sum;
}
`;

const GROUPNORM_STATS_WGSL = `
struct PixelStageDims {
  batch: u32,
  channels: u32,
  source_height: u32,
  source_width: u32,
  target_height: u32,
  target_width: u32,
  total: u32,
  groups: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> stats: array<f32>;
@group(0) @binding(2) var<uniform> dims: PixelStageDims;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let group_total = dims.batch * dims.groups;
  if (index >= group_total) { return; }
  let group = index % dims.groups;
  let batch = index / dims.groups;
  let per_batch_total = dims.target_height * dims.target_width * dims.channels;
  let count = per_batch_total / dims.groups;
  let batch_base = batch * per_batch_total;
  var mean = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    mean = mean + input_values[batch_base + i * dims.groups + group];
  }
  mean = mean / f32(count);
  var variance = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    let delta = input_values[batch_base + i * dims.groups + group] - mean;
    variance = variance + delta * delta;
  }
  variance = variance / f32(count);
  stats[index * 2u] = mean;
  stats[index * 2u + 1u] = variance;
}
`;

const GROUPNORM_RELU_WGSL = `
struct PixelStageDims {
  batch: u32,
  channels: u32,
  source_height: u32,
  source_width: u32,
  target_height: u32,
  target_width: u32,
  total: u32,
  groups: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(3) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<uniform> dims: PixelStageDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let per_batch_total = dims.target_height * dims.target_width * dims.channels;
  let batch = index / per_batch_total;
  let within_batch = index - batch * per_batch_total;
  let group = within_batch % dims.groups;
  let stats_index = (batch * dims.groups + group) * 2u;
  let mean = stats[stats_index];
  let variance = stats[stats_index + 1u];
  let normalized = (input_values[index] - mean) * inverseSqrt(variance + 0.00001);
  output_values[index] = max(normalized * norm_weight[channel] + norm_bias[channel], 0.0);
}
`;

function requiredStages(stageCount) {
  const stages = ['load-pixel-decoder-tensors'];
  for (let index = 0; index < stageCount; index += 1) {
    stages.push(`pixel-upsample-add-${index}`, `pixel-conv3x3-${index}`, `pixel-groupnorm-stats-${index}`, `pixel-groupnorm-relu-${index}`);
  }
  stages.push('readback-pixel-embed');
  return stages;
}

function createDefaultScheduler(stageCount) {
  const stages = requiredStages(stageCount);
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: stages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-pixel-embed' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: stages.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-pixel-embed' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-pixel-embed' })),
      notes: 'SAM3 pixel-decoder phase program cooperates between FPN upsample/add, conv, groupnorm, ReLU, and readback boundaries.',
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
  const batch = shape.batch;
  const channels = shape.channels;
  const groups = shape.groups || 8;
  if (!Number.isInteger(batch) || batch <= 0) throw new Error('shape.batch must be a positive integer');
  if (!Number.isInteger(channels) || channels <= 0) throw new Error('shape.channels must be a positive integer');
  if (!Number.isInteger(groups) || groups <= 0 || channels % groups !== 0) throw new Error('shape.groups must divide channels');
  if (!Array.isArray(shape.levels) || shape.levels.length < 2) throw new Error('shape.levels must contain at least two levels');
  const levels = shape.levels.map((level, index) => {
    const height = level?.height;
    const width = level?.width;
    if (!Number.isInteger(height) || height <= 0) throw new Error(`shape.levels[${index}].height must be a positive integer`);
    if (!Number.isInteger(width) || width <= 0) throw new Error(`shape.levels[${index}].width must be a positive integer`);
    return { height, width };
  });
  return { batch, channels, groups, levels };
}

function levelElementCount(shape, level) {
  return shape.batch * level.height * level.width * shape.channels;
}

function validatePixelDecoderInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  if (!Array.isArray(input.features) || input.features.length !== shape.levels.length) throw new Error('features must match shape.levels');
  const features = input.features.map((feature, index) => {
    const array = ensureFloat32Array(feature, `features[${index}]`);
    const expected = levelElementCount(shape, shape.levels[index]);
    if (array.length !== expected) throw new Error(`features[${index}] length ${array.length} does not match ${expected}`);
    return array;
  });
  const stageCount = shape.levels.length - 1;
  const stages = input.weights?.stages;
  if (!Array.isArray(stages) || stages.length < stageCount) throw new Error(`weights.stages must contain at least ${stageCount} stages`);
  const weights = stages.slice(0, stageCount).map((stage, index) => {
    const convWeight = ensureFloat32Array(stage?.convWeight, `weights.stages[${index}].convWeight`);
    const convBias = ensureFloat32Array(stage?.convBias, `weights.stages[${index}].convBias`);
    const normWeight = ensureFloat32Array(stage?.normWeight, `weights.stages[${index}].normWeight`);
    const normBias = ensureFloat32Array(stage?.normBias, `weights.stages[${index}].normBias`);
    if (convWeight.length !== shape.channels * 3 * 3 * shape.channels) throw new Error(`pixel decoder stage ${index} conv weight length mismatch`);
    if (convBias.length !== shape.channels) throw new Error(`pixel decoder stage ${index} conv bias length mismatch`);
    if (normWeight.length !== shape.channels) throw new Error(`pixel decoder stage ${index} norm weight length mismatch`);
    if (normBias.length !== shape.channels) throw new Error(`pixel decoder stage ${index} norm bias length mismatch`);
    return { convWeight, convBias, normWeight, normBias };
  });
  return { shape, features, weights: { stages: weights } };
}

function upsampleAdd(source, skip, shape, sourceLevel, targetLevel) {
  const out = new Float32Array(levelElementCount(shape, targetLevel));
  for (let b = 0; b < shape.batch; b += 1) {
    for (let y = 0; y < targetLevel.height; y += 1) {
      const sourceY = Math.floor((y * sourceLevel.height) / targetLevel.height);
      for (let x = 0; x < targetLevel.width; x += 1) {
        const sourceX = Math.floor((x * sourceLevel.width) / targetLevel.width);
        for (let c = 0; c < shape.channels; c += 1) {
          const outIndex = ((b * targetLevel.height + y) * targetLevel.width + x) * shape.channels + c;
          const sourceIndex = ((b * sourceLevel.height + sourceY) * sourceLevel.width + sourceX) * shape.channels + c;
          out[outIndex] = source[sourceIndex] + skip[outIndex];
        }
      }
    }
  }
  return out;
}

function conv3x3(input, stageWeights, shape, level) {
  const out = new Float32Array(input.length);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        for (let oc = 0; oc < shape.channels; oc += 1) {
          let sum = stageWeights.convBias[oc];
          for (let ky = 0; ky < 3; ky += 1) {
            for (let kx = 0; kx < 3; kx += 1) {
              const iy = y + ky - 1;
              const ix = x + kx - 1;
              if (iy < 0 || ix < 0 || iy >= level.height || ix >= level.width) continue;
              const inputBase = ((b * level.height + iy) * level.width + ix) * shape.channels;
              const weightBase = ((oc * 3 + ky) * 3 + kx) * shape.channels;
              for (let ic = 0; ic < shape.channels; ic += 1) {
                sum += input[inputBase + ic] * stageWeights.convWeight[weightBase + ic];
              }
            }
          }
          out[((b * level.height + y) * level.width + x) * shape.channels + oc] = sum;
        }
      }
    }
  }
  return out;
}

function groupNormRelu(input, stageWeights, shape, level) {
  const out = new Float32Array(input.length);
  const perBatch = level.height * level.width * shape.channels;
  const count = perBatch / shape.groups;
  for (let b = 0; b < shape.batch; b += 1) {
    const batchBase = b * perBatch;
    for (let group = 0; group < shape.groups; group += 1) {
      let mean = 0;
      for (let i = 0; i < count; i += 1) mean += input[batchBase + i * shape.groups + group];
      mean /= count;
      let variance = 0;
      for (let i = 0; i < count; i += 1) {
        const delta = input[batchBase + i * shape.groups + group] - mean;
        variance += delta * delta;
      }
      variance /= count;
      const scale = 1 / Math.sqrt(variance + 0.00001);
      for (let i = 0; i < count; i += 1) {
        const index = batchBase + i * shape.groups + group;
        const channel = index % shape.channels;
        out[index] = Math.max(0, (input[index] - mean) * scale * stageWeights.normWeight[channel] + stageWeights.normBias[channel]);
      }
    }
  }
  return out;
}

export function createSam3PixelDecoderPhaseProgramCpuOracle(input) {
  const { shape, features, weights } = validatePixelDecoderInputs(input);
  let current = features[features.length - 1];
  let currentLevel = shape.levels[shape.levels.length - 1];
  for (let stage = 0; stage < weights.stages.length; stage += 1) {
    const targetIndex = shape.levels.length - 2 - stage;
    const targetLevel = shape.levels[targetIndex];
    current = upsampleAdd(current, features[targetIndex], shape, currentLevel, targetLevel);
    current = conv3x3(current, weights.stages[stage], shape, targetLevel);
    current = groupNormRelu(current, weights.stages[stage], shape, targetLevel);
    currentLevel = targetLevel;
  }
  return { shape, pixelEmbed: current };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM pixel-decoder outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const pixelRequest = roleArtifact(request.outputs, 'pixel-embed');
  return {
    pixelEmbed: { artifactId: pixelRequest.artifactId, sha256: hashes.pixelEmbed, shape },
  };
}

export function createSam3PixelDecoderPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-pixel-decoder-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-pixel-decoder-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3PixelDecoderPhaseProgramRouteDefinition(input = {}) {
  const stageCount = Number.isInteger(input.stageCount) && input.stageCount > 0 ? input.stageCount : 2;
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: requiredStages(stageCount),
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-pixel-decoder', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(stageCount),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3PixelDecoderPhaseProgramRoute', upstreamBoundary: 'mlx-reference-fpn-features' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3PixelDecoderPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const projection = validatePixelDecoderInputs(input.tensors || {});
  const { shape, features, weights } = projection;
  const stageCount = shape.levels.length - 1;
  const route = input.route || createSam3PixelDecoderPhaseProgramRouteDefinition({ kernel: input.kernel, stageCount });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-pixel-decoder-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-pixel-decoder-weights');
  const outputLevel = shape.levels[0];
  const pixelShape = [shape.batch, outputLevel.height, outputLevel.width, shape.channels];

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-pixel-decoder-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: requiredStages(stageCount),
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
    residentTensorResolver: input.residentTensorResolver,
  });

  let tensors = null;
  await runtime.runStage('load-pixel-decoder-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      features: features.map((feature, index) => stage.createTensor({ name: `sam3.fpn-feature.${index}`, shape: [shape.batch, shape.levels[index].height, shape.levels[index].width, shape.channels], dtype: 'f32', usage: readonlyUsage })),
      upsampled: [],
      convolved: [],
      normalized: [],
      stats: [],
      dims: [],
      weights: weights.stages.map((stageWeights, index) => ({
        convWeight: stage.createTensor({ name: `sam3.pixel-decoder.${index}.conv.weight`, shape: [shape.channels, 3, 3, shape.channels], dtype: 'f32', usage: readonlyUsage, sourceData: stageWeights.convWeight }),
        convBias: stage.createTensor({ name: `sam3.pixel-decoder.${index}.conv.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage, sourceData: stageWeights.convBias }),
        normWeight: stage.createTensor({ name: `sam3.pixel-decoder.${index}.norm.weight`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage, sourceData: stageWeights.normWeight }),
        normBias: stage.createTensor({ name: `sam3.pixel-decoder.${index}.norm.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage, sourceData: stageWeights.normBias }),
      })),
    };
    for (let index = 0; index < features.length; index += 1) stage.uploadTensor(tensors.features[index], features[index]);
    for (let index = 0; index < stageCount; index += 1) {
      const targetLevel = shape.levels[shape.levels.length - 2 - index];
      const sourceLevel = shape.levels[shape.levels.length - 1 - index];
      const total = levelElementCount(shape, targetLevel);
      tensors.upsampled[index] = stage.createTensor({ name: `sam3.pixel-decoder.${index}.upsample-add`, shape: [shape.batch, targetLevel.height, targetLevel.width, shape.channels], dtype: 'f32', usage });
      tensors.convolved[index] = stage.createTensor({ name: `sam3.pixel-decoder.${index}.conv`, shape: [shape.batch, targetLevel.height, targetLevel.width, shape.channels], dtype: 'f32', usage });
      tensors.normalized[index] = stage.createTensor({ name: `sam3.pixel-decoder.${index}.norm-relu`, shape: [shape.batch, targetLevel.height, targetLevel.width, shape.channels], dtype: 'f32', usage });
      tensors.stats[index] = stage.createTensor({ name: `sam3.pixel-decoder.${index}.groupnorm-stats`, shape: [shape.batch, shape.groups, 2], dtype: 'f32', usage });
      tensors.dims[index] = stage.createUniformBuffer({
        label: `sam3.pixel-decoder.${index}.dims`,
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'source_height', type: 'u32' },
          { name: 'source_width', type: 'u32' },
          { name: 'target_height', type: 'u32' },
          { name: 'target_width', type: 'u32' },
          { name: 'total', type: 'u32' },
          { name: 'groups', type: 'u32' },
        ],
        values: { batch: shape.batch, channels: shape.channels, source_height: sourceLevel.height, source_width: sourceLevel.width, target_height: targetLevel.height, target_width: targetLevel.width, total, groups: shape.groups },
      });
      stage.uploadTensor(tensors.weights[index].convWeight, weights.stages[index].convWeight);
      stage.uploadTensor(tensors.weights[index].convBias, weights.stages[index].convBias);
      stage.uploadTensor(tensors.weights[index].normWeight, weights.stages[index].normWeight);
      stage.uploadTensor(tensors.weights[index].normBias, weights.stages[index].normBias);
    }
    await stage.yieldToBrowser({ reason: 'after-sam3-pixel-decoder-upload' });
  }, { shape });

  const programTensors = {};
  for (let index = 0; index < tensors.features.length; index += 1) programTensors[`feature${index}`] = tensors.features[index];
  for (let index = 0; index < stageCount; index += 1) {
    programTensors[`upsampled${index}`] = tensors.upsampled[index];
    programTensors[`convolved${index}`] = tensors.convolved[index];
    programTensors[`normalized${index}`] = tensors.normalized[index];
    programTensors[`stats${index}`] = tensors.stats[index];
    programTensors[`convWeight${index}`] = tensors.weights[index].convWeight;
    programTensors[`convBias${index}`] = tensors.weights[index].convBias;
    programTensors[`normWeight${index}`] = tensors.weights[index].normWeight;
    programTensors[`normBias${index}`] = tensors.weights[index].normBias;
  }
  const uniforms = Object.fromEntries(tensors.dims.map((dims, index) => [`dims${index}`, dims]));
  const kernels = {};
  const phases = [];
  for (let index = 0; index < stageCount; index += 1) {
    const sourceTensor = index === 0 ? `feature${features.length - 1}` : `normalized${index - 1}`;
    const skipTensor = `feature${features.length - 2 - index}`;
    const targetLevel = shape.levels[shape.levels.length - 2 - index];
    const total = levelElementCount(shape, targetLevel);
    kernels[`upsampleAdd${index}`] = { code: UPSAMPLE_ADD_WGSL, bindings: [{ name: 'source', resource: `tensor:${sourceTensor}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'skip', resource: `tensor:${skipTensor}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:upsampled${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: `uniform:dims${index}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] };
    kernels[`conv3x3_${index}`] = { code: CONV3X3_WGSL, bindings: [{ name: 'input', resource: `tensor:upsampled${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:convWeight${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:convBias${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:convolved${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: `uniform:dims${index}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] };
    kernels[`groupnormStats${index}`] = { code: GROUPNORM_STATS_WGSL, bindings: [{ name: 'input', resource: `tensor:convolved${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'stats', resource: `tensor:stats${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: `uniform:dims${index}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] };
    kernels[`groupnormRelu${index}`] = { code: GROUPNORM_RELU_WGSL, bindings: [{ name: 'input', resource: `tensor:convolved${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'stats', resource: `tensor:stats${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'normWeight', resource: `tensor:normWeight${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'normBias', resource: `tensor:normBias${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:normalized${index}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: `uniform:dims${index}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] };
    phases.push(
      { name: `pixel-upsample-add-${index}`, kernel: `upsampleAdd${index}`, dispatch: [workgroups(total)], yieldAfter: true },
      { name: `pixel-conv3x3-${index}`, kernel: `conv3x3_${index}`, dispatch: [workgroups(total)], yieldAfter: true },
      { name: `pixel-groupnorm-stats-${index}`, kernel: `groupnormStats${index}`, dispatch: [shape.batch * shape.groups], yieldAfter: true },
      { name: `pixel-groupnorm-relu-${index}`, kernel: `groupnormRelu${index}`, dispatch: [workgroups(total)], yieldAfter: true },
    );
  }
  phases.push({ name: 'readback-pixel-embed', readbacks: [{ name: 'pixelEmbed', tensor: `normalized${stageCount - 1}` }] });
  const program = runtime.defineProgram({
    name: 'sam3.pixel-decoder-phase-program',
    tensors: programTensors,
    uniforms,
    kernels,
    phases,
    metadata: { routeId: SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const pixelEmbed = run.outputs.pixelEmbed;
  const outputs = outputArtifacts(input.request, {
    pixelEmbed: await sha256Hex(pixelEmbed),
  }, pixelShape);
  const receipt = createSam3PixelDecoderPhaseProgramRouteReceipt({
    sourceImage,
    tensorPacket,
    weightsPacket,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || weightsPacket.sha256, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      pixelEmbed: Array.from(new Float32Array(pixelEmbed)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
