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
import { stableSam3Gelu } from './sam-image-vit-block-stack-phase-program.js';
import { SAM31_EXACT_GELU_FUNCTIONS_WGSL } from './sam31-memory-encoder-phase-program.js';

export const SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.memory-attention.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/sam3.1';
const DEFAULT_KERNEL_PROFILE = 'sam31-memory-attention-phase-program-v0';
const INPUT_ROLES = [
  'source-image',
  'sam31-memory-attention-current-tensors',
  'sam31-memory-attention-bank-tensors',
  'sam31-memory-attention-weights',
];
const OUTPUT_ROLES = [{ key: 'memory', role: 'sam31-memory-conditioned-features', required: true }];

function requiredStages(layerCount = 4) {
  const stages = ['memory-attention-load-tensors', 'memory-attention-initial-position-add'];
  for (let layer = 0; layer < layerCount; layer += 1) {
    stages.push(
      `memory-attention-layer-${layer}-load-weights`,
      `memory-attention-layer-${layer}-norm1`,
      `memory-attention-layer-${layer}-self-qkv`,
      `memory-attention-layer-${layer}-self-rope`,
      `memory-attention-layer-${layer}-self-attention`,
      `memory-attention-layer-${layer}-self-output-residual`,
      `memory-attention-layer-${layer}-self-residual-readback`,
      `memory-attention-layer-${layer}-norm2`,
      `memory-attention-layer-${layer}-cross-image-query`,
      `memory-attention-layer-${layer}-cross-memory-key`,
      `memory-attention-layer-${layer}-cross-value`,
      `memory-attention-layer-${layer}-cross-rope-pointer-tail`,
      `memory-attention-layer-${layer}-cross-input-readback`,
      `memory-attention-layer-${layer}-cross-attention`,
      `memory-attention-layer-${layer}-cross-attention-readback`,
      `memory-attention-layer-${layer}-cross-output-residual`,
      `memory-attention-layer-${layer}-cross-residual-readback`,
      `memory-attention-layer-${layer}-norm3`,
      `memory-attention-layer-${layer}-mlp-gelu`,
      `memory-attention-layer-${layer}-mlp-output-residual`,
      `memory-attention-layer-${layer}-readback`,
    );
  }
  stages.push('memory-attention-final-layernorm', 'memory-attention-readback');
  return stages;
}

function createDefaultScheduler(layerCount = 4) {
  const stages = requiredStages(layerCount);
  const chunks = Object.fromEntries(stages.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: stages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.endsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: stages.map(stage => ({ name: `after-${stage}`, kind: stage.endsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.endsWith('readback') })),
      notes: 'Four-layer SAM3.1 decoupled memory attention yields at every normalization, projection, RoPE, online-softmax, residual, and readback boundary.',
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

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function ensureFloat32Array(value, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  return value;
}

function normalizeShape(input = {}) {
  const shape = {
    batch: positiveInteger(input.batch, 'shape.batch'),
    queryHeight: positiveInteger(input.queryHeight, 'shape.queryHeight'),
    queryWidth: positiveInteger(input.queryWidth, 'shape.queryWidth'),
    queryTokens: positiveInteger(input.queryTokens, 'shape.queryTokens'),
    memorySpatialTokens: positiveInteger(input.memorySpatialTokens, 'shape.memorySpatialTokens'),
    numObjPtrTokens: positiveInteger(input.numObjPtrTokens, 'shape.numObjPtrTokens'),
    memoryTokens: positiveInteger(input.memoryTokens, 'shape.memoryTokens'),
    channels: positiveInteger(input.channels, 'shape.channels'),
    heads: positiveInteger(input.heads, 'shape.heads'),
    headDim: positiveInteger(input.headDim, 'shape.headDim'),
    mlpHidden: positiveInteger(input.mlpHidden, 'shape.mlpHidden'),
    layerCount: positiveInteger(input.layerCount, 'shape.layerCount'),
  };
  if (shape.queryHeight * shape.queryWidth !== shape.queryTokens) throw new Error('shape query grid must equal queryTokens');
  if (shape.channels !== shape.heads * shape.headDim) throw new Error('shape heads * headDim must equal channels');
  if (shape.memorySpatialTokens + shape.numObjPtrTokens !== shape.memoryTokens) throw new Error('shape memorySpatialTokens + numObjPtrTokens must equal memoryTokens');
  if (shape.memorySpatialTokens % shape.queryTokens !== 0) throw new Error('spatial memory tokens must be an integer repeat of the query grid');
  if (shape.headDim % 4 !== 0) throw new Error('shape.headDim must be divisible by four for axial RoPE');
  return shape;
}

function validateProjection(value, name, inputChannels, outputChannels) {
  if (!value || typeof value !== 'object') throw new Error(`${name} is required`);
  const weight = ensureFloat32Array(value.weight, `${name}.weight`);
  const bias = ensureFloat32Array(value.bias, `${name}.bias`);
  if (weight.length !== inputChannels * outputChannels) throw new Error(`${name}.weight length mismatch`);
  if (bias.length !== outputChannels) throw new Error(`${name}.bias length mismatch`);
  return { weight, bias, inChannels: inputChannels, outChannels: outputChannels };
}

function validateNorm(value, name, channels) {
  if (!value || typeof value !== 'object') throw new Error(`${name} is required`);
  const weight = ensureFloat32Array(value.weight, `${name}.weight`);
  const bias = ensureFloat32Array(value.bias, `${name}.bias`);
  if (weight.length !== channels || bias.length !== channels) throw new Error(`${name} length mismatch`);
  const epsilon = Number(value.epsilon ?? 1e-5);
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw new Error(`${name}.epsilon must be positive`);
  if (epsilon !== 1e-5) throw new Error(`${name}.epsilon must equal 0.00001 because the authoritative WGSL constant is baked`);
  return { weight, bias, epsilon };
}

function validateLayer(value, index, shape) {
  if (!value || typeof value !== 'object') throw new Error(`layers.${index} is required`);
  const path = name => `layers.${index}.${name}`;
  return {
    norm1: validateNorm(value.norm1, path('norm1'), shape.channels),
    selfQ: validateProjection(value.selfQ, path('selfQ'), shape.channels, shape.channels),
    selfK: validateProjection(value.selfK, path('selfK'), shape.channels, shape.channels),
    selfV: validateProjection(value.selfV, path('selfV'), shape.channels, shape.channels),
    selfOut: validateProjection(value.selfOut, path('selfOut'), shape.channels, shape.channels),
    norm2: validateNorm(value.norm2, path('norm2'), shape.channels),
    crossQ: validateProjection(value.crossQ, path('crossQ'), shape.channels, shape.channels),
    crossK: validateProjection(value.crossK, path('crossK'), shape.channels, shape.channels),
    crossV: validateProjection(value.crossV, path('crossV'), shape.channels, shape.channels),
    crossOut: validateProjection(value.crossOut, path('crossOut'), shape.channels, shape.channels),
    imageCrossQ: validateProjection(value.imageCrossQ, path('imageCrossQ'), shape.channels, shape.channels),
    imageCrossK: validateProjection(value.imageCrossK, path('imageCrossK'), shape.channels, shape.channels),
    norm3: validateNorm(value.norm3, path('norm3'), shape.channels),
    linear1: validateProjection(value.linear1, path('linear1'), shape.channels, shape.mlpHidden),
    linear2: validateProjection(value.linear2, path('linear2'), shape.mlpHidden, shape.channels),
  };
}

function validateInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const current = input.current || {};
  const bank = input.bank || {};
  const queryValues = shape.batch * shape.queryTokens * shape.channels;
  const spatialValues = shape.batch * shape.memorySpatialTokens * shape.channels;
  const memoryValues = shape.batch * shape.memoryTokens * shape.channels;
  const tensors = {
    current: {
      image: ensureFloat32Array(current.image, 'current.image'),
      src: ensureFloat32Array(current.src, 'current.src'),
      srcPos: ensureFloat32Array(current.srcPos, 'current.srcPos'),
    },
    bank: {
      memoryImage: ensureFloat32Array(bank.memoryImage, 'bank.memoryImage'),
      memory: ensureFloat32Array(bank.memory, 'bank.memory'),
      memoryImagePos: ensureFloat32Array(bank.memoryImagePos, 'bank.memoryImagePos'),
      memoryPos: ensureFloat32Array(bank.memoryPos, 'bank.memoryPos'),
    },
  };
  for (const [name, value] of Object.entries(tensors.current)) {
    if (value.length !== queryValues) throw new Error(`current.${name} length mismatch`);
  }
  if (tensors.bank.memoryImage.length !== spatialValues) throw new Error('bank.memoryImage length mismatch');
  if (tensors.bank.memoryImagePos.length !== spatialValues) throw new Error('bank.memoryImagePos length mismatch');
  if (tensors.bank.memory.length !== memoryValues) throw new Error('bank.memory length mismatch');
  if (tensors.bank.memoryPos.length !== memoryValues) throw new Error('bank.memoryPos length mismatch');
  if (!Array.isArray(input.layers) || input.layers.length !== shape.layerCount) throw new Error('layers length must equal shape.layerCount');
  const layers = input.layers.map((layer, index) => validateLayer(layer, index, shape));
  const finalNorm = validateNorm(input.finalNorm, 'finalNorm', shape.channels);
  return { shape, ...tensors, layers, finalNorm };
}

function add(a, b, bScale = 1) {
  const output = new Float32Array(a.length);
  for (let index = 0; index < output.length; index += 1) output[index] = a[index] + bScale * b[index];
  return output;
}

function layerNorm(input, norm, tokens, channels) {
  const output = new Float32Array(input.length);
  for (let token = 0; token < tokens; token += 1) {
    const base = token * channels;
    let mean = 0;
    for (let channel = 0; channel < channels; channel += 1) mean += input[base + channel];
    mean /= channels;
    let variance = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const delta = input[base + channel] - mean;
      variance += delta * delta;
    }
    variance /= channels;
    const inverseStd = 1 / Math.sqrt(variance + norm.epsilon);
    for (let channel = 0; channel < channels; channel += 1) {
      output[base + channel] = (input[base + channel] - mean) * inverseStd * norm.weight[channel] + norm.bias[channel];
    }
  }
  return output;
}

function linear(input, projection, tokens, activation = null) {
  const output = new Float32Array(tokens * projection.outChannels);
  for (let token = 0; token < tokens; token += 1) {
    const inputBase = token * projection.inChannels;
    const outputBase = token * projection.outChannels;
    for (let outputChannel = 0; outputChannel < projection.outChannels; outputChannel += 1) {
      let value = projection.bias[outputChannel];
      const weightBase = outputChannel * projection.inChannels;
      for (let inputChannel = 0; inputChannel < projection.inChannels; inputChannel += 1) {
        value += input[inputBase + inputChannel] * projection.weight[weightBase + inputChannel];
      }
      output[outputBase + outputChannel] = activation === 'gelu' ? stableSam3Gelu(value) : value;
    }
  }
  return output;
}

function paddedImageMemory(bank, shape) {
  const output = new Float32Array(shape.batch * shape.memoryTokens * shape.channels);
  const outputPos = new Float32Array(output.length);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    const spatialBase = batch * shape.memorySpatialTokens * shape.channels;
    const memoryBase = batch * shape.memoryTokens * shape.channels;
    output.set(bank.memoryImage.subarray(spatialBase, spatialBase + shape.memorySpatialTokens * shape.channels), memoryBase);
    outputPos.set(bank.memoryImagePos.subarray(spatialBase, spatialBase + shape.memorySpatialTokens * shape.channels), memoryBase);
    const pointerSource = batch * shape.memoryTokens * shape.channels + shape.memorySpatialTokens * shape.channels;
    outputPos.set(bank.memoryPos.subarray(pointerSource, pointerSource + shape.numObjPtrTokens * shape.channels), memoryBase + shape.memorySpatialTokens * shape.channels);
  }
  return { memoryImage: output, memoryImagePos: outputPos };
}

export function applySam31AxialRope(input, options = {}) {
  const batch = positiveInteger(options.batch, 'rope.batch');
  const tokens = positiveInteger(options.tokens, 'rope.tokens');
  const channels = positiveInteger(options.channels, 'rope.channels');
  const heads = positiveInteger(options.heads, 'rope.heads');
  const headDim = positiveInteger(options.headDim, 'rope.headDim');
  const baseTokens = positiveInteger(options.baseTokens, 'rope.baseTokens');
  const gridWidth = positiveInteger(options.gridWidth, 'rope.gridWidth');
  const rotatedTokens = Number.isInteger(options.rotatedTokens) ? options.rotatedTokens : tokens;
  const theta = Number(options.theta ?? 10000);
  if (channels !== heads * headDim || headDim % 4 !== 0) throw new Error('invalid RoPE head shape');
  if (input.length !== batch * tokens * channels) throw new Error('RoPE input length mismatch');
  if (rotatedTokens < 0 || rotatedTokens > tokens || rotatedTokens % baseTokens !== 0) throw new Error('invalid RoPE rotated token count');
  const output = new Float32Array(input);
  const pairsPerAxis = headDim / 4;
  for (let b = 0; b < batch; b += 1) {
    for (let token = 0; token < rotatedTokens; token += 1) {
      const position = token % baseTokens;
      const x = position % gridWidth;
      const y = Math.floor(position / gridWidth);
      for (let head = 0; head < heads; head += 1) {
        for (let pair = 0; pair < headDim / 2; pair += 1) {
          const axisPair = pair % pairsPerAxis;
          const coordinate = pair < pairsPerAxis ? x : y;
          const angle = coordinate / (theta ** ((4 * axisPair) / headDim));
          const even = ((b * tokens + token) * channels) + head * headDim + pair * 2;
          const real = input[even];
          const imaginary = input[even + 1];
          output[even] = real * Math.cos(angle) - imaginary * Math.sin(angle);
          output[even + 1] = real * Math.sin(angle) + imaginary * Math.cos(angle);
        }
      }
    }
  }
  return output;
}

function attention(q, k, v, shape, queryTokens, keyTokens) {
  const output = new Float32Array(shape.batch * queryTokens * shape.channels);
  const scale = 1 / Math.sqrt(shape.headDim);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let query = 0; query < queryTokens; query += 1) {
      for (let head = 0; head < shape.heads; head += 1) {
        const headOffset = head * shape.headDim;
        const queryBase = (batch * queryTokens + query) * shape.channels + headOffset;
        const scores = new Float64Array(keyTokens);
        let maximum = -Infinity;
        for (let key = 0; key < keyTokens; key += 1) {
          const keyBase = (batch * keyTokens + key) * shape.channels + headOffset;
          let score = 0;
          for (let dimension = 0; dimension < shape.headDim; dimension += 1) score += q[queryBase + dimension] * k[keyBase + dimension];
          score *= scale;
          scores[key] = score;
          maximum = Math.max(maximum, score);
        }
        let denominator = 0;
        for (let key = 0; key < keyTokens; key += 1) denominator += Math.exp(scores[key] - maximum);
        for (let dimension = 0; dimension < shape.headDim; dimension += 1) {
          let value = 0;
          for (let key = 0; key < keyTokens; key += 1) {
            const valueIndex = (batch * keyTokens + key) * shape.channels + headOffset + dimension;
            value += Math.exp(scores[key] - maximum) / denominator * v[valueIndex];
          }
          output[queryBase + dimension] = value;
        }
      }
    }
  }
  return output;
}

export function createSam31MemoryAttentionPhaseProgramCpuOracle(input = {}) {
  const { shape, current, bank, layers, finalNorm } = validateInputs(input);
  const queryRows = shape.batch * shape.queryTokens;
  const memoryRows = shape.batch * shape.memoryTokens;
  const padded = paddedImageMemory(bank, shape);
  let hidden = add(current.src, current.srcPos, 0.1);
  const layerOutputs = [];
  const stageOutputs = [];
  for (const layer of layers) {
    const layerStages = {};
    const norm1 = layerNorm(hidden, layer.norm1, queryRows, shape.channels);
    const selfQ = applySam31AxialRope(linear(norm1, layer.selfQ, queryRows), { ...shape, batch: shape.batch, tokens: shape.queryTokens, baseTokens: shape.queryTokens, gridWidth: shape.queryWidth, rotatedTokens: shape.queryTokens, theta: 10000 });
    const selfK = applySam31AxialRope(linear(norm1, layer.selfK, queryRows), { ...shape, batch: shape.batch, tokens: shape.queryTokens, baseTokens: shape.queryTokens, gridWidth: shape.queryWidth, rotatedTokens: shape.queryTokens, theta: 10000 });
    const selfV = linear(norm1, layer.selfV, queryRows);
    hidden = add(hidden, linear(attention(selfQ, selfK, selfV, shape, shape.queryTokens, shape.queryTokens), layer.selfOut, queryRows));
    layerStages.selfAttentionResidual = new Float32Array(hidden);

    const norm2 = layerNorm(hidden, layer.norm2, queryRows, shape.channels);
    const crossQ = add(linear(current.image, layer.imageCrossQ, queryRows), linear(norm2, layer.crossQ, queryRows));
    let crossK = add(linear(padded.memoryImage, layer.imageCrossK, memoryRows), linear(bank.memory, layer.crossK, memoryRows));
    crossK = add(crossK, padded.memoryImagePos);
    const crossV = linear(bank.memory, layer.crossV, memoryRows);
    const crossQRope = applySam31AxialRope(crossQ, { ...shape, batch: shape.batch, tokens: shape.queryTokens, baseTokens: shape.queryTokens, gridWidth: shape.queryWidth, rotatedTokens: shape.queryTokens, theta: 10000 });
    const crossKRope = applySam31AxialRope(crossK, { ...shape, batch: shape.batch, tokens: shape.memoryTokens, baseTokens: shape.queryTokens, gridWidth: shape.queryWidth, rotatedTokens: shape.memorySpatialTokens, theta: 10000 });
    const crossAttention = attention(crossQRope, crossKRope, crossV, shape, shape.queryTokens, shape.memoryTokens);
    layerStages.crossQueryRope = new Float32Array(crossQRope);
    layerStages.crossKeyRope = new Float32Array(crossKRope);
    layerStages.crossValue = new Float32Array(crossV);
    layerStages.crossAttention = new Float32Array(crossAttention);
    hidden = add(hidden, linear(crossAttention, layer.crossOut, queryRows));
    layerStages.crossAttentionResidual = new Float32Array(hidden);

    const norm3 = layerNorm(hidden, layer.norm3, queryRows, shape.channels);
    hidden = add(hidden, linear(linear(norm3, layer.linear1, queryRows, 'gelu'), layer.linear2, queryRows));
    layerStages.mlpResidual = new Float32Array(hidden);
    stageOutputs.push(layerStages);
    layerOutputs.push(new Float32Array(hidden));
  }
  return { shape, stageOutputs, layerOutputs, memory: layerNorm(hidden, finalNorm, queryRows, shape.channels), posEmbed: new Float32Array(current.srcPos) };
}

export function createSam31MemoryAttentionPhaseProgramRouteDefinition(input = {}) {
  const layerCount = input.shape?.layerCount || input.layerCount || 4;
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: requiredStages(layerCount),
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: MODEL_ID, revision: input.model?.revision || 'sam31-official-memory-attention', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(({ role }) => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(layerCount),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam31MemoryAttentionPhaseProgramRoute', upstreamBoundary: 'sam31-multiplex-memory-bank-to-conditioned-features' },
  });
}

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

export function createSam31MemoryAttentionPhaseProgramRouteReceipt(input = {}) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam31-memory-attention-current-tensors', input.currentTensors),
      createRouteReceiptInputArtifact('sam31-memory-attention-bank-tensors', input.bankTensors),
      createRouteReceiptInputArtifact('sam31-memory-attention-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export const MEMORY_ATTENTION_LAYERNORM_WGSL = `
struct LayerNormDims { total_tokens: u32, channels: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LayerNormDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let token = gid.x + gid.y * dispatch_grid.x * 64u;
  if (token >= dims.total_tokens) { return; }
  let base = token * dims.channels;
  var mean = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) { mean = mean + input_values[base + channel]; }
  mean = mean / f32(dims.channels);
  var variance = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let delta = input_values[base + channel] - mean;
    variance = variance + delta * delta;
  }
  variance = variance / f32(dims.channels);
  let inverse_std = inverseSqrt(variance + 0.00001);
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    output_values[base + channel] = (input_values[base + channel] - mean) * inverse_std * norm_weight[channel] + norm_bias[channel];
  }
}
`;

export const MEMORY_ATTENTION_ADD_WGSL = `
struct AddDims { total: u32, scale: f32, };
@group(0) @binding(0) var<storage, read> left_values: array<f32>;
@group(0) @binding(1) var<storage, read> right_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: AddDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total) { return; }
  output_values[index] = left_values[index] + dims.scale * right_values[index];
}
`;

export const MEMORY_ATTENTION_LINEAR_WGSL = `
struct LinearDims { input_channels: u32, output_channels: u32, total_output: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  let input_base = token * dims.input_channels;
  let weight_base = output_channel * dims.input_channels;
  var value = bias[output_channel];
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 1u) {
    value = value + input_values[input_base + channel] * weight[weight_base + channel];
  }
  output_values[index] = value;
}
`;

const MEMORY_ATTENTION_LINEAR_GELU_WGSL = `
struct LinearDims { input_channels: u32, output_channels: u32, total_output: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;
${SAM31_EXACT_GELU_FUNCTIONS_WGSL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  let input_base = token * dims.input_channels;
  let weight_base = output_channel * dims.input_channels;
  var value = bias[output_channel];
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 1u) {
    value = value + input_values[input_base + channel] * weight[weight_base + channel];
  }
  output_values[index] = gelu_exact_approx(value);
}
`;

const MEMORY_ATTENTION_ROPE_WGSL = `
struct RopeDims {
  batch: u32,
  tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  base_tokens: u32,
  grid_width: u32,
  rotated_tokens: u32,
};
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: RopeDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.tokens * dims.channels;
  if (index >= total) { return; }
  let channel = index % dims.channels;
  let token = (index / dims.channels) % dims.tokens;
  if (token >= dims.rotated_tokens) { output_values[index] = input_values[index]; return; }
  let head_channel = channel % dims.head_dim;
  let pair = head_channel / 2u;
  let pairs_per_axis = dims.head_dim / 4u;
  let axis_pair = pair % pairs_per_axis;
  let position = token % dims.base_tokens;
  let x = position % dims.grid_width;
  let y = position / dims.grid_width;
  let coordinate = select(y, x, pair < pairs_per_axis);
  let exponent = 4.0 * f32(axis_pair) / f32(dims.head_dim);
  let angle = f32(coordinate) / pow(10000.0, exponent);
  let pair_base = index - (head_channel % 2u);
  let real = input_values[pair_base];
  let imaginary = input_values[pair_base + 1u];
  output_values[index] = select(
    real * sin(angle) + imaginary * cos(angle),
    real * cos(angle) - imaginary * sin(angle),
    (head_channel % 2u) == 0u,
  );
}
`;

export const MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
};

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: AttentionDims;
var<workgroup> products: array<f32, 32>;
var<workgroup> state: array<f32, 4>;

@compute @workgroup_size(32)
fn main(
  @builtin(local_invocation_id) local_id: vec3<u32>,
  @builtin(workgroup_id) workgroup_id: vec3<u32>,
) {
  let dimension = local_id.x;
  let query = workgroup_id.x;
  let head = workgroup_id.y;
  let batch = workgroup_id.z;
  let head_offset = head * dims.head_dim;
  let query_base = (batch * dims.query_tokens + query) * dims.channels + head_offset;
  let scale = inverseSqrt(f32(dims.head_dim));
  let active_dimension = dimension < dims.head_dim;
  var accumulator = 0.0;
  if (dimension == 0u) {
    state[0] = -3.402823466e+38;
    state[1] = 0.0;
  }
  workgroupBarrier();
  for (var token = 0u; token < dims.key_tokens; token = token + 1u) {
    let key_base = (batch * dims.key_tokens + token) * dims.channels + head_offset;
    products[dimension] = 0.0;
    if (active_dimension) {
      products[dimension] = q_values[query_base + dimension] * k_values[key_base + dimension];
    }
    workgroupBarrier();
    var stride = 16u;
    loop {
      if (dimension < stride) { products[dimension] = products[dimension] + products[dimension + stride]; }
      workgroupBarrier();
      if (stride == 1u) { break; }
      stride = stride / 2u;
    }
    if (dimension == 0u) {
      let score = products[0] * scale;
      let next_max = max(state[0], score);
      state[2] = exp(state[0] - next_max);
      state[3] = exp(score - next_max);
      state[1] = state[1] * state[2] + state[3];
      state[0] = next_max;
    }
    workgroupBarrier();
    if (active_dimension) {
      accumulator = accumulator * state[2] + state[3] * v_values[key_base + dimension];
    }
    workgroupBarrier();
  }
  if (active_dimension) {
    output_values[query_base + dimension] = accumulator / state[1];
  }
}
`;

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM3.1 memory attention outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function tensorBinding(name, access = 'read-only-storage') {
  return { name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access };
}

function uniformBinding(name) {
  return { name, resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' };
}

function weightTensorShapes(shape) {
  return {
    norm1Weight: [shape.channels], norm1Bias: [shape.channels],
    selfQWeight: [shape.channels, shape.channels], selfQBias: [shape.channels],
    selfKWeight: [shape.channels, shape.channels], selfKBias: [shape.channels],
    selfVWeight: [shape.channels, shape.channels], selfVBias: [shape.channels],
    selfOutWeight: [shape.channels, shape.channels], selfOutBias: [shape.channels],
    norm2Weight: [shape.channels], norm2Bias: [shape.channels],
    crossQWeight: [shape.channels, shape.channels], crossQBias: [shape.channels],
    crossKWeight: [shape.channels, shape.channels], crossKBias: [shape.channels],
    crossVWeight: [shape.channels, shape.channels], crossVBias: [shape.channels],
    crossOutWeight: [shape.channels, shape.channels], crossOutBias: [shape.channels],
    imageCrossQWeight: [shape.channels, shape.channels], imageCrossQBias: [shape.channels],
    imageCrossKWeight: [shape.channels, shape.channels], imageCrossKBias: [shape.channels],
    norm3Weight: [shape.channels], norm3Bias: [shape.channels],
    linear1Weight: [shape.mlpHidden, shape.channels], linear1Bias: [shape.mlpHidden],
    linear2Weight: [shape.channels, shape.mlpHidden], linear2Bias: [shape.channels],
  };
}

function layerWeightArrays(layer) {
  return {
    norm1Weight: layer.norm1.weight, norm1Bias: layer.norm1.bias,
    selfQWeight: layer.selfQ.weight, selfQBias: layer.selfQ.bias,
    selfKWeight: layer.selfK.weight, selfKBias: layer.selfK.bias,
    selfVWeight: layer.selfV.weight, selfVBias: layer.selfV.bias,
    selfOutWeight: layer.selfOut.weight, selfOutBias: layer.selfOut.bias,
    norm2Weight: layer.norm2.weight, norm2Bias: layer.norm2.bias,
    crossQWeight: layer.crossQ.weight, crossQBias: layer.crossQ.bias,
    crossKWeight: layer.crossK.weight, crossKBias: layer.crossK.bias,
    crossVWeight: layer.crossV.weight, crossVBias: layer.crossV.bias,
    crossOutWeight: layer.crossOut.weight, crossOutBias: layer.crossOut.bias,
    imageCrossQWeight: layer.imageCrossQ.weight, imageCrossQBias: layer.imageCrossQ.bias,
    imageCrossKWeight: layer.imageCrossK.weight, imageCrossKBias: layer.imageCrossK.bias,
    norm3Weight: layer.norm3.weight, norm3Bias: layer.norm3.bias,
    linear1Weight: layer.linear1.weight, linear1Bias: layer.linear1.bias,
    linear2Weight: layer.linear2.weight, linear2Bias: layer.linear2.bias,
  };
}

export async function runSam31MemoryAttentionPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const projection = validateInputs(input.tensors || {});
  const { shape, current, bank, layers, finalNorm } = projection;
  if (shape.channels !== 256 || shape.heads !== 8 || shape.headDim !== 32 || shape.mlpHidden !== 2048 || shape.layerCount !== 4) {
    throw new Error('authoritative SAM3.1 memory attention requires C=256, H=8, D=32, FFN=2048, and four layers');
  }
  const route = input.route || createSam31MemoryAttentionPhaseProgramRouteDefinition({ kernel: input.kernel, shape });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const currentTensors = roleArtifact(input.request.inputs, 'sam31-memory-attention-current-tensors');
  const bankTensors = roleArtifact(input.request.inputs, 'sam31-memory-attention-bank-tensors');
  const weights = roleArtifact(input.request.inputs, 'sam31-memory-attention-weights');
  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam31-memory-attention-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: requiredStages(shape.layerCount),
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
    residentTensorResolver: input.residentTensorResolver,
  });
  const queryRows = shape.batch * shape.queryTokens;
  const memoryRows = shape.batch * shape.memoryTokens;
  const totalQuery = queryRows * shape.channels;
  const totalMemory = memoryRows * shape.channels;
  const totalMlp = queryRows * shape.mlpHidden;
  const padded = paddedImageMemory(bank, shape);
  const layerValues = layers.map(layerWeightArrays);
  const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
  const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  let tensors;

  await runtime.runStage('memory-attention-load-tensors', async stage => {
    const create = (name, tensorShape, tensorUsage = usage, sourceData = undefined) => stage.createTensor({ name: `sam31.memory-attention.${name}`, shape: tensorShape, dtype: 'f32', usage: tensorUsage, ...(sourceData ? { sourceData } : {}) });
    tensors = {
      currentImage: create('current-image', [shape.batch, shape.queryTokens, shape.channels], readonlyUsage),
      src: create('src', [shape.batch, shape.queryTokens, shape.channels], readonlyUsage),
      srcPos: create('src-pos', [shape.batch, shape.queryTokens, shape.channels], readonlyUsage),
      memory: create('memory', [shape.batch, shape.memoryTokens, shape.channels], readonlyUsage),
      memoryImage: create('memory-image-padded', [shape.batch, shape.memoryTokens, shape.channels], readonlyUsage),
      memoryImagePos: create('memory-image-pos-padded', [shape.batch, shape.memoryTokens, shape.channels], readonlyUsage),
      hiddenA: create('hidden-a', [shape.batch, shape.queryTokens, shape.channels]),
      hiddenB: create('hidden-b', [shape.batch, shape.queryTokens, shape.channels]),
      norm: create('norm', [shape.batch, shape.queryTokens, shape.channels]),
      queryA: create('query-a', [shape.batch, shape.queryTokens, shape.channels]),
      queryB: create('query-b', [shape.batch, shape.queryTokens, shape.channels]),
      queryRope: create('query-rope', [shape.batch, shape.queryTokens, shape.channels]),
      keyA: create('key-a', [shape.batch, shape.memoryTokens, shape.channels]),
      keyB: create('key-b', [shape.batch, shape.memoryTokens, shape.channels]),
      keyRope: create('key-rope', [shape.batch, shape.memoryTokens, shape.channels]),
      valueQuery: create('value-query', [shape.batch, shape.queryTokens, shape.channels]),
      valueMemory: create('value-memory', [shape.batch, shape.memoryTokens, shape.channels]),
      attention: create('attention', [shape.batch, shape.queryTokens, shape.channels]),
      projected: create('projected', [shape.batch, shape.queryTokens, shape.channels]),
      mlp: create('mlp', [shape.batch, shape.queryTokens, shape.mlpHidden]),
      finalOutput: create('final-output', [shape.batch, shape.queryTokens, shape.channels]),
      finalNormWeight: create('final-norm.weight', [shape.channels], readonlyUsage, finalNorm.weight),
      finalNormBias: create('final-norm.bias', [shape.channels], readonlyUsage, finalNorm.bias),
      weights: [],
      uniforms: {},
    };
    stage.uploadTensor(tensors.currentImage, current.image);
    stage.uploadTensor(tensors.src, current.src);
    stage.uploadTensor(tensors.srcPos, current.srcPos);
    stage.uploadTensor(tensors.memory, bank.memory);
    stage.uploadTensor(tensors.memoryImage, padded.memoryImage);
    stage.uploadTensor(tensors.memoryImagePos, padded.memoryImagePos);
    stage.uploadTensor(tensors.finalNormWeight, finalNorm.weight);
    stage.uploadTensor(tensors.finalNormBias, finalNorm.bias);
    const shapes = weightTensorShapes(shape);
    for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
      const layerWeights = {};
      for (const [name, tensorShape] of Object.entries(shapes)) layerWeights[name] = create(`layer-${layerIndex}.${name}`, tensorShape, readonlyUsage, layerValues[layerIndex][name]);
      tensors.weights.push(layerWeights);
    }
    const uniform = (name, schema, values) => stage.createUniformBuffer({ label: `sam31.memory-attention.${name}`, schema, values });
    tensors.uniforms.norm = uniform('norm-dims', [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }], { total_tokens: queryRows, channels: shape.channels });
    tensors.uniforms.add = uniform('add-dims', [{ name: 'total', type: 'u32' }, { name: 'scale', type: 'f32' }], { total: totalQuery, scale: 1 });
    tensors.uniforms.memoryAdd = uniform('memory-add-dims', [{ name: 'total', type: 'u32' }, { name: 'scale', type: 'f32' }], { total: totalMemory, scale: 1 });
    tensors.uniforms.initialAdd = uniform('initial-add-dims', [{ name: 'total', type: 'u32' }, { name: 'scale', type: 'f32' }], { total: totalQuery, scale: 0.1 });
    const linearSchema = [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }];
    tensors.uniforms.queryLinear = uniform('query-linear-dims', linearSchema, { input_channels: shape.channels, output_channels: shape.channels, total_output: totalQuery });
    tensors.uniforms.memoryLinear = uniform('memory-linear-dims', linearSchema, { input_channels: shape.channels, output_channels: shape.channels, total_output: totalMemory });
    tensors.uniforms.linear1 = uniform('linear1-dims', linearSchema, { input_channels: shape.channels, output_channels: shape.mlpHidden, total_output: totalMlp });
    tensors.uniforms.linear2 = uniform('linear2-dims', linearSchema, { input_channels: shape.mlpHidden, output_channels: shape.channels, total_output: totalQuery });
    const ropeSchema = [{ name: 'batch', type: 'u32' }, { name: 'tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }, { name: 'base_tokens', type: 'u32' }, { name: 'grid_width', type: 'u32' }, { name: 'rotated_tokens', type: 'u32' }];
    tensors.uniforms.queryRope = uniform('query-rope-dims', ropeSchema, { batch: shape.batch, tokens: shape.queryTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, base_tokens: shape.queryTokens, grid_width: shape.queryWidth, rotated_tokens: shape.queryTokens });
    tensors.uniforms.memoryRope = uniform('memory-rope-dims', ropeSchema, { batch: shape.batch, tokens: shape.memoryTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, base_tokens: shape.queryTokens, grid_width: shape.queryWidth, rotated_tokens: shape.memorySpatialTokens });
    const attentionSchema = [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }];
    tensors.uniforms.selfAttention = uniform('self-attention-dims', attentionSchema, { batch: shape.batch, query_tokens: shape.queryTokens, key_tokens: shape.queryTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim });
    tensors.uniforms.crossAttention = uniform('cross-attention-dims', attentionSchema, { batch: shape.batch, query_tokens: shape.queryTokens, key_tokens: shape.memoryTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim });
    await stage.yieldToBrowser({ reason: 'after-sam31-memory-attention-tensor-upload' });
  }, { shape, numObjPtrTokens: shape.numObjPtrTokens });

  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    await runtime.runStage(`memory-attention-layer-${layerIndex}-load-weights`, async stage => {
      const values = layerValues[layerIndex];
      for (const [name, tensor] of Object.entries(tensors.weights[layerIndex])) stage.uploadTensor(tensor, values[name]);
      await stage.yieldToBrowser({ reason: `after-sam31-memory-attention-layer-${layerIndex}-weight-upload` });
    });
  }

  const programTensors = {};
  for (const [name, tensor] of Object.entries(tensors)) {
    if (name !== 'weights' && name !== 'uniforms') programTensors[name] = tensor;
  }
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    for (const [name, tensor] of Object.entries(tensors.weights[layerIndex])) programTensors[`layer${layerIndex}${name[0].toUpperCase()}${name.slice(1)}`] = tensor;
  }
  const kernels = {};
  const phases = [];
  const addKernel = (name, code, bindings) => { kernels[name] = { code, bindings }; };
  const linearBindings = (inputName, weightName, biasName, outputName, dimsName) => [tensorBinding(inputName), tensorBinding(weightName), tensorBinding(biasName), tensorBinding(outputName, 'storage'), uniformBinding(dimsName)];
  const addBindings = (left, right, output, dimsName = 'add') => [tensorBinding(left), tensorBinding(right), tensorBinding(output, 'storage'), uniformBinding(dimsName)];
  const normBindings = (inputName, weightName, biasName, outputName) => [tensorBinding(inputName), tensorBinding(weightName), tensorBinding(biasName), tensorBinding(outputName, 'storage'), uniformBinding('norm')];
  const ropeBindings = (inputName, outputName, dimsName) => [tensorBinding(inputName), tensorBinding(outputName, 'storage'), uniformBinding(dimsName)];
  const attentionBindings = (qName, kName, vName, outputName, dimsName) => [tensorBinding(qName), tensorBinding(kName), tensorBinding(vName), tensorBinding(outputName, 'storage'), uniformBinding(dimsName)];

  addKernel('initialPositionAdd', MEMORY_ATTENTION_ADD_WGSL, addBindings('src', 'srcPos', 'hiddenA', 'initialAdd'));
  phases.push({ name: 'memory-attention-initial-position-add', kernel: 'initialPositionAdd', dispatch: [workgroups(totalQuery)], yieldAfter: true });
  let currentHidden = 'hiddenA';
  let otherHidden = 'hiddenB';
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    const prefix = `layer${layerIndex}`;
    const weight = name => `${prefix}${name[0].toUpperCase()}${name.slice(1)}`;
    const kernel = (suffix, code, bindings) => addKernel(`${prefix}${suffix}`, code, bindings);
    kernel('Norm1', MEMORY_ATTENTION_LAYERNORM_WGSL, normBindings(currentHidden, weight('norm1Weight'), weight('norm1Bias'), 'norm'));
    kernel('SelfQ', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('norm', weight('selfQWeight'), weight('selfQBias'), 'queryA', 'queryLinear'));
    kernel('SelfK', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('norm', weight('selfKWeight'), weight('selfKBias'), 'keyA', 'queryLinear'));
    kernel('SelfV', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('norm', weight('selfVWeight'), weight('selfVBias'), 'valueQuery', 'queryLinear'));
    kernel('SelfQRope', MEMORY_ATTENTION_ROPE_WGSL, ropeBindings('queryA', 'queryRope', 'queryRope'));
    kernel('SelfKRope', MEMORY_ATTENTION_ROPE_WGSL, ropeBindings('keyA', 'keyRope', 'queryRope'));
    kernel('SelfAttention', MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL, attentionBindings('queryRope', 'keyRope', 'valueQuery', 'attention', 'selfAttention'));
    kernel('SelfOutput', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('attention', weight('selfOutWeight'), weight('selfOutBias'), 'projected', 'queryLinear'));
    kernel('SelfResidual', MEMORY_ATTENTION_ADD_WGSL, addBindings(currentHidden, 'projected', otherHidden));
    kernel('Norm2', MEMORY_ATTENTION_LAYERNORM_WGSL, normBindings(otherHidden, weight('norm2Weight'), weight('norm2Bias'), 'norm'));
    kernel('ImageCrossQ', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('currentImage', weight('imageCrossQWeight'), weight('imageCrossQBias'), 'queryA', 'queryLinear'));
    kernel('ObjectCrossQ', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('norm', weight('crossQWeight'), weight('crossQBias'), 'queryB', 'queryLinear'));
    kernel('CrossQAdd', MEMORY_ATTENTION_ADD_WGSL, addBindings('queryA', 'queryB', 'projected'));
    kernel('CrossQRope', MEMORY_ATTENTION_ROPE_WGSL, ropeBindings('projected', 'queryRope', 'queryRope'));
    kernel('ImageCrossK', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('memoryImage', weight('imageCrossKWeight'), weight('imageCrossKBias'), 'keyA', 'memoryLinear'));
    kernel('ObjectCrossK', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('memory', weight('crossKWeight'), weight('crossKBias'), 'keyB', 'memoryLinear'));
    kernel('CrossKAdd', MEMORY_ATTENTION_ADD_WGSL, addBindings('keyA', 'keyB', 'keyRope', 'memoryAdd'));
    kernel('CrossKPosAdd', MEMORY_ATTENTION_ADD_WGSL, addBindings('keyRope', 'memoryImagePos', 'keyA', 'memoryAdd'));
    kernel('CrossKRope', MEMORY_ATTENTION_ROPE_WGSL, ropeBindings('keyA', 'keyRope', 'memoryRope'));
    kernel('CrossV', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('memory', weight('crossVWeight'), weight('crossVBias'), 'valueMemory', 'memoryLinear'));
    kernel('CrossAttention', MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL, attentionBindings('queryRope', 'keyRope', 'valueMemory', 'attention', 'crossAttention'));
    kernel('CrossOutput', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('attention', weight('crossOutWeight'), weight('crossOutBias'), 'projected', 'queryLinear'));
    kernel('CrossResidual', MEMORY_ATTENTION_ADD_WGSL, addBindings(otherHidden, 'projected', currentHidden));
    kernel('Norm3', MEMORY_ATTENTION_LAYERNORM_WGSL, normBindings(currentHidden, weight('norm3Weight'), weight('norm3Bias'), 'norm'));
    kernel('Mlp1', MEMORY_ATTENTION_LINEAR_GELU_WGSL, linearBindings('norm', weight('linear1Weight'), weight('linear1Bias'), 'mlp', 'linear1'));
    kernel('Mlp2', MEMORY_ATTENTION_LINEAR_WGSL, linearBindings('mlp', weight('linear2Weight'), weight('linear2Bias'), 'projected', 'linear2'));
    kernel('MlpResidual', MEMORY_ATTENTION_ADD_WGSL, addBindings(currentHidden, 'projected', otherHidden));
    phases.push(
      { name: `memory-attention-layer-${layerIndex}-norm1`, kernel: `${prefix}Norm1`, dispatch: [workgroups(queryRows)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-self-qkv`, kernel: `${prefix}SelfQ`, dispatch: [workgroups(totalQuery)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-self-k`, kernel: `${prefix}SelfK`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-self-v`, kernel: `${prefix}SelfV`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-self-rope`, kernel: `${prefix}SelfQRope`, dispatch: [workgroups(totalQuery)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-self-rope-k`, kernel: `${prefix}SelfKRope`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-self-attention`, kernel: `${prefix}SelfAttention`, dispatch: [shape.queryTokens, shape.heads, shape.batch], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-self-output`, kernel: `${prefix}SelfOutput`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-self-output-residual`, kernel: `${prefix}SelfResidual`, dispatch: [workgroups(totalQuery)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-self-residual-readback`, readbacks: [{ name: `layer${layerIndex}SelfAttentionResidual`, tensor: otherHidden }] },
      { name: `memory-attention-layer-${layerIndex}-norm2`, kernel: `${prefix}Norm2`, dispatch: [workgroups(queryRows)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-image-query`, kernel: `${prefix}ImageCrossQ`, dispatch: [workgroups(totalQuery)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-object-query`, kernel: `${prefix}ObjectCrossQ`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-cross-query-add`, kernel: `${prefix}CrossQAdd`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-cross-rope-query`, kernel: `${prefix}CrossQRope`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-cross-memory-key`, kernel: `${prefix}ImageCrossK`, dispatch: [workgroups(totalMemory)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-object-key`, kernel: `${prefix}ObjectCrossK`, dispatch: [workgroups(totalMemory)] },
      { name: `memory-attention-layer-${layerIndex}-cross-key-add`, kernel: `${prefix}CrossKAdd`, dispatch: [workgroups(totalMemory)] },
      { name: `memory-attention-layer-${layerIndex}-cross-key-position-add`, kernel: `${prefix}CrossKPosAdd`, dispatch: [workgroups(totalMemory)] },
      { name: `memory-attention-layer-${layerIndex}-cross-value`, kernel: `${prefix}CrossV`, dispatch: [workgroups(totalMemory)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-rope-pointer-tail`, kernel: `${prefix}CrossKRope`, dispatch: [workgroups(totalMemory)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-input-readback`, readbacks: [
        { name: `layer${layerIndex}CrossQueryRope`, tensor: 'queryRope' },
        { name: `layer${layerIndex}CrossKeyRope`, tensor: 'keyRope' },
        { name: `layer${layerIndex}CrossValue`, tensor: 'valueMemory' },
      ] },
      { name: `memory-attention-layer-${layerIndex}-cross-attention`, kernel: `${prefix}CrossAttention`, dispatch: [shape.queryTokens, shape.heads, shape.batch], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-attention-readback`, readbacks: [{ name: `layer${layerIndex}CrossAttention`, tensor: 'attention' }] },
      { name: `memory-attention-layer-${layerIndex}-cross-output`, kernel: `${prefix}CrossOutput`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-cross-output-residual`, kernel: `${prefix}CrossResidual`, dispatch: [workgroups(totalQuery)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-cross-residual-readback`, readbacks: [{ name: `layer${layerIndex}CrossAttentionResidual`, tensor: currentHidden }] },
      { name: `memory-attention-layer-${layerIndex}-norm3`, kernel: `${prefix}Norm3`, dispatch: [workgroups(queryRows)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-mlp-gelu`, kernel: `${prefix}Mlp1`, dispatch: [workgroups(totalMlp)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-mlp-output`, kernel: `${prefix}Mlp2`, dispatch: [workgroups(totalQuery)] },
      { name: `memory-attention-layer-${layerIndex}-mlp-output-residual`, kernel: `${prefix}MlpResidual`, dispatch: [workgroups(totalQuery)], yieldAfter: true },
      { name: `memory-attention-layer-${layerIndex}-readback`, readbacks: [{ name: `layer${layerIndex}Memory`, tensor: otherHidden }] },
    );
    [currentHidden, otherHidden] = [otherHidden, currentHidden];
  }
  addKernel('finalLayerNorm', MEMORY_ATTENTION_LAYERNORM_WGSL, normBindings(currentHidden, 'finalNormWeight', 'finalNormBias', 'finalOutput'));
  phases.push(
    { name: 'memory-attention-final-layernorm', kernel: 'finalLayerNorm', dispatch: [workgroups(queryRows)], yieldAfter: true },
    { name: 'memory-attention-readback', readbacks: [{ name: 'memory', tensor: 'finalOutput' }] },
  );

  const program = runtime.defineProgram({
    name: 'sam31.memory-attention-phase-program',
    tensors: programTensors,
    uniforms: tensors.uniforms,
    kernels,
    phases,
    metadata: {
      routeId: SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
      sourceBoundary: 'Meta TransformerEncoderDecoupledCrossAttention',
      numObjPtrTokens: shape.numObjPtrTokens,
      attentionMemory: 'online-softmax-without-logits-tensor',
    },
  });
  const run = await runtime.runProgram(program);
  const memory = run.outputs.memory;
  const outputShape = [shape.batch, shape.queryTokens, shape.channels];
  const outputs = {
    memory: {
      artifactId: roleArtifact(input.request.outputs, 'sam31-memory-conditioned-features').artifactId,
      sha256: await sha256Hex(memory),
      shape: outputShape,
    },
  };
  const receipt = createSam31MemoryAttentionPhaseProgramRouteReceipt({
    sourceImage,
    currentTensors,
    bankTensors,
    weights,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || weights.sha256, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      memory: Array.from(new Float32Array(memory)),
      layerOutputs: Array.from({ length: shape.layerCount }, (_, index) => Array.from(new Float32Array(run.outputs[`layer${index}Memory`]))),
      stageOutputs: Array.from({ length: shape.layerCount }, (_, index) => ({
        selfAttentionResidual: Array.from(new Float32Array(run.outputs[`layer${index}SelfAttentionResidual`])),
        crossQueryRope: Array.from(new Float32Array(run.outputs[`layer${index}CrossQueryRope`])),
        crossKeyRope: Array.from(new Float32Array(run.outputs[`layer${index}CrossKeyRope`])),
        crossValue: Array.from(new Float32Array(run.outputs[`layer${index}CrossValue`])),
        crossAttention: Array.from(new Float32Array(run.outputs[`layer${index}CrossAttention`])),
        crossAttentionResidual: Array.from(new Float32Array(run.outputs[`layer${index}CrossAttentionResidual`])),
        mlpResidual: Array.from(new Float32Array(run.outputs[`layer${index}Memory`])),
      })),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
