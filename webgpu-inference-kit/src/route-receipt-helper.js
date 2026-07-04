import { validateWebGpuBackendIdentity } from './gpu-environment.js';
import { createWebGpuLocalRouteReceipt } from './route-receipt.js';
import { finishStagedSubmitProfile, validateStagedSubmitProfile } from './staged-profile.js';

export function validateRouteReceiptArtifact(value, name) {
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

export function createRouteReceiptInputArtifact(role, artifact) {
  return {
    role,
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
    shape: Array.isArray(artifact.shape) ? [...artifact.shape] : undefined,
  };
}

export function createRouteReceiptArtifacts({ artifacts, roles }) {
  if (!artifacts || typeof artifacts !== 'object') throw new Error('artifacts must be an object');
  if (!Array.isArray(roles) || roles.length === 0) throw new Error('roles must be a non-empty array');

  const outputs = [];
  for (const role of roles) {
    const key = role.key;
    const artifact = artifacts[key];
    if (!artifact) {
      if (role.required !== false) throw new Error(`${key} output is required`);
      continue;
    }

    validateRouteReceiptArtifact(artifact, key);
    outputs.push({
      role: role.role,
      artifactId: artifact.artifactId,
      sha256: artifact.sha256,
      shape: [...artifact.shape],
      status: artifact.status || 'real',
    });
  }
  return outputs;
}

export function finishAndValidateRouteProfile(profile) {
  const finished = finishStagedSubmitProfile(profile);
  const result = validateStagedSubmitProfile(finished);
  if (!result.ok) throw new Error(`invalid staged profile: ${result.errors.join('; ')}`);
  return finished;
}

export function validateRouteReceiptBackendIdentity(backend) {
  const result = validateWebGpuBackendIdentity(backend);
  if (!result.ok) throw new Error(`invalid WebGPU backend identity: ${result.errors.join('; ')}`);
  return backend;
}

export function createWebGpuRouteReceiptFromArtifacts(input) {
  validateRouteReceiptBackendIdentity(input.backend);
  const profile = finishAndValidateRouteProfile(input.profile);

  return createWebGpuLocalRouteReceipt({
    requestedRouteId: input.requestedRouteId,
    effectiveRouteId: input.effectiveRouteId || input.requestedRouteId,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: input.model,
    kernel: input.kernel,
    inputs: input.inputs,
    outputs: input.outputs,
    timings: {
      source: profile.timingSource,
      totalMs: profile.totalMs,
      stages: profile.stages,
      profile,
    },
  });
}
