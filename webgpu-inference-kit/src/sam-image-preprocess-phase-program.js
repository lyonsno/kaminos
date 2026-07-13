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

export const SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-preprocess.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-preprocess-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-preprocess-tensors',
  'image-u8-to-normalized-f32',
  'readback-pixel-values',
];
const INPUT_ROLES = ['source-image', 'sam3-image-preprocess-tensors'];
const OUTPUT_ROLES = [
  { key: 'pixelValues', role: 'pixel-values', required: true },
];

const PREPROCESS_WGSL = `
struct ImagePreprocessDims {
  batch: u32,
  height: u32,
  width: u32,
  channels: u32,
  total_values: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<storage, read> rgba: array<u32>;
@group(0) @binding(1) var<storage, read_write> pixel_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: ImagePreprocessDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_values) { return; }
  let channel = index % dims.channels;
  let pixel = index / dims.channels;
  let rgba_index = pixel * 4u + channel;
  pixel_values[index] = f32(rgba[rgba_index]) / 127.5 - 1.0;
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-pixel-values' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-pixel-values' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-pixel-values' })),
      notes: 'SAM3 image-preprocess phase program cooperates between source pixel upload, normalized pixel-value generation, and readback boundaries.',
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

function normalizeShape(shape = {}) {
  const out = {
    batch: shape.batch,
    height: shape.height,
    width: shape.width,
    channels: shape.channels ?? 3,
  };
  for (const key of ['batch', 'height', 'width', 'channels']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (out.channels !== 3) throw new Error('shape.channels must be 3 for SAM3 RGB pixel-values');
  return out;
}

function ensureU8Array(value, name) {
  if (!(value instanceof Uint8Array) && !(value instanceof Uint8ClampedArray)) throw new Error(`${name} must be a Uint8Array or Uint8ClampedArray`);
  return value;
}

function validateImagePreprocessInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const rgba = ensureU8Array(input.rgba, 'rgba');
  const expected = shape.batch * shape.height * shape.width * 4;
  if (rgba.length !== expected) throw new Error(`rgba length ${rgba.length} does not match shape (${expected})`);
  return { shape, rgba };
}

export function createSam3ImagePreprocessPhaseProgramCpuOracle(input) {
  const { shape, rgba } = validateImagePreprocessInputs(input);
  const pixelValues = new Float32Array(shape.batch * shape.height * shape.width * shape.channels);
  for (let index = 0; index < pixelValues.length; index += 1) {
    const channel = index % shape.channels;
    const pixel = Math.floor(index / shape.channels);
    pixelValues[index] = rgba[pixel * 4 + channel] / 127.5 - 1;
  }
  return { shape, pixelValues };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image-preprocess outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    pixelValues: {
      artifactId: roleArtifact(request.outputs, 'pixel-values').artifactId,
      sha256: hashes.pixelValues,
      shape: [shape.batch, shape.height, shape.width, shape.channels],
    },
  };
}

export function createSam3ImagePreprocessPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash || 'none', dtype: input.model?.dtype || 'u8-to-fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-image-preprocess-tensors', input.tensorPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImagePreprocessPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-preprocess', dtype: input.model?.dtype || 'u8-to-fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImagePreprocessPhaseProgramRoute', upstreamBoundary: 'browser-source-image-to-normalized-pixel-values' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3ImagePreprocessPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImagePreprocessPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-image-preprocess-tensors');
  const { shape, rgba } = validateImagePreprocessInputs(input.tensors || {});
  const totalValues = shape.batch * shape.height * shape.width * shape.channels;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-preprocess-phase-program',
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
  await runtime.runStage('load-image-preprocess-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const rgbaU32 = new Uint32Array(rgba.length);
    for (let index = 0; index < rgba.length; index += 1) rgbaU32[index] = rgba[index];
    tensors = {
      rgba: stage.createTensor({ name: 'sam3.image-preprocess.rgba-u8-as-u32', shape: [shape.batch, shape.height, shape.width, 4], dtype: 'u32', usage: readonlyUsage }),
      pixelValues: stage.createTensor({ name: 'sam3.image-preprocess.pixel-values', shape: [shape.batch, shape.height, shape.width, shape.channels], dtype: 'f32', usage }),
      dims: stage.createUniformBuffer({
        label: 'sam3.image-preprocess.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'height', type: 'u32' },
          { name: 'width', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'total_values', type: 'u32' },
          { name: '_pad0', type: 'u32' },
          { name: '_pad1', type: 'u32' },
          { name: '_pad2', type: 'u32' },
        ],
        values: { batch: shape.batch, height: shape.height, width: shape.width, channels: shape.channels, total_values: totalValues, _pad0: 0, _pad1: 0, _pad2: 0 },
      }),
    };
    stage.uploadTensor(tensors.rgba, rgbaU32);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-preprocess-upload' });
  }, { shape });

  const program = runtime.defineProgram({
    name: 'sam3.image-preprocess-phase-program',
    tensors: {
      rgba: tensors.rgba,
      pixelValues: tensors.pixelValues,
    },
    uniforms: { dims: tensors.dims },
    kernels: {
      normalize: {
        code: PREPROCESS_WGSL,
        bindings: [
          { name: 'rgba', resource: 'tensor:rgba', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'pixelValues', resource: 'tensor:pixelValues', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
    },
    phases: [
      { name: 'image-u8-to-normalized-f32', kernel: 'normalize', dispatch: [workgroups(totalValues)], yieldAfter: true },
      { name: 'readback-pixel-values', readbacks: [{ name: 'pixelValues', tensor: 'pixelValues' }] },
    ],
    metadata: { routeId: SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    pixelValues: await sha256Hex(run.outputs.pixelValues),
  }, shape);
  const receipt = createSam3ImagePreprocessPhaseProgramRouteReceipt({
    sourceImage,
    tensorPacket,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || 'none', dtype: input.model?.dtype || 'u8-to-fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      pixelValues: Array.from(new Float32Array(run.outputs.pixelValues)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
