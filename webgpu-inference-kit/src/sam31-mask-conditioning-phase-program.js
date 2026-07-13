import {
  assertAuthoritativeRouteWorkerResult,
  createRouteWorkerResult,
  defineWebGpuRoute,
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

export const SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.mask-conditioning.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/sam3.1';
const DEFAULT_KERNEL_PROFILE = 'sam31-mask-conditioning-phase-program-v0';
const REQUIRED_STAGES = [
  'load-mask-conditioning-inputs',
  'mask-conditioning-logits-and-appearance',
  'readback-mask-conditioning',
];
const INPUT_ROLES = ['source-frame', 'sam31-binary-mask-inputs'];
const OUTPUT_ROLES = [
  { key: 'maskLogits', role: 'sam31-mask-conditioning-logits', required: true },
  { key: 'objectScores', role: 'sam31-mask-conditioning-object-scores', required: true },
];

const MASK_CONDITIONING_WGSL = `
struct MaskConditioningDims {
  multiplex_count: u32,
  mask_area: u32,
  total_values: u32,
  reserved: u32,
};

@group(0) @binding(0) var<storage, read> binary_masks: array<f32>;
@group(0) @binding(1) var<storage, read_write> mask_logits: array<f32>;
@group(0) @binding(2) var<storage, read_write> object_scores: array<f32>;
@group(0) @binding(3) var<uniform> dims: MaskConditioningDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let object = gid.x;
  if (object >= dims.multiplex_count) { return; }
  let base = object * dims.mask_area;
  var appearing = false;
  for (var pixel = 0u; pixel < dims.mask_area; pixel = pixel + 1u) {
    let value = binary_masks[base + pixel];
    mask_logits[base + pixel] = value * 20.0 - 10.0;
    appearing = appearing || value > 0.0;
  }
  object_scores[object] = select(-10.0, 10.0, appearing);
}
`;

function createDefaultScheduler() {
  const chunks = Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-mask-conditioning' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-mask-conditioning' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-mask-conditioning' })),
      notes: 'SAM3.1 mask conditioning yields between upload, binary-mask conversion, and readback.',
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

function normalizeInput(input = {}) {
  const shape = {
    multiplexCount: input.shape?.multiplexCount,
    maskHeight: input.shape?.maskHeight,
    maskWidth: input.shape?.maskWidth,
  };
  for (const [name, value] of Object.entries(shape)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`shape.${name} must be a positive integer`);
  }
  if (!(input.binaryMasks instanceof Float32Array)) throw new Error('binaryMasks must be a Float32Array');
  const expectedLength = shape.multiplexCount * shape.maskHeight * shape.maskWidth;
  if (input.binaryMasks.length !== expectedLength) throw new Error(`binaryMasks length ${input.binaryMasks.length} != ${expectedLength}`);
  for (let index = 0; index < input.binaryMasks.length; index += 1) {
    const value = input.binaryMasks[index];
    if (value !== 0 && value !== 1) throw new Error(`binaryMasks must contain only 0 or 1; found ${value} at ${index}`);
  }
  return { shape, binaryMasks: input.binaryMasks };
}

export function createSam31MaskConditioningPhaseProgramCpuOracle(input = {}) {
  const { shape, binaryMasks } = normalizeInput(input);
  const maskArea = shape.maskHeight * shape.maskWidth;
  const maskLogits = new Float32Array(binaryMasks.length);
  const objectScores = new Float32Array(shape.multiplexCount);
  const appearing = new Float32Array(shape.multiplexCount);
  for (let object = 0; object < shape.multiplexCount; object += 1) {
    let present = false;
    for (let pixel = 0; pixel < maskArea; pixel += 1) {
      const index = object * maskArea + pixel;
      present ||= binaryMasks[index] > 0;
      maskLogits[index] = binaryMasks[index] * 20 - 10;
    }
    appearing[object] = present ? 1 : 0;
    objectScores[object] = present ? 10 : -10;
  }
  return { shape, maskLogits, objectScores, appearing };
}

async function sha256(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM3.1 mask-conditioning outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const maskRequest = roleArtifact(request.outputs, 'sam31-mask-conditioning-logits');
  const scoreRequest = roleArtifact(request.outputs, 'sam31-mask-conditioning-object-scores');
  return {
    maskLogits: { artifactId: maskRequest.artifactId, sha256: hashes.maskLogits, shape: [shape.multiplexCount, 1, shape.maskHeight, shape.maskWidth] },
    objectScores: { artifactId: scoreRequest.artifactId, sha256: hashes.objectScores, shape: [shape.multiplexCount, 1] },
  };
}

export function createSam31MaskConditioningPhaseProgramRouteReceipt(input = {}) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-frame', input.sourceFrame),
      createRouteReceiptInputArtifact('sam31-binary-mask-inputs', input.binaryMasks),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam31MaskConditioningPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: MODEL_ID, revision: input.model?.revision || 'pinned-official-mask-conditioning', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam31MaskConditioningPhaseProgramRoute', upstreamBoundary: 'binary-mask-conditioning-inputs' },
  });
}

export async function runSam31MaskConditioningPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam31MaskConditioningPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceFrame = roleArtifact(input.request.inputs, 'source-frame');
  const binaryMaskArtifact = roleArtifact(input.request.inputs, 'sam31-binary-mask-inputs');
  const { shape, binaryMasks } = normalizeInput(input.tensors || {});
  const maskArea = shape.maskHeight * shape.maskWidth;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam31-mask-conditioning-phase-program',
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

  let tensors;
  await runtime.runStage('load-mask-conditioning-inputs', async stage => {
    const readOnlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const outputUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc;
    tensors = {
      binaryMasks: stage.createTensor({ name: 'sam31.mask-conditioning.binary-masks', shape: [shape.multiplexCount, 1, shape.maskHeight, shape.maskWidth], dtype: 'f32', usage: readOnlyUsage }),
      maskLogits: stage.createTensor({ name: 'sam31.mask-conditioning.mask-logits', shape: [shape.multiplexCount, 1, shape.maskHeight, shape.maskWidth], dtype: 'f32', usage: outputUsage }),
      objectScores: stage.createTensor({ name: 'sam31.mask-conditioning.object-scores', shape: [shape.multiplexCount, 1], dtype: 'f32', usage: outputUsage }),
      dims: stage.createUniformBuffer({
        label: 'sam31.mask-conditioning.dims',
        schema: [
          { name: 'multiplex_count', type: 'u32' },
          { name: 'mask_area', type: 'u32' },
          { name: 'total_values', type: 'u32' },
          { name: 'reserved', type: 'u32' },
        ],
        values: { multiplex_count: shape.multiplexCount, mask_area: maskArea, total_values: binaryMasks.length, reserved: 0 },
      }),
    };
    stage.uploadTensor(tensors.binaryMasks, binaryMasks);
    await stage.yieldToBrowser({ reason: 'after-sam31-mask-conditioning-upload' });
  }, { shape });

  const program = runtime.defineProgram({
    name: 'sam31.mask-conditioning-phase-program',
    tensors: { binaryMasks: tensors.binaryMasks, maskLogits: tensors.maskLogits, objectScores: tensors.objectScores },
    uniforms: { dims: tensors.dims },
    kernels: {
      conditionMasks: {
        code: MASK_CONDITIONING_WGSL,
        bindings: [
          { name: 'binaryMasks', resource: 'tensor:binaryMasks', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'maskLogits', resource: 'tensor:maskLogits', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'objectScores', resource: 'tensor:objectScores', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
          { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
        ],
      },
    },
    phases: [
      { name: 'mask-conditioning-logits-and-appearance', kernel: 'conditionMasks', dispatch: [Math.max(1, Math.ceil(shape.multiplexCount / 64))], yieldAfter: true },
      { name: 'readback-mask-conditioning', readbacks: [{ name: 'maskLogits', tensor: 'maskLogits' }, { name: 'objectScores', tensor: 'objectScores' }] },
    ],
    metadata: { routeId: SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    maskLogits: await sha256(run.outputs.maskLogits),
    objectScores: await sha256(run.outputs.objectScores),
  }, shape);
  const receipt = createSam31MaskConditioningPhaseProgramRouteReceipt({
    sourceFrame,
    binaryMasks: binaryMaskArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || binaryMaskArtifact.sha256, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      maskLogits: Array.from(new Float32Array(run.outputs.maskLogits)),
      objectScores: Array.from(new Float32Array(run.outputs.objectScores)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
