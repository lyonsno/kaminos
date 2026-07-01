import { defineWebGpuRoute } from './route-boundary.js';
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

export const MOGE_DEPTH_NORMAL_ROUTE_ID = 'moge.depth-normal.webgpu-local.v0';
const MOGE_MODEL_ID = 'Ruicheng/moge-2-vitl-normal';
const DEFAULT_KERNEL_PROFILE = 'conv-transpose2d-stride2';
const REQUIRED_STAGES = ['backbone', 'decoder-heads', 'output-readback'];
const OUTPUT_ROLES = [
  { key: 'depth', role: 'depth', required: true },
  { key: 'normal', role: 'normal', required: true },
  { key: 'pointMap', role: 'pointmap', required: false },
  { key: 'mask', role: 'mask', required: false },
];

function createDefaultMogeScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        backbone: 1,
        'decoder-heads': 1,
        'output-readback': 1,
      },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        backbone: 1,
        'decoder-heads': 1,
        'output-readback': 1,
      },
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: [
        {
          name: 'backbone-submit',
          stage: 'backbone',
          kind: 'gpu-submit-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
          nonInterruptibleReason: 'GPU command buffers cannot be preempted after submit',
        },
        {
          name: 'decoder-heads-submit',
          stage: 'decoder-heads',
          kind: 'gpu-submit-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
          nonInterruptibleReason: 'GPU command buffers cannot be preempted after submit',
        },
        {
          name: 'output-readback',
          stage: 'output-readback',
          kind: 'readback-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
        },
      ],
      checkpoints: REQUIRED_STAGES.map(stage => ({
        name: `after-${stage}`,
        kind: stage === 'output-readback' ? 'readback' : 'stage-boundary',
        afterStage: stage,
        yieldable: true,
        waitsForSubmittedWorkDone: true,
      })),
      notes: 'MoGE can cooperate between staged submits and readback, not inside a submitted GPU pass.',
    },
  });
}

function createDefaultMogeBackpressure() {
  return createWebGpuRouteBackpressureProfile({
    requestedBudget: 'visible-wait',
    effectiveBudget: 'visible-wait',
    memoryExclusivity: 'shared',
    warmCacheState: 'unknown',
  });
}

export function createMogeDepthNormalRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.depth) throw new Error('depth output is required');
  if (!input.outputs?.normal) throw new Error('normal output is required');

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: MOGE_DEPTH_NORMAL_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || MOGE_DEPTH_NORMAL_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: MOGE_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.input),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createMogeDepthNormalRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });

  return defineWebGpuRoute({
    routeId: MOGE_DEPTH_NORMAL_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: MOGE_MODEL_ID,
      revision: input.model?.revision || 'local-vitl-normal',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: routeMetadata.kernel,
    inputs: [
      { role: 'source-image', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      { role: 'depth', required: true, artifactRequired: true, hashRequired: true, shape: [592, 592] },
      { role: 'normal', required: true, artifactRequired: true, hashRequired: true, shape: [3, 592, 592] },
      { role: 'pointmap', required: false, artifactRequired: true, hashRequired: true, shape: [3, 592, 592] },
      { role: 'mask', required: false, artifactRequired: true, hashRequired: true, shape: [592, 592] },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultMogeScheduler(),
    backpressure: input.backpressure || createDefaultMogeBackpressure(),
    worker: input.worker || {
      exportName: 'runMogeDepthNormalRoute',
    },
  });
}
