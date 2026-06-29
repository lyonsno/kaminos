import { validateWebGpuBackendIdentity } from './gpu-environment.js';
import { defineWebGpuRoute } from './route-boundary.js';
import { createWebGpuLocalRouteReceipt } from './route-receipt.js';
import { finishStagedSubmitProfile, validateStagedSubmitProfile } from './staged-profile.js';

export const SF3D_IMAGE_TO_MESH_ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';
const SF3D_MODEL_ID = 'stabilityai/stable-fast-3d';
const REQUIRED_STAGES = [
  'image-preprocess',
  'dinov2-tokenizer',
  'two-stream-backbone',
  'triplane-decode',
  'marching-tet',
  'texture-bake',
  'glb-export',
];

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

export function createSf3dImageToMeshRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.meshGlb) throw new Error('meshGlb output is required');
  if (!input.outputs?.albedoTexture) throw new Error('albedoTexture output is required');
  if (!input.outputs?.normalMap) throw new Error('normalMap output is required');

  requireArtifact(input.outputs.meshGlb, 'meshGlb');
  requireArtifact(input.outputs.albedoTexture, 'albedoTexture');
  requireArtifact(input.outputs.normalMap, 'normalMap');
  if (input.outputs.meshObj) requireArtifact(input.outputs.meshObj, 'meshObj');

  const backendResult = validateWebGpuBackendIdentity(input.backend);
  if (!backendResult.ok) {
    throw new Error(`invalid WebGPU backend identity: ${backendResult.errors.join('; ')}`);
  }

  const profile = finishAndValidateProfile(input.profile);
  const outputs = [
    outputArtifact('mesh-glb', input.outputs.meshGlb),
    outputArtifact('albedo-texture', input.outputs.albedoTexture),
    outputArtifact('normal-map', input.outputs.normalMap),
  ];
  if (input.outputs.meshObj) outputs.push(outputArtifact('mesh-obj', input.outputs.meshObj));

  return createWebGpuLocalRouteReceipt({
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

export function createSf3dImageToMeshRouteDefinition(input = {}) {
  return defineWebGpuRoute({
    routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: SF3D_MODEL_ID,
      revision: input.model?.revision || 'stable-fast-3d',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: {
      kitVersion: input.kernel?.kitVersion || '0.0.0',
      profile: input.kernel?.profile || 'dinov2-two-stream-triplane-marching-tet-texture-bake',
      commit: input.kernel?.commit || null,
    },
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
    requiredStages: input.requiredStages || REQUIRED_STAGES,
    timingSource: input.timingSource || 'adapter-phase-wall-clock',
    worker: input.worker || {
      exportName: 'runSf3dImageToMeshRoute',
      meshFormat: 'glb',
      textureBake: true,
      normalMap: true,
    },
  });
}
