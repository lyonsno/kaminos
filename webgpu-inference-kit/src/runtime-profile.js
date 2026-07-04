import {
  createWebGpuBackendIdentity,
  validateWebGpuBackendIdentity,
} from './gpu-environment.js';
import {
  createKernelProfileMetadata,
  createRouteTimingMetadata,
  validateKernelProfileMetadata,
  validateRouteTimingMetadata,
} from './kernel-profile.js';
import {
  finishAndValidateRouteProfile,
} from './route-receipt-helper.js';
import {
  validateStagedSubmitProfile,
} from './staged-profile.js';

export const WEBGPU_RUNTIME_PROFILE_SCHEMA = 'kaminos.webgpu-runtime-profile.v0';

const EVIDENCE_MODES = new Set(['live', 'fallback', 'cache', 'demo', 'partial', 'unknown']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createBackendIdentity(input) {
  if (input?.kind === 'webgpu-local') return clone(input);
  return createWebGpuBackendIdentity(input || {});
}

function createEvidence(input = {}) {
  const mode = input.mode || 'live';
  return {
    mode,
    source: input.source || 'browser-webgpu-route',
    fallbackReason: input.fallbackReason || null,
  };
}

function validateEvidence(errors, evidence) {
  if (!evidence || typeof evidence !== 'object') {
    errors.push('evidence must be an object');
    return;
  }
  if (!EVIDENCE_MODES.has(evidence.mode)) errors.push('evidence.mode has unsupported state');
  if (!isNonEmptyString(evidence.source)) errors.push('evidence.source must be a non-empty string');
  if (evidence.mode === 'fallback' && !isNonEmptyString(evidence.fallbackReason)) {
    errors.push('fallback evidence must include fallbackReason');
  }
}

export function createWebGpuRuntimeProfileInput(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('runtime profile input must be an object');
  if (!isNonEmptyString(input.routeId)) throw new Error('routeId must be a non-empty string');

  const backend = createBackendIdentity(input.backend);
  const backendResult = validateWebGpuBackendIdentity(backend);
  if (!backendResult.ok) throw new Error(`invalid WebGPU backend identity: ${backendResult.errors.join('; ')}`);

  const kernel = createKernelProfileMetadata(input.kernel, { requireProfile: true });
  const profile = finishAndValidateRouteProfile(input.profile);
  const evidence = createEvidence(input.evidence);

  const errors = [];
  validateEvidence(errors, evidence);
  if (errors.length > 0) throw new Error(errors.join('; '));

  return {
    routeId: input.routeId,
    runtimeLabel: input.runtimeLabel || 'browser-webgpu',
    backend,
    kernel,
    profile,
    evidence,
  };
}

export function createWebGpuRuntimeProfile(input = {}) {
  const runtimeInput = createWebGpuRuntimeProfileInput(input);
  const timing = createRouteTimingMetadata({
    requiredStages: Array.isArray(input.requiredStages) ? input.requiredStages : runtimeInput.profile.requiredStages,
    timingSource: input.timingSource || runtimeInput.profile.timingSource,
  }, { validate: true });

  return {
    schema: WEBGPU_RUNTIME_PROFILE_SCHEMA,
    routeId: runtimeInput.routeId,
    runtimeLabel: runtimeInput.runtimeLabel,
    backend: runtimeInput.backend,
    kernel: runtimeInput.kernel,
    profile: runtimeInput.profile,
    evidence: runtimeInput.evidence,
    requiredStages: timing.requiredStages,
    timingSource: timing.timingSource,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function validateWebGpuRuntimeProfile(runtimeProfile) {
  const errors = [];

  if (!runtimeProfile || typeof runtimeProfile !== 'object') {
    return { ok: false, errors: ['runtimeProfile must be an object'] };
  }

  if (runtimeProfile.schema !== WEBGPU_RUNTIME_PROFILE_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_RUNTIME_PROFILE_SCHEMA}`);
  }
  if (!isNonEmptyString(runtimeProfile.routeId)) errors.push('routeId must be a non-empty string');
  if (!isNonEmptyString(runtimeProfile.runtimeLabel)) errors.push('runtimeLabel must be a non-empty string');

  const backendResult = validateWebGpuBackendIdentity(runtimeProfile.backend);
  if (!backendResult.ok) errors.push(...backendResult.errors.map(error => `backend.${error}`));

  const kernelResult = validateKernelProfileMetadata(runtimeProfile.kernel);
  if (!kernelResult.ok) errors.push(...kernelResult.errors.map(error => `kernel.${error}`));

  const profileResult = validateStagedSubmitProfile(runtimeProfile.profile);
  if (!profileResult.ok) errors.push(...profileResult.errors.map(error => `profile.${error}`));

  const timingResult = validateRouteTimingMetadata(runtimeProfile);
  if (!timingResult.ok) errors.push(...timingResult.errors);

  validateEvidence(errors, runtimeProfile.evidence);

  if (
    isNonEmptyString(runtimeProfile.timingSource)
    && isNonEmptyString(runtimeProfile.profile?.timingSource)
    && runtimeProfile.timingSource !== runtimeProfile.profile.timingSource
  ) {
    errors.push('timingSource must match profile.timingSource');
  }

  return { ok: errors.length === 0, errors };
}
