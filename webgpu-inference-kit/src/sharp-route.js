import { defineWebGpuRoute } from './route-boundary.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';

export const SHARP_IMAGE_TO_SPLAT_ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';
const SHARP_MODEL_ID = 'apple/ml-sharp';
const REQUIRED_STAGES = ['spn', 'monodepth', 'gaussian-decoder', 'compose-ply', 'output-capture'];
const OUTPUT_ROLES = [
  { key: 'splat', role: 'splat-candidate', required: true },
  { key: 'depthMap', role: 'depth-map', required: true },
  { key: 'metadata', role: 'sharp-webgpu-metadata', required: true },
  { key: 'autoCropEvidence', role: 'splat-autocrop-evidence', required: false },
];

export function createSharpImageToSplatRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.splat) throw new Error('splat output is required');
  if (!input.outputs?.depthMap) throw new Error('depthMap output is required');
  if (!input.outputs?.metadata) throw new Error('metadata output is required');

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: SHARP_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: {
      kitVersion: input.kernel?.kitVersion || '0.0.0',
      profile: input.kernel?.profile,
      commit: input.kernel?.commit || null,
    },
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.input),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSharpImageToSplatRouteDefinition(input = {}) {
  return defineWebGpuRoute({
    routeId: SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: SHARP_MODEL_ID,
      revision: input.model?.revision || 'local-sharp-webgpu',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: {
      kitVersion: input.kernel?.kitVersion || '0.0.0',
      profile: input.kernel?.profile || 'spn-dinov2l16-monodepth-gaussian-ply',
      commit: input.kernel?.commit || null,
    },
    inputs: [
      { role: 'source-image', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      { role: 'splat-candidate', required: true, artifactRequired: true, hashRequired: true, shape: [1179648, 14] },
      { role: 'depth-map', required: true, artifactRequired: true, hashRequired: true, shape: [768, 768, 4] },
      { role: 'sharp-webgpu-metadata', required: true, artifactRequired: true, hashRequired: true, shape: [1] },
      { role: 'splat-autocrop-evidence', required: false, artifactRequired: true, hashRequired: true, shape: [1] },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: input.requiredStages || REQUIRED_STAGES,
    timingSource: input.timingSource || 'adapter-phase-wall-clock',
    worker: input.worker || {
      exportName: 'runSharpImageToSplatRoute',
      adapterReportSchema: 'kaminos.sharp-webgpu-adapter-report.v0',
      pipelineRouteId: 'adapter.sharp-image-to-splat-live.v0',
    },
  });
}
