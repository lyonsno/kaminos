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
    worker: input.worker || {
      exportName: 'runMogeDepthNormalRoute',
    },
  });
}
