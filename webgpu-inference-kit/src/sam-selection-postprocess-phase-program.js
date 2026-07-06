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

export const SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.selection-postprocess.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-selection-postprocess-phase-program-v0';
const REQUIRED_STAGES = [
  'load-selection-tensors',
  'selection-score-threshold',
  'selection-box-cxcywh-to-xyxy',
  'selection-argmax',
  'readback-selection',
];
const INPUT_ROLES = ['source-image', 'sam3-selection-tensors'];
const OUTPUT_ROLES = [
  { key: 'scores', role: 'selection-scores', required: true },
  { key: 'boxes', role: 'selection-boxes', required: true },
  { key: 'keep', role: 'selection-keep', required: true },
  { key: 'selectedIndex', role: 'selected-index', required: true },
  { key: 'selectedScore', role: 'selected-score', required: true },
  { key: 'selectedBox', role: 'selected-box', required: true },
];

const POSTPROCESS_WGSL = `
struct SelectionDims {
  layer_count: u32,
  batch: u32,
  query_tokens: u32,
  image_height: u32,
  image_width: u32,
  total_queries: u32,
  score_threshold: f32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> pred_logits: array<f32>;
@group(0) @binding(1) var<storage, read> reference_boxes: array<f32>;
@group(0) @binding(2) var<storage, read> presence_logits: array<f32>;
@group(0) @binding(3) var<storage, read_write> scores: array<f32>;
@group(0) @binding(4) var<storage, read_write> boxes: array<f32>;
@group(0) @binding(5) var<storage, read_write> keep: array<u32>;
@group(0) @binding(6) var<uniform> dims: SelectionDims;

fn sigmoid(value: f32) -> f32 {
  return 1.0 / (1.0 + exp(-value));
}

fn clamp_pixel(value: f32, max_value: f32) -> f32 {
  return min(max(value, 0.0), max_value);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_queries) { return; }
  let query = index % dims.query_tokens;
  let batch = index / dims.query_tokens;
  let last_layer = dims.layer_count - 1u;
  let logits_index = (last_layer * dims.batch + batch) * dims.query_tokens + query;
  let presence_index = last_layer * dims.batch + batch;
  let score = sigmoid(pred_logits[logits_index]) * sigmoid(presence_logits[presence_index]);
  scores[index] = score;
  keep[index] = select(0u, 1u, score > dims.score_threshold);

  let box_base = index * 4u;
  let cx = reference_boxes[box_base + 0u];
  let cy = reference_boxes[box_base + 1u];
  let width = reference_boxes[box_base + 2u];
  let height = reference_boxes[box_base + 3u];
  let image_width = f32(dims.image_width);
  let image_height = f32(dims.image_height);
  boxes[box_base + 0u] = clamp_pixel((cx - width * 0.5) * image_width, image_width);
  boxes[box_base + 1u] = clamp_pixel((cy - height * 0.5) * image_height, image_height);
  boxes[box_base + 2u] = clamp_pixel((cx + width * 0.5) * image_width, image_width);
  boxes[box_base + 3u] = clamp_pixel((cy + height * 0.5) * image_height, image_height);
}
`;

const SELECT_WGSL = `
struct SelectionDims {
  layer_count: u32,
  batch: u32,
  query_tokens: u32,
  image_height: u32,
  image_width: u32,
  total_queries: u32,
  score_threshold: f32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> scores: array<f32>;
@group(0) @binding(1) var<storage, read> boxes: array<f32>;
@group(0) @binding(2) var<storage, read> keep: array<u32>;
@group(0) @binding(3) var<storage, read_write> selected_index: array<u32>;
@group(0) @binding(4) var<storage, read_write> selected_score: array<f32>;
@group(0) @binding(5) var<storage, read_write> selected_box: array<f32>;
@group(0) @binding(6) var<uniform> dims: SelectionDims;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let batch = gid.x;
  if (batch >= dims.batch) { return; }
  var best_index = 0u;
  var best_score = -1.0;
  for (var query = 0u; query < dims.query_tokens; query = query + 1u) {
    let index = batch * dims.query_tokens + query;
    let score = scores[index];
    if (keep[index] == 1u && score > best_score) {
      best_score = score;
      best_index = query;
    }
  }
  selected_index[batch] = best_index;
  selected_score[batch] = max(best_score, 0.0);
  let source_base = (batch * dims.query_tokens + best_index) * 4u;
  let target_base = batch * 4u;
  selected_box[target_base + 0u] = select(0.0, boxes[source_base + 0u], best_score >= 0.0);
  selected_box[target_base + 1u] = select(0.0, boxes[source_base + 1u], best_score >= 0.0);
  selected_box[target_base + 2u] = select(0.0, boxes[source_base + 2u], best_score >= 0.0);
  selected_box[target_base + 3u] = select(0.0, boxes[source_base + 3u], best_score >= 0.0);
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-selection' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-selection' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-selection' })),
      notes: 'SAM3 selection postprocess phase program cooperates between score thresholding, box conversion, argmax, and readback boundaries.',
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
    imageHeight: shape.imageHeight,
    imageWidth: shape.imageWidth,
    scoreThreshold: shape.scoreThreshold,
  };
  for (const key of ['layerCount', 'batch', 'queryTokens', 'imageHeight', 'imageWidth']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (typeof out.scoreThreshold !== 'number' || !Number.isFinite(out.scoreThreshold)) throw new Error('shape.scoreThreshold must be finite');
  return out;
}

function validateSelectionInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const predLogits = ensureFloat32Array(input.predLogits, 'predLogits');
  const referenceBoxes = ensureFloat32Array(input.referenceBoxes, 'referenceBoxes');
  const presenceLogits = ensureFloat32Array(input.presenceLogits, 'presenceLogits');
  const expectedPred = shape.layerCount * shape.batch * shape.queryTokens;
  const expectedBoxes = shape.batch * shape.queryTokens * 4;
  const expectedPresence = shape.layerCount * shape.batch;
  if (predLogits.length !== expectedPred) throw new Error(`predLogits length ${predLogits.length} does not match shape (${expectedPred})`);
  if (referenceBoxes.length !== expectedBoxes) throw new Error(`referenceBoxes length ${referenceBoxes.length} does not match shape (${expectedBoxes})`);
  if (presenceLogits.length !== expectedPresence) throw new Error(`presenceLogits length ${presenceLogits.length} does not match shape (${expectedPresence})`);
  return { shape, predLogits, referenceBoxes, presenceLogits };
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function clipPixel(value, maxValue) {
  return Math.min(Math.max(value, 0), maxValue);
}

export function createSam3SelectionPostprocessPhaseProgramCpuOracle(input) {
  const { shape, predLogits, referenceBoxes, presenceLogits } = validateSelectionInputs(input);
  const total = shape.batch * shape.queryTokens;
  const scores = new Float32Array(total);
  const boxes = new Float32Array(total * 4);
  const keep = new Uint32Array(total);
  const selectedIndex = new Uint32Array(shape.batch);
  const selectedScore = new Float32Array(shape.batch);
  const selectedBox = new Float32Array(shape.batch * 4);
  const layer = shape.layerCount - 1;
  for (let b = 0; b < shape.batch; b += 1) {
    let bestIndex = 0;
    let bestScore = -1;
    const presence = sigmoid(presenceLogits[layer * shape.batch + b]);
    for (let q = 0; q < shape.queryTokens; q += 1) {
      const index = b * shape.queryTokens + q;
      const score = sigmoid(predLogits[(layer * shape.batch + b) * shape.queryTokens + q]) * presence;
      scores[index] = score;
      keep[index] = score > shape.scoreThreshold ? 1 : 0;
      const boxBase = index * 4;
      const cx = referenceBoxes[boxBase];
      const cy = referenceBoxes[boxBase + 1];
      const width = referenceBoxes[boxBase + 2];
      const height = referenceBoxes[boxBase + 3];
      boxes[boxBase] = clipPixel((cx - width / 2) * shape.imageWidth, shape.imageWidth);
      boxes[boxBase + 1] = clipPixel((cy - height / 2) * shape.imageHeight, shape.imageHeight);
      boxes[boxBase + 2] = clipPixel((cx + width / 2) * shape.imageWidth, shape.imageWidth);
      boxes[boxBase + 3] = clipPixel((cy + height / 2) * shape.imageHeight, shape.imageHeight);
      if (keep[index] && score > bestScore) {
        bestScore = score;
        bestIndex = q;
      }
    }
    selectedIndex[b] = bestIndex;
    selectedScore[b] = Math.max(bestScore, 0);
    if (bestScore >= 0) selectedBox.set(boxes.slice((b * shape.queryTokens + bestIndex) * 4, (b * shape.queryTokens + bestIndex + 1) * 4), b * 4);
  }
  return { shape, scores, boxes, keep, selectedIndex, selectedScore, selectedBox };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM selection outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const scoreShape = [shape.batch, shape.queryTokens];
  const boxShape = [shape.batch, shape.queryTokens, 4];
  return {
    scores: { artifactId: roleArtifact(request.outputs, 'selection-scores').artifactId, sha256: hashes.scores, shape: scoreShape },
    boxes: { artifactId: roleArtifact(request.outputs, 'selection-boxes').artifactId, sha256: hashes.boxes, shape: boxShape },
    keep: { artifactId: roleArtifact(request.outputs, 'selection-keep').artifactId, sha256: hashes.keep, shape: scoreShape },
    selectedIndex: { artifactId: roleArtifact(request.outputs, 'selected-index').artifactId, sha256: hashes.selectedIndex, shape: [shape.batch] },
    selectedScore: { artifactId: roleArtifact(request.outputs, 'selected-score').artifactId, sha256: hashes.selectedScore, shape: [shape.batch] },
    selectedBox: { artifactId: roleArtifact(request.outputs, 'selected-box').artifactId, sha256: hashes.selectedBox, shape: [shape.batch, 4] },
  };
}

export function createSam3SelectionPostprocessPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-selection-tensors', input.tensorPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3SelectionPostprocessPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-selection', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3SelectionPostprocessPhaseProgramRoute', upstreamBoundary: 'browser-scoring-decoder-selection-tensors' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3SelectionPostprocessPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3SelectionPostprocessPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-selection-tensors');
  const { shape, predLogits, referenceBoxes, presenceLogits } = validateSelectionInputs(input.tensors || {});
  const totalQueries = shape.batch * shape.queryTokens;
  const totalBoxes = totalQueries * 4;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-selection-postprocess-phase-program',
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
  await runtime.runStage('load-selection-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      predLogits: stage.createTensor({ name: 'sam3.selection.pred-logits', shape: [shape.layerCount, shape.batch, shape.queryTokens, 1], dtype: 'f32', usage: readonlyUsage }),
      referenceBoxes: stage.createTensor({ name: 'sam3.selection.reference-boxes', shape: [shape.batch, shape.queryTokens, 4], dtype: 'f32', usage: readonlyUsage }),
      presenceLogits: stage.createTensor({ name: 'sam3.selection.presence-logits', shape: [shape.layerCount, shape.batch, 1], dtype: 'f32', usage: readonlyUsage }),
      scores: stage.createTensor({ name: 'sam3.selection.scores', shape: [shape.batch, shape.queryTokens], dtype: 'f32', usage }),
      boxes: stage.createTensor({ name: 'sam3.selection.boxes', shape: [shape.batch, shape.queryTokens, 4], dtype: 'f32', usage }),
      keep: stage.createTensor({ name: 'sam3.selection.keep', shape: [shape.batch, shape.queryTokens], dtype: 'u32', usage }),
      selectedIndex: stage.createTensor({ name: 'sam3.selection.selected-index', shape: [shape.batch], dtype: 'u32', usage }),
      selectedScore: stage.createTensor({ name: 'sam3.selection.selected-score', shape: [shape.batch], dtype: 'f32', usage }),
      selectedBox: stage.createTensor({ name: 'sam3.selection.selected-box', shape: [shape.batch, 4], dtype: 'f32', usage }),
      dims: stage.createUniformBuffer({
        label: 'sam3.selection.dims',
        schema: [
          { name: 'layer_count', type: 'u32' },
          { name: 'batch', type: 'u32' },
          { name: 'query_tokens', type: 'u32' },
          { name: 'image_height', type: 'u32' },
          { name: 'image_width', type: 'u32' },
          { name: 'total_queries', type: 'u32' },
          { name: 'score_threshold', type: 'f32' },
          { name: '_pad', type: 'u32' },
        ],
        values: {
          layer_count: shape.layerCount,
          batch: shape.batch,
          query_tokens: shape.queryTokens,
          image_height: shape.imageHeight,
          image_width: shape.imageWidth,
          total_queries: totalQueries,
          score_threshold: shape.scoreThreshold,
          _pad: 0,
        },
      }),
    };
    stage.uploadTensor(tensors.predLogits, predLogits);
    stage.uploadTensor(tensors.referenceBoxes, referenceBoxes);
    stage.uploadTensor(tensors.presenceLogits, presenceLogits);
    await stage.yieldToBrowser({ reason: 'after-sam3-selection-upload' });
  }, { shape });

  const program = runtime.defineProgram({
    name: 'sam3.selection-postprocess-phase-program',
    tensors: {
      predLogits: tensors.predLogits,
      referenceBoxes: tensors.referenceBoxes,
      presenceLogits: tensors.presenceLogits,
      scores: tensors.scores,
      boxes: tensors.boxes,
      keep: tensors.keep,
      selectedIndex: tensors.selectedIndex,
      selectedScore: tensors.selectedScore,
      selectedBox: tensors.selectedBox,
    },
    uniforms: { dims: tensors.dims },
    kernels: {
      postprocess: {
        code: POSTPROCESS_WGSL,
        bindings: [
          { name: 'predLogits', resource: 'tensor:predLogits', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'referenceBoxes', resource: 'tensor:referenceBoxes', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'presenceLogits', resource: 'tensor:presenceLogits', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'scores', resource: 'tensor:scores', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'boxes', resource: 'tensor:boxes', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'keep', resource: 'tensor:keep', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
      select: {
        code: SELECT_WGSL,
        bindings: [
          { name: 'scores', resource: 'tensor:scores', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'boxes', resource: 'tensor:boxes', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'keep', resource: 'tensor:keep', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'selectedIndex', resource: 'tensor:selectedIndex', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'selectedScore', resource: 'tensor:selectedScore', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'selectedBox', resource: 'tensor:selectedBox', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
    },
    phases: [
      { name: 'selection-score-threshold', kernel: 'postprocess', dispatch: [workgroups(totalQueries)], yieldAfter: true },
      { name: 'selection-box-cxcywh-to-xyxy', kernel: 'postprocess', dispatch: [workgroups(totalQueries)], yieldAfter: true },
      { name: 'selection-argmax', kernel: 'select', dispatch: [shape.batch], yieldAfter: true },
      { name: 'readback-selection', readbacks: [
        { name: 'scores', tensor: 'scores' },
        { name: 'boxes', tensor: 'boxes' },
        { name: 'keep', tensor: 'keep' },
        { name: 'selectedIndex', tensor: 'selectedIndex' },
        { name: 'selectedScore', tensor: 'selectedScore' },
        { name: 'selectedBox', tensor: 'selectedBox' },
      ] },
    ],
    metadata: { routeId: SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    scores: await sha256Hex(run.outputs.scores),
    boxes: await sha256Hex(run.outputs.boxes),
    keep: await sha256Hex(run.outputs.keep),
    selectedIndex: await sha256Hex(run.outputs.selectedIndex),
    selectedScore: await sha256Hex(run.outputs.selectedScore),
    selectedBox: await sha256Hex(run.outputs.selectedBox),
  }, shape);
  const receipt = createSam3SelectionPostprocessPhaseProgramRouteReceipt({
    sourceImage,
    tensorPacket,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || 'none', dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      scores: Array.from(new Float32Array(run.outputs.scores)),
      boxes: Array.from(new Float32Array(run.outputs.boxes)),
      keep: Array.from(new Uint32Array(run.outputs.keep)),
      selectedIndex: Array.from(new Uint32Array(run.outputs.selectedIndex)),
      selectedScore: Array.from(new Float32Array(run.outputs.selectedScore)),
      selectedBox: Array.from(new Float32Array(run.outputs.selectedBox)),
    };
  }
  return authoritative;
}
