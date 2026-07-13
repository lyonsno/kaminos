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

export const SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-patch-embed.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-patch-embed-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-patch-embed-tensors',
  'patch-conv2d-stride',
  'readback-patch-embeddings',
];
const INPUT_ROLES = ['source-image', 'pixel-values', 'sam3-image-patch-embed-weights'];
const OUTPUT_ROLES = [
  { key: 'patchEmbeddings', role: 'patch-embeddings', required: true },
];

const PATCH_EMBED_WGSL = `
struct PatchEmbedDims {
  batch: u32,
  image_height: u32,
  image_width: u32,
  image_channels: u32,
  patch_size: u32,
  patch_height: u32,
  patch_width: u32,
  hidden_size: u32,
  total_values: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<storage, read> pixel_values: array<f32>;
@group(0) @binding(1) var<storage, read> projection_weight: array<f32>;
@group(0) @binding(2) var<storage, read_write> patch_embeddings: array<f32>;
@group(0) @binding(3) var<uniform> dims: PatchEmbedDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_values) { return; }
  let out_channel = index % dims.hidden_size;
  let token = (index / dims.hidden_size) % (dims.patch_height * dims.patch_width);
  let batch = index / (dims.hidden_size * dims.patch_height * dims.patch_width);
  let patch_y = token / dims.patch_width;
  let patch_x = token % dims.patch_width;
  var sum = 0.0;
  for (var ky = 0u; ky < dims.patch_size; ky = ky + 1u) {
    for (var kx = 0u; kx < dims.patch_size; kx = kx + 1u) {
      let in_y = patch_y * dims.patch_size + ky;
      let in_x = patch_x * dims.patch_size + kx;
      let input_base = ((batch * dims.image_height + in_y) * dims.image_width + in_x) * dims.image_channels;
      let weight_base = ((out_channel * dims.patch_size + ky) * dims.patch_size + kx) * dims.image_channels;
      for (var in_channel = 0u; in_channel < dims.image_channels; in_channel = in_channel + 1u) {
        sum = sum + pixel_values[input_base + in_channel] * projection_weight[weight_base + in_channel];
      }
    }
  }
  patch_embeddings[index] = sum;
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-patch-embeddings' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-patch-embeddings' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-patch-embeddings' })),
      notes: 'SAM3 image patch-embed phase program cooperates between normalized pixel upload, stride patch Conv2d projection, and patch embedding readback boundaries.',
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
    imageHeight: shape.imageHeight ?? shape.height,
    imageWidth: shape.imageWidth ?? shape.width,
    imageChannels: shape.imageChannels ?? shape.channels ?? 3,
    patchSize: shape.patchSize,
    patchHeight: shape.patchHeight,
    patchWidth: shape.patchWidth,
    hiddenSize: shape.hiddenSize,
  };
  if (Number.isInteger(out.patchSize) && out.patchSize > 0) {
    out.patchHeight = out.patchHeight ?? Math.floor(out.imageHeight / out.patchSize);
    out.patchWidth = out.patchWidth ?? Math.floor(out.imageWidth / out.patchSize);
  }
  for (const key of ['batch', 'imageHeight', 'imageWidth', 'imageChannels', 'patchSize', 'patchHeight', 'patchWidth', 'hiddenSize']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (out.imageChannels !== 3) throw new Error('shape.imageChannels must be 3 for SAM3 RGB pixel-values');
  if (out.imageHeight % out.patchSize !== 0 || out.imageWidth % out.patchSize !== 0) throw new Error('image dimensions must be divisible by shape.patchSize');
  if (out.patchHeight !== out.imageHeight / out.patchSize || out.patchWidth !== out.imageWidth / out.patchSize) throw new Error('patchHeight/patchWidth must match image dimensions divided by patchSize');
  return out;
}

function validateImagePatchEmbedInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const pixelValues = ensureFloat32Array(input.pixelValues, 'pixelValues');
  const projection = ensureFloat32Array(input.weights?.projection, 'weights.projection');
  const expectedPixels = shape.batch * shape.imageHeight * shape.imageWidth * shape.imageChannels;
  const expectedWeights = shape.hiddenSize * shape.patchSize * shape.patchSize * shape.imageChannels;
  if (pixelValues.length !== expectedPixels) throw new Error(`pixelValues length ${pixelValues.length} does not match shape (${expectedPixels})`);
  if (projection.length !== expectedWeights) throw new Error(`weights.projection length ${projection.length} does not match out,kH,kW,in layout (${expectedWeights})`);
  return { shape, pixelValues, projection };
}

export function createSam3ImagePatchEmbedPhaseProgramCpuOracle(input) {
  const { shape, pixelValues, projection } = validateImagePatchEmbedInputs(input);
  const patchEmbeddings = new Float32Array(shape.batch * shape.patchHeight * shape.patchWidth * shape.hiddenSize);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let patchY = 0; patchY < shape.patchHeight; patchY += 1) {
      for (let patchX = 0; patchX < shape.patchWidth; patchX += 1) {
        const token = patchY * shape.patchWidth + patchX;
        for (let outChannel = 0; outChannel < shape.hiddenSize; outChannel += 1) {
          let sum = 0;
          for (let ky = 0; ky < shape.patchSize; ky += 1) {
            for (let kx = 0; kx < shape.patchSize; kx += 1) {
              const inY = patchY * shape.patchSize + ky;
              const inX = patchX * shape.patchSize + kx;
              const inputBase = ((batch * shape.imageHeight + inY) * shape.imageWidth + inX) * shape.imageChannels;
              const weightBase = ((outChannel * shape.patchSize + ky) * shape.patchSize + kx) * shape.imageChannels;
              for (let inChannel = 0; inChannel < shape.imageChannels; inChannel += 1) {
                sum += pixelValues[inputBase + inChannel] * projection[weightBase + inChannel];
              }
            }
          }
          patchEmbeddings[(batch * shape.patchHeight * shape.patchWidth + token) * shape.hiddenSize + outChannel] = sum;
        }
      }
    }
  }
  return { shape, patchEmbeddings };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image patch-embed outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    patchEmbeddings: {
      artifactId: roleArtifact(request.outputs, 'patch-embeddings').artifactId,
      sha256: hashes.patchEmbeddings,
      shape: [shape.batch, shape.patchHeight * shape.patchWidth, shape.hiddenSize],
    },
  };
}

export function createSam3ImagePatchEmbedPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('pixel-values', input.pixelValues),
      createRouteReceiptInputArtifact('sam3-image-patch-embed-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImagePatchEmbedPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-patch-embed', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImagePatchEmbedPhaseProgramRoute', upstreamBoundary: 'browser-normalized-pixel-values-to-sam3-patch-embeddings' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3ImagePatchEmbedPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImagePatchEmbedPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const pixelValuesArtifact = roleArtifact(input.request.inputs, 'pixel-values');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-image-patch-embed-weights');
  const { shape, pixelValues, projection } = validateImagePatchEmbedInputs(input.tensors || {});
  const totalValues = shape.batch * shape.patchHeight * shape.patchWidth * shape.hiddenSize;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-patch-embed-phase-program',
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
  await runtime.runStage('load-image-patch-embed-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      pixelValues: stage.createTensor({ name: 'sam3.image-patch-embed.pixel-values', shape: [shape.batch, shape.imageHeight, shape.imageWidth, shape.imageChannels], dtype: 'f32', usage: readonlyUsage }),
      projection: stage.createTensor({ name: 'sam3.image-patch-embed.projection-weight', shape: [shape.hiddenSize, shape.patchSize, shape.patchSize, shape.imageChannels], dtype: 'f32', usage: readonlyUsage }),
      patchEmbeddings: stage.createTensor({ name: 'sam3.image-patch-embed.patch-embeddings', shape: [shape.batch, shape.patchHeight * shape.patchWidth, shape.hiddenSize], dtype: 'f32', usage }),
      dims: stage.createUniformBuffer({
        label: 'sam3.image-patch-embed.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'image_height', type: 'u32' },
          { name: 'image_width', type: 'u32' },
          { name: 'image_channels', type: 'u32' },
          { name: 'patch_size', type: 'u32' },
          { name: 'patch_height', type: 'u32' },
          { name: 'patch_width', type: 'u32' },
          { name: 'hidden_size', type: 'u32' },
          { name: 'total_values', type: 'u32' },
          { name: '_pad0', type: 'u32' },
          { name: '_pad1', type: 'u32' },
          { name: '_pad2', type: 'u32' },
        ],
        values: { batch: shape.batch, image_height: shape.imageHeight, image_width: shape.imageWidth, image_channels: shape.imageChannels, patch_size: shape.patchSize, patch_height: shape.patchHeight, patch_width: shape.patchWidth, hidden_size: shape.hiddenSize, total_values: totalValues, _pad0: 0, _pad1: 0, _pad2: 0 },
      }),
    };
    stage.uploadTensor(tensors.pixelValues, pixelValues);
    stage.uploadTensor(tensors.projection, projection);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-patch-embed-upload' });
  }, { shape, weightLayout: 'out,kH,kW,in' });

  const program = runtime.defineProgram({
    name: 'sam3.image-patch-embed-phase-program',
    tensors: {
      pixelValues: tensors.pixelValues,
      projection: tensors.projection,
      patchEmbeddings: tensors.patchEmbeddings,
    },
    uniforms: { dims: tensors.dims },
    kernels: {
      patchConv2dStride: {
        code: PATCH_EMBED_WGSL,
        bindings: [
          { name: 'pixelValues', resource: 'tensor:pixelValues', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'projection', resource: 'tensor:projection', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'patchEmbeddings', resource: 'tensor:patchEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
    },
    phases: [
      { name: 'patch-conv2d-stride', kernel: 'patchConv2dStride', dispatch: [workgroups(totalValues)], yieldAfter: true },
      { name: 'readback-patch-embeddings', readbacks: [{ name: 'patchEmbeddings', tensor: 'patchEmbeddings' }] },
    ],
    metadata: { routeId: SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID, weightLayout: 'out,kH,kW,in' },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    patchEmbeddings: await sha256Hex(run.outputs.patchEmbeddings),
  }, shape);
  const receipt = createSam3ImagePatchEmbedPhaseProgramRouteReceipt({
    sourceImage,
    pixelValues: pixelValuesArtifact,
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
      patchEmbeddings: Array.from(new Float32Array(run.outputs.patchEmbeddings)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
