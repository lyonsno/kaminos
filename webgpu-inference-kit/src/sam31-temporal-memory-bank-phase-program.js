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

export const SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/sam3.1';
const DEFAULT_KERNEL_PROFILE = 'sam31-temporal-memory-bank-phase-program-v0';
const REQUIRED_STAGES = [
  'temporal-memory-load-tensors',
  'temporal-memory-spatial-assembly',
  'temporal-memory-spatial-image-assembly',
  'temporal-memory-pointer-copy',
  'temporal-memory-pointer-position',
  'temporal-memory-readback',
];
const INPUT_ROLES = [
  'source-video-episode',
  'sam31-temporal-spatial-memory-frames',
  'sam31-temporal-object-pointer-frames',
  'sam31-temporal-memory-position-weights',
];
const OUTPUT_ROLES = [{ key: 'bank', role: 'sam31-temporal-memory-attention-bank', required: true }];

export const TEMPORAL_SPATIAL_ASSEMBLY_WGSL = `
struct SpatialDims {
  batch: u32,
  frame_count: u32,
  frame_tokens: u32,
  channels: u32,
  spatial_tokens: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> frame_values: array<f32>;
@group(0) @binding(1) var<storage, read> frame_positions: array<f32>;
@group(0) @binding(2) var<storage, read> temporal_embeddings: array<f32>;
@group(0) @binding(3) var<storage, read> temporal_indices: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<storage, read_write> output_positions: array<f32>;
@group(0) @binding(6) var<uniform> dims: SpatialDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let token = (index / dims.channels) % dims.frame_tokens;
  let batch = (index / (dims.channels * dims.frame_tokens)) % dims.batch;
  let frame = index / (dims.channels * dims.frame_tokens * dims.batch);
  let source = (((frame * dims.batch + batch) * dims.frame_tokens + token) * dims.channels) + channel;
  let destination_token = frame * dims.frame_tokens + token;
  let destination = ((batch * dims.spatial_tokens + destination_token) * dims.channels) + channel;
  let temporal_index = u32(temporal_indices[frame]);
  let temporal_value = temporal_embeddings[temporal_index * dims.channels + channel];
  output_values[destination] = frame_values[source];
  output_positions[destination] = frame_positions[source] + temporal_value;
}
`;

const TEMPORAL_POINTER_COPY_WGSL = `
struct PointerDims {
  batch: u32,
  frame_count: u32,
  multiplex_count: u32,
  channels: u32,
  spatial_tokens: u32,
  memory_tokens: u32,
  max_pointer_frames: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> frame_pointers: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_memory: array<f32>;
@group(0) @binding(2) var<uniform> dims: PointerDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let pointer = (index / dims.channels) % dims.multiplex_count;
  let batch = (index / (dims.channels * dims.multiplex_count)) % dims.batch;
  let frame = index / (dims.channels * dims.multiplex_count * dims.batch);
  let source = (((frame * dims.batch + batch) * dims.multiplex_count + pointer) * dims.channels) + channel;
  let destination_token = dims.spatial_tokens + frame * dims.multiplex_count + pointer;
  let destination = ((batch * dims.memory_tokens + destination_token) * dims.channels) + channel;
  output_memory[destination] = frame_pointers[source];
}
`;

export const TEMPORAL_POINTER_POSITION_WGSL = `
struct PointerDims {
  batch: u32,
  frame_count: u32,
  multiplex_count: u32,
  channels: u32,
  spatial_tokens: u32,
  memory_tokens: u32,
  max_pointer_frames: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> relative_positions: array<f32>;
@group(0) @binding(1) var<storage, read> projection_weight: array<f32>;
@group(0) @binding(2) var<storage, read> projection_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_memory_pos: array<f32>;
@group(0) @binding(4) var<uniform> dims: PointerDims;

fn sine_component(relative_position: f32, component: u32) -> f32 {
  let half_dim = dims.channels / 2u;
  let frequency_index = component % half_dim;
  let exponent = 2.0 * f32(frequency_index / 2u) / f32(half_dim);
  let angle = (relative_position / f32(dims.max_pointer_frames - 1u)) / pow(10000.0, exponent);
  return select(cos(angle), sin(angle), component < half_dim);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let output_channel = index % dims.channels;
  let pointer = (index / dims.channels) % dims.multiplex_count;
  let batch = (index / (dims.channels * dims.multiplex_count)) % dims.batch;
  let frame = index / (dims.channels * dims.multiplex_count * dims.batch);
  var value = projection_bias[output_channel];
  for (var input_channel = 0u; input_channel < dims.channels; input_channel = input_channel + 1u) {
    value = value + projection_weight[output_channel * dims.channels + input_channel] * sine_component(relative_positions[frame], input_channel);
  }
  let destination_token = dims.spatial_tokens + frame * dims.multiplex_count + pointer;
  let destination = ((batch * dims.memory_tokens + destination_token) * dims.channels) + output_channel;
  output_memory_pos[destination] = value;
}
`;

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function integerArray(value, name) {
  if (!Array.isArray(value) || value.some(item => !Number.isInteger(item))) throw new Error(`${name} must be an integer array`);
  if (new Set(value).size !== value.length) throw new Error(`${name} must not contain duplicates`);
  return [...value];
}

function selectClosestConditioningFrames(frameIndex, conditioningFrames, maximum, keepFirst) {
  if (maximum === -1 || conditioningFrames.length <= maximum) return { selected: [...conditioningFrames], unselected: [] };
  if (maximum < 2) throw new Error('Meta temporal selection requires 2+ conditioning frames when selection is active');
  const selected = [];
  const add = value => { if (value !== undefined && !selected.includes(value)) selected.push(value); };
  if (keepFirst) {
    const before = conditioningFrames.filter(frame => frame < frameIndex);
    const after = conditioningFrames.filter(frame => frame > frameIndex);
    add(before.length ? Math.min(...before) : after.length ? Math.max(...after) : undefined);
  }
  const before = conditioningFrames.filter(frame => frame < frameIndex);
  const after = conditioningFrames.filter(frame => frame >= frameIndex);
  add(before.length ? Math.max(...before) : undefined);
  add(after.length ? Math.min(...after) : undefined);
  const remaining = conditioningFrames
    .filter(frame => !selected.includes(frame))
    .sort((left, right) => Math.abs(left - frameIndex) - Math.abs(right - frameIndex));
  for (const frame of remaining.slice(0, maximum - selected.length)) add(frame);
  return { selected, unselected: conditioningFrames.filter(frame => !selected.includes(frame)) };
}

export function createSam31TemporalMemoryBankPlan(input = {}) {
  const frameIndex = Number.isInteger(input.frameIndex) ? input.frameIndex : (() => { throw new Error('frameIndex must be an integer'); })();
  const numFrames = positiveInteger(input.numFrames, 'numFrames');
  const frameTokenCount = positiveInteger(input.frameTokenCount, 'frameTokenCount');
  const multiplexCount = positiveInteger(input.multiplexCount, 'multiplexCount');
  const numMaskmem = positiveInteger(input.numMaskmem, 'numMaskmem');
  const maxConditioningFrames = input.maxConditioningFrames === -1 ? -1 : positiveInteger(input.maxConditioningFrames, 'maxConditioningFrames');
  const maxObjectPointerFrames = positiveInteger(input.maxObjectPointerFrames, 'maxObjectPointerFrames');
  const memoryTemporalStride = positiveInteger(input.memoryTemporalStride ?? 1, 'memoryTemporalStride');
  const conditioningFrames = integerArray(input.conditioningFrameIndices, 'conditioningFrameIndices');
  const nonConditioningFrames = integerArray(input.nonConditioningFrameIndices, 'nonConditioningFrameIndices');
  if (conditioningFrames.length === 0) throw new Error('at least one conditioning frame is required');
  const selection = selectClosestConditioningFrames(frameIndex, conditioningFrames, maxConditioningFrames, input.keepFirstConditioningFrame === true);
  const nonConditioningSet = new Set(nonConditioningFrames);
  const unselectedSet = new Set(selection.unselected);
  const direction = input.trackInReverse === true ? -1 : 1;
  const spatialFrames = selection.selected.map(frame => ({
    frameIndex: frame,
    temporalPosition: (frameIndex - frame) * direction,
    isSelectedConditioningFrame: true,
  }));
  for (let temporalPosition = 1; temporalPosition < numMaskmem; temporalPosition += 1) {
    const relative = numMaskmem - temporalPosition;
    let previous;
    if (relative === 1) previous = frameIndex + (input.trackInReverse === true ? relative : -relative);
    else if (input.trackInReverse === true) previous = Math.ceil((frameIndex + 2) / memoryTemporalStride) * memoryTemporalStride + (relative - 2) * memoryTemporalStride;
    else previous = Math.floor((frameIndex - 2) / memoryTemporalStride) * memoryTemporalStride - (relative - 2) * memoryTemporalStride;
    if (nonConditioningSet.has(previous) || unselectedSet.has(previous)) spatialFrames.push({ frameIndex: previous, temporalPosition, isSelectedConditioningFrame: false });
  }
  for (const frame of spatialFrames) {
    const temporal = frame.temporalPosition;
    frame.temporalPositionIndex = input.useMaskmemTemporalPositionV2 !== false
      ? (temporal <= 0 || temporal >= numMaskmem ? numMaskmem - 1 : numMaskmem - temporal - 1)
      : numMaskmem - (frame.isSelectedConditioningFrame ? 0 : temporal) - 1;
  }
  const maxPointerFrames = Math.min(numFrames, maxObjectPointerFrames);
  const pointerFrames = [];
  for (const frame of selection.selected) {
    if (input.onlyObjectPointersInPastForEval === true && (input.trackInReverse === true ? frame < frameIndex : frame > frameIndex)) continue;
    pointerFrames.push({
      frameIndex: frame,
      relativePosition: input.useSignedPointerTemporalPosition === true ? (frameIndex - frame) * direction : Math.abs(frameIndex - frame),
      isSelectedConditioningFrame: true,
    });
  }
  for (let difference = 1; difference < maxPointerFrames; difference += 1) {
    const frame = frameIndex + (input.trackInReverse === true ? difference : -difference);
    if (frame < 0 || frame >= numFrames) break;
    if (nonConditioningSet.has(frame) || unselectedSet.has(frame)) pointerFrames.push({ frameIndex: frame, relativePosition: difference, isSelectedConditioningFrame: false });
  }
  if (spatialFrames.length === 0) throw new Error('the temporal memory plan selected no spatial frames');
  if (pointerFrames.length === 0) throw new Error('the temporal memory plan selected no object-pointer frames');
  return {
    frameIndex,
    numFrames,
    numMaskmem,
    frameTokenCount,
    multiplexCount,
    maxObjectPointerFrames: maxPointerFrames,
    selectedConditioningFrameIndices: selection.selected,
    unselectedConditioningFrameIndices: selection.unselected,
    spatialFrames,
    pointerFrames,
    spatialTokenCount: spatialFrames.length * frameTokenCount,
    objectPointerTokenCount: pointerFrames.length * multiplexCount,
    memoryTokenCount: spatialFrames.length * frameTokenCount + pointerFrames.length * multiplexCount,
  };
}

export function getSam31TemporalPointerPositionEncoding({ relativePosition, maxObjectPointerFrames, channels, temperature = 10000 }) {
  positiveInteger(maxObjectPointerFrames, 'maxObjectPointerFrames');
  positiveInteger(channels, 'channels');
  if (maxObjectPointerFrames < 2) throw new Error('maxObjectPointerFrames must be at least 2');
  if (channels % 2 !== 0) throw new Error('channels must be even');
  const half = channels / 2;
  const output = new Float32Array(channels);
  const normalized = relativePosition / (maxObjectPointerFrames - 1);
  for (let index = 0; index < half; index += 1) {
    const denominator = temperature ** (2 * Math.floor(index / 2) / half);
    output[index] = Math.sin(normalized / denominator);
    output[half + index] = Math.cos(normalized / denominator);
  }
  return output;
}

function requireFloat32(value, length, name) {
  if (!(value instanceof Float32Array) || value.length !== length) throw new Error(`${name} must be a Float32Array of length ${length}`);
  return value;
}

function flattenFrames(frames, key, expectedFrames, frameLength) {
  const output = new Float32Array(expectedFrames.length * frameLength);
  expectedFrames.forEach((planFrame, index) => {
    const frame = frames[index];
    if (!frame || frame.frameIndex !== planFrame.frameIndex) throw new Error(`${key} frame order does not match the temporal plan at index ${index}`);
    output.set(requireFloat32(frame[key], frameLength, `${key}[${index}]`), index * frameLength);
  });
  return output;
}

export function createSam31TemporalMemoryBankCpuOracle(input = {}) {
  const plan = input.plan;
  if (!plan || typeof plan !== 'object') throw new Error('plan is required');
  const channels = positiveInteger(input.channels, 'channels');
  const batch = positiveInteger(input.batch ?? 1, 'batch');
  const multiplexCount = positiveInteger(input.multiplexCount, 'multiplexCount');
  if (multiplexCount !== plan.multiplexCount) throw new Error('multiplexCount does not match plan');
  const spatialLength = batch * plan.frameTokenCount * channels;
  const pointerLength = batch * multiplexCount * channels;
  const temporalEmbeddings = requireFloat32(input.temporalEmbeddings, plan.numMaskmem * channels, 'temporalEmbeddings');
  const projection = input.pointerPositionProjection || {};
  const projectionWeight = requireFloat32(projection.weight, channels * channels, 'pointerPositionProjection.weight');
  const projectionBias = requireFloat32(projection.bias, channels, 'pointerPositionProjection.bias');
  const memoryImage = new Float32Array(batch * plan.spatialTokenCount * channels);
  const memoryImagePosition = new Float32Array(memoryImage.length);
  const memory = new Float32Array(batch * plan.memoryTokenCount * channels);
  const memoryPosition = new Float32Array(memory.length);
  plan.spatialFrames.forEach((planFrame, frameSlot) => {
    const frame = input.spatialFrames?.[frameSlot];
    if (!frame || frame.frameIndex !== planFrame.frameIndex) throw new Error(`spatial frame order does not match plan at index ${frameSlot}`);
    const frameMemory = requireFloat32(frame.memory, spatialLength, `spatialFrames[${frameSlot}].memory`);
    const frameMemoryPos = requireFloat32(frame.memoryPosition, spatialLength, `spatialFrames[${frameSlot}].memoryPosition`);
    const frameImage = requireFloat32(frame.image, spatialLength, `spatialFrames[${frameSlot}].image`);
    const frameImagePos = requireFloat32(frame.imagePosition, spatialLength, `spatialFrames[${frameSlot}].imagePosition`);
    for (let b = 0; b < batch; b += 1) for (let token = 0; token < plan.frameTokenCount; token += 1) for (let channel = 0; channel < channels; channel += 1) {
      const source = (b * plan.frameTokenCount + token) * channels + channel;
      const destinationToken = frameSlot * plan.frameTokenCount + token;
      const destinationSpatial = (b * plan.spatialTokenCount + destinationToken) * channels + channel;
      const destinationMemory = (b * plan.memoryTokenCount + destinationToken) * channels + channel;
      const temporal = temporalEmbeddings[planFrame.temporalPositionIndex * channels + channel];
      memoryImage[destinationSpatial] = frameImage[source];
      memoryImagePosition[destinationSpatial] = frameImagePos[source] + temporal;
      memory[destinationMemory] = frameMemory[source];
      memoryPosition[destinationMemory] = frameMemoryPos[source] + temporal;
    }
  });
  plan.pointerFrames.forEach((planFrame, frameSlot) => {
    const frame = input.pointerFrames?.[frameSlot];
    if (!frame || frame.frameIndex !== planFrame.frameIndex) throw new Error(`pointer frame order does not match plan at index ${frameSlot}`);
    const pointers = requireFloat32(frame.pointers, pointerLength, `pointerFrames[${frameSlot}].pointers`);
    const position = getSam31TemporalPointerPositionEncoding({ relativePosition: planFrame.relativePosition, maxObjectPointerFrames: plan.maxObjectPointerFrames, channels });
    const projected = new Float32Array(channels);
    for (let out = 0; out < channels; out += 1) {
      let sum = projectionBias[out];
      for (let inner = 0; inner < channels; inner += 1) sum += projectionWeight[out * channels + inner] * position[inner];
      projected[out] = sum;
    }
    for (let b = 0; b < batch; b += 1) for (let pointer = 0; pointer < multiplexCount; pointer += 1) for (let channel = 0; channel < channels; channel += 1) {
      const source = (b * multiplexCount + pointer) * channels + channel;
      const destinationToken = plan.spatialTokenCount + frameSlot * multiplexCount + pointer;
      const destination = (b * plan.memoryTokenCount + destinationToken) * channels + channel;
      memory[destination] = pointers[source];
      memoryPosition[destination] = projected[channel];
    }
  });
  return { memoryImage, memory, memoryImagePosition, memoryPosition };
}

function createDefaultScheduler() {
  const chunks = Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.endsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage.endsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.endsWith('readback') })),
      notes: 'Host control selects Meta-equivalent frame order; WebGPU assembles spatial memories, temporal embeddings, object pointers, and projected pointer positions before one bounded readback.',
    },
  });
}

export function createSam31TemporalMemoryBankPhaseProgramRouteDefinition(input = {}) {
  const metadata = createRouteKernelProfileMetadata(input, { defaultProfile: DEFAULT_KERNEL_PROFILE, requiredStages: REQUIRED_STAGES, timingSource: 'queue-submit-wait' });
  return defineWebGpuRoute({
    routeId: SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: MODEL_ID, revision: input.model?.revision || 'sam31-browser-temporal-memory-bank', dtype: input.model?.dtype || 'fp32' },
    kernel: metadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(({ role }) => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: metadata.requiredStages,
    timingSource: metadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createWebGpuRouteBackpressureProfile({ requestedBudget: 'visible-wait', effectiveBudget: 'visible-wait', memoryExclusivity: 'shared', warmCacheState: 'unknown' }),
    worker: input.worker || { exportName: 'runSam31TemporalMemoryBankPhaseProgramRoute', upstreamBoundary: 'browser-sam31-video-output-dictionary-to-memory-attention-bank' },
  });
}

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function tensorBinding(name, access = 'read-only-storage') {
  return { name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access };
}

function uniformBinding(name) {
  return { name, resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' };
}

function workgroups(total) { return Math.max(1, Math.ceil(total / 64)); }

async function aggregateSha256(arrays) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM3.1 temporal memory-bank outputs');
  const bytes = arrays.map(array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  const total = bytes.reduce((sum, array) => sum + array.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const array of bytes) { joined.set(array, offset); offset += array.byteLength; }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', joined);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function runSam31TemporalMemoryBankPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const plan = input.plan;
  if (!plan || typeof plan !== 'object') throw new Error('plan is required');
  const channels = positiveInteger(input.channels, 'channels');
  const batch = positiveInteger(input.batch ?? 1, 'batch');
  const multiplexCount = positiveInteger(input.multiplexCount, 'multiplexCount');
  if (plan.multiplexCount !== multiplexCount) throw new Error('multiplexCount does not match plan');
  const spatialFrameLength = batch * plan.frameTokenCount * channels;
  const pointerFrameLength = batch * multiplexCount * channels;
  const spatialMemory = flattenFrames(input.spatialFrames, 'memory', plan.spatialFrames, spatialFrameLength);
  const spatialMemoryPos = flattenFrames(input.spatialFrames, 'memoryPosition', plan.spatialFrames, spatialFrameLength);
  const spatialImage = flattenFrames(input.spatialFrames, 'image', plan.spatialFrames, spatialFrameLength);
  const spatialImagePos = flattenFrames(input.spatialFrames, 'imagePosition', plan.spatialFrames, spatialFrameLength);
  const pointerValues = flattenFrames(input.pointerFrames, 'pointers', plan.pointerFrames, pointerFrameLength);
  const temporalEmbeddings = requireFloat32(input.temporalEmbeddings, plan.numMaskmem * channels, 'temporalEmbeddings');
  const temporalIndices = new Float32Array(plan.spatialFrames.map(frame => frame.temporalPositionIndex));
  const relativePositions = new Float32Array(plan.pointerFrames.map(frame => frame.relativePosition));
  const projectionWeight = requireFloat32(input.pointerPositionProjection?.weight, channels * channels, 'pointerPositionProjection.weight');
  const projectionBias = requireFloat32(input.pointerPositionProjection?.bias, channels, 'pointerPositionProjection.bias');
  const route = input.route || createSam31TemporalMemoryBankPhaseProgramRouteDefinition({ kernel: input.kernel });
  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam31-temporal-memory-bank-phase-program',
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
  const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
  const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  let tensors;
  await runtime.runStage('temporal-memory-load-tensors', async stage => {
    const create = (name, shape, tensorUsage = usage) => stage.createTensor({ name: `sam31.temporal-memory.${name}`, shape, dtype: 'f32', usage: tensorUsage });
    tensors = {
      spatialMemory: create('spatial-memory', [plan.spatialFrames.length, batch, plan.frameTokenCount, channels], readonlyUsage),
      spatialMemoryPos: create('spatial-memory-pos', [plan.spatialFrames.length, batch, plan.frameTokenCount, channels], readonlyUsage),
      spatialImage: create('spatial-image', [plan.spatialFrames.length, batch, plan.frameTokenCount, channels], readonlyUsage),
      spatialImagePos: create('spatial-image-pos', [plan.spatialFrames.length, batch, plan.frameTokenCount, channels], readonlyUsage),
      temporalEmbeddings: create('temporal-embeddings', [plan.numMaskmem, channels], readonlyUsage),
      temporalIndices: create('temporal-indices', [plan.spatialFrames.length], readonlyUsage),
      pointerValues: create('pointer-values', [plan.pointerFrames.length, batch, multiplexCount, channels], readonlyUsage),
      relativePositions: create('relative-positions', [plan.pointerFrames.length], readonlyUsage),
      projectionWeight: create('pointer-position-projection-weight', [channels, channels], readonlyUsage),
      projectionBias: create('pointer-position-projection-bias', [channels], readonlyUsage),
      memoryImage: create('memory-image', [batch, plan.spatialTokenCount, channels]),
      memory: create('memory', [batch, plan.memoryTokenCount, channels]),
      memoryImagePos: create('memory-image-pos', [batch, plan.spatialTokenCount, channels]),
      memoryPos: create('memory-pos', [batch, plan.memoryTokenCount, channels]),
    };
    for (const [tensor, values] of [
      [tensors.spatialMemory, spatialMemory], [tensors.spatialMemoryPos, spatialMemoryPos],
      [tensors.spatialImage, spatialImage], [tensors.spatialImagePos, spatialImagePos],
      [tensors.temporalEmbeddings, temporalEmbeddings], [tensors.temporalIndices, temporalIndices],
      [tensors.pointerValues, pointerValues], [tensors.relativePositions, relativePositions],
      [tensors.projectionWeight, projectionWeight], [tensors.projectionBias, projectionBias],
    ]) stage.uploadTensor(tensor, values);
    const spatialTotal = plan.spatialFrames.length * batch * plan.frameTokenCount * channels;
    const pointerTotal = plan.pointerFrames.length * batch * multiplexCount * channels;
    tensors.spatialDims = stage.createUniformBuffer({
      label: 'sam31.temporal-memory.spatial-dims',
      schema: ['batch', 'frame_count', 'frame_tokens', 'channels', 'spatial_tokens', 'total'].map(name => ({ name, type: 'u32' })),
      values: { batch, frame_count: plan.spatialFrames.length, frame_tokens: plan.frameTokenCount, channels, spatial_tokens: plan.spatialTokenCount, total: spatialTotal },
    });
    tensors.pointerDims = stage.createUniformBuffer({
      label: 'sam31.temporal-memory.pointer-dims',
      schema: ['batch', 'frame_count', 'multiplex_count', 'channels', 'spatial_tokens', 'memory_tokens', 'max_pointer_frames', 'total'].map(name => ({ name, type: 'u32' })),
      values: { batch, frame_count: plan.pointerFrames.length, multiplex_count: multiplexCount, channels, spatial_tokens: plan.spatialTokenCount, memory_tokens: plan.memoryTokenCount, max_pointer_frames: plan.maxObjectPointerFrames, total: pointerTotal },
    });
  });
  const programTensors = Object.fromEntries(Object.entries(tensors).filter(([name]) => name !== 'spatialDims' && name !== 'pointerDims'));
  const bind = (name, access = 'read-only-storage') => tensorBinding(name, access);
  const kernels = {
    spatialAssembly: { code: TEMPORAL_SPATIAL_ASSEMBLY_WGSL, bindings: [bind('spatialMemory'), bind('spatialMemoryPos'), bind('temporalEmbeddings'), bind('temporalIndices'), bind('memory', 'storage'), bind('memoryPos', 'storage'), uniformBinding('spatialDims')] },
    spatialImageAssembly: { code: TEMPORAL_SPATIAL_ASSEMBLY_WGSL, bindings: [bind('spatialImage'), bind('spatialImagePos'), bind('temporalEmbeddings'), bind('temporalIndices'), bind('memoryImage', 'storage'), bind('memoryImagePos', 'storage'), uniformBinding('spatialDims')] },
    pointerCopy: { code: TEMPORAL_POINTER_COPY_WGSL, bindings: [bind('pointerValues'), bind('memory', 'storage'), uniformBinding('pointerDims')] },
    pointerPosition: { code: TEMPORAL_POINTER_POSITION_WGSL, bindings: [bind('relativePositions'), bind('projectionWeight'), bind('projectionBias'), bind('memoryPos', 'storage'), uniformBinding('pointerDims')] },
  };
  const spatialTotal = plan.spatialFrames.length * batch * plan.frameTokenCount * channels;
  const pointerTotal = plan.pointerFrames.length * batch * multiplexCount * channels;
  const program = runtime.defineProgram({
    name: 'sam31.temporal-memory-bank-phase-program',
    tensors: programTensors,
    uniforms: { spatialDims: tensors.spatialDims, pointerDims: tensors.pointerDims },
    kernels,
    phases: [
      { name: 'temporal-memory-spatial-assembly', kernel: 'spatialAssembly', dispatch: [workgroups(spatialTotal)], yieldAfter: true },
      { name: 'temporal-memory-spatial-image-assembly', kernel: 'spatialImageAssembly', dispatch: [workgroups(spatialTotal)], yieldAfter: true },
      { name: 'temporal-memory-pointer-copy', kernel: 'pointerCopy', dispatch: [workgroups(pointerTotal)], yieldAfter: true },
      { name: 'temporal-memory-pointer-position', kernel: 'pointerPosition', dispatch: [workgroups(pointerTotal)], yieldAfter: true },
      { name: 'temporal-memory-readback', readbacks: [
        { name: 'memoryImage', tensor: 'memoryImage' },
        { name: 'memory', tensor: 'memory' },
        { name: 'memoryImagePosition', tensor: 'memoryImagePos' },
        { name: 'memoryPosition', tensor: 'memoryPos' },
      ] },
    ],
    metadata: {
      routeId: SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID,
      sourceBoundary: 'Meta Sam3VideoTrackingMultiplex._prepare_memory_conditioned_features memory assembly',
      selectedConditioningFrameIndices: plan.selectedConditioningFrameIndices,
      spatialFrameIndices: plan.spatialFrames.map(frame => frame.frameIndex),
      pointerFrameIndices: plan.pointerFrames.map(frame => frame.frameIndex),
      numObjPtrTokens: plan.objectPointerTokenCount,
    },
  });
  const run = await runtime.runProgram(program);
  const arrays = ['memoryImage', 'memory', 'memoryImagePosition', 'memoryPosition'].map(name => new Float32Array(run.outputs[name]));
  const outputArtifact = roleArtifact(input.request.outputs, 'sam31-temporal-memory-attention-bank');
  const outputs = {
    bank: {
      artifactId: outputArtifact.artifactId,
      sha256: await aggregateSha256(arrays),
      shape: [batch, plan.memoryTokenCount, channels],
      componentShapes: { memoryImage: [batch, plan.spatialTokenCount, channels], memoryImagePosition: [batch, plan.spatialTokenCount, channels], memoryPosition: [batch, plan.memoryTokenCount, channels] },
      numObjPtrTokens: plan.objectPointerTokenCount,
    },
  };
  const receipt = createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID,
    status: 'real',
    fallbackReason: null,
    backend: runtime.backendIdentity,
    model: { id: MODEL_ID, revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || roleArtifact(input.request.inputs, 'sam31-temporal-memory-position-weights').sha256, dtype: 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel || runtime.kernel, { requireProfile: true }),
    inputs: INPUT_ROLES.map(role => createRouteReceiptInputArtifact(role, roleArtifact(input.request.inputs, role))),
    outputs: createRouteReceiptArtifacts({ artifacts: outputs, roles: OUTPUT_ROLES }),
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  authoritative.plan = {
    selectedConditioningFrameIndices: plan.selectedConditioningFrameIndices,
    unselectedConditioningFrameIndices: plan.unselectedConditioningFrameIndices,
    spatialFrameIndices: plan.spatialFrames.map(frame => frame.frameIndex),
    spatialTemporalPositionIndices: plan.spatialFrames.map(frame => frame.temporalPositionIndex),
    pointerFrameIndices: plan.pointerFrames.map(frame => frame.frameIndex),
    pointerRelativePositions: plan.pointerFrames.map(frame => frame.relativePosition),
    memorySpatialTokens: plan.spatialTokenCount,
    numObjPtrTokens: plan.objectPointerTokenCount,
    memoryTokens: plan.memoryTokenCount,
  };
  if (input.includeReadback === true) authoritative.debugReadback = {
    memoryImage: Array.from(arrays[0]), memory: Array.from(arrays[1]), memoryImagePosition: Array.from(arrays[2]), memoryPosition: Array.from(arrays[3]),
  };
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
