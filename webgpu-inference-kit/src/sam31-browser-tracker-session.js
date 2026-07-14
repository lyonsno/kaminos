import { classifySam31MemoryAttentionAdapter } from './sam31-memory-attention-evidence.js';
import {
  loadSam31BrowserTrackerModelPackageRuntime,
  loadSam31BrowserTrackerPackageRuntime,
} from './sam31-browser-tracker-package-runtime.js';
import {
  createSam31BrowserTrackerCallerInvocationRuntime,
  decodeSam31BrowserTrackerSourceImage,
} from './sam31-browser-tracker-caller-invocation.js';
import { runSam31BrowserTrackerPackageInvocation } from './sam31-browser-tracker-session-driver.js';

export const SAM31_BROWSER_TRACKER_SESSION_SCHEMA = 'kaminos.sam31-browser-tracker-session.v0';

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
