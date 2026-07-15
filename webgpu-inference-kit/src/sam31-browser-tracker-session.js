import { classifySam31MemoryAttentionAdapter } from './sam31-memory-attention-evidence.js';
import {
  loadSam31BrowserTrackerModelPackageRuntime,
  loadSam31BrowserTrackerPackageRuntime,
} from './sam31-browser-tracker-package-runtime.js';
import {
  createSam31BrowserTrackerCallerInvocationRuntime,
  decodeSam31BrowserTrackerSourceImage,
} from './sam31-browser-tracker-caller-invocation.js';
import { createWebGpuInferenceSession } from './inference-session.js';
import { createSam31ResidentModelResources } from './sam31-resident-model-resources.js';
import { runSam31BrowserTrackerPackageInvocation } from './sam31-browser-tracker-session-driver.js';

export const SAM31_BROWSER_TRACKER_SESSION_SCHEMA = 'kaminos.sam31-browser-tracker-session.v0';
export const SAM31_BROWSER_TRACKER_RESIDENT_SESSION_SCHEMA = 'kaminos.sam31-browser-tracker-resident-session.v0';

const SAM31_RESIDENT_MODEL_OWNER_ROUTE_ID = 'sam31.resident-model-owner.webgpu-local.v0';

function adapterIdentity(adapter) {
  const info = adapter.info;
  return {
    description: String(info?.description || ''),
    vendor: String(info?.vendor || ''),
    architecture: String(info?.architecture || ''),
    device: String(info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({
      explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined,
      vendor: info?.vendor,
      architecture: info?.architecture,
    }),
  };
}

async function acquireExecutionContext(gpu) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') throw new Error('WebGPU request surface is required');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  return { adapter, device, errors: [] };
}

function createSession({ runtime, execution, driver, userAgent, commit, onProgress }) {
  if (!execution?.adapter || !execution?.device) throw new Error('execution context requires an adapter and device');
  if (!Array.isArray(execution.errors)) execution.errors = [];
  const { adapter, device } = execution;
  const adapterInfo = execution.adapterInfo || adapterIdentity(adapter);
  execution.adapterInfo = adapterInfo;
  let status = 'open';
  let closeEvidence = null;
  let intentionalClose = false;
  let deviceLoss = null;
  device.addEventListener?.('uncapturederror', event => execution.errors.push(String(event.error?.message || event.error)));
  device.lost.then(info => {
    if (intentionalClose) return;
    deviceLoss = { reason: info?.reason || 'unknown', message: info?.message || '' };
    execution.errors.push(`WebGPU device lost: ${deviceLoss.reason}: ${deviceLoss.message}`);
  });

  const session = {
    schema: SAM31_BROWSER_TRACKER_SESSION_SCHEMA,
    adapterInfo,
    get status() { return status; },
    get deviceLoss() { return deviceLoss; },
    async run() {
      if (status === 'closed') throw new Error('tracker session is closed');
      if (status !== 'open') throw new Error('tracker session already executed');
      status = 'running';
      try {
        const result = await driver({ packageRuntime: runtime, adapter, device, errors: execution.errors, adapterInfo, userAgent, commit, onProgress });
        const completeRouteEvidence = result?.evidence?.passed === true
          && ['receipts', 'requestIds', 'requestedRouteIds', 'effectiveRouteIds']
            .every(name => Array.isArray(result[name]) && result[name].length === 19);
        if (!completeRouteEvidence) throw new Error('tracker session driver did not return complete 19-route evidence');
        status = 'completed';
        return result;
      } catch (error) {
        status = 'failed';
        throw error;
      }
    },
    async close() {
      if (closeEvidence) return closeEvidence;
      let queueDrained = false;
      let deviceDestroyed = false;
      let deviceLossAwaited = false;
      if (typeof device.queue?.onSubmittedWorkDone === 'function') {
        await device.queue.onSubmittedWorkDone();
        queueDrained = true;
      }
      intentionalClose = true;
      if (typeof device.destroy === 'function') {
        device.destroy();
        deviceDestroyed = true;
      }
      if (device.lost && typeof device.lost.then === 'function') {
        await device.lost;
        deviceLossAwaited = true;
      }
      status = 'closed';
      closeEvidence = Object.freeze({ schema: 'kaminos.sam31-browser-tracker-session-close-evidence.v0', queueDrained, deviceDestroyed, deviceLossAwaited, deviceLoss });
      return closeEvidence;
    },
  };
  return session;
}

function completeTrackerRouteEvidence(result) {
  return result?.evidence?.passed === true
    && ['receipts', 'requestIds', 'requestedRouteIds', 'effectiveRouteIds']
      .every(name => Array.isArray(result[name]) && result[name].length === 19);
}

function residentEvidenceSummary(evidence) {
  const resources = Array.isArray(evidence?.resources) ? evidence.resources : [];
  return Object.freeze({
    resourceCount: evidence?.resourceCount ?? resources.length,
    allocationCount: evidence?.allocationCount ?? resources.length,
    uploadCount: evidence?.uploadCount ?? resources.length,
    bindingCount: evidence?.bindingCount ?? 0,
    liveBufferIds: resources.map(resource => resource.liveBufferId),
    truncated: evidence?.truncated === true,
  });
}

function createResidentSession({
  modelPackageRuntime,
  inferenceSession,
  ownerRoute,
  residentResources,
  createCallerRuntime,
  driver,
  decodeImage,
  userAgent,
  commit,
  onProgress,
}) {
  if (!modelPackageRuntime || typeof modelPackageRuntime.loadFloat32 !== 'function') throw new Error('resident tracker session requires a model package runtime');
  if (!inferenceSession?.adapter || !inferenceSession?.device) throw new Error('resident tracker session requires an inference session');
  if (!ownerRoute?.routeId) throw new Error('resident tracker session requires an owner route');
  if (!residentResources || typeof residentResources.evidence !== 'function' || typeof residentResources.release !== 'function') throw new Error('resident tracker session requires model resources');
  if (typeof createCallerRuntime !== 'function' || typeof driver !== 'function') throw new Error('resident tracker session requires caller and driver functions');
  const adapterInfo = adapterIdentity(inferenceSession.adapter);
  const errors = [];
  inferenceSession.device.addEventListener?.('uncapturederror', event => errors.push(String(event.error?.message || event.error)));
  const strictResidentTensorResolver = tensorInput => {
    const binding = residentResources.residentTensorResolver(tensorInput);
    if (!binding) throw new Error(`static tensor ${tensorInput?.name || '<unnamed>'} did not resolve to authenticated model residency`);
    return binding;
  };
  const residentModelPackageRuntime = Object.freeze({
    ...modelPackageRuntime,
    bindResidentTensor: residentResources.bind,
    residentTensorResolver: strictResidentTensorResolver,
  });
  const invocationEvidence = [];
  let status = 'open';
  let invocationCount = 0;
  let attemptCount = 0;
  let closeEvidence = null;

  const api = {
    schema: SAM31_BROWSER_TRACKER_RESIDENT_SESSION_SCHEMA,
    packageId: modelPackageRuntime.packageId,
    adapterInfo,
    get status() { return status; },
    get invocationCount() { return invocationCount; },
    get attemptCount() { return attemptCount; },
    async run(input = {}) {
      if (status === 'closed') throw new Error('resident tracker session is closed');
      if (status === 'running') throw new Error('resident tracker session is already running');
      status = 'running';
      const invocationIndex = attemptCount;
      attemptCount += 1;
      const before = residentEvidenceSummary(residentResources.evidence());
      try {
        const packageRuntime = await createCallerRuntime({
          modelPackageRuntime: residentModelPackageRuntime,
          sourceImages: input.sourceImages,
          initialMask: input.initialMask,
          session: input.session,
          decodeImage,
        });
        const result = await driver({
          packageRuntime,
          adapter: inferenceSession.adapter,
          device: inferenceSession.device,
          errors,
          adapterInfo,
          userAgent,
          commit,
          onProgress: input.onProgress || onProgress,
        });
        if (!completeTrackerRouteEvidence(result)) throw new Error('resident tracker driver did not return complete 19-route evidence');
        const after = residentEvidenceSummary(residentResources.evidence());
        const residentRuntime = Object.freeze({
          schema: 'kaminos.sam31-browser-tracker-resident-invocation-evidence.v0',
          invocationIndex,
          modelPackageId: modelPackageRuntime.packageId,
          resourceCount: after.resourceCount,
          bindingCountBefore: before.bindingCount,
          bindingCountAfter: after.bindingCount,
          liveBufferIds: [...after.liveBufferIds],
          modelAllocationDelta: after.allocationCount - before.allocationCount,
          modelUploadDelta: after.uploadCount - before.uploadCount,
          truncated: before.truncated || after.truncated,
        });
        if (residentRuntime.truncated) throw new Error('resident model evidence is truncated');
        if (residentRuntime.modelAllocationDelta !== 0 || residentRuntime.modelUploadDelta !== 0) {
          throw new Error('resident invocation changed model GPU allocation or upload counts');
        }
        if (JSON.stringify(before.liveBufferIds) !== JSON.stringify(after.liveBufferIds)) {
          throw new Error('resident invocation changed live model buffer identity');
        }
        invocationEvidence.push(Object.freeze({
          invocationIndex,
          invocationId: packageRuntime.invocationId,
          status: 'completed',
          requestIds: [...result.requestIds],
          outputIds: result.receipts.flatMap(receipt => Array.isArray(receipt?.outputs) ? receipt.outputs.map(output => output.artifactId) : []),
          residentRuntime,
        }));
        invocationCount += 1;
        status = 'open';
        return Object.freeze({ ...result, residentRuntime });
      } catch (error) {
        invocationEvidence.push(Object.freeze({
          invocationIndex,
          status: 'failed',
          failurePhase: 'resident-invocation',
          error: String(error?.message || error),
          lastTrustworthyEvidence: residentEvidenceSummary(residentResources.evidence()),
        }));
        status = 'open';
        throw error;
      }
    },
    evidence() {
      return Object.freeze({
        schema: 'kaminos.sam31-browser-tracker-resident-session-evidence.v0',
        packageId: modelPackageRuntime.packageId,
        status,
        invocationCount,
        attemptCount,
        truncated: false,
        invocations: invocationEvidence.map(row => ({ ...row })),
        residentModel: residentResources.evidence(),
        inferenceSession: inferenceSession.snapshot(),
      });
    },
    async close() {
      if (closeEvidence) return closeEvidence;
      if (status === 'running') throw new Error('resident tracker session must finish its active invocation before close');
      const drained = await inferenceSession.drain();
      const release = residentResources.release();
      const detached = inferenceSession.unregisterRoute(ownerRoute.routeId);
      const closed = inferenceSession.close();
      let deviceLoss = null;
      let deviceLossAwaited = false;
      if (inferenceSession.deviceLost && typeof inferenceSession.deviceLost.then === 'function') {
        deviceLoss = await inferenceSession.deviceLost;
        deviceLossAwaited = true;
      }
      status = 'closed';
      closeEvidence = Object.freeze({
        schema: 'kaminos.sam31-browser-tracker-resident-session-close-evidence.v0',
        queueDrained: drained != null,
        modelReleased: release?.status === 'released' || release?.status === 'already-released',
        ownerRouteDetached: detached?.status === 'detached',
        sessionClosed: closed?.status === 'closed',
        deviceLossAwaited,
        deviceLoss,
        release,
        detached,
        closed,
      });
      return closeEvidence;
    },
  };
  return Object.freeze(api);
}

export async function createSam31BrowserTrackerSession(options = {}) {
  for (const name of ['packageRuntime', 'executionContext', 'executeInvocation', 'modelPackageRuntime', 'callerInvocationRuntime', 'decodeImage']) {
    if (Object.hasOwn(options, name)) throw new Error(`public tracker session does not accept ${name}`);
  }
  const {
    packageRoot = null,
    modelPackageRoot = null,
    sourceImages = null,
    initialMask = null,
    session: invocationSession = null,
    pageUrl = globalThis.location?.href,
    cache = null,
    gpu = globalThis.navigator?.gpu,
    userAgent = globalThis.navigator?.userAgent || 'unknown-browser',
    commit = null,
    onProgress = () => {},
  } = options;
  if (!cache) throw new Error('package root and shared cache are required');
  if (Boolean(packageRoot) === Boolean(modelPackageRoot)) throw new Error('exactly one packageRoot or modelPackageRoot is required');
  if (packageRoot && (sourceImages != null || initialMask != null || invocationSession != null)) {
    throw new Error('prebuilt packageRoot cannot be combined with caller invocation inputs');
  }
  let runtime;
  if (modelPackageRoot) {
    if (!sourceImages || !initialMask || !invocationSession) throw new Error('modelPackageRoot requires caller sourceImages, initialMask, and session');
    const modelPackageRuntime = await loadSam31BrowserTrackerModelPackageRuntime({ rootUrl: modelPackageRoot, pageUrl, cache });
    runtime = await createSam31BrowserTrackerCallerInvocationRuntime({
      modelPackageRuntime,
      sourceImages,
      initialMask,
      session: invocationSession,
      decodeImage: decodeSam31BrowserTrackerSourceImage,
    });
  } else {
    runtime = await loadSam31BrowserTrackerPackageRuntime({ rootUrl: packageRoot, pageUrl, cache });
  }
  const execution = await acquireExecutionContext(gpu);
  return createSession({ runtime, execution, driver: runSam31BrowserTrackerPackageInvocation, userAgent, commit, onProgress });
}

export async function createSam31BrowserTrackerResidentSession(options = {}) {
  for (const name of ['modelPackageRuntime', 'inferenceSession', 'ownerRoute', 'residentResources', 'createCallerRuntime', 'executeInvocation', 'decodeImage']) {
    if (Object.hasOwn(options, name)) throw new Error(`public resident tracker session does not accept ${name}`);
  }
  const {
    modelPackageRoot = null,
    pageUrl = globalThis.location?.href,
    cache = null,
    gpu = globalThis.navigator?.gpu,
    userAgent = globalThis.navigator?.userAgent || 'unknown-browser',
    commit = null,
    onProgress = () => {},
    residentSessionId = `sam31-resident:${globalThis.crypto?.randomUUID?.() || Date.now()}`,
  } = options;
  if (!modelPackageRoot || !cache) throw new Error('model package root and shared cache are required');
  const modelPackageRuntime = await loadSam31BrowserTrackerModelPackageRuntime({ rootUrl: modelPackageRoot, pageUrl, cache });
  const inferenceSession = await createWebGpuInferenceSession({
    sessionId: residentSessionId,
    gpu,
    browser: userAgent,
    deviceOwnership: 'owned',
  });
  let ownerRoute = null;
  let residentResources = null;
  try {
    ownerRoute = await inferenceSession.registerRoute({
      routeId: SAM31_RESIDENT_MODEL_OWNER_ROUTE_ID,
      runtimeOptions: {
        runtimeLabel: 'sam31-resident-model-owner',
        kernel: { profile: 'sam31-resident-model-owner-v0', commit },
        requiredStages: [],
      },
    });
    residentResources = await createSam31ResidentModelResources({ packageRuntime: modelPackageRuntime, route: ownerRoute });
    return createResidentSession({
      modelPackageRuntime,
      inferenceSession,
      ownerRoute,
      residentResources,
      createCallerRuntime: createSam31BrowserTrackerCallerInvocationRuntime,
      driver: runSam31BrowserTrackerPackageInvocation,
      decodeImage: decodeSam31BrowserTrackerSourceImage,
      userAgent,
      commit,
      onProgress,
    });
  } catch (error) {
    residentResources?.release?.();
    if (ownerRoute) inferenceSession.unregisterRoute(ownerRoute.routeId);
    inferenceSession.close();
    await inferenceSession.deviceLost;
    throw error;
  }
}

export function createSam31BrowserTrackerSessionForTest({
  packageRuntime,
  executionContext,
  executeInvocation,
  userAgent = 'test-browser',
  commit = null,
  onProgress = () => {},
} = {}) {
  if (!packageRuntime) throw new Error('test tracker session requires a package runtime');
  if (typeof executeInvocation !== 'function') throw new Error('test tracker session requires an invocation driver');
  return createSession({ runtime: packageRuntime, execution: executionContext, driver: executeInvocation, userAgent, commit, onProgress });
}

export function createSam31BrowserTrackerResidentSessionForTest({
  modelPackageRuntime,
  inferenceSession,
  ownerRoute,
  residentResources,
  createCallerRuntime,
  executeInvocation,
  decodeImage = async () => {},
  userAgent = 'test-browser',
  commit = null,
  onProgress = () => {},
} = {}) {
  return createResidentSession({
    modelPackageRuntime,
    inferenceSession,
    ownerRoute,
    residentResources,
    createCallerRuntime,
    driver: executeInvocation,
    decodeImage,
    userAgent,
    commit,
    onProgress,
  });
}
