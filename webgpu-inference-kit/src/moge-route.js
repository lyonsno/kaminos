import { createWebGpuLocalRouteReceipt } from './route-receipt.js';
import { finishStagedSubmitProfile, validateStagedSubmitProfile } from './staged-profile.js';
import { validateWebGpuBackendIdentity } from './gpu-environment.js';
import { defineWebGpuRoute } from './route-boundary.js';

export const MOGE_DEPTH_NORMAL_ROUTE_ID = 'moge.depth-normal.webgpu-local.v0';
const MOGE_MODEL_ID = 'Ruicheng/moge-2-vitl-normal';

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

export function createMogeDepthNormalRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.depth) throw new Error('depth output is required');
  if (!input.outputs?.normal) throw new Error('normal output is required');

  requireArtifact(input.outputs.depth, 'depth');
  requireArtifact(input.outputs.normal, 'normal');
  if (input.outputs.pointMap) requireArtifact(input.outputs.pointMap, 'pointMap');
  if (input.outputs.mask) requireArtifact(input.outputs.mask, 'mask');

  const backendResult = validateWebGpuBackendIdentity(input.backend);
  if (!backendResult.ok) {
    throw new Error(`invalid WebGPU backend identity: ${backendResult.errors.join('; ')}`);
  }

  const profile = finishStagedSubmitProfile(input.profile);
  const profileResult = validateStagedSubmitProfile(profile);
  if (!profileResult.ok) {
    throw new Error(`invalid staged profile: ${profileResult.errors.join('; ')}`);
  }

  const outputs = [
    outputArtifact('depth', input.outputs.depth),
    outputArtifact('normal', input.outputs.normal),
  ];
  if (input.outputs.pointMap) outputs.push(outputArtifact('pointmap', input.outputs.pointMap));
  if (input.outputs.mask) outputs.push(outputArtifact('mask', input.outputs.mask));

  return createWebGpuLocalRouteReceipt({
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

export function createMogeDepthNormalRouteDefinition(input = {}) {
  return defineWebGpuRoute({
    routeId: MOGE_DEPTH_NORMAL_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: MOGE_MODEL_ID,
      revision: input.model?.revision || 'local-vitl-normal',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: {
      kitVersion: input.kernel?.kitVersion || '0.0.0',
      profile: input.kernel?.profile || 'conv-transpose2d-stride2',
      commit: input.kernel?.commit || null,
    },
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
    requiredStages: input.requiredStages || ['backbone', 'decoder-heads', 'output-readback'],
    timingSource: input.timingSource || 'queue-submit-wait',
    worker: input.worker || {
      exportName: 'runMogeDepthNormalRoute',
    },
  });
}
