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

export const SF3D_IMAGE_TO_MESH_ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';
const SF3D_MODEL_ID = 'stabilityai/stable-fast-3d';
const DEFAULT_KERNEL_PROFILE = 'dinov2-two-stream-triplane-marching-tet-texture-bake';
const REQUIRED_STAGES = [
  'image-preprocess',
  'dinov2-tokenizer',
  'two-stream-backbone',
  'triplane-decode',
  'marching-tet',
  'texture-bake',
  'glb-export',
];
const OUTPUT_ROLES = [
  { key: 'meshGlb', role: 'mesh-glb', required: true },
  { key: 'albedoTexture', role: 'albedo-texture', required: true },
  { key: 'normalMap', role: 'normal-map', required: true },
  { key: 'meshObj', role: 'mesh-obj', required: false },
];

export function createSf3dImageToMeshRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.meshGlb) throw new Error('meshGlb output is required');
  if (!input.outputs?.albedoTexture) throw new Error('albedoTexture output is required');
  if (!input.outputs?.normalMap) throw new Error('normalMap output is required');

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SF3D_IMAGE_TO_MESH_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: SF3D_MODEL_ID,
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

export function createSf3dImageToMeshRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'adapter-phase-wall-clock',
  });

  return defineWebGpuRoute({
    routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: SF3D_MODEL_ID,
      revision: input.model?.revision || 'stable-fast-3d',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: routeMetadata.kernel,
    inputs: [
      { role: 'source-image', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      { role: 'mesh-glb', required: true, artifactRequired: true, hashRequired: true, shape: [1] },
      { role: 'albedo-texture', required: true, artifactRequired: true, hashRequired: true },
      { role: 'normal-map', required: true, artifactRequired: true, hashRequired: true },
      { role: 'mesh-obj', required: false, artifactRequired: true, hashRequired: true, shape: [1] },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    worker: input.worker || {
      exportName: 'runSf3dImageToMeshRoute',
      meshFormat: 'glb',
      textureBake: true,
      normalMap: true,
    },
  });
}
