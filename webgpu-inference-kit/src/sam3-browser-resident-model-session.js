import { createWebGpuInferenceSession } from './inference-session.js';
import { createSam31ResidentModelResources } from './sam31-resident-model-resources.js';

export const SAM3_BROWSER_RESIDENT_MODEL_SESSION_EVIDENCE_SCHEMA = 'kaminos.sam3-browser-resident-model-session-evidence.v0';
export const SAM3_BROWSER_RESIDENT_MODEL_OWNER_ROUTE_ID = 'sam3.resident-model-owner.webgpu-local.v0';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function createResidentSession({ packageRuntime, inferenceSession, ownerRoute, residentResources, commit, preparationMilliseconds, ownsInferenceSession = true }) {
  requireObject(packageRuntime, 'packageRuntime');
  requireObject(inferenceSession, 'inferenceSession');
  requireObject(ownerRoute, 'ownerRoute');
  requireObject(residentResources, 'residentResources');
  const packageId = requireString(packageRuntime.packageId, 'packageRuntime.packageId');
  let status = 'active';
  let closePromise = null;

  function assertActive() {
    if (status !== 'active') throw new Error('SAM3 browser resident model session is closed');
  }

  function evidence() {
    return {
      schema: SAM3_BROWSER_RESIDENT_MODEL_SESSION_EVIDENCE_SCHEMA,
      status,
      packageId,
      commit: commit || null,
      preparationMilliseconds,
      inferenceSession: inferenceSession.snapshot(),
      residentResources: residentResources.evidence(),
    };
  }

  async function close() {
    if (closePromise) return closePromise;
    status = 'closing';
    closePromise = (async () => {
      const errors = [];
      for (const closeStep of [
        () => ownsInferenceSession ? inferenceSession.drain() : ownerRoute.drain(),
        () => residentResources.release(),
        () => inferenceSession.unregisterRoute(ownerRoute.routeId),
        () => ownsInferenceSession ? inferenceSession.close() : undefined,
      ]) {
        try {
          await closeStep();
        } catch (error) {
          errors.push(error);
        }
      }
      status = 'closed';
      if (errors.length > 0) {
        if (errors.length > 1 && errors[0] && typeof errors[0] === 'object') {
          try {
            errors[0].cleanupErrors = errors.slice(1);
          } catch {
            // Preserve the primary teardown failure even when it is non-extensible.
          }
        }
        throw errors[0];
      }
    })();
    return closePromise;
  }

  return Object.freeze({
    packageId,
    acquisitionReport() { return residentResources.acquisitionReport(); },
    enqueue(input) {
      assertActive();
      return ownerRoute.enqueue(input);
    },
    forgetJob(jobId) {
      return ownerRoute.forgetJob(jobId);
    },
    loadFloat32(entry) {
      assertActive();
      const sourceData = residentResources.loadFloat32(entry);
      residentResources.bind(entry, sourceData);
      return sourceData;
    },
    residentTensorResolver(input) {
      assertActive();
      return residentResources.residentTensorResolver(input);
    },
    evidence,
    close,
  });
}

export async function createSam3BrowserResidentModelSession({
  packageRuntime,
  executionContext,
  commit = null,
  sessionId = `sam3-resident:${globalThis.crypto?.randomUUID?.() || Date.now()}`,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  requireObject(packageRuntime, 'packageRuntime');
  requireObject(executionContext, 'executionContext');
  const startedAt = now();
  const adapterName = executionContext.adapter?.info?.description
    || executionContext.adapter?.info?.device
    || 'browser-webgpu-adapter';
  const ownsInferenceSession = executionContext.inferenceSession == null;
  if (!ownsInferenceSession && executionContext.inferenceSession.device !== executionContext.device) {
    throw new Error('borrowed inference session must own the exact execution device');
  }
  const inferenceSession = executionContext.inferenceSession || await createWebGpuInferenceSession({
    sessionId,
    adapter: executionContext.adapter,
    device: executionContext.device,
    queue: executionContext.device.queue,
    adapterName,
    deviceOwnership: 'borrowed',
  });
  let ownerRoute = null;
  let residentResources = null;
  try {
    ownerRoute = await inferenceSession.registerRoute({
      routeId: SAM3_BROWSER_RESIDENT_MODEL_OWNER_ROUTE_ID,
      runtimeOptions: {
        runtimeLabel: 'sam3-resident-model-owner',
        kernel: { profile: 'sam3-resident-model-owner-v0', commit },
        requiredStages: [],
      },
    });
    residentResources = await createSam31ResidentModelResources({ packageRuntime, route: ownerRoute });
    return createResidentSession({
      packageRuntime,
      inferenceSession,
      ownerRoute,
      residentResources,
      ownsInferenceSession,
      commit,
      preparationMilliseconds: now() - startedAt,
    });
  } catch (error) {
    const cleanupErrors = [];
    for (const cleanup of [
      () => residentResources?.release?.(),
      () => ownerRoute ? inferenceSession.unregisterRoute(ownerRoute.routeId) : undefined,
      () => ownsInferenceSession ? inferenceSession.close() : undefined,
    ]) {
      try { await cleanup(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (cleanupErrors.length) error.cleanupErrors = cleanupErrors;
    throw error;
  }
}

export function createSam3BrowserResidentModelSessionForTest(input = {}) {
  return createResidentSession(input);
}
