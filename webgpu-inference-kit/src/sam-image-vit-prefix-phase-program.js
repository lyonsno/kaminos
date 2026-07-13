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

export const SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-vit-prefix.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-vit-prefix-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-vit-prefix-tensors',
  'tile-position-embeddings',
  'add-position-embeddings',
  'vit-prefix-layernorm',
  'readback-vit-prefix-hidden-states',
];
const INPUT_ROLES = ['source-image', 'patch-embeddings', 'sam3-image-vit-prefix-weights'];
const OUTPUT_ROLES = [
  { key: 'vitPrefixHiddenStates', role: 'vit-prefix-hidden-states', required: true },
];

const TILE_POSITION_WGSL = `
struct VitPrefixDims {
  batch: u32,
  patch_height: u32,
  patch_width: u32,
  hidden_size: u32,
  pretrain_grid_size: u32,
  patch_tokens: u32,
  total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> position_embeddings: array<f32>;
@group(0) @binding(1) var<storage, read_write> tiled_position_embeddings: array<f32>;
@group(0) @binding(2) var<uniform> dims: VitPrefixDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.patch_tokens * dims.hidden_size) { return; }
  let channel = index % dims.hidden_size;
  let token = index / dims.hidden_size;
  let patch_y = token / dims.patch_width;
  let patch_x = token % dims.patch_width;
  let source_y = patch_y % dims.pretrain_grid_size;
  let source_x = patch_x % dims.pretrain_grid_size;
  let source_token = source_y * dims.pretrain_grid_size + source_x;
  tiled_position_embeddings[index] = position_embeddings[source_token * dims.hidden_size + channel];
}
`;

const ADD_POSITION_WGSL = `
struct VitPrefixDims {
  batch: u32,
  patch_height: u32,
  patch_width: u32,
  hidden_size: u32,
  pretrain_grid_size: u32,
  patch_tokens: u32,
  total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> patch_embeddings: array<f32>;
@group(0) @binding(1) var<storage, read> tiled_position_embeddings: array<f32>;
@group(0) @binding(2) var<storage, read_write> patch_plus_position: array<f32>;
@group(0) @binding(3) var<uniform> dims: VitPrefixDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_values) { return; }
  let position_index = index % (dims.patch_tokens * dims.hidden_size);
  patch_plus_position[index] = patch_embeddings[index] + tiled_position_embeddings[position_index];
}
`;

const LAYERNORM_WGSL = `
struct VitPrefixDims {
  batch: u32,
  patch_height: u32,
  patch_width: u32,
  hidden_size: u32,
  pretrain_grid_size: u32,
  patch_tokens: u32,
  total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: VitPrefixDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let token = gid.x;
  if (token >= dims.batch * dims.patch_tokens) { return; }
  let base = token * dims.hidden_size;
  var mean = 0.0;
  for (var c = 0u; c < dims.hidden_size; c = c + 1u) {
    mean = mean + input_values[base + c];
  }
  mean = mean / f32(dims.hidden_size);
  var variance = 0.0;
  for (var c = 0u; c < dims.hidden_size; c = c + 1u) {
    let delta = input_values[base + c] - mean;
    variance = variance + delta * delta;
  }
  variance = variance / f32(dims.hidden_size);
  let inv_std = inverseSqrt(variance + 0.000001);
  for (var c = 0u; c < dims.hidden_size; c = c + 1u) {
    output_values[base + c] = (input_values[base + c] - mean) * inv_std * norm_weight[c] + norm_bias[c];
  }
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-vit-prefix-hidden-states' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-vit-prefix-hidden-states' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-vit-prefix-hidden-states' })),
      notes: 'SAM3 image ViT-prefix phase program cooperates between learned absolute position tiling, patch-plus-position addition, backbone B,H,W,C LayerNorm, and readback boundaries.',
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
    patchHeight: shape.patchHeight ?? shape.height,
    patchWidth: shape.patchWidth ?? shape.width,
    hiddenSize: shape.hiddenSize ?? shape.channels,
    pretrainGridSize: shape.pretrainGridSize,
  };
  out.patchTokens = out.patchHeight * out.patchWidth;
  for (const key of ['batch', 'patchHeight', 'patchWidth', 'hiddenSize', 'pretrainGridSize']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  return out;
}

function validateImageVitPrefixInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const patchEmbeddings = ensureFloat32Array(input.patchEmbeddings, 'patchEmbeddings');
  const positionEmbeddings = ensureFloat32Array(input.weights?.positionEmbeddings, 'weights.positionEmbeddings');
  const layerNormWeight = ensureFloat32Array(input.weights?.layerNormWeight, 'weights.layerNormWeight');
  const layerNormBias = ensureFloat32Array(input.weights?.layerNormBias, 'weights.layerNormBias');
  const expectedPatch = shape.batch * shape.patchTokens * shape.hiddenSize;
  const expectedPosition = shape.pretrainGridSize * shape.pretrainGridSize * shape.hiddenSize;
  if (patchEmbeddings.length !== expectedPatch) throw new Error(`patchEmbeddings length ${patchEmbeddings.length} does not match shape (${expectedPatch})`);
  if (positionEmbeddings.length !== expectedPosition) throw new Error(`weights.positionEmbeddings length ${positionEmbeddings.length} does not match pretrain grid (${expectedPosition})`);
  if (layerNormWeight.length !== shape.hiddenSize) throw new Error(`weights.layerNormWeight length ${layerNormWeight.length} does not match hiddenSize (${shape.hiddenSize})`);
  if (layerNormBias.length !== shape.hiddenSize) throw new Error(`weights.layerNormBias length ${layerNormBias.length} does not match hiddenSize (${shape.hiddenSize})`);
  return { shape, patchEmbeddings, positionEmbeddings, layerNormWeight, layerNormBias };
}

export function createSam3ImageVitPrefixPhaseProgramCpuOracle(input) {
  const { shape, patchEmbeddings, positionEmbeddings, layerNormWeight, layerNormBias } = validateImageVitPrefixInputs(input);
  const tiledPositionEmbeddings = new Float32Array(shape.patchTokens * shape.hiddenSize);
  // HF/SAM3 uses tiling (repeating), not interpolation, then crops to target H/W.
  for (let y = 0; y < shape.patchHeight; y += 1) {
    for (let x = 0; x < shape.patchWidth; x += 1) {
      const token = y * shape.patchWidth + x;
      const sourceToken = (y % shape.pretrainGridSize) * shape.pretrainGridSize + (x % shape.pretrainGridSize);
      for (let c = 0; c < shape.hiddenSize; c += 1) {
        tiledPositionEmbeddings[token * shape.hiddenSize + c] = positionEmbeddings[sourceToken * shape.hiddenSize + c];
      }
    }
  }
  const patchPlusPosition = new Float32Array(patchEmbeddings.length);
  for (let index = 0; index < patchEmbeddings.length; index += 1) {
    patchPlusPosition[index] = patchEmbeddings[index] + tiledPositionEmbeddings[index % tiledPositionEmbeddings.length];
  }
  const vitPrefixHiddenStates = new Float32Array(patchEmbeddings.length);
  for (let token = 0; token < shape.batch * shape.patchTokens; token += 1) {
    const base = token * shape.hiddenSize;
    let mean = 0;
    for (let c = 0; c < shape.hiddenSize; c += 1) mean += patchPlusPosition[base + c];
    mean /= shape.hiddenSize;
    let variance = 0;
    for (let c = 0; c < shape.hiddenSize; c += 1) {
      const delta = patchPlusPosition[base + c] - mean;
      variance += delta * delta;
    }
    variance /= shape.hiddenSize;
    const invStd = 1 / Math.sqrt(variance + 0.000001);
    for (let c = 0; c < shape.hiddenSize; c += 1) {
      vitPrefixHiddenStates[base + c] = (patchPlusPosition[base + c] - mean) * invStd * layerNormWeight[c] + layerNormBias[c];
    }
  }
  return { shape, tiledPositionEmbeddings, patchPlusPosition, vitPrefixHiddenStates };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image ViT-prefix outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    vitPrefixHiddenStates: {
      artifactId: roleArtifact(request.outputs, 'vit-prefix-hidden-states').artifactId,
      sha256: hashes.vitPrefixHiddenStates,
      shape: [shape.batch, shape.patchHeight, shape.patchWidth, shape.hiddenSize],
    },
  };
}

export function createSam3ImageVitPrefixPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: input.model?.id || SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('patch-embeddings', input.patchEmbeddings),
      createRouteReceiptInputArtifact('sam3-image-vit-prefix-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImageVitPrefixPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: input.model?.id || SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-vit-prefix', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImageVitPrefixPhaseProgramRoute', upstreamBoundary: 'browser-sam3-patch-embeddings-to-vit-prefix-hidden-states' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3ImageVitPrefixPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImageVitPrefixPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const patchEmbeddingsArtifact = roleArtifact(input.request.inputs, 'patch-embeddings');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-image-vit-prefix-weights');
  const { shape, patchEmbeddings, positionEmbeddings, layerNormWeight, layerNormBias } = validateImageVitPrefixInputs(input.tensors || {});
  const totalValues = shape.batch * shape.patchTokens * shape.hiddenSize;
  const totalTokens = shape.batch * shape.patchTokens;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-vit-prefix-phase-program',
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
  await runtime.runStage('load-image-vit-prefix-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      patchEmbeddings: stage.createTensor({ name: 'sam3.image-vit-prefix.patch-embeddings', shape: [shape.batch, shape.patchHeight * shape.patchWidth, shape.hiddenSize], dtype: 'f32', usage: readonlyUsage }),
      positionEmbeddings: stage.createTensor({ name: 'sam3.image-vit-prefix.position-embeddings', shape: [1, shape.pretrainGridSize * shape.pretrainGridSize, shape.hiddenSize], dtype: 'f32', usage: readonlyUsage }),
      layerNormWeight: stage.createTensor({ name: 'sam3.image-vit-prefix.layernorm.weight', shape: [shape.hiddenSize], dtype: 'f32', usage: readonlyUsage }),
      layerNormBias: stage.createTensor({ name: 'sam3.image-vit-prefix.layernorm.bias', shape: [shape.hiddenSize], dtype: 'f32', usage: readonlyUsage }),
      tiledPositionEmbeddings: stage.createTensor({ name: 'sam3.image-vit-prefix.tiled-position-embeddings', shape: [1, shape.patchHeight * shape.patchWidth, shape.hiddenSize], dtype: 'f32', usage }),
      patchPlusPosition: stage.createTensor({ name: 'sam3.image-vit-prefix.patch-plus-position', shape: [shape.batch, shape.patchHeight, shape.patchWidth, shape.hiddenSize], dtype: 'f32', usage }),
      vitPrefixHiddenStates: stage.createTensor({ name: 'sam3.image-vit-prefix.hidden-states', shape: [shape.batch, shape.patchHeight, shape.patchWidth, shape.hiddenSize], dtype: 'f32', usage }),
      dims: stage.createUniformBuffer({
        label: 'sam3.image-vit-prefix.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'patch_height', type: 'u32' },
          { name: 'patch_width', type: 'u32' },
          { name: 'hidden_size', type: 'u32' },
          { name: 'pretrain_grid_size', type: 'u32' },
          { name: 'patch_tokens', type: 'u32' },
          { name: 'total_values', type: 'u32' },
          { name: '_pad0', type: 'u32' },
        ],
        values: { batch: shape.batch, patch_height: shape.patchHeight, patch_width: shape.patchWidth, hidden_size: shape.hiddenSize, pretrain_grid_size: shape.pretrainGridSize, patch_tokens: shape.patchTokens, total_values: totalValues, _pad0: 0 },
      }),
    };
    stage.uploadTensor(tensors.patchEmbeddings, patchEmbeddings);
    stage.uploadTensor(tensors.positionEmbeddings, positionEmbeddings);
    stage.uploadTensor(tensors.layerNormWeight, layerNormWeight);
    stage.uploadTensor(tensors.layerNormBias, layerNormBias);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-vit-prefix-upload' });
  }, { shape, positionEmbeddingRule: 'HF/SAM3 tiling (repeating), not interpolation; crop to target B,H,W,C grid' });

  const program = runtime.defineProgram({
    name: 'sam3.image-vit-prefix-phase-program',
    tensors: {
      patchEmbeddings: tensors.patchEmbeddings,
      positionEmbeddings: tensors.positionEmbeddings,
      layerNormWeight: tensors.layerNormWeight,
      layerNormBias: tensors.layerNormBias,
      tiledPositionEmbeddings: tensors.tiledPositionEmbeddings,
      patchPlusPosition: tensors.patchPlusPosition,
      vitPrefixHiddenStates: tensors.vitPrefixHiddenStates,
    },
    uniforms: { dims: tensors.dims },
    kernels: {
      tilePositionEmbeddings: {
        code: TILE_POSITION_WGSL,
        bindings: [
          { name: 'positionEmbeddings', resource: 'tensor:positionEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'tiledPositionEmbeddings', resource: 'tensor:tiledPositionEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
      addPositionEmbeddings: {
        code: ADD_POSITION_WGSL,
        bindings: [
          { name: 'patchEmbeddings', resource: 'tensor:patchEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'tiledPositionEmbeddings', resource: 'tensor:tiledPositionEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'patchPlusPosition', resource: 'tensor:patchPlusPosition', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
      vitPrefixLayernorm: {
        code: LAYERNORM_WGSL,
        bindings: [
          { name: 'inputValues', resource: 'tensor:patchPlusPosition', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'normWeight', resource: 'tensor:layerNormWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'normBias', resource: 'tensor:layerNormBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'outputValues', resource: 'tensor:vitPrefixHiddenStates', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
    },
    phases: [
      { name: 'tile-position-embeddings', kernel: 'tilePositionEmbeddings', dispatch: [workgroups(shape.patchTokens * shape.hiddenSize)], yieldAfter: true },
      { name: 'add-position-embeddings', kernel: 'addPositionEmbeddings', dispatch: [workgroups(totalValues)], yieldAfter: true },
      { name: 'vit-prefix-layernorm', kernel: 'vitPrefixLayernorm', dispatch: [workgroups(totalTokens)], yieldAfter: true },
      { name: 'readback-vit-prefix-hidden-states', readbacks: [{ name: 'vitPrefixHiddenStates', tensor: 'vitPrefixHiddenStates' }] },
    ],
    metadata: { routeId: SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID, layout: 'B,H,W,C', positionEmbeddingRule: 'tiling (repeating), not interpolation' },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    vitPrefixHiddenStates: await sha256Hex(run.outputs.vitPrefixHiddenStates),
  }, shape);
  const receipt = createSam3ImageVitPrefixPhaseProgramRouteReceipt({
    sourceImage,
    patchEmbeddings: patchEmbeddingsArtifact,
    weights: weightsArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { id: input.model?.id || route.model?.id, revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      vitPrefixHiddenStates: Array.from(new Float32Array(run.outputs.vitPrefixHiddenStates)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
