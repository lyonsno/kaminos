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

export const KIMODO_TEXT_TO_MOTION_ROUTE_ID = 'kimodo.text-to-motion.webgpu-local.v0';
const KIMODO_MODEL_ID = 'NVIDIA/Kimodo-SOMA-RP-v1.1';
const DEFAULT_KERNEL_PROFILE = 'twostage-denoiser-ddim50-fk';
const REQUIRED_STAGES = ['text-embedding', 'ddim-sampling', 'fk-decode', 'output-capture'];
const OUTPUT_ROLES = [
  { key: 'soma77Joints', role: 'soma77-joints', required: true },
  { key: 'motionClip', role: 'motion-clip', required: true },
  { key: 'filmstrip', role: 'filmstrip', required: false },
];

export function createKimodoTextToMotionRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('text prompt artifactId and sha256 are required');
  }
  if (!input.outputs?.soma77Joints) throw new Error('soma77Joints output is required');
  if (!input.outputs?.motionClip) throw new Error('motionClip output is required');

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: KIMODO_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('text-prompt', input.input),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createKimodoTextToMotionRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'adapter-phase-wall-clock',
  });

  return defineWebGpuRoute({
    routeId: KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: KIMODO_MODEL_ID,
      revision: input.model?.revision || 'SOMA-RP-v1.1',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: routeMetadata.kernel,
    inputs: [
      { role: 'text-prompt', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      { role: 'soma77-joints', required: true, artifactRequired: true, hashRequired: true, shape: [90, 77, 3] },
      { role: 'motion-clip', required: true, artifactRequired: true, hashRequired: true, shape: [1] },
      { role: 'filmstrip', required: false, artifactRequired: true, hashRequired: true },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    worker: input.worker || {
      exportName: 'runKimodoTextToMotionRoute',
      textEmbedding: 'external-llama3-8b',
      motionFormat: 'kimodo-soma77-explicit-joints',
    },
  });
}
