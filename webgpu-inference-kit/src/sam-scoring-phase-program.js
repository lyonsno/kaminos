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

export const SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID = 'sam3.scoring.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-scoring-phase-program-v0';
const REQUIRED_STAGES = [
  'load-scoring-tensors',
  'scoring-text-mlp-fc1-relu',
  'scoring-text-mlp-fc2',
  'scoring-text-mlp-residual-layernorm',
  'scoring-mask-pool-text',
  'scoring-text-proj',
  'scoring-query-proj',
  'scoring-dot-product',
  'readback-scoring',
];
const INPUT_ROLES = ['source-image', 'sam3-scoring-tensors', 'sam3-scoring-weights'];
const OUTPUT_ROLES = [{ key: 'predLogits', role: 'pred-logits', required: true }];

const LINEAR_RELU_WGSL = `
struct LinearDims {
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  let input_base = token * dims.input_channels;
  let weight_base = output_channel * dims.input_channels;
  var sum = bias[output_channel];
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 1u) {
    sum = sum + input_values[input_base + channel] * weight[weight_base + channel];
  }
  output_values[index] = max(sum, 0.0);
}
`;

const LINEAR_WGSL = LINEAR_RELU_WGSL.replace('output_values[index] = max(sum, 0.0);', 'output_values[index] = sum;');

const RESIDUAL_LAYERNORM_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  channels: u32,
  total_tokens: u32,
};

@group(0) @binding(0) var<storage, read> mlp_values: array<f32>;
@group(0) @binding(1) var<storage, read> residual_values: array<f32>;
@group(0) @binding(2) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(3) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let token = gid.x;
  if (token >= dims.total_tokens) { return; }
  let base = token * dims.channels;
  var mean = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    mean = mean + mlp_values[base + channel] + residual_values[base + channel];
  }
  mean = mean / f32(dims.channels);
  var variance = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let value = mlp_values[base + channel] + residual_values[base + channel];
    let delta = value - mean;
    variance = variance + delta * delta;
  }
  variance = variance / f32(dims.channels);
  let inv_std = inverseSqrt(variance + 0.000001);
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let value = mlp_values[base + channel] + residual_values[base + channel];
    output_values[base + channel] = (value - mean) * inv_std * norm_weight[channel] + norm_bias[channel];
  }
}
`;

const MASKED_POOL_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  channels: u32,
  total_tokens: u32,
};

@group(0) @binding(0) var<storage, read> text_values: array<f32>;
@group(0) @binding(1) var<storage, read> prompt_mask: array<f32>;
@group(0) @binding(2) var<storage, read_write> pooled_text: array<f32>;
@group(0) @binding(3) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.channels;
  if (index >= total) { return; }
  let channel = index % dims.channels;
  let batch = index / dims.channels;
  var sum = 0.0;
  var valid = 0.0;
  for (var token = 0u; token < dims.prompt_tokens; token = token + 1u) {
    let mask_value = prompt_mask[batch * dims.prompt_tokens + token];
    if (mask_value > 0.0) {
      sum = sum + text_values[(batch * dims.prompt_tokens + token) * dims.channels + channel] * mask_value;
      valid = valid + mask_value;
    }
  }
  pooled_text[index] = sum / max(valid, 1.0);
}
`;

const DOT_PRODUCT_WGSL = `
struct ScoreDims {
  layer_count: u32,
  batch: u32,
  query_tokens: u32,
  channels: u32,
  total_scores: u32,
};

@group(0) @binding(0) var<storage, read> projected_queries: array<f32>;
@group(0) @binding(1) var<storage, read> projected_text: array<f32>;
@group(0) @binding(2) var<storage, read_write> pred_logits: array<f32>;
@group(0) @binding(3) var<uniform> dims: ScoreDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_scores) { return; }
  let query = index % dims.query_tokens;
  let batch = (index / dims.query_tokens) % dims.batch;
  let layer = index / (dims.query_tokens * dims.batch);
  let query_base = ((layer * dims.batch + batch) * dims.query_tokens + query) * dims.channels;
  let text_base = batch * dims.channels;
  var sum = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    sum = sum + projected_queries[query_base + channel] * projected_text[text_base + channel];
  }
  let scaled = sum * inverseSqrt(f32(dims.channels));
  pred_logits[index] = clamp(scaled, -12.0, 12.0);
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-scoring' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-scoring' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-scoring' })),
      notes: 'SAM3 scoring phase program cooperates between text scoring, query projection, dot-product, and readback boundaries.',
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
    layerCount: shape.layerCount,
    batch: shape.batch,
    queryTokens: shape.queryTokens,
    promptTokens: shape.promptTokens,
    channels: shape.channels,
    mlpHidden: shape.mlpHidden,
  };
  for (const [key, value] of Object.entries(out)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  return out;
}

function validateScoringInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const hiddenStates = ensureFloat32Array(input.hiddenStates, 'hiddenStates');
  const promptFeatures = ensureFloat32Array(input.promptFeatures, 'promptFeatures');
  const promptMask = ensureFloat32Array(input.promptMask, 'promptMask');
  const expectedHidden = shape.layerCount * shape.batch * shape.queryTokens * shape.channels;
  const expectedPrompt = shape.batch * shape.promptTokens * shape.channels;
  if (hiddenStates.length !== expectedHidden) throw new Error(`hiddenStates length ${hiddenStates.length} does not match shape (${expectedHidden})`);
  if (promptFeatures.length !== expectedPrompt) throw new Error(`promptFeatures length ${promptFeatures.length} does not match shape (${expectedPrompt})`);
  if (promptMask.length !== shape.batch * shape.promptTokens) throw new Error('promptMask length mismatch');
  const weights = {
    textMlpLayer1Weight: ensureFloat32Array(input.weights?.textMlpLayer1Weight, 'weights.textMlpLayer1Weight'),
    textMlpLayer1Bias: ensureFloat32Array(input.weights?.textMlpLayer1Bias, 'weights.textMlpLayer1Bias'),
    textMlpLayer2Weight: ensureFloat32Array(input.weights?.textMlpLayer2Weight, 'weights.textMlpLayer2Weight'),
    textMlpLayer2Bias: ensureFloat32Array(input.weights?.textMlpLayer2Bias, 'weights.textMlpLayer2Bias'),
    textMlpOutNormWeight: ensureFloat32Array(input.weights?.textMlpOutNormWeight, 'weights.textMlpOutNormWeight'),
    textMlpOutNormBias: ensureFloat32Array(input.weights?.textMlpOutNormBias, 'weights.textMlpOutNormBias'),
    textProjWeight: ensureFloat32Array(input.weights?.textProjWeight, 'weights.textProjWeight'),
    textProjBias: ensureFloat32Array(input.weights?.textProjBias, 'weights.textProjBias'),
    queryProjWeight: ensureFloat32Array(input.weights?.queryProjWeight, 'weights.queryProjWeight'),
    queryProjBias: ensureFloat32Array(input.weights?.queryProjBias, 'weights.queryProjBias'),
  };
  if (weights.textMlpLayer1Weight.length !== shape.mlpHidden * shape.channels) throw new Error('text MLP layer 1 weight length mismatch');
  if (weights.textMlpLayer1Bias.length !== shape.mlpHidden) throw new Error('text MLP layer 1 bias length mismatch');
  if (weights.textMlpLayer2Weight.length !== shape.channels * shape.mlpHidden) throw new Error('text MLP layer 2 weight length mismatch');
  if (weights.textMlpLayer2Bias.length !== shape.channels) throw new Error('text MLP layer 2 bias length mismatch');
  for (const [name, value] of Object.entries({
    textMlpOutNormWeight: weights.textMlpOutNormWeight,
    textMlpOutNormBias: weights.textMlpOutNormBias,
    textProjBias: weights.textProjBias,
    queryProjBias: weights.queryProjBias,
  })) {
    if (value.length !== shape.channels) throw new Error(`${name} length mismatch`);
  }
  for (const [name, value] of Object.entries({
    textProjWeight: weights.textProjWeight,
    queryProjWeight: weights.queryProjWeight,
  })) {
    if (value.length !== shape.channels * shape.channels) throw new Error(`${name} length mismatch`);
  }
  return { shape, hiddenStates, promptFeatures, promptMask, weights };
}

function linear(input, weight, bias, inputChannels, outputChannels, relu = false) {
  const tokens = input.length / inputChannels;
  const out = new Float32Array(tokens * outputChannels);
  for (let token = 0; token < tokens; token += 1) {
    for (let oc = 0; oc < outputChannels; oc += 1) {
      let sum = bias[oc];
      for (let ic = 0; ic < inputChannels; ic += 1) sum += input[token * inputChannels + ic] * weight[oc * inputChannels + ic];
      out[token * outputChannels + oc] = relu ? Math.max(0, sum) : sum;
    }
  }
  return out;
}

function residualLayerNorm(mlp, residual, weight, bias, shape) {
  const out = new Float32Array(mlp.length);
  const tokens = shape.batch * shape.promptTokens;
  for (let token = 0; token < tokens; token += 1) {
    const base = token * shape.channels;
    let mean = 0;
    for (let c = 0; c < shape.channels; c += 1) mean += mlp[base + c] + residual[base + c];
    mean /= shape.channels;
    let variance = 0;
    for (let c = 0; c < shape.channels; c += 1) {
      const delta = mlp[base + c] + residual[base + c] - mean;
      variance += delta * delta;
    }
    variance /= shape.channels;
    const invStd = 1 / Math.sqrt(variance + 1e-6);
    for (let c = 0; c < shape.channels; c += 1) {
      out[base + c] = (mlp[base + c] + residual[base + c] - mean) * invStd * weight[c] + bias[c];
    }
  }
  return out;
}

function maskedPool(text, mask, shape) {
  const out = new Float32Array(shape.batch * shape.channels);
  for (let b = 0; b < shape.batch; b += 1) {
    let valid = 0;
    for (let t = 0; t < shape.promptTokens; t += 1) valid += mask[b * shape.promptTokens + t] > 0 ? mask[b * shape.promptTokens + t] : 0;
    valid = Math.max(valid, 1);
    for (let c = 0; c < shape.channels; c += 1) {
      let sum = 0;
      for (let t = 0; t < shape.promptTokens; t += 1) {
        const m = mask[b * shape.promptTokens + t];
        if (m > 0) sum += text[(b * shape.promptTokens + t) * shape.channels + c] * m;
      }
      out[b * shape.channels + c] = sum / valid;
    }
  }
  return out;
}

export function createSam3ScoringPhaseProgramCpuOracle(input) {
  const { shape, hiddenStates, promptFeatures, promptMask, weights } = validateScoringInputs(input);
  const mlp1 = linear(promptFeatures, weights.textMlpLayer1Weight, weights.textMlpLayer1Bias, shape.channels, shape.mlpHidden, true);
  const mlp2 = linear(mlp1, weights.textMlpLayer2Weight, weights.textMlpLayer2Bias, shape.mlpHidden, shape.channels, false);
  const textProcessed = residualLayerNorm(mlp2, promptFeatures, weights.textMlpOutNormWeight, weights.textMlpOutNormBias, shape);
  const pooledText = maskedPool(textProcessed, promptMask, shape);
  const projectedText = linear(pooledText, weights.textProjWeight, weights.textProjBias, shape.channels, shape.channels, false);
  const projectedQueries = linear(hiddenStates, weights.queryProjWeight, weights.queryProjBias, shape.channels, shape.channels, false);
  const predLogits = new Float32Array(shape.layerCount * shape.batch * shape.queryTokens);
  const scale = 1 / Math.sqrt(shape.channels);
  for (let layer = 0; layer < shape.layerCount; layer += 1) {
    for (let b = 0; b < shape.batch; b += 1) {
      for (let q = 0; q < shape.queryTokens; q += 1) {
        let sum = 0;
        const queryBase = ((layer * shape.batch + b) * shape.queryTokens + q) * shape.channels;
        const textBase = b * shape.channels;
        for (let c = 0; c < shape.channels; c += 1) sum += projectedQueries[queryBase + c] * projectedText[textBase + c];
        predLogits[(layer * shape.batch + b) * shape.queryTokens + q] = Math.max(-12, Math.min(12, sum * scale));
      }
    }
  }
  return { shape, textProcessed, pooledText, projectedText, projectedQueries, predLogits };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM scoring outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const logitsRequest = roleArtifact(request.outputs, 'pred-logits');
  return {
    predLogits: { artifactId: logitsRequest.artifactId, sha256: hashes.predLogits, shape },
  };
}

export function createSam3ScoringPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-scoring-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-scoring-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ScoringPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-scoring', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ScoringPhaseProgramRoute', upstreamBoundary: 'mlx-reference-scoring-tensors' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3ScoringPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ScoringPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-scoring-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-scoring-weights');
  const projection = validateScoringInputs(input.tensors || {});
  const { shape, hiddenStates, promptFeatures, promptMask, weights } = projection;
  const promptTotal = shape.batch * shape.promptTokens;
  const textMlpHiddenTotal = promptTotal * shape.mlpHidden;
  const promptFeatureTotal = promptTotal * shape.channels;
  const pooledTotal = shape.batch * shape.channels;
  const hiddenTotal = shape.layerCount * shape.batch * shape.queryTokens * shape.channels;
  const scoreTotal = shape.layerCount * shape.batch * shape.queryTokens;
  const scoreShape = [shape.layerCount, shape.batch, shape.queryTokens, 1];

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-scoring-phase-program',
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
  await runtime.runStage('load-scoring-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      hiddenStates: stage.createTensor({ name: 'sam3.scoring.hidden-states', shape: [shape.layerCount, shape.batch, shape.queryTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      promptFeatures: stage.createTensor({ name: 'sam3.scoring.prompt-features', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      promptMask: stage.createTensor({ name: 'sam3.scoring.prompt-mask', shape: [shape.batch, shape.promptTokens], dtype: 'f32', usage: readonlyUsage }),
      textMlp1: stage.createTensor({ name: 'sam3.scoring.text-mlp1', shape: [shape.batch, shape.promptTokens, shape.mlpHidden], dtype: 'f32', usage }),
      textMlp2: stage.createTensor({ name: 'sam3.scoring.text-mlp2', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
      textProcessed: stage.createTensor({ name: 'sam3.scoring.text-processed', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
      pooledText: stage.createTensor({ name: 'sam3.scoring.pooled-text', shape: [shape.batch, shape.channels], dtype: 'f32', usage }),
      projectedText: stage.createTensor({ name: 'sam3.scoring.projected-text', shape: [shape.batch, shape.channels], dtype: 'f32', usage }),
      projectedQueries: stage.createTensor({ name: 'sam3.scoring.projected-queries', shape: [shape.layerCount, shape.batch, shape.queryTokens, shape.channels], dtype: 'f32', usage }),
      predLogits: stage.createTensor({ name: 'sam3.scoring.pred-logits', shape: scoreShape, dtype: 'f32', usage }),
      textMlp1Dims: stage.createUniformBuffer({ label: 'sam3.scoring.text-mlp1-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.mlpHidden, total_output: textMlpHiddenTotal } }),
      textMlp2Dims: stage.createUniformBuffer({ label: 'sam3.scoring.text-mlp2-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.mlpHidden, output_channels: shape.channels, total_output: promptFeatureTotal } }),
      textDims: stage.createUniformBuffer({ label: 'sam3.scoring.text-dims', schema: [{ name: 'batch', type: 'u32' }, { name: 'prompt_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'total_tokens', type: 'u32' }], values: { batch: shape.batch, prompt_tokens: shape.promptTokens, channels: shape.channels, total_tokens: promptTotal } }),
      textProjDims: stage.createUniformBuffer({ label: 'sam3.scoring.text-proj-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.channels, total_output: pooledTotal } }),
      queryProjDims: stage.createUniformBuffer({ label: 'sam3.scoring.query-proj-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.channels, total_output: hiddenTotal } }),
      scoreDims: stage.createUniformBuffer({ label: 'sam3.scoring.score-dims', schema: [{ name: 'layer_count', type: 'u32' }, { name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'total_scores', type: 'u32' }], values: { layer_count: shape.layerCount, batch: shape.batch, query_tokens: shape.queryTokens, channels: shape.channels, total_scores: scoreTotal } }),
      weights: {
        textMlpLayer1Weight: stage.createTensor({ name: 'sam3.scoring.text-mlp.layer1.weight', shape: [shape.mlpHidden, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        textMlpLayer1Bias: stage.createTensor({ name: 'sam3.scoring.text-mlp.layer1.bias', shape: [shape.mlpHidden], dtype: 'f32', usage: readonlyUsage }),
        textMlpLayer2Weight: stage.createTensor({ name: 'sam3.scoring.text-mlp.layer2.weight', shape: [shape.channels, shape.mlpHidden], dtype: 'f32', usage: readonlyUsage }),
        textMlpLayer2Bias: stage.createTensor({ name: 'sam3.scoring.text-mlp.layer2.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        textMlpOutNormWeight: stage.createTensor({ name: 'sam3.scoring.text-mlp-out-norm.weight', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        textMlpOutNormBias: stage.createTensor({ name: 'sam3.scoring.text-mlp-out-norm.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        textProjWeight: stage.createTensor({ name: 'sam3.scoring.text-proj.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        textProjBias: stage.createTensor({ name: 'sam3.scoring.text-proj.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        queryProjWeight: stage.createTensor({ name: 'sam3.scoring.query-proj.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        queryProjBias: stage.createTensor({ name: 'sam3.scoring.query-proj.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
      },
    };
    stage.uploadTensor(tensors.hiddenStates, hiddenStates);
    stage.uploadTensor(tensors.promptFeatures, promptFeatures);
    stage.uploadTensor(tensors.promptMask, promptMask);
    for (const [name, value] of Object.entries(weights)) stage.uploadTensor(tensors.weights[name], value);
    await stage.yieldToBrowser({ reason: 'after-sam3-scoring-upload' });
  }, { shape });

  const program = runtime.defineProgram({
    name: 'sam3.scoring-phase-program',
    tensors: {
      hiddenStates: tensors.hiddenStates,
      promptFeatures: tensors.promptFeatures,
      promptMask: tensors.promptMask,
      textMlp1: tensors.textMlp1,
      textMlp2: tensors.textMlp2,
      textProcessed: tensors.textProcessed,
      pooledText: tensors.pooledText,
      projectedText: tensors.projectedText,
      projectedQueries: tensors.projectedQueries,
      predLogits: tensors.predLogits,
      ...tensors.weights,
    },
    uniforms: { textMlp1Dims: tensors.textMlp1Dims, textMlp2Dims: tensors.textMlp2Dims, textDims: tensors.textDims, textProjDims: tensors.textProjDims, queryProjDims: tensors.queryProjDims, scoreDims: tensors.scoreDims },
    kernels: {
      textMlpFc1Relu: { code: LINEAR_RELU_WGSL, bindings: [{ name: 'input', resource: 'tensor:promptFeatures', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:textMlpLayer1Weight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:textMlpLayer1Bias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:textMlp1', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:textMlp1Dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      textMlpFc2: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:textMlp1', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:textMlpLayer2Weight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:textMlpLayer2Bias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:textMlp2', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:textMlp2Dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      residualLayernorm: { code: RESIDUAL_LAYERNORM_WGSL, bindings: [{ name: 'mlp', resource: 'tensor:textMlp2', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'residual', resource: 'tensor:promptFeatures', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:textMlpOutNormWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:textMlpOutNormBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:textProcessed', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:textDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      maskedPool: { code: MASKED_POOL_WGSL, bindings: [{ name: 'text', resource: 'tensor:textProcessed', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'mask', resource: 'tensor:promptMask', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'pooled', resource: 'tensor:pooledText', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:textDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      textProj: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:pooledText', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:textProjWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:textProjBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:projectedText', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:textProjDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      queryProj: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:hiddenStates', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:queryProjWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:queryProjBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:projectedQueries', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:queryProjDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      dotProduct: { code: DOT_PRODUCT_WGSL, bindings: [{ name: 'queries', resource: 'tensor:projectedQueries', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'text', resource: 'tensor:projectedText', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'predLogits', resource: 'tensor:predLogits', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:scoreDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
    },
    phases: [
      { name: 'scoring-text-mlp-fc1-relu', kernel: 'textMlpFc1Relu', dispatch: [workgroups(textMlpHiddenTotal)], yieldAfter: true },
      { name: 'scoring-text-mlp-fc2', kernel: 'textMlpFc2', dispatch: [workgroups(promptFeatureTotal)], yieldAfter: true },
      { name: 'scoring-text-mlp-residual-layernorm', kernel: 'residualLayernorm', dispatch: [workgroups(promptTotal)], yieldAfter: true },
      { name: 'scoring-mask-pool-text', kernel: 'maskedPool', dispatch: [workgroups(pooledTotal)], yieldAfter: true },
      { name: 'scoring-text-proj', kernel: 'textProj', dispatch: [workgroups(pooledTotal)], yieldAfter: true },
      { name: 'scoring-query-proj', kernel: 'queryProj', dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: 'scoring-dot-product', kernel: 'dotProduct', dispatch: [workgroups(scoreTotal)], yieldAfter: true },
      { name: 'readback-scoring', readbacks: [{ name: 'predLogits', tensor: 'predLogits' }] },
    ],
    metadata: { routeId: SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const predLogits = run.outputs.predLogits;
  const outputs = outputArtifacts(input.request, { predLogits: await sha256Hex(predLogits) }, scoreShape);
  const receipt = createSam3ScoringPhaseProgramRouteReceipt({
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
      predLogits: Array.from(new Float32Array(predLogits)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
