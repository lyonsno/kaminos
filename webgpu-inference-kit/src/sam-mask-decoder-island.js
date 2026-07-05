import { defineWebGpuRoute, createRouteWorkerResult } from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
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

export const SAM3_MASK_DECODER_ISLAND_ROUTE_ID = 'sam3.mask-decoder-island.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-mask-projection-threshold-v0';
const REQUIRED_STAGES = [
  'load-decoder-tensors',
  'decode-mask',
  'threshold-mask',
  'readback-mask',
];
const INPUT_ROLES = [
  'source-image',
  'sam3-decoder-tensors',
  'sam3-decoder-weights',
];
const OUTPUT_ROLES = [
  { key: 'maskLogits', role: 'mask-logits', required: true },
  { key: 'binaryMask', role: 'mask-binary', required: true },
  { key: 'maskOverlay', role: 'mask-overlay', required: false },
];

const GPUBufferUsageFlags = {
  MAP_READ: globalThis.GPUBufferUsage?.MAP_READ ?? 1,
  COPY_SRC: globalThis.GPUBufferUsage?.COPY_SRC ?? 4,
  COPY_DST: globalThis.GPUBufferUsage?.COPY_DST ?? 8,
  STORAGE: globalThis.GPUBufferUsage?.STORAGE ?? 128,
  UNIFORM: globalThis.GPUBufferUsage?.UNIFORM ?? 64,
};

const MASK_PROJECTION_WGSL = `
struct ProjectionDims {
  batch: u32,
  mask_tokens: u32,
  channels: u32,
  height: u32,
  width: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> hyper_input: array<f32>;
@group(0) @binding(1) var<storage, read> upscaled_embedding: array<f32>;
@group(0) @binding(2) var<storage, read_write> mask_logits: array<f32>;
@group(0) @binding(3) var<uniform> dims: ProjectionDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) {
    return;
  }

  let hw = dims.height * dims.width;
  let spatial = index % hw;
  let token_index = (index / hw) % dims.mask_tokens;
  let batch_index = index / (hw * dims.mask_tokens);

  var sum = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let hyper_index = ((batch_index * dims.mask_tokens + token_index) * dims.channels) + channel;
    let embedding_index = ((batch_index * dims.channels + channel) * hw) + spatial;
    sum = sum + hyper_input[hyper_index] * upscaled_embedding[embedding_index];
  }
  mask_logits[index] = sum;
}
`;

const THRESHOLD_WGSL = `
struct ThresholdDims {
  total: u32,
};

@group(0) @binding(0) var<storage, read> mask_logits: array<f32>;
@group(0) @binding(1) var<storage, read_write> binary_mask: array<u32>;
@group(0) @binding(2) var<uniform> dims: ThresholdDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) {
    return;
  }
  binary_mask[index] = select(0u, 1u, mask_logits[index] > 0.0);
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: {
      mode: 'cooperative',
      yieldMs: 0,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        'load-decoder-tensors': 1,
        'decode-mask': 1,
        'threshold-mask': 1,
        'readback-mask': 1,
      },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      yieldMs: 0,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        'load-decoder-tensors': 1,
        'decode-mask': 1,
        'threshold-mask': 1,
        'readback-mask': 1,
      },
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({
        name: `${stage}-phase`,
        stage,
        kind: stage === 'readback-mask' ? 'readback-bound' : 'gpu-submit-bound',
        interruptible: false,
        canYieldBefore: true,
        canYieldAfter: true,
        nonInterruptibleReason: stage === 'readback-mask'
          ? null
          : 'Browser WebGPU cannot preempt a submitted SAM mask island compute pass.',
      })),
      checkpoints: REQUIRED_STAGES.map(stage => ({
        name: `after-${stage}`,
        kind: stage === 'readback-mask' ? 'readback' : 'stage-boundary',
        afterStage: stage,
        yieldable: true,
        waitsForSubmittedWorkDone: stage !== 'readback-mask',
      })),
      notes: 'SAM3 mask island cooperates between tensor upload, projection, threshold, and readback boundaries.',
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

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
    maskTokens: shape.maskTokens,
    channels: shape.channels,
    height: shape.height,
    width: shape.width,
  };
  for (const [key, value] of Object.entries(out)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  return out;
}

function elementCount(shape) {
  return shape.batch * shape.maskTokens * shape.height * shape.width;
}

function validateProjectionInputs({ hyperInput, upscaledEmbedding, shape }) {
  const normalized = normalizeShape(shape);
  const hyper = ensureFloat32Array(hyperInput, 'hyperInput');
  const embedding = ensureFloat32Array(upscaledEmbedding, 'upscaledEmbedding');
  const expectedHyper = normalized.batch * normalized.maskTokens * normalized.channels;
  const expectedEmbedding = normalized.batch * normalized.channels * normalized.height * normalized.width;
  if (hyper.length !== expectedHyper) {
    throw new Error(`hyperInput length ${hyper.length} does not match shape (${expectedHyper})`);
  }
  if (embedding.length !== expectedEmbedding) {
    throw new Error(`upscaledEmbedding length ${embedding.length} does not match shape (${expectedEmbedding})`);
  }
  return { hyperInput: hyper, upscaledEmbedding: embedding, shape: normalized };
}

function workgroups(total, groupSize = 64) {
  return Math.max(1, Math.ceil(total / groupSize));
}

function createOutputArtifacts(request, hashes, shape) {
  const logitsRequest = roleArtifact(request.outputs, 'mask-logits');
  const binaryRequest = roleArtifact(request.outputs, 'mask-binary');
  const overlayRequest = Array.isArray(request.outputs)
    ? request.outputs.find(entry => entry?.role === 'mask-overlay')
    : request.outputs?.['mask-overlay'];

  const outputs = {
    maskLogits: {
      artifactId: logitsRequest.artifactId,
      sha256: hashes.maskLogits,
      shape,
    },
    binaryMask: {
      artifactId: binaryRequest.artifactId,
      sha256: hashes.binaryMask,
      shape,
    },
  };

  if (overlayRequest?.artifactId && hashes.maskOverlay) {
    outputs.maskOverlay = {
      artifactId: overlayRequest.artifactId,
      sha256: hashes.maskOverlay,
      shape: overlayRequest.shape || [1],
    };
  }

  return outputs;
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error('crypto.subtle.digest is required to hash SAM mask island outputs');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function requireCommandEncoder(device) {
  if (typeof device.createCommandEncoder !== 'function') {
    throw new Error('device.createCommandEncoder must be available for SAM mask island execution');
  }
}

function dispatchProjection({ runtime, stage, buffers, total }) {
  const module = stage.getShaderModule('sam3.mask-projection', MASK_PROJECTION_WGSL);
  const pipeline = stage.getComputePipeline('sam3.mask-projection', {
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = runtime.device.createBindGroup({
    label: 'sam3.mask-projection.bind-group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.hyperInput } },
      { binding: 1, resource: { buffer: buffers.upscaledEmbedding } },
      { binding: 2, resource: { buffer: buffers.maskLogits } },
      { binding: 3, resource: { buffer: buffers.projectionDims } },
    ],
  });

  const encoder = runtime.device.createCommandEncoder({ label: 'sam3.mask-projection.encoder' });
  const pass = encoder.beginComputePass({ label: 'sam3.mask-projection.pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroups(total));
  pass.end();
  encoder.copyBufferToBuffer(buffers.maskLogits, 0, buffers.maskLogitsReadback, 0, total * 4);
  runtime.queue.submit([encoder.finish()]);
}

function dispatchThreshold({ runtime, stage, buffers, total }) {
  const module = stage.getShaderModule('sam3.threshold-mask', THRESHOLD_WGSL);
  const pipeline = stage.getComputePipeline('sam3.threshold-mask', {
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = runtime.device.createBindGroup({
    label: 'sam3.threshold-mask.bind-group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.maskLogits } },
      { binding: 1, resource: { buffer: buffers.binaryMask } },
      { binding: 2, resource: { buffer: buffers.thresholdDims } },
    ],
  });

  const encoder = runtime.device.createCommandEncoder({ label: 'sam3.threshold-mask.encoder' });
  const pass = encoder.beginComputePass({ label: 'sam3.threshold-mask.pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroups(total));
  pass.end();
  encoder.copyBufferToBuffer(buffers.binaryMask, 0, buffers.binaryMaskReadback, 0, total * 4);
  runtime.queue.submit([encoder.finish()]);
}

export function createSam3MaskProjectionCpuOracle(input) {
  const { hyperInput, upscaledEmbedding, shape } = validateProjectionInputs(input);
  const total = elementCount(shape);
  const hw = shape.height * shape.width;
  const maskLogits = new Float32Array(total);
  const binaryMask = new Uint32Array(total);

  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let token = 0; token < shape.maskTokens; token += 1) {
      for (let spatial = 0; spatial < hw; spatial += 1) {
        let sum = 0;
        for (let channel = 0; channel < shape.channels; channel += 1) {
          const hyperIndex = ((batch * shape.maskTokens + token) * shape.channels) + channel;
          const embeddingIndex = ((batch * shape.channels + channel) * hw) + spatial;
          sum += hyperInput[hyperIndex] * upscaledEmbedding[embeddingIndex];
        }
        const outputIndex = ((batch * shape.maskTokens + token) * hw) + spatial;
        maskLogits[outputIndex] = sum;
        binaryMask[outputIndex] = sum > 0 ? 1 : 0;
      }
    }
  }

  return {
    shape,
    inputs: {
      hyperInput,
      upscaledEmbedding,
    },
    maskLogits,
    binaryMask,
  };
}

export function createSam3MaskDecoderIslandRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.sourceImage?.artifactId || !input.sourceImage?.sha256) {
    throw new Error('sourceImage artifactId and sha256 are required');
  }
  if (!input.tensorPacket?.artifactId || !input.tensorPacket?.sha256) {
    throw new Error('tensorPacket artifactId and sha256 are required');
  }
  if (!input.weightsPacket?.artifactId || !input.weightsPacket?.sha256) {
    throw new Error('weightsPacket artifactId and sha256 are required');
  }
  if (!input.outputs?.maskLogits) throw new Error('maskLogits output is required');
  if (!input.outputs?.binaryMask) throw new Error('binaryMask output is required');

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: SAM3_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp32',
    },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-decoder-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-decoder-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3MaskDecoderIslandRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });

  return defineWebGpuRoute({
    routeId: SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: SAM3_MODEL_ID,
      revision: input.model?.revision || 'mlx-oracle-upstream-mask-island',
      dtype: input.model?.dtype || 'fp32',
    },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({
      role,
      required: true,
      artifactRequired: true,
      hashRequired: true,
    })),
    outputs: [
      { role: 'mask-logits', required: true, artifactRequired: true, hashRequired: true },
      { role: 'mask-binary', required: true, artifactRequired: true, hashRequired: true },
      { role: 'mask-overlay', required: false, artifactRequired: true, hashRequired: true },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || {
      exportName: 'runSam3MaskDecoderIslandRoute',
      upstreamBoundary: 'mlx-oracle-mask-decoder-tensors',
    },
  });
}

export async function runSam3MaskDecoderIslandRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3MaskDecoderIslandRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-decoder-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-decoder-weights');
  const projection = validateProjectionInputs(input.tensors || {});
  const { hyperInput, upscaledEmbedding, shape } = projection;
  const total = elementCount(shape);
  const maskShape = [shape.batch, shape.maskTokens, shape.height, shape.width];
  const outputBytes = total * 4;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-mask-decoder-island',
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
  requireCommandEncoder(runtime.device);

  let buffers = null;
  await runtime.runStage('load-decoder-tensors', async stage => {
    const projectionDims = new Uint32Array([
      shape.batch,
      shape.maskTokens,
      shape.channels,
      shape.height,
      shape.width,
      total,
      0,
      0,
    ]);
    const thresholdDims = new Uint32Array([total, 0, 0, 0]);

    buffers = {
      hyperInput: stage.createBuffer({
        label: 'sam3.hyper-input',
        size: hyperInput.byteLength,
        usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST,
      }),
      upscaledEmbedding: stage.createBuffer({
        label: 'sam3.upscaled-embedding',
        size: upscaledEmbedding.byteLength,
        usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST,
      }),
      maskLogits: stage.createBuffer({
        label: 'sam3.mask-logits',
        size: outputBytes,
        usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_SRC,
      }),
      binaryMask: stage.createBuffer({
        label: 'sam3.binary-mask',
        size: outputBytes,
        usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_SRC,
      }),
      maskLogitsReadback: stage.createBuffer({
        label: 'sam3.mask-logits.readback',
        size: outputBytes,
        usage: GPUBufferUsageFlags.MAP_READ | GPUBufferUsageFlags.COPY_DST,
      }),
      binaryMaskReadback: stage.createBuffer({
        label: 'sam3.binary-mask.readback',
        size: outputBytes,
        usage: GPUBufferUsageFlags.MAP_READ | GPUBufferUsageFlags.COPY_DST,
      }),
      projectionDims: stage.createBuffer({
        label: 'sam3.projection-dims',
        size: projectionDims.byteLength,
        usage: GPUBufferUsageFlags.UNIFORM | GPUBufferUsageFlags.COPY_DST,
      }),
      thresholdDims: stage.createBuffer({
        label: 'sam3.threshold-dims',
        size: thresholdDims.byteLength,
        usage: GPUBufferUsageFlags.UNIFORM | GPUBufferUsageFlags.COPY_DST,
      }),
    };

    stage.writeBuffer(buffers.hyperInput, hyperInput);
    stage.writeBuffer(buffers.upscaledEmbedding, upscaledEmbedding);
    stage.writeBuffer(buffers.projectionDims, projectionDims);
    stage.writeBuffer(buffers.thresholdDims, thresholdDims);
    await stage.yieldToBrowser({ reason: 'after-sam3-mask-island-upload' });
  }, { shape });

  await runtime.runStage('decode-mask', async stage => {
    dispatchProjection({ runtime, stage, buffers, total });
    await stage.yieldToBrowser({ reason: 'after-sam3-mask-projection-submit' });
  }, { outputShape: maskShape });

  await runtime.runStage('threshold-mask', async stage => {
    dispatchThreshold({ runtime, stage, buffers, total });
    await stage.yieldToBrowser({ reason: 'after-sam3-threshold-submit' });
  }, { threshold: 0 });

  const readback = await runtime.runStage('readback-mask', async stage => ({
    maskLogits: await stage.readBuffer(buffers.maskLogitsReadback, { size: outputBytes }),
    binaryMask: await stage.readBuffer(buffers.binaryMaskReadback, { size: outputBytes }),
  }), { outputBytes });

  const outputArtifacts = createOutputArtifacts(input.request, {
    maskLogits: await sha256Hex(readback.maskLogits),
    binaryMask: await sha256Hex(readback.binaryMask),
  }, maskShape);

  const receipt = createSam3MaskDecoderIslandRouteReceipt({
    sourceImage,
    tensorPacket,
    weightsPacket,
    outputs: outputArtifacts,
    backend: runtime.backendIdentity,
    model: {
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash || weightsPacket.sha256,
      dtype: input.model?.dtype || 'fp32',
    },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });

  const result = createRouteWorkerResult(route, {
    request: input.request,
    receipt,
  });

  if (nonEmptyString(input.effectiveRouteId) && input.effectiveRouteId !== SAM3_MASK_DECODER_ISLAND_ROUTE_ID) {
    result.receipt.effectiveRouteId = input.effectiveRouteId;
  }

  return result;
}
