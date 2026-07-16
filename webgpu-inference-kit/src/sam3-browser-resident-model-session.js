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

function createResidentSession({ packageRuntime, inferenceSession, ownerRoute, residentResources, commit, preparationMilliseconds }) {
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
      await inferenceSession.drain();
      residentResources.release();
      inferenceSession.unregisterRoute(ownerRoute.routeId);
      inferenceSession.close();
      status = 'closed';
    })();
    return closePromise;
  }

  return Object.freeze({
    packageId,
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
  const inferenceSession = await createWebGpuInferenceSession({
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
      commit,
      preparationMilliseconds: now() - startedAt,
    });
  } catch (error) {
    residentResources?.release?.();
    if (ownerRoute) inferenceSession.unregisterRoute(ownerRoute.routeId);
    inferenceSession.close();
    throw error;
  }
}

export function createSam3BrowserResidentModelSessionForTest(input = {}) {
  return createResidentSession(input);
}
