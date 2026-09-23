import { assertAuthoritativeRouteWorkerResult, createRouteWorkerResult, defineWebGpuRoute } from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { createLinearDispatch, WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE } from './runtime-primitives.js';
import { createKernelProfileMetadata, createRouteKernelProfileMetadata } from './kernel-profile.js';
import { createRouteReceiptArtifacts, createRouteReceiptInputArtifact, createWebGpuRouteReceiptFromArtifacts } from './route-receipt-helper.js';
import { createWebGpuRouteBackpressureProfile, createWebGpuRouteSchedulerProfile } from './scheduler-backpressure.js';
import { SAM_VECTOR_LINEAR_GELU_WGSL, SAM_VECTOR_LINEAR_WGSL } from './sam-vector-linear-wgsl.js';

export const TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID = 'trellis2.dinov3.prefix-block0.phase-program.webgpu-local.v0';
export const TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_HANDOFF_PROBE_ROUTE_ID = 'trellis2.dinov3.block0-to-block1-attention.resident-probe.webgpu-local.v0';
export const TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK1_PROBE_ROUTE_ID = 'trellis2.dinov3.block0-to-block1-full-block.resident-probe.webgpu-local.v0';
export const TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK2_NORM1_PROBE_ROUTE_ID = 'trellis2.dinov3.block0-to-block2-norm1.resident-probe.webgpu-local.v0';
export const TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK2_ATTENTION_PROBE_ROUTE_ID = 'trellis2.dinov3.block0-to-block2-attention.resident-probe.webgpu-local.v0';

export function createTrellisDinoV3ResidentProbeTransferMetadata({ residentBlock1Probe = false, residentBlock2Norm1Probe = false, residentBlock2AttentionProbe = false } = {}) {
  return {
    block0ToBlock1Norm1:'same-runtime-device-buffer',block1Norm1ToAttention:'same-runtime-device-buffer',
    ...(residentBlock1Probe ? {
      block1AttentionToNorm2:'same-runtime-device-buffer',norm2ToMlp:'same-runtime-device-buffer',
    } : {}),
    ...(residentBlock2Norm1Probe ? { block1OutputToBlock2Norm1:'same-runtime-device-buffer' } : {}),
    ...(residentBlock2AttentionProbe ? {
      block1OutputToBlock2AttentionResidual:'same-runtime-device-buffer',block2Norm1ToAttention:'same-runtime-device-buffer',
    } : {}),
    block0HostReadback:false,downstreamOutputHostReadback:true,
  };
}

const MODEL_ID = 'facebook/dinov3-vitl16-pretrain-lvd1689m';
const MODEL_REVISION = 'ea8dc2863c51be0a264bab82070e3e8836b02d51';
const MODEL_WEIGHTS_SHA256 = 'sha256:dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179';
const PINNED_BLOCK0_WEIGHT_BUNDLE_SHA256 = 'sha256:e50bfcdd1060e6b4aea34f846dc3146bd18482d2dad48d4ea9be699ce1c406e9';
const DEFAULT_KERNEL_PROFILE = 'trellis2-dinov3-prefix-block0-phase-program-v0';
const PREFIX_TOKENS = 5;
const PATCH_TOKENS = 1024;
const TOKEN_COUNT = PREFIX_TOKENS + PATCH_TOKENS;
const CHANNELS = 1024;
const HEADS = 16;
const HEAD_DIM = 64;
const INTERMEDIATE = 4096;
const PATCH_SIZE = 16;
const IMAGE_SIZE = 512;
const LAYER_NORM_EPSILON = 1e-5;
const INPUT_ROLES = ['source-image', 'trellis-dinov3-normalized-pixels', 'trellis-dinov3-checkpoint-tensors'];
const OUTPUT_ROLES = [
  { key: 'patchEmbeddings', role: 'trellis-dinov3-patch-embeddings', required: true },
  { key: 'prefixHiddenStates', role: 'trellis-dinov3-prefix-hidden-states', required: true },
  { key: 'block0HiddenStates', role: 'trellis-dinov3-block0-hidden-states', required: true },
];
const REQUIRED_STAGES = [
  'load-trellis-dinov3-prefix-block0-tensors',
  'dinov3-prefix-block0-patch-embedding',
  'dinov3-prefix-block0-prefix-assembly',
  'dinov3-prefix-block0-layernorm1',
  'dinov3-prefix-block0-qkv-projection',
  'dinov3-prefix-block0-patch-rope',
  'dinov3-prefix-block0-global-attention',
  'dinov3-prefix-block0-output-residual',
  'dinov3-prefix-block0-layernorm2',
  'dinov3-prefix-block0-gelu-mlp',
  'dinov3-prefix-block0-mlp-residual',
  'readback-trellis-dinov3-prefix-block0-outputs',
];
const RESIDENT_HANDOFF_PROBE_STAGES = [
  ...REQUIRED_STAGES.filter(stage => stage !== 'readback-trellis-dinov3-prefix-block0-outputs'),
  'dinov3-block1-layernorm1-resident',
  'dinov3-block1-qkv-projection-resident',
  'dinov3-block1-patch-rope-resident',
  'dinov3-block1-global-attention-resident',
  'dinov3-block1-output-residual-resident',
  'readback-dinov3-block1-attention-resident-probe',
];
const RESIDENT_BLOCK1_PROBE_STAGES = [
  ...RESIDENT_HANDOFF_PROBE_STAGES.filter(stage => stage !== 'readback-dinov3-block1-attention-resident-probe'),
  'dinov3-block1-layernorm2-resident',
  'dinov3-block1-mlp-up-resident',
  'dinov3-block1-mlp-down-resident',
  'dinov3-block1-mlp-residual-resident',
  'readback-dinov3-block1-full-block-resident-probe',
];
const RESIDENT_BLOCK2_NORM1_PROBE_STAGES = [
  ...RESIDENT_BLOCK1_PROBE_STAGES.filter(stage => stage !== 'readback-dinov3-block1-full-block-resident-probe'),
  'dinov3-block2-layernorm1-resident',
  'readback-dinov3-block2-norm1-resident-probe',
];
const RESIDENT_BLOCK2_ATTENTION_PROBE_STAGES = [
  ...RESIDENT_BLOCK2_NORM1_PROBE_STAGES.filter(stage => stage !== 'readback-dinov3-block2-norm1-resident-probe'),
  'dinov3-block2-qkv-projection-resident',
  'dinov3-block2-patch-rope-resident',
  'dinov3-block2-global-attention-resident',
  'dinov3-block2-output-residual-resident',
  'readback-dinov3-block2-attention-resident-probe',
];

const PATCH_EMBED_WGSL = `
struct PatchDims { image_height:u32, image_width:u32, patch_size:u32, patch_height:u32, patch_width:u32, hidden_size:u32, total_values:u32, _pad0:u32, };
@group(0) @binding(0) var<storage, read> pixels: array<f32>;
@group(0) @binding(1) var<storage, read> projection: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PatchDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let out_channel = index % dims.hidden_size;
  let patch_index = index / dims.hidden_size;
  let patch_y = patch_index / dims.patch_width;
  let patch_x = patch_index % dims.patch_width;
  var sum = bias[out_channel];
  for (var ky=0u; ky<dims.patch_size; ky=ky+1u) {
    for (var kx=0u; kx<dims.patch_size; kx=kx+1u) {
      let pixel_base = ((patch_y*dims.patch_size+ky)*dims.image_width+patch_x*dims.patch_size+kx)*3u;
      let weight_base = ((out_channel*dims.patch_size+ky)*dims.patch_size+kx)*3u;
      for (var channel=0u; channel<3u; channel=channel+1u) {
        sum = sum + pixels[pixel_base+channel] * projection[weight_base+channel];
      }
    }
  }
  output_values[index] = sum;
}`;

const PREFIX_ASSEMBLY_WGSL = `
struct PrefixDims { patch_count:u32, prefix_tokens:u32, channels:u32, total_values:u32, };
@group(0) @binding(0) var<storage, read> patch_values: array<f32>;
@group(0) @binding(1) var<storage, read> class_token: array<f32>;
@group(0) @binding(2) var<storage, read> register_tokens: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PrefixDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let channel = index % dims.channels;
  let token = index / dims.channels;
  if (token == 0u) { output_values[index] = class_token[channel]; }
  else if (token < dims.prefix_tokens) { output_values[index] = register_tokens[(token-1u)*dims.channels+channel]; }
  else { output_values[index] = patch_values[(token-dims.prefix_tokens)*dims.channels+channel]; }
}`;

const LAYERNORM_WGSL = `
struct NormDims { token_count:u32, channels:u32, epsilon:f32, _pad0:u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: NormDims;
var<workgroup> reduction: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) local:vec3<u32>, @builtin(workgroup_id) group:vec3<u32>) {
  let token = group.x;
  let lane = local.x;
  let base = token * dims.channels;
  var partial = 0.0;
  for (var channel=lane; channel<dims.channels; channel=channel+64u) { partial = partial + input_values[base+channel]; }
  reduction[lane] = partial;
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (lane < stride) { reduction[lane] = reduction[lane] + reduction[lane+stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  let mean = reduction[0] / f32(dims.channels);
  var variance_partial = 0.0;
  for (var channel=lane; channel<dims.channels; channel=channel+64u) {
    let delta = input_values[base+channel] - mean;
    variance_partial = variance_partial + delta * delta;
  }
  reduction[lane] = variance_partial;
  workgroupBarrier();
  stride = 32u;
  loop {
    if (lane < stride) { reduction[lane] = reduction[lane] + reduction[lane+stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  let inverse_std = inverseSqrt(reduction[0] / f32(dims.channels) + dims.epsilon);
  for (var channel=lane; channel<dims.channels; channel=channel+64u) {
    output_values[base+channel] = (input_values[base+channel]-mean)*inverse_std*norm_weight[channel]+norm_bias[channel];
  }
}`;

const ROPE_WGSL = `
struct RopeDims { token_count:u32, prefix_tokens:u32, channels:u32, head_dim:u32, patch_count:u32, total_values:u32, _pad0:u32, _pad1:u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> rope_cos: array<f32>;
@group(0) @binding(2) var<storage, read> rope_sin: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: RopeDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let channel = index % dims.channels;
  let token = index / dims.channels;
  if (token < dims.prefix_tokens) { output_values[index] = input_values[index]; return; }
  let patch_index = token - dims.prefix_tokens;
  let dim = channel % dims.head_dim;
  let mate = select(dim - dims.head_dim/2u, dim + dims.head_dim/2u, dim < dims.head_dim/2u);
  let mate_index = index - dim + mate;
  let rotated = select(input_values[mate_index], -input_values[mate_index], dim < dims.head_dim/2u);
  let rope_index = patch_index*dims.head_dim+dim;
  output_values[index] = input_values[index]*rope_cos[rope_index] + rotated*rope_sin[rope_index];
}`;

const ATTENTION_SCORE_WGSL = `
struct AttentionDims { token_count:u32, channels:u32, heads:u32, head_dim:u32, total_scores:u32, _pad0:u32, _pad1:u32, _pad2:u32, };
@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> scores: array<f32>;
@group(0) @binding(3) var<uniform> dims: AttentionDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (index >= dims.total_scores) { return; }
  let token_count = dims.token_count;
  let key = index % token_count;
  let query = (index / token_count) % token_count;
  let head = index / (token_count*token_count);
  let q_base = query*dims.channels+head*dims.head_dim;
  let k_base = key*dims.channels+head*dims.head_dim;
  var score = 0.0;
  for (var dim=0u; dim<dims.head_dim; dim=dim+1u) { score = score + q_values[q_base+dim]*k_values[k_base+dim]; }
  scores[index] = score * inverseSqrt(f32(dims.head_dim));
}`;

const ATTENTION_SOFTMAX_WGSL = `
struct SoftmaxDims { row_count:u32, key_count:u32, total_scores:u32, _pad0:u32, };
@group(0) @binding(0) var<storage, read_write> scores: array<f32>;
@group(0) @binding(1) var<uniform> dims: SoftmaxDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let row = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (row >= dims.row_count) { return; }
  let base = row*dims.key_count;
  var maximum = -3.402823466e+38;
  for (var key=0u; key<dims.key_count; key=key+1u) { maximum = max(maximum, scores[base+key]); }
  var denominator = 0.0;
  for (var key=0u; key<dims.key_count; key=key+1u) { denominator = denominator + exp(scores[base+key]-maximum); }
  for (var key=0u; key<dims.key_count; key=key+1u) { scores[base+key] = exp(scores[base+key]-maximum)/denominator; }
}`;

const ATTENTION_CONTEXT_WGSL = `
struct ContextDims { token_count:u32, channels:u32, heads:u32, head_dim:u32, total_values:u32, _pad0:u32, _pad1:u32, _pad2:u32, };
@group(0) @binding(0) var<storage, read> probabilities: array<f32>;
@group(0) @binding(1) var<storage, read> v_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: ContextDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (index >= dims.total_values) { return; }
  let channel = index%dims.channels;
  let query = index/dims.channels;
  let head = channel/dims.head_dim;
  let row = (head*dims.token_count+query)*dims.token_count;
  var value = 0.0;
  for (var key=0u; key<dims.token_count; key=key+1u) {
    value = value + probabilities[row+key]*v_values[key*dims.channels+channel];
  }
  output_values[index] = value;
}`;

const LAYER_SCALE_RESIDUAL_WGSL = `
struct ResidualDims { total_values:u32, channels:u32, _pad0:u32, _pad1:u32, };
@group(0) @binding(0) var<storage, read> residual: array<f32>;
@group(0) @binding(1) var<storage, read> update_values: array<f32>;
@group(0) @binding(2) var<storage, read> layer_scale: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ResidualDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (index >= dims.total_values) { return; }
  output_values[index] = residual[index]+update_values[index]*layer_scale[index%dims.channels];
}`;

const REQUIRED_WEIGHT_KEYS = [
  'patchProjection', 'patchBias', 'classToken', 'registerTokens', 'ropeCos', 'ropeSin',
  'norm1Weight', 'norm1Bias', 'qWeight', 'qBias', 'kWeight', 'vWeight', 'vBias',
  'oWeight', 'oBias', 'layerScale1', 'norm2Weight', 'norm2Bias',
  'mlpUpWeight', 'mlpUpBias', 'mlpDownWeight', 'mlpDownBias', 'layerScale2',
];

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function normalizeShape(input = {}) {
  const expected = {
    batch: 1, imageHeight: IMAGE_SIZE, imageWidth: IMAGE_SIZE, imageChannels: 3,
    patchSize: PATCH_SIZE, patchHeight: 32, patchWidth: 32, patchTokens: PATCH_TOKENS,
    prefixTokens: PREFIX_TOKENS, tokenCount: TOKEN_COUNT, hiddenSize: CHANNELS,
    heads: HEADS, headDim: HEAD_DIM, intermediateSize: INTERMEDIATE,
    ropeTheta: 100, layerNormEpsilon: LAYER_NORM_EPSILON,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (input[key] !== value) throw new Error(`shape.${key} must equal ${value} for the pinned TRELLIS DINOv3 ViT-L/16 route`);
  }
  return { ...expected, patchValues: PATCH_TOKENS*CHANNELS, sequenceValues: TOKEN_COUNT*CHANNELS, scoreValues: HEADS*TOKEN_COUNT*TOKEN_COUNT, attentionRows: HEADS*TOKEN_COUNT, mlpValues: TOKEN_COUNT*INTERMEDIATE };
}

function ensureF32(value, name, length) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array; fp16 and implicit numeric conversion are not accepted`);
  if (value.length !== length) throw new Error(`${name} length ${value.length} does not match expected ${length}`);
  return value;
}

function validateInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const pixelValues = ensureF32(input.pixelValues, 'pixelValues', shape.imageHeight*shape.imageWidth*shape.imageChannels);
  const sourceImage = input.sourceImage;
  if (!(sourceImage instanceof Uint8Array) || sourceImage.length === 0) throw new Error('sourceImage must be the non-empty original image byte array');
  const weights = input.weights || {};
  const dimensions = {
    patchProjection: CHANNELS*PATCH_SIZE*PATCH_SIZE*3, patchBias: CHANNELS,
    classToken: CHANNELS, registerTokens: 4*CHANNELS, ropeCos: PATCH_TOKENS*HEAD_DIM, ropeSin: PATCH_TOKENS*HEAD_DIM,
    norm1Weight: CHANNELS, norm1Bias: CHANNELS, qWeight: CHANNELS*CHANNELS, qBias: CHANNELS,
    kWeight: CHANNELS*CHANNELS, vWeight: CHANNELS*CHANNELS, vBias: CHANNELS,
    oWeight: CHANNELS*CHANNELS, oBias: CHANNELS, layerScale1: CHANNELS,
    norm2Weight: CHANNELS, norm2Bias: CHANNELS, mlpUpWeight: INTERMEDIATE*CHANNELS, mlpUpBias: INTERMEDIATE,
    mlpDownWeight: CHANNELS*INTERMEDIATE, mlpDownBias: CHANNELS, layerScale2: CHANNELS,
  };
  const checkedWeights = {};
  for (const key of REQUIRED_WEIGHT_KEYS) checkedWeights[key] = ensureF32(weights[key], `weights.${key}`, dimensions[key]);
  for (let index=0; index<pixelValues.length; index+=1) if (!Number.isFinite(pixelValues[index])) throw new Error(`pixelValues[${index}] is not finite`);
  for (const [key, values] of Object.entries(checkedWeights)) for (let index=0; index<values.length; index+=1) if (!Number.isFinite(values[index])) throw new Error(`weights.${key}[${index}] is not finite`);
  return { shape, pixelValues, sourceImage, weights: checkedWeights };
}

function defaultScheduler() {
  const chunks = Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.startsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage.startsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.startsWith('readback') })),
      notes: 'Checkpointed DINOv3 F32 prefix and block 0 yields after patch projection, prefix assembly, normalization, attention, residuals, and GELU MLP; no reduced-precision fallback is admitted.',
    },
  });
}

function defaultBackpressure() {
  return createWebGpuRouteBackpressureProfile({ requestedBudget: 'visible-wait', effectiveBudget: 'visible-wait', memoryExclusivity: 'shared', warmCacheState: 'unknown' });
}

export function createTrellisDinoV3PrefixBlockDispatchPlan(input = {}) {
  const shape = normalizeShape(input.shape);
  const max = input.maxWorkgroupsPerDimension ?? 65_535;
  const linear = total => createLinearDispatch(total, { workgroupSize: 64, maxWorkgroupsPerDimension: max });
  return {
    patchEmbedding: linear(shape.patchValues), prefixAssembly: linear(shape.sequenceValues), layerNorm1: [shape.tokenCount],
    qkvProjection: linear(shape.sequenceValues), patchRope: linear(shape.sequenceValues),
    attentionScore: linear(shape.scoreValues), attentionSoftmax: linear(shape.attentionRows), attentionContext: linear(shape.sequenceValues),
    outputProjection: linear(shape.sequenceValues), attentionResidual: linear(shape.sequenceValues), layerNorm2: [shape.tokenCount],
    mlpUp: linear(shape.mlpValues), mlpDown: linear(shape.sequenceValues), mlpResidual: linear(shape.sequenceValues),
  };
}

export function createTrellisDinoV3PrefixCpuOracle(input = {}) {
  const hiddenSize = input.hiddenSize;
  const patchCount = input.patchCount;
  const registerCount = input.registerCount ?? 4;
  const batch = input.batch ?? 1;
  if (![hiddenSize, patchCount, registerCount, batch].every(value => Number.isInteger(value) && value > 0)) throw new Error('prefix dimensions must be positive integers');
  const patchEmbeddings = ensureF32(input.patchEmbeddings, 'patchEmbeddings', batch*patchCount*hiddenSize);
  const classToken = ensureF32(input.classToken, 'classToken', hiddenSize);
  const registerTokens = ensureF32(input.registerTokens, 'registerTokens', registerCount*hiddenSize);
  const output = new Float32Array(batch*(1+registerCount+patchCount)*hiddenSize);
  const tokens = 1+registerCount+patchCount;
  for (let b=0; b<batch; b+=1) {
    const outputBase = b*tokens*hiddenSize;
    output.set(classToken, outputBase);
    output.set(registerTokens, outputBase+hiddenSize);
    output.set(patchEmbeddings.subarray(b*patchCount*hiddenSize, (b+1)*patchCount*hiddenSize), outputBase+(1+registerCount)*hiddenSize);
  }
  return output;
}

export function createTrellisDinoV3PrefixBlockPhaseProgramRouteDefinition(input = {}) {
  const metadata = createRouteKernelProfileMetadata(input, { defaultProfile: DEFAULT_KERNEL_PROFILE, requiredStages: REQUIRED_STAGES, timingSource: 'queue-submit-wait' });
  return defineWebGpuRoute({
    routeId: TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: input.model?.id || MODEL_ID, revision: input.model?.revision || MODEL_REVISION, dtype: input.model?.dtype || 'fp32' },
    kernel: metadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [], requiredStages: metadata.requiredStages, timingSource: metadata.timingSource,
    scheduler: input.scheduler || defaultScheduler(), backpressure: input.backpressure || defaultBackpressure(),
    worker: input.worker || { exportName: 'runTrellisDinoV3PrefixBlockPhaseProgramRoute', upstreamBoundary: 'pinned-dinov3-normalized-image-to-prefix-and-complete-block0-hidden-states' },
  });
}

export function createTrellisDinoV3PrefixBlockPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real', fallbackReason: null, backend: input.backend,
    model: { id: input.model?.id || MODEL_ID, revision: input.model?.revision || MODEL_REVISION, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('trellis-dinov3-normalized-pixels', input.pixelValues),
      createRouteReceiptInputArtifact('trellis-dinov3-checkpoint-tensors', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }), profile: input.profile,
  });
}

function outputArtifacts(request, hashes, shape) {
  return {
    patchEmbeddings: { artifactId: roleArtifact(request.outputs, 'trellis-dinov3-patch-embeddings').artifactId, sha256: hashes.patchEmbeddings, shape: [1, PATCH_TOKENS, CHANNELS] },
    prefixHiddenStates: { artifactId: roleArtifact(request.outputs, 'trellis-dinov3-prefix-hidden-states').artifactId, sha256: hashes.prefixHiddenStates, shape: [1, shape.tokenCount, shape.hiddenSize] },
    block0HiddenStates: { artifactId: roleArtifact(request.outputs, 'trellis-dinov3-block0-hidden-states').artifactId, sha256: hashes.block0HiddenStates, shape: [1, shape.tokenCount, shape.hiddenSize] },
  };
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash DINOv3 prefix/block-0 outputs');
  const bytes = value instanceof ArrayBuffer ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function computeTrellisDinoV3PrefixBlockWeightBundleSha256(weights) {
  const entries = [];
  for (const key of REQUIRED_WEIGHT_KEYS) {
    const value = weights?.[key];
    if (!(value instanceof Float32Array)) throw new Error(`weights.${key} must be a Float32Array for checkpoint tensor custody`);
    entries.push([key, await sha256Hex(value)]);
  }
  return sha256Hex(new TextEncoder().encode(JSON.stringify(entries)));
}

// Copy before the first await. The caller retains its own mutable views, so the
// digest and every later upload must consume these same private bytes.
export function snapshotTrellisDinoV3PrefixBlockInputs({ sourceImage, pixelValues, weights }) {
  return {
    sourceImage: new Uint8Array(sourceImage),
    pixelValues: new Float32Array(pixelValues),
    weights: Object.fromEntries(REQUIRED_WEIGHT_KEYS.map(key => [key, new Float32Array(weights[key])])),
  };
}

// Caller callbacks can run after every phase. Bind the receipt and returned
// request to the claims inspected before any asynchronous execution begins.
export function snapshotTrellisDinoV3PrefixBlockClaims({ request, model, kernel, route, backendIdentity }) {
  return {
    request: structuredClone(request),
    model: model == null ? model : structuredClone(model),
    kernel: kernel == null ? kernel : structuredClone(kernel),
    route: route == null ? route : structuredClone(route),
    backendIdentity: backendIdentity == null ? backendIdentity : structuredClone(backendIdentity),
  };
}

export async function runTrellisDinoV3LayerNormResident(input = {}) {
  const layerIndex = input.layerIndex ?? 1;
  const { runtime, inputTensor, weight, bias, schedulerInvocation } = input;
  if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= 24) {
    throw new Error('resident LayerNorm layerIndex must be an integer from 0 through 23');
  }
  const layerName = `block${layerIndex}`;
  const operationName = `dinov3-${layerName}-layernorm1`;
  const tensorPrefix = `trellis.dinov3.${layerName}.norm1`;
  if (!runtime || !['createTensor', 'uploadTensor', 'createUniformBuffer', 'defineComputeKernel', 'runKernel'].every(name => typeof runtime[name] === 'function')) {
    throw new Error('resident LayerNorm requires the live WebGPU inference runtime');
  }
  if (!inputTensor?.buffer || inputTensor.dtype !== 'f32' || JSON.stringify(inputTensor.shape) !== JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
    throw new Error(`resident LayerNorm input must be the live F32 ${layerName === 'block1' ? 'block-0' : 'upstream'} tensor with shape [1,1029,1024]`);
  }
  if (!Number.isInteger(inputTensor.usage) || (inputTensor.usage & WEBGPU_BUFFER_USAGE.storage) === 0) {
    throw new Error('resident LayerNorm input must expose storage usage');
  }
  const weightValues = new Float32Array(ensureF32(weight, `${layerName}Norm1Weight`, CHANNELS));
  const biasValues = new Float32Array(ensureF32(bias, `${layerName}Norm1Bias`, CHANNELS));
  for (let index=0; index<CHANNELS; index+=1) {
    if (!Number.isFinite(weightValues[index])) throw new Error(`${layerName}Norm1Weight[${index}] is not finite`);
    if (!Number.isFinite(biasValues[index])) throw new Error(`${layerName}Norm1Bias[${index}] is not finite`);
  }
  const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  const outputUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc;
  const normWeight = runtime.createTensor({ name:`${tensorPrefix}.weight`, shape:[CHANNELS], dtype:'f32', usage:readonly });
  const normBias = runtime.createTensor({ name:`${tensorPrefix}.bias`, shape:[CHANNELS], dtype:'f32', usage:readonly });
  const output = runtime.createTensor({ name:`${tensorPrefix}.output`, shape:[1,TOKEN_COUNT,CHANNELS], dtype:'f32', usage:outputUsage });
  runtime.uploadTensor(normWeight, weightValues);
  runtime.uploadTensor(normBias, biasValues);
  const dims = runtime.createUniformBuffer({
    label:`${tensorPrefix}.resident-dims`,
    schema:[{name:'token_count',type:'u32'},{name:'channels',type:'u32'},{name:'epsilon',type:'f32'},{name:'_pad0',type:'u32'}],
    values:{ token_count:TOKEN_COUNT, channels:CHANNELS, epsilon:LAYER_NORM_EPSILON, _pad0:0 },
  });
  const kernel = runtime.defineComputeKernel({
    name:`${tensorPrefix}.resident`, code:LAYERNORM_WGSL, entryPoint:'main',
    bindings:[
      {name:'input_values',resource:inputTensor,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
      {name:'norm_weight',resource:normWeight,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
      {name:'norm_bias',resource:normBias,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
      {name:'output_values',resource:output,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'},
      {name:'dims',resource:dims,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'},
    ],
  });
  await runtime.runKernel(kernel, {
    stage:`${operationName}-resident`, dispatch:[TOKEN_COUNT], schedulerInvocation,
    metadata:{ operation:'layernorm', sourceTensor:inputTensor.name, outputTensor:output.name, dtype:'f32', shape:[1,TOKEN_COUNT,CHANNELS] },
  });
  return { operation:operationName, inputTensor, tensor:output, dtype:'f32', shape:[1,TOKEN_COUNT,CHANNELS] };
}

export async function runTrellisDinoV3Block1LayerNormResident(input = {}) {
  return runTrellisDinoV3LayerNormResident({ ...input, layerIndex:1 });
}

export async function runTrellisDinoV3Block2LayerNorm1Resident(input = {}) {
  return runTrellisDinoV3LayerNormResident({ ...input, layerIndex:2 });
}

async function runTrellisDinoV3AttentionResident(input = {}, layerIndex) {
  const layerName=`block${layerIndex}`;
  const residualLayerName=`block${layerIndex-1}`;
  const { runtime, inputTensor, residualTensor, schedulerInvocation } = input;
  if (!runtime || !['createTensor', 'uploadTensor', 'createUniformBuffer', 'defineComputeKernel', 'runKernel'].every(name => typeof runtime[name] === 'function')) {
    throw new Error('resident attention requires the live WebGPU inference runtime');
  }
  for (const [label, tensor] of [[`${layerName} LayerNorm`,inputTensor],[`${residualLayerName} residual`,residualTensor]]) {
    if (!tensor?.buffer || tensor.dtype !== 'f32' || JSON.stringify(tensor.shape) !== JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
      throw new Error(`${label} must be a live F32 tensor with shape [1,1029,1024]`);
    }
    if (!Number.isInteger(tensor.usage) || (tensor.usage & WEBGPU_BUFFER_USAGE.storage) === 0) {
      throw new Error(`${label} must expose storage usage`);
    }
  }
  const weightShapes = {
    qWeight:CHANNELS*CHANNELS,qBias:CHANNELS,kWeight:CHANNELS*CHANNELS,
    vWeight:CHANNELS*CHANNELS,vBias:CHANNELS,oWeight:CHANNELS*CHANNELS,
    oBias:CHANNELS,layerScale1:CHANNELS,ropeCos:PATCH_TOKENS*HEAD_DIM,ropeSin:PATCH_TOKENS*HEAD_DIM,
  };
  const weightValues={};
  for (const [name,length] of Object.entries(weightShapes)) {
    weightValues[name]=new Float32Array(ensureF32(input[name],`${layerName}${name[0].toUpperCase()}${name.slice(1)}`,length));
    for (let index=0;index<weightValues[name].length;index+=1) {
      if (!Number.isFinite(weightValues[name][index])) throw new Error(`${layerName} ${name}[${index}] is not finite`);
    }
  }
  const noKeyBias=new Float32Array(CHANNELS);
  const readonly=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copyDst;
  const scratch=WEBGPU_BUFFER_USAGE.storage;
  const outputUsage=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copySrc;
  const tensor=(name,shape,usage=scratch)=>runtime.createTensor({name:`trellis.dinov3.${layerName}.${name}`,shape,dtype:'f32',usage});
  const tensors={
    qWeight:tensor('attention.q.weight',[CHANNELS,CHANNELS],readonly),qBias:tensor('attention.q.bias',[CHANNELS],readonly),
    kWeight:tensor('attention.k.weight',[CHANNELS,CHANNELS],readonly),kBias:tensor('attention.k.bias.architecture-zero',[CHANNELS],readonly),
    vWeight:tensor('attention.v.weight',[CHANNELS,CHANNELS],readonly),vBias:tensor('attention.v.bias',[CHANNELS],readonly),
    oWeight:tensor('attention.o.weight',[CHANNELS,CHANNELS],readonly),oBias:tensor('attention.o.bias',[CHANNELS],readonly),
    layerScale1:tensor('attention.layer-scale1',[CHANNELS],readonly),
    ropeCos:tensor('rope.cos',[PATCH_TOKENS,HEAD_DIM],readonly),ropeSin:tensor('rope.sin',[PATCH_TOKENS,HEAD_DIM],readonly),
    q:tensor('attention.q',[1,TOKEN_COUNT,CHANNELS]),k:tensor('attention.k',[1,TOKEN_COUNT,CHANNELS]),v:tensor('attention.v',[1,TOKEN_COUNT,CHANNELS]),
    qRope:tensor('attention.q-rope',[1,TOKEN_COUNT,CHANNELS]),kRope:tensor('attention.k-rope',[1,TOKEN_COUNT,CHANNELS]),
    scores:tensor('attention.scores-f32',[HEADS,TOKEN_COUNT,TOKEN_COUNT]),
    context:tensor('attention.context',[1,TOKEN_COUNT,CHANNELS]),projected:tensor('attention.projection',[1,TOKEN_COUNT,CHANNELS]),
    afterAttention:tensor('attention.residual-output',[1,TOKEN_COUNT,CHANNELS],outputUsage),
  };
  for (const [name,value] of Object.entries({ ...weightValues,kBias:noKeyBias })) runtime.uploadTensor(tensors[name],value);
  const linearDims=runtime.createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.linear-dims`,
    schema:['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})),
    values:{input_channels:CHANNELS,output_channels:CHANNELS,total_output:TOKEN_COUNT*CHANNELS,_pad0:0},
  });
  const ropeDims=runtime.createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.rope-dims`,
    schema:['token_count','prefix_tokens','channels','head_dim','patch_count','total_values','_pad0','_pad1'].map(name=>({name,type:'u32'})),
    values:{token_count:TOKEN_COUNT,prefix_tokens:PREFIX_TOKENS,channels:CHANNELS,head_dim:HEAD_DIM,patch_count:PATCH_TOKENS,total_values:TOKEN_COUNT*CHANNELS,_pad0:0,_pad1:0},
  });
  const attentionDims=runtime.createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.score-dims`,
    schema:['token_count','channels','heads','head_dim','total_scores','_pad0','_pad1','_pad2'].map(name=>({name,type:'u32'})),
    values:{token_count:TOKEN_COUNT,channels:CHANNELS,heads:HEADS,head_dim:HEAD_DIM,total_scores:HEADS*TOKEN_COUNT*TOKEN_COUNT,_pad0:0,_pad1:0,_pad2:0},
  });
  const softmaxDims=runtime.createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.softmax-dims`,
    schema:['row_count','key_count','total_scores','_pad0'].map(name=>({name,type:'u32'})),
    values:{row_count:HEADS*TOKEN_COUNT,key_count:TOKEN_COUNT,total_scores:HEADS*TOKEN_COUNT*TOKEN_COUNT,_pad0:0},
  });
  const contextDims=runtime.createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.context-dims`,
    schema:['token_count','channels','heads','head_dim','total_values','_pad0','_pad1','_pad2'].map(name=>({name,type:'u32'})),
    values:{token_count:TOKEN_COUNT,channels:CHANNELS,heads:HEADS,head_dim:HEAD_DIM,total_values:TOKEN_COUNT*CHANNELS,_pad0:0,_pad1:0,_pad2:0},
  });
  const residualDims=runtime.createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.residual-dims`,
    schema:['total_values','channels','_pad0','_pad1'].map(name=>({name,type:'u32'})),
    values:{total_values:TOKEN_COUNT*CHANNELS,channels:CHANNELS,_pad0:0,_pad1:0},
  });
  const read=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'});
  const write=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'});
  const uniform=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'});
  const linear=(name,source,weight,bias,output)=>runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.${name}`,code:SAM_VECTOR_LINEAR_WGSL,entryPoint:'main',
    bindings:[read('input_values',source),read('weight',weight),read('bias',bias),write('output_values',output),uniform('dims',linearDims)],
  });
  const rope=(name,source,output)=>runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.${name}`,code:ROPE_WGSL,entryPoint:'main',
    bindings:[read('input_values',source),read('rope_cos',tensors.ropeCos),read('rope_sin',tensors.ropeSin),write('output_values',output),uniform('dims',ropeDims)],
  });
  const qProjection=linear('attention.q-projection',inputTensor,tensors.qWeight,tensors.qBias,tensors.q);
  const kProjection=linear('attention.k-projection',inputTensor,tensors.kWeight,tensors.kBias,tensors.k);
  const vProjection=linear('attention.v-projection',inputTensor,tensors.vWeight,tensors.vBias,tensors.v);
  const qRope=rope('attention.q-rope',tensors.q,tensors.qRope);
  const kRope=rope('attention.k-rope',tensors.k,tensors.kRope);
  const scoreKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.score`,code:ATTENTION_SCORE_WGSL,entryPoint:'main',
    bindings:[read('q_values',tensors.qRope),read('k_values',tensors.kRope),write('scores',tensors.scores),uniform('dims',attentionDims)],
  });
  const softmaxKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.softmax`,code:ATTENTION_SOFTMAX_WGSL,entryPoint:'main',
    bindings:[{...read('scores',tensors.scores),access:'storage'},uniform('dims',softmaxDims)],
  });
  const contextKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.context`,code:ATTENTION_CONTEXT_WGSL,entryPoint:'main',
    bindings:[read('probabilities',tensors.scores),read('v_values',tensors.v),write('output_values',tensors.context),uniform('dims',contextDims)],
  });
  const outputProjection=linear('attention.o-projection',tensors.context,tensors.oWeight,tensors.oBias,tensors.projected);
  const residualKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.layer-scale-residual`,code:LAYER_SCALE_RESIDUAL_WGSL,entryPoint:'main',
    bindings:[read('residual',residualTensor),read('update_values',tensors.projected),read('layer_scale',tensors.layerScale1),write('output_values',tensors.afterAttention),uniform('dims',residualDims)],
  });
  const maxWorkgroupsPerDimension=input.device?.limits?.maxComputeWorkgroupsPerDimension;
  const linearDispatch=total=>createLinearDispatch(total,{workgroupSize:64,maxWorkgroupsPerDimension});
  const dispatch={
    qkvProjection:linearDispatch(TOKEN_COUNT*CHANNELS),patchRope:linearDispatch(TOKEN_COUNT*CHANNELS),
    attentionScore:linearDispatch(HEADS*TOKEN_COUNT*TOKEN_COUNT),attentionSoftmax:linearDispatch(HEADS*TOKEN_COUNT),
    attentionContext:linearDispatch(TOKEN_COUNT*CHANNELS),outputProjection:linearDispatch(TOKEN_COUNT*CHANNELS),
    attentionResidual:linearDispatch(TOKEN_COUNT*CHANNELS),
  };
  const invoke=async (kernel,stage,plan)=>runtime.runKernel(kernel,{stage,dispatch:plan,schedulerInvocation,yieldAfter:true,metadata:{operation:`dinov3-${layerName}-attention`,inputTensor:inputTensor.name,residualTensor:residualTensor.name,outputTensor:tensors.afterAttention.name,dtype:'f32'}});
  await invoke(qProjection,`dinov3-${layerName}-qkv-projection-resident`,dispatch.qkvProjection);
  await invoke(kProjection,`dinov3-${layerName}-qkv-projection-resident`,dispatch.qkvProjection);
  await invoke(vProjection,`dinov3-${layerName}-qkv-projection-resident`,dispatch.qkvProjection);
  await invoke(qRope,`dinov3-${layerName}-patch-rope-resident`,dispatch.patchRope);
  await invoke(kRope,`dinov3-${layerName}-patch-rope-resident`,dispatch.patchRope);
  await invoke(scoreKernel,`dinov3-${layerName}-global-attention-resident`,dispatch.attentionScore);
  await invoke(softmaxKernel,`dinov3-${layerName}-global-attention-resident`,dispatch.attentionSoftmax);
  await invoke(contextKernel,`dinov3-${layerName}-global-attention-resident`,dispatch.attentionContext);
  await invoke(outputProjection,`dinov3-${layerName}-output-residual-resident`,dispatch.outputProjection);
  await invoke(residualKernel,`dinov3-${layerName}-output-residual-resident`,dispatch.attentionResidual);
  return {operation:`dinov3-${layerName}-attention-residual`,inputTensor, residualTensor, tensor:tensors.afterAttention, dtype:'f32', shape:[1,TOKEN_COUNT,CHANNELS]};
}

export async function runTrellisDinoV3Block1AttentionResident(input = {}) {
  return runTrellisDinoV3AttentionResident(input,1);
}

export async function runTrellisDinoV3Block2AttentionResident(input = {}) {
  return runTrellisDinoV3AttentionResident(input,2);
}

export async function runTrellisDinoV3Block1MlpResident(input = {}) {
  const { runtime, inputTensor, residualTensor, schedulerInvocation } = input;
  if (!runtime || !['createTensor', 'uploadTensor', 'createUniformBuffer', 'defineComputeKernel', 'runKernel'].every(name => typeof runtime[name] === 'function')) {
    throw new Error('resident MLP requires the live WebGPU inference runtime');
  }
  for (const [label, tensor] of [['block1 attention residual',inputTensor],['block1 MLP residual',residualTensor]]) {
    if (!tensor?.buffer || tensor.dtype !== 'f32' || JSON.stringify(tensor.shape) !== JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
      throw new Error(`${label} must be a live F32 tensor with shape [1,1029,1024]`);
    }
    if (!Number.isInteger(tensor.usage) || (tensor.usage & WEBGPU_BUFFER_USAGE.storage) === 0) {
      throw new Error(`${label} must expose storage usage`);
    }
  }
  const weightShapes = {
    norm2Weight:CHANNELS,norm2Bias:CHANNELS,
    mlpUpWeight:INTERMEDIATE*CHANNELS,mlpUpBias:INTERMEDIATE,
    mlpDownWeight:CHANNELS*INTERMEDIATE,mlpDownBias:CHANNELS,layerScale2:CHANNELS,
  };
  const weightValues={};
  for (const [name,length] of Object.entries(weightShapes)) {
    weightValues[name]=new Float32Array(ensureF32(input[name],`block1${name[0].toUpperCase()}${name.slice(1)}`,length));
    for (let index=0;index<weightValues[name].length;index+=1) {
      if (!Number.isFinite(weightValues[name][index])) throw new Error(`block1 ${name}[${index}] is not finite`);
    }
  }
  const readonly=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copyDst;
  const outputUsage=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copySrc;
  const tensor=(name,shape,usage=outputUsage)=>runtime.createTensor({name:`trellis.dinov3.block1.${name}`,shape,dtype:'f32',usage});
  const tensors={
    norm2Weight:tensor('norm2.weight',[CHANNELS],readonly),norm2Bias:tensor('norm2.bias',[CHANNELS],readonly),
    norm2:tensor('norm2.output',[1,TOKEN_COUNT,CHANNELS]),
    mlpUpWeight:tensor('mlp.up.weight',[INTERMEDIATE,CHANNELS],readonly),mlpUpBias:tensor('mlp.up.bias',[INTERMEDIATE],readonly),
    mlpHidden:tensor('mlp.gelu-output',[1,TOKEN_COUNT,INTERMEDIATE]),
    mlpDownWeight:tensor('mlp.down.weight',[CHANNELS,INTERMEDIATE],readonly),mlpDownBias:tensor('mlp.down.bias',[CHANNELS],readonly),
    mlpProjection:tensor('mlp.projection',[1,TOKEN_COUNT,CHANNELS]),layerScale2:tensor('mlp.layer-scale2',[CHANNELS],readonly),
    afterMlp:tensor('mlp.residual-output',[1,TOKEN_COUNT,CHANNELS]),
  };
  for (const [name,value] of Object.entries(weightValues)) runtime.uploadTensor(tensors[name],value);
  const normDims=runtime.createUniformBuffer({
    label:'trellis.dinov3.block1.norm2.resident-dims',
    schema:[{name:'token_count',type:'u32'},{name:'channels',type:'u32'},{name:'epsilon',type:'f32'},{name:'_pad0',type:'u32'}],
    values:{token_count:TOKEN_COUNT,channels:CHANNELS,epsilon:LAYER_NORM_EPSILON,_pad0:0},
  });
  const linearDims=(label,inputChannels,outputChannels,totalOutput)=>runtime.createUniformBuffer({
    label, schema:['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})),
    values:{input_channels:inputChannels,output_channels:outputChannels,total_output:totalOutput,_pad0:0},
  });
  const upDims=linearDims('trellis.dinov3.block1.mlp-up.resident-dims',CHANNELS,INTERMEDIATE,TOKEN_COUNT*INTERMEDIATE);
  const downDims=linearDims('trellis.dinov3.block1.mlp-down.resident-dims',INTERMEDIATE,CHANNELS,TOKEN_COUNT*CHANNELS);
  const residualDims=runtime.createUniformBuffer({
    label:'trellis.dinov3.block1.mlp-residual.resident-dims',
    schema:['total_values','channels','_pad0','_pad1'].map(name=>({name,type:'u32'})),
    values:{total_values:TOKEN_COUNT*CHANNELS,channels:CHANNELS,_pad0:0,_pad1:0},
  });
  const read=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'});
  const write=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'});
  const uniform=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'});
  const norm2=runtime.defineComputeKernel({
    name:'trellis.dinov3.block1.norm2',code:LAYERNORM_WGSL,entryPoint:'main',
    bindings:[read('input_values',inputTensor),read('norm_weight',tensors.norm2Weight),read('norm_bias',tensors.norm2Bias),write('output_values',tensors.norm2),uniform('dims',normDims)],
  });
  const mlpUp=runtime.defineComputeKernel({
    name:'trellis.dinov3.block1.mlp-up',code:SAM_VECTOR_LINEAR_GELU_WGSL,entryPoint:'main',
    bindings:[read('input_values',tensors.norm2),read('weight',tensors.mlpUpWeight),read('bias',tensors.mlpUpBias),write('output_values',tensors.mlpHidden),uniform('dims',upDims)],
  });
  const mlpDown=runtime.defineComputeKernel({
    name:'trellis.dinov3.block1.mlp-down',code:SAM_VECTOR_LINEAR_WGSL,entryPoint:'main',
    bindings:[read('input_values',tensors.mlpHidden),read('weight',tensors.mlpDownWeight),read('bias',tensors.mlpDownBias),write('output_values',tensors.mlpProjection),uniform('dims',downDims)],
  });
  const residual=runtime.defineComputeKernel({
    name:'trellis.dinov3.block1.mlp.layer-scale-residual',code:LAYER_SCALE_RESIDUAL_WGSL,entryPoint:'main',
    bindings:[read('residual',residualTensor),read('update_values',tensors.mlpProjection),read('layer_scale',tensors.layerScale2),write('output_values',tensors.afterMlp),uniform('dims',residualDims)],
  });
  const maxWorkgroupsPerDimension=input.device?.limits?.maxComputeWorkgroupsPerDimension;
  const dispatch=total=>createLinearDispatch(total,{workgroupSize:64,maxWorkgroupsPerDimension});
  let phaseIndex=0;
  let lastCompletedPhase=null;
  const invoke=async (kernel,stage,workgroups,operation)=>{
    await input.onPhase?.({phase:stage,phaseIndex,lastCompletedPhase});
    await runtime.runKernel(kernel,{
      stage,dispatch:workgroups,schedulerInvocation,yieldAfter:true,
      metadata:{operation,inputTensor:inputTensor.name,residualTensor:residualTensor.name,outputTensor:tensors.afterMlp.name,dtype:'f32'},
    });
    lastCompletedPhase=stage;
    phaseIndex+=1;
  };
  await invoke(norm2,'dinov3-block1-layernorm2-resident',[TOKEN_COUNT],'layernorm');
  await invoke(mlpUp,'dinov3-block1-mlp-up-resident',dispatch(TOKEN_COUNT*INTERMEDIATE),'linear-gelu');
  await invoke(mlpDown,'dinov3-block1-mlp-down-resident',dispatch(TOKEN_COUNT*CHANNELS),'linear');
  await invoke(residual,'dinov3-block1-mlp-residual-resident',dispatch(TOKEN_COUNT*CHANNELS),'layer-scale-residual');
  return {
    operation:'dinov3-block1-mlp-residual',inputTensor,residualTensor,norm2Tensor:tensors.norm2,
    mlpHiddenTensor:tensors.mlpHidden,mlpProjectionTensor:tensors.mlpProjection,tensor:tensors.afterMlp,
    dtype:'f32',shape:[1,TOKEN_COUNT,CHANNELS],
  };
}

export function assertTrellisDinoV3ResidentMlpHandoffIdentity({ residentMlp, attentionResidual } = {}) {
  if (!residentMlp || residentMlp.inputTensor !== attentionResidual || residentMlp.residualTensor !== attentionResidual) {
    throw new Error('resident MLP must consume the exact live block-1 attention residual as both norm2 input and residual');
  }
  return true;
}

export function assertTrellisDinoV3ResidentBlock2Norm1HandoffIdentity({ residentNorm1, block1Output } = {}) {
  if (!residentNorm1 || residentNorm1.inputTensor !== block1Output) {
    throw new Error('block-2 norm1 must consume the exact live completed block-1 output tensor');
  }
  return true;
}

export function assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity({ residentAttention, residentNorm1, block1Output } = {}) {
  if (!residentAttention || residentAttention.inputTensor !== residentNorm1?.tensor) {
    throw new Error('block-2 attention must consume the exact live block-2 norm1 output tensor');
  }
  if (residentAttention.residualTensor !== block1Output) {
    throw new Error('block-2 attention residual must retain the exact live completed block-1 output tensor');
  }
  return true;
}

export function assertTrellisDinoV3ResidentAttentionHandoffIdentity({ residentHandoff, block0HiddenStates, block1Norm1HiddenStates } = {}) {
  if (!residentHandoff || residentHandoff.inputTensor !== block1Norm1HiddenStates) {
    throw new Error('resident attention must consume the exact live block-1 norm1 output');
  }
  if (residentHandoff.residualTensor !== block0HiddenStates) {
    throw new Error('resident attention must retain the exact live block-0 residual');
  }
  return true;
}

async function runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal(input = {}, { residentHandoffProbe = false, residentBlock1Probe = false, residentBlock2Norm1Probe = false, residentBlock2AttentionProbe = false } = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  if (input.residentTensorResolver != null) throw new Error('residentTensorResolver is not admitted for pinned input custody without GPU-buffer content attestation');
  if (residentHandoffProbe && input.includeReadback === true) throw new Error('resident handoff probe cannot request block-0 host readback');
  if (residentBlock2Norm1Probe && !residentBlock1Probe) throw new Error('block-2 norm1 probe requires the complete resident block-1 output');
  if (residentBlock2AttentionProbe && !residentBlock2Norm1Probe) throw new Error('block-2 attention probe requires resident block-2 norm1');
  const claims = snapshotTrellisDinoV3PrefixBlockClaims(input);
  const { request, model, kernel, backendIdentity } = claims;
  const route = claims.route || createTrellisDinoV3PrefixBlockPhaseProgramRouteDefinition({ kernel });
  const sourceImageArtifact = roleArtifact(request.inputs, 'source-image');
  const pixelValuesArtifact = roleArtifact(request.inputs, 'trellis-dinov3-normalized-pixels');
  const checkpointArtifact = roleArtifact(request.inputs, 'trellis-dinov3-checkpoint-tensors');
  const validated = validateInputs(input.tensors || {});
  const { shape } = validated;
  const { pixelValues, sourceImage, weights } = snapshotTrellisDinoV3PrefixBlockInputs(validated);
  const residentWeights = residentHandoffProbe ? {
    norm1Weight: new Float32Array(ensureF32(input.block1Norm1Weight, 'block1Norm1Weight', CHANNELS)),
    norm1Bias: new Float32Array(ensureF32(input.block1Norm1Bias, 'block1Norm1Bias', CHANNELS)),
    qWeight: new Float32Array(ensureF32(input.block1QWeight, 'block1QWeight', CHANNELS*CHANNELS)),
    qBias: new Float32Array(ensureF32(input.block1QBias, 'block1QBias', CHANNELS)),
    kWeight: new Float32Array(ensureF32(input.block1KWeight, 'block1KWeight', CHANNELS*CHANNELS)),
    vWeight: new Float32Array(ensureF32(input.block1VWeight, 'block1VWeight', CHANNELS*CHANNELS)),
    vBias: new Float32Array(ensureF32(input.block1VBias, 'block1VBias', CHANNELS)),
    oWeight: new Float32Array(ensureF32(input.block1OWeight, 'block1OWeight', CHANNELS*CHANNELS)),
    oBias: new Float32Array(ensureF32(input.block1OBias, 'block1OBias', CHANNELS)),
    layerScale1: new Float32Array(ensureF32(input.block1LayerScale1, 'block1LayerScale1', CHANNELS)),
    ...(residentBlock1Probe ? {
      norm2Weight: new Float32Array(ensureF32(input.block1Norm2Weight, 'block1Norm2Weight', CHANNELS)),
      norm2Bias: new Float32Array(ensureF32(input.block1Norm2Bias, 'block1Norm2Bias', CHANNELS)),
      mlpUpWeight: new Float32Array(ensureF32(input.block1MlpUpWeight, 'block1MlpUpWeight', INTERMEDIATE*CHANNELS)),
      mlpUpBias: new Float32Array(ensureF32(input.block1MlpUpBias, 'block1MlpUpBias', INTERMEDIATE)),
      mlpDownWeight: new Float32Array(ensureF32(input.block1MlpDownWeight, 'block1MlpDownWeight', CHANNELS*INTERMEDIATE)),
      mlpDownBias: new Float32Array(ensureF32(input.block1MlpDownBias, 'block1MlpDownBias', CHANNELS)),
      layerScale2: new Float32Array(ensureF32(input.block1LayerScale2, 'block1LayerScale2', CHANNELS)),
      ...(residentBlock2Norm1Probe ? {
        block2Norm1Weight: new Float32Array(ensureF32(input.block2Norm1Weight, 'block2Norm1Weight', CHANNELS)),
        block2Norm1Bias: new Float32Array(ensureF32(input.block2Norm1Bias, 'block2Norm1Bias', CHANNELS)),
        ...(residentBlock2AttentionProbe ? {
          block2Attention:{
            qWeight:new Float32Array(ensureF32(input.block2QWeight,'block2QWeight',CHANNELS*CHANNELS)),
            qBias:new Float32Array(ensureF32(input.block2QBias,'block2QBias',CHANNELS)),
            kWeight:new Float32Array(ensureF32(input.block2KWeight,'block2KWeight',CHANNELS*CHANNELS)),
            vWeight:new Float32Array(ensureF32(input.block2VWeight,'block2VWeight',CHANNELS*CHANNELS)),
            vBias:new Float32Array(ensureF32(input.block2VBias,'block2VBias',CHANNELS)),
            oWeight:new Float32Array(ensureF32(input.block2OWeight,'block2OWeight',CHANNELS*CHANNELS)),
            oBias:new Float32Array(ensureF32(input.block2OBias,'block2OBias',CHANNELS)),
            layerScale1:new Float32Array(ensureF32(input.block2LayerScale1,'block2LayerScale1',CHANNELS)),
          },
        } : {}),
      } : {}),
    } : {}),
  } : null;
  const validateResidentWeights=(value,prefix='')=>{
    for (const [name,values] of Object.entries(value||{})) {
      if (values instanceof Float32Array) {
        for (let index=0; index<values.length; index+=1) if (!Number.isFinite(values[index])) throw new Error(`${prefix}${name}[${index}] is not finite`);
      } else if (values && typeof values==='object') validateResidentWeights(values,`${prefix}${name}.`);
    }
  };
  validateResidentWeights(residentWeights);
  if (route.model?.id !== MODEL_ID || route.model?.revision !== MODEL_REVISION || route.model?.dtype !== 'fp32') throw new Error('route model identity differs from pinned F32 DINOv3 checkpoint');
  if (model?.id !== MODEL_ID || model?.revision !== MODEL_REVISION || model?.dtype !== 'fp32' || model?.weightsHash !== MODEL_WEIGHTS_SHA256) throw new Error('invocation model identity differs from pinned F32 DINOv3 checkpoint');
  if (sourceImageArtifact.sha256 !== await sha256Hex(sourceImage)) throw new Error('source-image digest mismatch with uploaded bytes');
  if (pixelValuesArtifact.sha256 !== await sha256Hex(pixelValues)) throw new Error('normalized-pixels digest mismatch with uploaded F32 bytes');
  const actualWeightBundleSha256 = await computeTrellisDinoV3PrefixBlockWeightBundleSha256(weights);
  if (checkpointArtifact.sha256 !== PINNED_BLOCK0_WEIGHT_BUNDLE_SHA256 || actualWeightBundleSha256 !== PINNED_BLOCK0_WEIGHT_BUNDLE_SHA256) throw new Error('checkpoint tensor bundle digest mismatch with pinned F32 block-0 tensors');
  const plan = createTrellisDinoV3PrefixBlockDispatchPlan({ shape, maxWorkgroupsPerDimension: input.device?.limits?.maxComputeWorkgroupsPerDimension });
  const probeRouteId = residentBlock2AttentionProbe
    ? TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK2_ATTENTION_PROBE_ROUTE_ID
    : residentBlock2Norm1Probe
    ? TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK2_NORM1_PROBE_ROUTE_ID
    : residentBlock1Probe
      ? TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK1_PROBE_ROUTE_ID
      : TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_HANDOFF_PROBE_ROUTE_ID;
  const probeRuntimeLabel = residentBlock2AttentionProbe
    ? 'trellis-dinov3-block0-through-block2-attention-resident-probe'
    : residentBlock2Norm1Probe
    ? 'trellis-dinov3-block0-through-block2-norm1-resident-probe'
    : residentBlock1Probe
      ? 'trellis-dinov3-block0-through-block1-full-block-resident-probe'
      : 'trellis-dinov3-block0-through-block1-attention-resident-probe';
  const runtime = await createWebGpuInferenceRuntime({
    routeId: residentHandoffProbe ? probeRouteId : TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || (residentHandoffProbe ? probeRuntimeLabel : 'trellis-dinov3-prefix-block0-phase-program'),
    device: input.device, queue: input.queue, adapter: input.adapter, adapterName: input.adapterName, browser: input.browser,
    backendIdentity, kernel: kernel || route.kernel, requiredStages: residentBlock2AttentionProbe ? RESIDENT_BLOCK2_ATTENTION_PROBE_STAGES : residentBlock2Norm1Probe ? RESIDENT_BLOCK2_NORM1_PROBE_STAGES : residentBlock1Probe ? RESIDENT_BLOCK1_PROBE_STAGES : residentHandoffProbe ? RESIDENT_HANDOFF_PROBE_STAGES : REQUIRED_STAGES,
    timingSource: 'queue-submit-wait', waitForSubmittedWorkDone: true, yieldMs: 0, now: input.now, yield: input.yield,
  });

  let failedPhase = REQUIRED_STAGES[0];
  let lastCompletedPhase = null;
  let primaryError;
  let residentHandoff = null;
  let residentMlp = null;
  let residentBlock2Norm1 = null;
  let residentBlock2Attention = null;
  let expectedResidentAttentionInputTensor = null;
  try {
    let tensors;
    await runtime.runStage('load-trellis-dinov3-prefix-block0-tensors', async stage => {
      const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
      const outputs = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc;
      const scratch = WEBGPU_BUFFER_USAGE.storage;
      const tensor = (name, tensorShape, usage = scratch, sourceData = undefined) => stage.createTensor({ name: `trellis.dinov3.prefix-block0.${name}`, shape: tensorShape, dtype: 'f32', usage, ...(sourceData ? { sourceData } : {}) });
      const noKeyBias = new Float32Array(CHANNELS);
      tensors = {
        pixels: tensor('normalized-pixels', [1, IMAGE_SIZE, IMAGE_SIZE, 3], readonly),
        patchProjection: tensor('patch-projection', [CHANNELS, PATCH_SIZE, PATCH_SIZE, 3], readonly, weights.patchProjection),
        patchBias: tensor('patch-bias', [CHANNELS], readonly, weights.patchBias),
        patchEmbeddings: tensor('patch-embeddings', [1, PATCH_TOKENS, CHANNELS], outputs),
        classToken: tensor('class-token', [1, CHANNELS], readonly, weights.classToken),
        registerTokens: tensor('register-tokens', [4, CHANNELS], readonly, weights.registerTokens),
        prefixHiddenStates: tensor('prefix-hidden-states', [1, TOKEN_COUNT, CHANNELS], outputs),
        ropeCos: tensor('rope-cos', [PATCH_TOKENS, HEAD_DIM], readonly, weights.ropeCos),
        ropeSin: tensor('rope-sin', [PATCH_TOKENS, HEAD_DIM], readonly, weights.ropeSin),
        norm1Weight: tensor('layer0.norm1.weight', [CHANNELS], readonly, weights.norm1Weight),
        norm1Bias: tensor('layer0.norm1.bias', [CHANNELS], readonly, weights.norm1Bias),
        norm1: tensor('layer0.norm1.output', [1, TOKEN_COUNT, CHANNELS]),
        qWeight: tensor('layer0.q.weight', [CHANNELS, CHANNELS], readonly, weights.qWeight),
        qBias: tensor('layer0.q.bias', [CHANNELS], readonly, weights.qBias),
        kWeight: tensor('layer0.k.weight', [CHANNELS, CHANNELS], readonly, weights.kWeight),
        kBias: tensor('layer0.k.bias.architecture-zero', [CHANNELS], readonly, noKeyBias),
        vWeight: tensor('layer0.v.weight', [CHANNELS, CHANNELS], readonly, weights.vWeight),
        vBias: tensor('layer0.v.bias', [CHANNELS], readonly, weights.vBias),
        q: tensor('layer0.q', [1, TOKEN_COUNT, CHANNELS]), k: tensor('layer0.k', [1, TOKEN_COUNT, CHANNELS]), v: tensor('layer0.v', [1, TOKEN_COUNT, CHANNELS]),
        qRope: tensor('layer0.q-rope', [1, TOKEN_COUNT, CHANNELS]), kRope: tensor('layer0.k-rope', [1, TOKEN_COUNT, CHANNELS]),
        attentionScores: tensor('layer0.attention-scores-f32', [HEADS, TOKEN_COUNT, TOKEN_COUNT]),
        attentionContext: tensor('layer0.attention-context', [1, TOKEN_COUNT, CHANNELS]),
        oWeight: tensor('layer0.o.weight', [CHANNELS, CHANNELS], readonly, weights.oWeight),
        oBias: tensor('layer0.o.bias', [CHANNELS], readonly, weights.oBias),
        projectedAttention: tensor('layer0.attention-projection', [1, TOKEN_COUNT, CHANNELS]),
        layerScale1: tensor('layer0.layer-scale1', [CHANNELS], readonly, weights.layerScale1),
        attentionResidual: tensor('layer0.attention-residual', [1, TOKEN_COUNT, CHANNELS]),
        norm2Weight: tensor('layer0.norm2.weight', [CHANNELS], readonly, weights.norm2Weight),
        norm2Bias: tensor('layer0.norm2.bias', [CHANNELS], readonly, weights.norm2Bias),
        norm2: tensor('layer0.norm2.output', [1, TOKEN_COUNT, CHANNELS]),
        mlpUpWeight: tensor('layer0.mlp.up.weight', [INTERMEDIATE, CHANNELS], readonly, weights.mlpUpWeight),
        mlpUpBias: tensor('layer0.mlp.up.bias', [INTERMEDIATE], readonly, weights.mlpUpBias),
        mlpHidden: tensor('layer0.mlp.gelu-output', [1, TOKEN_COUNT, INTERMEDIATE]),
        mlpDownWeight: tensor('layer0.mlp.down.weight', [CHANNELS, INTERMEDIATE], readonly, weights.mlpDownWeight),
        mlpDownBias: tensor('layer0.mlp.down.bias', [CHANNELS], readonly, weights.mlpDownBias),
        mlpProjection: tensor('layer0.mlp.projection', [1, TOKEN_COUNT, CHANNELS]),
        layerScale2: tensor('layer0.layer-scale2', [CHANNELS], readonly, weights.layerScale2),
        block0HiddenStates: tensor('layer0.output-before-final-no-affine-norm', [1, TOKEN_COUNT, CHANNELS], outputs),
        patchDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.patch-dims', schema: ['image_height','image_width','patch_size','patch_height','patch_width','hidden_size','total_values','_pad0'].map(name=>({name,type:'u32'})), values: { image_height:IMAGE_SIZE, image_width:IMAGE_SIZE, patch_size:PATCH_SIZE, patch_height:32, patch_width:32, hidden_size:CHANNELS, total_values:PATCH_TOKENS*CHANNELS, _pad0:0 } }),
        prefixDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.prefix-dims', schema: ['patch_count','prefix_tokens','channels','total_values'].map(name=>({name,type:'u32'})), values: { patch_count:PATCH_TOKENS, prefix_tokens:PREFIX_TOKENS, channels:CHANNELS, total_values:TOKEN_COUNT*CHANNELS } }),
        normDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.norm-dims', schema: [{name:'token_count',type:'u32'},{name:'channels',type:'u32'},{name:'epsilon',type:'f32'},{name:'_pad0',type:'u32'}], values: { token_count:TOKEN_COUNT, channels:CHANNELS, epsilon:LAYER_NORM_EPSILON, _pad0:0 } }),
        ropeDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.rope-dims', schema: ['token_count','prefix_tokens','channels','head_dim','patch_count','total_values','_pad0','_pad1'].map(name=>({name,type:'u32'})), values: { token_count:TOKEN_COUNT, prefix_tokens:PREFIX_TOKENS, channels:CHANNELS, head_dim:HEAD_DIM, patch_count:PATCH_TOKENS, total_values:TOKEN_COUNT*CHANNELS, _pad0:0, _pad1:0 } }),
        linearDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.linear-dims', schema: ['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})), values: { input_channels:CHANNELS, output_channels:CHANNELS, total_output:TOKEN_COUNT*CHANNELS, _pad0:0 } }),
        mlpUpDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.mlp-up-dims', schema: ['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})), values: { input_channels:CHANNELS, output_channels:INTERMEDIATE, total_output:TOKEN_COUNT*INTERMEDIATE, _pad0:0 } }),
        mlpDownDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.mlp-down-dims', schema: ['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})), values: { input_channels:INTERMEDIATE, output_channels:CHANNELS, total_output:TOKEN_COUNT*CHANNELS, _pad0:0 } }),
        attentionDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.attention-dims', schema: ['token_count','channels','heads','head_dim','total_scores','_pad0','_pad1','_pad2'].map(name=>({name,type:'u32'})), values: { token_count:TOKEN_COUNT, channels:CHANNELS, heads:HEADS, head_dim:HEAD_DIM, total_scores:HEADS*TOKEN_COUNT*TOKEN_COUNT, _pad0:0, _pad1:0, _pad2:0 } }),
        softmaxDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.softmax-dims', schema: ['row_count','key_count','total_scores','_pad0'].map(name=>({name,type:'u32'})), values: { row_count:HEADS*TOKEN_COUNT, key_count:TOKEN_COUNT, total_scores:HEADS*TOKEN_COUNT*TOKEN_COUNT, _pad0:0 } }),
        contextDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.context-dims', schema: ['token_count','channels','heads','head_dim','total_values','_pad0','_pad1','_pad2'].map(name=>({name,type:'u32'})), values: { token_count:TOKEN_COUNT, channels:CHANNELS, heads:HEADS, head_dim:HEAD_DIM, total_values:TOKEN_COUNT*CHANNELS, _pad0:0, _pad1:0, _pad2:0 } }),
        residualDims: stage.createUniformBuffer({ label: 'trellis.dinov3.prefix-block0.residual-dims', schema: ['total_values','channels','_pad0','_pad1'].map(name=>({name,type:'u32'})), values: { total_values:TOKEN_COUNT*CHANNELS, channels:CHANNELS, _pad0:0, _pad1:0 } }),
      };
      stage.uploadTensor(tensors.pixels, pixelValues);
      for (const [tensorName, weightName] of Object.entries({
        patchProjection:'patchProjection', patchBias:'patchBias', classToken:'classToken', registerTokens:'registerTokens',
        ropeCos:'ropeCos', ropeSin:'ropeSin', norm1Weight:'norm1Weight', norm1Bias:'norm1Bias',
        qWeight:'qWeight', qBias:'qBias', kWeight:'kWeight', vWeight:'vWeight', vBias:'vBias',
        oWeight:'oWeight', oBias:'oBias', layerScale1:'layerScale1', norm2Weight:'norm2Weight', norm2Bias:'norm2Bias',
        mlpUpWeight:'mlpUpWeight', mlpUpBias:'mlpUpBias', mlpDownWeight:'mlpDownWeight', mlpDownBias:'mlpDownBias', layerScale2:'layerScale2',
      })) stage.uploadTensor(tensors[tensorName],weights[weightName]);
      stage.uploadTensor(tensors.kBias,noKeyBias);
      await stage.yieldToBrowser({ reason: 'after-trellis-dinov3-prefix-block0-f32-upload' });
    }, { modelId: MODEL_ID, modelRevision: MODEL_REVISION, dtype: 'f32', shape, checkpointTensorDtype: 'F32' });

    const bindTensor = (name, access = 'read-only-storage') => ({ name: name.replace(/^tensor:/, ''), resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access });
    const bindUniform = name => ({ name: name.replace(/^uniform:/, ''), resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
    const linearBindings = (source, weight, bias, output, dims) => [bindTensor(source), bindTensor(weight), bindTensor(bias), bindTensor(output,'storage'), bindUniform(dims)];
    const program = runtime.defineProgram({
      name: 'trellis.dinov3.prefix-block0.phase-program', tensors,
      uniforms: Object.fromEntries(Object.entries(tensors).filter(([key])=>key.endsWith('Dims'))),
      kernels: {
        patchEmbed: { code:PATCH_EMBED_WGSL, bindings:[bindTensor('pixels'),bindTensor('patchProjection'),bindTensor('patchBias'),bindTensor('patchEmbeddings','storage'),bindUniform('patchDims')] },
        prefixAssembly: { code:PREFIX_ASSEMBLY_WGSL, bindings:[bindTensor('patchEmbeddings'),bindTensor('classToken'),bindTensor('registerTokens'),bindTensor('prefixHiddenStates','storage'),bindUniform('prefixDims')] },
        layerNorm1: { code:LAYERNORM_WGSL, bindings:[bindTensor('prefixHiddenStates'),bindTensor('norm1Weight'),bindTensor('norm1Bias'),bindTensor('norm1','storage'),bindUniform('normDims')] },
        qProjection: { code:SAM_VECTOR_LINEAR_WGSL, bindings:linearBindings('norm1','qWeight','qBias','q','linearDims') },
        kProjection: { code:SAM_VECTOR_LINEAR_WGSL, bindings:linearBindings('norm1','kWeight','kBias','k','linearDims') },
        vProjection: { code:SAM_VECTOR_LINEAR_WGSL, bindings:linearBindings('norm1','vWeight','vBias','v','linearDims') },
        qRope: { code:ROPE_WGSL, bindings:[bindTensor('q'),bindTensor('ropeCos'),bindTensor('ropeSin'),bindTensor('qRope','storage'),bindUniform('ropeDims')] },
        kRope: { code:ROPE_WGSL, bindings:[bindTensor('k'),bindTensor('ropeCos'),bindTensor('ropeSin'),bindTensor('kRope','storage'),bindUniform('ropeDims')] },
        attentionScore: { code:ATTENTION_SCORE_WGSL, bindings:[bindTensor('qRope'),bindTensor('kRope'),bindTensor('attentionScores','storage'),bindUniform('attentionDims')] },
        attentionSoftmax: { code:ATTENTION_SOFTMAX_WGSL, bindings:[bindTensor('attentionScores','storage'),bindUniform('softmaxDims')] },
        attentionContext: { code:ATTENTION_CONTEXT_WGSL, bindings:[bindTensor('attentionScores'),bindTensor('v'),bindTensor('attentionContext','storage'),bindUniform('contextDims')] },
        outputProjection: { code:SAM_VECTOR_LINEAR_WGSL, bindings:linearBindings('attentionContext','oWeight','oBias','projectedAttention','linearDims') },
        attentionResidual: { code:LAYER_SCALE_RESIDUAL_WGSL, bindings:[bindTensor('prefixHiddenStates'),bindTensor('projectedAttention'),bindTensor('layerScale1'),bindTensor('attentionResidual','storage'),bindUniform('residualDims')] },
        layerNorm2: { code:LAYERNORM_WGSL, bindings:[bindTensor('attentionResidual'),bindTensor('norm2Weight'),bindTensor('norm2Bias'),bindTensor('norm2','storage'),bindUniform('normDims')] },
        mlpUp: { code:SAM_VECTOR_LINEAR_GELU_WGSL, bindings:linearBindings('norm2','mlpUpWeight','mlpUpBias','mlpHidden','mlpUpDims') },
        mlpDown: { code:SAM_VECTOR_LINEAR_WGSL, bindings:linearBindings('mlpHidden','mlpDownWeight','mlpDownBias','mlpProjection','mlpDownDims') },
        mlpResidual: { code:LAYER_SCALE_RESIDUAL_WGSL, bindings:[bindTensor('attentionResidual'),bindTensor('mlpProjection'),bindTensor('layerScale2'),bindTensor('block0HiddenStates','storage'),bindUniform('residualDims')] },
      },
      phases:[
        {name:'dinov3-prefix-block0-patch-embedding',kernel:'patchEmbed',dispatch:plan.patchEmbedding,yieldAfter:true},
        {name:'dinov3-prefix-block0-prefix-assembly',kernel:'prefixAssembly',dispatch:plan.prefixAssembly,yieldAfter:true},
        {name:'dinov3-prefix-block0-layernorm1',kernel:'layerNorm1',dispatch:plan.layerNorm1,yieldAfter:true},
        {name:'dinov3-prefix-block0-qkv-projection',kernel:'qProjection',dispatch:plan.qkvProjection},
        {name:'dinov3-prefix-block0-qkv-projection',kernel:'kProjection',dispatch:plan.qkvProjection},
        {name:'dinov3-prefix-block0-qkv-projection',kernel:'vProjection',dispatch:plan.qkvProjection,yieldAfter:true},
        {name:'dinov3-prefix-block0-patch-rope',kernel:'qRope',dispatch:plan.patchRope},
        {name:'dinov3-prefix-block0-patch-rope',kernel:'kRope',dispatch:plan.patchRope,yieldAfter:true},
        {name:'dinov3-prefix-block0-global-attention',kernel:'attentionScore',dispatch:plan.attentionScore},
        {name:'dinov3-prefix-block0-global-attention',kernel:'attentionSoftmax',dispatch:plan.attentionSoftmax},
        {name:'dinov3-prefix-block0-global-attention',kernel:'attentionContext',dispatch:plan.attentionContext,yieldAfter:true},
        {name:'dinov3-prefix-block0-output-residual',kernel:'outputProjection',dispatch:plan.outputProjection},
        {name:'dinov3-prefix-block0-output-residual',kernel:'attentionResidual',dispatch:plan.attentionResidual,yieldAfter:true},
        {name:'dinov3-prefix-block0-layernorm2',kernel:'layerNorm2',dispatch:plan.layerNorm2,yieldAfter:true},
        {name:'dinov3-prefix-block0-gelu-mlp',kernel:'mlpUp',dispatch:plan.mlpUp},
        {name:'dinov3-prefix-block0-gelu-mlp',kernel:'mlpDown',dispatch:plan.mlpDown,yieldAfter:true},
        {name:'dinov3-prefix-block0-mlp-residual',kernel:'mlpResidual',dispatch:plan.mlpResidual,yieldAfter:true},
        {name:'readback-trellis-dinov3-prefix-block0-outputs',readbacks:[
          {name:'patchEmbeddings',tensor:'patchEmbeddings'},
          {name:'prefixHiddenStates',tensor:'prefixHiddenStates'},
          {name:'block0HiddenStates',tensor:'block0HiddenStates'},
        ]},
      ],
      metadata:{routeId:TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,modelRevision:MODEL_REVISION,dtype:'f32',sequence:'CLS+4 registers+1024 patches',rope:'reference-provided 2D DINO RoPE; patch Q/K only',attention:'global 16-head softmax',finalNoAffineLayerNormApplied:false},
    });

    let run;
    const outputs = {};
    let phaseIndex = 0;
    await runtime.runInvocation({ invocationId:input.invocationId || `${TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID}:${Date.now()}` }, async invocation => {
      const phases = residentHandoffProbe
        ? program.phases.filter(phase => phase.name !== 'readback-trellis-dinov3-prefix-block0-outputs')
        : program.phases;
      for (const phase of phases) {
        failedPhase = phase.name;
        await input.onPhase?.({ phase:phase.name, phaseIndex, lastCompletedPhase });
        if (phase.kind === 'kernel') {
          await runtime.runKernel(phase.kernel,{stage:phase.name,dispatch:phase.dispatch,yieldAfter:phase.yieldAfter,yieldReason:phase.yieldReason,commandDuty:phase.commandDuty,schedulerInvocation:invocation,metadata:{phaseIndex:phase.phaseIndex,programName:program.name,routeId:TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID}});
        } else {
          const readback = await runtime.runStage(phase.name,async stage=>{
            const values={};
            for (const output of phase.readbacks) values[output.name]=await stage.readTensor(output.tensor,output.options);
            return values;
          },{phaseIndex:phase.phaseIndex,programName:program.name,routeId:TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID});
          Object.assign(outputs,readback);
        }
        lastCompletedPhase=phase.name;
        phaseIndex+=1;
        if (residentHandoffProbe && phase.name === 'dinov3-prefix-block0-mlp-residual') {
          failedPhase='dinov3-block1-layernorm1-resident';
          await input.onPhase?.({ phase:failedPhase, phaseIndex, lastCompletedPhase });
          const norm1Output = await runTrellisDinoV3Block1LayerNormResident({
            runtime, inputTensor:tensors.block0HiddenStates,
            weight:residentWeights.norm1Weight, bias:residentWeights.norm1Bias,
            schedulerInvocation:invocation,
          });
          expectedResidentAttentionInputTensor = norm1Output.tensor;
          lastCompletedPhase='dinov3-block1-layernorm1-resident';
          phaseIndex+=1;
          failedPhase='dinov3-block1-qkv-projection-resident';
          await input.onPhase?.({ phase:failedPhase, phaseIndex, lastCompletedPhase });
          const downstream = await runTrellisDinoV3Block1AttentionResident({
            runtime,device:input.device,inputTensor:norm1Output.tensor,residualTensor:tensors.block0HiddenStates,
            qWeight:residentWeights.qWeight,qBias:residentWeights.qBias,kWeight:residentWeights.kWeight,
            vWeight:residentWeights.vWeight,vBias:residentWeights.vBias,oWeight:residentWeights.oWeight,
            oBias:residentWeights.oBias,layerScale1:residentWeights.layerScale1,
            ropeCos:weights.ropeCos,ropeSin:weights.ropeSin,schedulerInvocation:invocation,
          });
          lastCompletedPhase='dinov3-block1-output-residual-resident';
          phaseIndex+=1;
          if (residentBlock1Probe) {
            residentMlp = await runTrellisDinoV3Block1MlpResident({
              runtime,device:input.device,inputTensor:downstream.tensor,residualTensor:downstream.tensor,
              norm2Weight:residentWeights.norm2Weight,norm2Bias:residentWeights.norm2Bias,
              mlpUpWeight:residentWeights.mlpUpWeight,mlpUpBias:residentWeights.mlpUpBias,
              mlpDownWeight:residentWeights.mlpDownWeight,mlpDownBias:residentWeights.mlpDownBias,
              layerScale2:residentWeights.layerScale2,schedulerInvocation:invocation,
              onPhase:({phase,phaseIndex:mlpPhaseIndex,lastCompletedPhase:mlpLastCompletedPhase})=>{
                if (mlpLastCompletedPhase) lastCompletedPhase=mlpLastCompletedPhase;
                failedPhase=phase;
                return input.onPhase?.({phase,phaseIndex:phaseIndex+mlpPhaseIndex,lastCompletedPhase});
              },
            });
            lastCompletedPhase='dinov3-block1-mlp-residual-resident';
            phaseIndex+=4;
            if (residentBlock2Norm1Probe) {
              failedPhase='dinov3-block2-layernorm1-resident';
              await input.onPhase?.({ phase:failedPhase, phaseIndex, lastCompletedPhase });
              residentBlock2Norm1=await runTrellisDinoV3Block2LayerNorm1Resident({
                runtime,inputTensor:residentMlp.tensor,weight:residentWeights.block2Norm1Weight,
                bias:residentWeights.block2Norm1Bias,schedulerInvocation:invocation,
              });
              assertTrellisDinoV3ResidentBlock2Norm1HandoffIdentity({residentNorm1:residentBlock2Norm1,block1Output:residentMlp.tensor});
              lastCompletedPhase=failedPhase;
              phaseIndex+=1;
              if (residentBlock2AttentionProbe) {
                failedPhase='dinov3-block2-qkv-projection-resident';
                await input.onPhase?.({phase:failedPhase,phaseIndex,lastCompletedPhase});
                residentBlock2Attention=await runTrellisDinoV3Block2AttentionResident({
                  runtime,device:input.device,inputTensor:residentBlock2Norm1.tensor,residualTensor:residentMlp.tensor,
                  ...residentWeights.block2Attention,ropeCos:weights.ropeCos,ropeSin:weights.ropeSin,
                  schedulerInvocation:invocation,
                });
                assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity({
                  residentAttention:residentBlock2Attention,residentNorm1:residentBlock2Norm1,block1Output:residentMlp.tensor,
                });
                lastCompletedPhase='dinov3-block2-output-residual-resident';
                phaseIndex+=1;
              }
            }
            failedPhase=residentBlock2AttentionProbe
              ? 'readback-dinov3-block2-attention-resident-probe'
              : residentBlock2Norm1Probe
              ? 'readback-dinov3-block2-norm1-resident-probe'
              : 'readback-dinov3-block1-full-block-resident-probe';
            await input.onPhase?.({ phase:failedPhase, phaseIndex, lastCompletedPhase });
            const byteOutputs = await runtime.runStage(failedPhase,async stage=>({
              block1Attention:await stage.readTensor(downstream.tensor),
              block1Norm2:await stage.readTensor(residentMlp.norm2Tensor),
              block1MlpHidden:await stage.readTensor(residentMlp.mlpHiddenTensor),
              block1MlpProjection:await stage.readTensor(residentMlp.mlpProjectionTensor),
              block1Output:await stage.readTensor(residentMlp.tensor),
              ...(residentBlock2Norm1Probe ? { block2Norm1:await stage.readTensor(residentBlock2Norm1.tensor) } : {}),
              ...(residentBlock2AttentionProbe ? { block2Attention:await stage.readTensor(residentBlock2Attention.tensor) } : {}),
            }),{
              routeId:probeRouteId,operation:residentBlock2Attention?.operation||residentBlock2Norm1?.operation||residentMlp.operation,
              inputTensor:residentBlock2Attention?.inputTensor.name||residentBlock2Norm1?.inputTensor.name||residentMlp.inputTensor.name,
              residualTensor:residentBlock2Attention?.residualTensor.name||(residentBlock2Norm1 ? null : residentMlp.residualTensor.name),
              outputTensor:residentBlock2Attention?.tensor.name||residentBlock2Norm1?.tensor.name||residentMlp.tensor.name,
            });
            const expectedLengths={
              block1Attention:TOKEN_COUNT*CHANNELS,block1Norm2:TOKEN_COUNT*CHANNELS,
              block1MlpHidden:TOKEN_COUNT*INTERMEDIATE,block1MlpProjection:TOKEN_COUNT*CHANNELS,
              block1Output:TOKEN_COUNT*CHANNELS,
              ...(residentBlock2Norm1Probe ? { block2Norm1:TOKEN_COUNT*CHANNELS } : {}),
              ...(residentBlock2AttentionProbe ? { block2Attention:TOKEN_COUNT*CHANNELS } : {}),
            };
            const outputValues={};
            for (const [name,byteLength] of Object.entries(expectedLengths)) {
              const values=new Float32Array(byteOutputs[name]);
              if (values.length!==byteLength) throw new Error(`resident ${name} readback is missing or partial`);
              for (let index=0;index<values.length;index+=1) if (!Number.isFinite(values[index])) throw new Error(`resident ${name}[${index}] is not finite`);
              outputValues[name]=values;
            }
            residentHandoff={...downstream,outputValues:outputValues.block1Attention};
            residentMlp={...residentMlp,outputValues};
            if (residentBlock2Norm1Probe) {
              residentBlock2Norm1={...residentBlock2Norm1,outputValues:outputValues.block2Norm1};
            }
            if (residentBlock2AttentionProbe) {
              residentBlock2Attention={...residentBlock2Attention,outputValues:outputValues.block2Attention};
            }
            lastCompletedPhase=failedPhase;
            phaseIndex+=1;
          } else {
            failedPhase='readback-dinov3-block1-attention-resident-probe';
            await input.onPhase?.({ phase:failedPhase, phaseIndex, lastCompletedPhase });
            const bytes = await runtime.runStage(failedPhase,stage => stage.readTensor(downstream.tensor), {
              routeId:probeRouteId,
              operation:downstream.operation, inputTensor:downstream.inputTensor.name, outputTensor:downstream.tensor.name,
            });
            residentHandoff = { ...downstream, outputValues:new Float32Array(bytes) };
            if (residentHandoff.outputValues.length !== TOKEN_COUNT*CHANNELS) throw new Error('resident block-1 attention readback is missing or partial');
            for (let index=0; index<residentHandoff.outputValues.length; index+=1) if (!Number.isFinite(residentHandoff.outputValues[index])) throw new Error(`resident block-1 attention output[${index}] is not finite`);
            lastCompletedPhase='readback-dinov3-block1-attention-resident-probe';
            phaseIndex+=1;
          }
        }
      }
      run={outputs,phaseNames:program.phases.map(phase=>phase.name)};
    });
    if (residentHandoffProbe) {
      assertTrellisDinoV3ResidentAttentionHandoffIdentity({
        residentHandoff,
        block0HiddenStates:tensors.block0HiddenStates,
        block1Norm1HiddenStates:expectedResidentAttentionInputTensor,
      });
      if (residentBlock1Probe) assertTrellisDinoV3ResidentMlpHandoffIdentity({residentMlp,attentionResidual:residentHandoff.tensor});
      return {
        status:'diagnostic-probe-complete', authority:'non-authoritative-diagnostic',
        requestedProbeRouteId:probeRouteId,
        runtimeRouteId:runtime.routeId,
        computeRouteId:route.routeId,
        backend:runtime.backendIdentity,
        model:{ id:model?.id||route.model?.id, revision:model?.revision||route.model?.revision, weightsHash:model?.weightsHash, dtype:'fp32' },
        precision:{ input:'Float32Array', weights:'Float32Array', storage:'f32', output:'Float32Array' },
        block0Readback:'skipped',
        transfer:createTrellisDinoV3ResidentProbeTransferMetadata({ residentBlock1Probe, residentBlock2Norm1Probe, residentBlock2AttentionProbe }),
        downstream:residentBlock2AttentionProbe
          ? {operation:residentBlock2Attention.operation,inputTensor:residentBlock2Attention.inputTensor.name,outputTensor:residentBlock2Attention.tensor.name,dtype:residentBlock2Attention.dtype,shape:residentBlock2Attention.shape}
          : residentBlock2Norm1Probe
          ? {operation:residentBlock2Norm1.operation,inputTensor:residentBlock2Norm1.inputTensor.name,outputTensor:residentBlock2Norm1.tensor.name,dtype:residentBlock2Norm1.dtype,shape:residentBlock2Norm1.shape}
          : residentBlock1Probe
            ? {operation:residentMlp.operation,inputTensor:residentMlp.inputTensor.name,outputTensor:residentMlp.tensor.name,dtype:residentMlp.dtype,shape:residentMlp.shape}
          : { operation:residentHandoff.operation, inputTensor:residentHandoff.inputTensor.name, outputTensor:residentHandoff.tensor.name, dtype:residentHandoff.dtype, shape:residentHandoff.shape },
        debugResidentHandoff:{ operation:residentHandoff.operation, outputValues:new Float32Array(residentHandoff.outputValues), lastCompletedPhase },
        ...(residentBlock1Probe ? {debugResidentBlock1:{
          operation:residentMlp.operation,
          outputValues:Object.fromEntries(Object.entries(residentMlp.outputValues).map(([name,values])=>[name,new Float32Array(values)])),
          lastCompletedPhase,
        }} : {}),
        ...(residentBlock2Norm1Probe ? {debugResidentBlock2Norm1:{
          operation:residentBlock2Norm1.operation,
          outputValues:new Float32Array(residentBlock2Norm1.outputValues),
          lastCompletedPhase,
        }} : {}),
        ...(residentBlock2AttentionProbe ? {debugResidentBlock2Attention:{
          operation:residentBlock2Attention.operation,
          outputValues:{
            block2Norm1:new Float32Array(residentBlock2Norm1.outputValues),
            block2Attention:new Float32Array(residentBlock2Attention.outputValues),
          },
          lastCompletedPhase,
        }} : {}),
      };
    }
    const hashes = {
      patchEmbeddings:await sha256Hex(run.outputs.patchEmbeddings),
      prefixHiddenStates:await sha256Hex(run.outputs.prefixHiddenStates),
      block0HiddenStates:await sha256Hex(run.outputs.block0HiddenStates),
    };
    const outputRecords = outputArtifacts(request,hashes,shape);
    const receipt = createTrellisDinoV3PrefixBlockPhaseProgramRouteReceipt({
      sourceImage:sourceImageArtifact,pixelValues:pixelValuesArtifact,weights:checkpointArtifact,outputs:outputRecords,
      backend:runtime.backendIdentity,model:{id:model?.id||route.model?.id,revision:model?.revision||route.model?.revision,weightsHash:model?.weightsHash,dtype:'fp32'},
      kernel:kernel||runtime.kernel,profile:runtime.profile,
    });
    const result=assertAuthoritativeRouteWorkerResult(createRouteWorkerResult(route,{request,receipt}),route);
    if (input.includeReadback===true) result.debugReadback={mode:'explicit-debug-evidence',dtype:'float32',patchEmbeddings:new Float32Array(run.outputs.patchEmbeddings),prefixHiddenStates:new Float32Array(run.outputs.prefixHiddenStates),block0HiddenStates:new Float32Array(run.outputs.block0HiddenStates),lastCompletedPhase};
    return result;
  } catch(error) {
    primaryError=error;
    try { error.dinov3FailurePhase=failedPhase; error.dinov3LastCompletedPhase=lastCompletedPhase; } catch {}
    throw error;
  } finally {
    try { await runtime.dispose(); } catch(cleanupError) {
      if (!primaryError) throw cleanupError;
      try { primaryError.cleanupErrors=[...(primaryError.cleanupErrors||[]),cleanupError]; } catch {}
    }
  }
}

export function runTrellisDinoV3PrefixBlockPhaseProgramRoute(input = {}) {
  return runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal(input);
}

export function runTrellisDinoV3PrefixBlockResidentHandoffProbe(input = {}) {
  return runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal(input, { residentHandoffProbe:true });
}

export function runTrellisDinoV3PrefixBlockResidentBlock1Probe(input = {}) {
  return runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal(input, { residentHandoffProbe:true,residentBlock1Probe:true });
}

export function runTrellisDinoV3PrefixBlockResidentBlock2Norm1Probe(input = {}) {
  return runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal(input, { residentHandoffProbe:true,residentBlock1Probe:true,residentBlock2Norm1Probe:true });
}

export function runTrellisDinoV3PrefixBlockResidentBlock2AttentionProbe(input = {}) {
  return runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal(input, {
    residentHandoffProbe:true,residentBlock1Probe:true,residentBlock2Norm1Probe:true,residentBlock2AttentionProbe:true,
  });
}
