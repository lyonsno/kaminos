import { validateWebGpuBackendIdentity } from './gpu-environment.js';
import { defineWebGpuRoute } from './route-boundary.js';
import { createWebGpuLocalRouteReceipt } from './route-receipt.js';
import { finishStagedSubmitProfile, validateStagedSubmitProfile } from './staged-profile.js';

export const SHARP_IMAGE_TO_SPLAT_ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';
const SHARP_MODEL_ID = 'apple/ml-sharp';
const REQUIRED_STAGES = ['spn', 'monodepth', 'gaussian-decoder', 'compose-ply', 'output-capture'];

function requireArtifact(value, name) {
  if (!value || typeof value !== 'object') throw new Error(`${name} output must be an object`);
  if (typeof value.artifactId !== 'string' || value.artifactId.length === 0) {
    throw new Error(`${name} output must include artifactId`);
  }
  if (typeof value.sha256 !== 'string' || value.sha256.length === 0) {
    throw new Error(`${name} output must include sha256`);
  }
  if (!Array.isArray(value.shape) || value.shape.length === 0) {
    throw new Error(`${name} output must include shape`);
  }
}

function outputArtifact(role, artifact) {
  return {
    role,
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
    shape: [...artifact.shape],
    status: artifact.status || 'real',
  };
}

function finishAndValidateProfile(profile) {
  const finished = finishStagedSubmitProfile(profile);
  const result = validateStagedSubmitProfile(finished);
  if (!result.ok) throw new Error(`invalid staged profile: ${result.errors.join('; ')}`);
  return finished;
}

export function createSharpImageToSplatRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.splat) throw new Error('splat output is required');
  if (!input.outputs?.depthMap) throw new Error('depthMap output is required');
  if (!input.outputs?.metadata) throw new Error('metadata output is required');

  requireArtifact(input.outputs.splat, 'splat');
  requireArtifact(input.outputs.depthMap, 'depthMap');
  requireArtifact(input.outputs.metadata, 'metadata');
  if (input.outputs.autoCropEvidence) requireArtifact(input.outputs.autoCropEvidence, 'autoCropEvidence');

  const backendResult = validateWebGpuBackendIdentity(input.backend);
  if (!backendResult.ok) {
    throw new Error(`invalid WebGPU backend identity: ${backendResult.errors.join('; ')}`);
  }

  const profile = finishAndValidateProfile(input.profile);
  const outputs = [
    outputArtifact('splat-candidate', input.outputs.splat),
    outputArtifact('depth-map', input.outputs.depthMap),
    outputArtifact('sharp-webgpu-metadata', input.outputs.metadata),
  ];
  if (input.outputs.autoCropEvidence) {
    outputs.push(outputArtifact('splat-autocrop-evidence', input.outputs.autoCropEvidence));
  }

  return createWebGpuLocalRouteReceipt({
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
      {
        role: 'source-image',
        artifactId: input.input.artifactId,
        sha256: input.input.sha256,
        shape: Array.isArray(input.input.shape) ? [...input.input.shape] : undefined,
      },
    ],
    outputs,
    timings: {
      source: profile.timingSource,
      totalMs: profile.totalMs,
      stages: profile.stages,
      profile,
    },
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
