import { validateWebGpuBackendIdentity } from './gpu-environment.js';
import { defineWebGpuRoute } from './route-boundary.js';
import { createWebGpuLocalRouteReceipt } from './route-receipt.js';
import { finishStagedSubmitProfile, validateStagedSubmitProfile } from './staged-profile.js';

export const KIMODO_TEXT_TO_MOTION_ROUTE_ID = 'kimodo.text-to-motion.webgpu-local.v0';
const KIMODO_MODEL_ID = 'NVIDIA/Kimodo-SOMA-RP-v1.1';
const REQUIRED_STAGES = ['text-embedding', 'ddim-sampling', 'fk-decode', 'output-capture'];

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

export function createKimodoTextToMotionRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('text prompt artifactId and sha256 are required');
  }
  if (!input.outputs?.soma77Joints) throw new Error('soma77Joints output is required');
  if (!input.outputs?.motionClip) throw new Error('motionClip output is required');

  requireArtifact(input.outputs.soma77Joints, 'soma77Joints');
  requireArtifact(input.outputs.motionClip, 'motionClip');
  if (input.outputs.filmstrip) requireArtifact(input.outputs.filmstrip, 'filmstrip');

  const backendResult = validateWebGpuBackendIdentity(input.backend);
  if (!backendResult.ok) {
    throw new Error(`invalid WebGPU backend identity: ${backendResult.errors.join('; ')}`);
  }

  const profile = finishAndValidateProfile(input.profile);
  const outputs = [
    outputArtifact('soma77-joints', input.outputs.soma77Joints),
    outputArtifact('motion-clip', input.outputs.motionClip),
  ];
  if (input.outputs.filmstrip) outputs.push(outputArtifact('filmstrip', input.outputs.filmstrip));

  return createWebGpuLocalRouteReceipt({
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
    kernel: {
      kitVersion: input.kernel?.kitVersion || '0.0.0',
      profile: input.kernel?.profile,
      commit: input.kernel?.commit || null,
    },
    inputs: [
      {
        role: 'text-prompt',
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

export function createKimodoTextToMotionRouteDefinition(input = {}) {
  return defineWebGpuRoute({
    routeId: KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: KIMODO_MODEL_ID,
      revision: input.model?.revision || 'SOMA-RP-v1.1',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: {
      kitVersion: input.kernel?.kitVersion || '0.0.0',
      profile: input.kernel?.profile || 'twostage-denoiser-ddim50-fk',
      commit: input.kernel?.commit || null,
    },
    inputs: [
      { role: 'text-prompt', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      { role: 'soma77-joints', required: true, artifactRequired: true, hashRequired: true, shape: [90, 77, 3] },
      { role: 'motion-clip', required: true, artifactRequired: true, hashRequired: true, shape: [1] },
      { role: 'filmstrip', required: false, artifactRequired: true, hashRequired: true },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: input.requiredStages || REQUIRED_STAGES,
    timingSource: input.timingSource || 'adapter-phase-wall-clock',
    worker: input.worker || {
      exportName: 'runKimodoTextToMotionRoute',
      textEmbedding: 'external-llama3-8b',
      motionFormat: 'kimodo-soma77-explicit-joints',
    },
  });
}
