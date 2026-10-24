import { createWebGpuInferenceSession } from './inference-session.js';
import { createSam31BrowserTrackerPackageCache, loadSam31BrowserTrackerModelPackageRuntime } from './sam31-browser-tracker-package-runtime.js';
import { createSam31ResidentModelResources } from './sam31-resident-model-resources.js';
import { createSam31StreamDriver } from './sam31-stream-driver.js';
import { createSam31StreamEngine } from './sam31-stream-engine.js';
import { classifySam31MemoryAttentionAdapter } from './sam31-memory-attention-evidence.js';

const production = { loadRuntime: loadSam31BrowserTrackerModelPackageRuntime,
  createInferenceSession: createWebGpuInferenceSession, createResources: createSam31ResidentModelResources,
  createDriver: createSam31StreamDriver };

async function createTracker(options, dependencies) {
  const { modelPackageRoot, pageUrl = globalThis.location?.href,
    cache = createSam31BrowserTrackerPackageCache(), inferenceSession: borrowed = null,
    gpu = globalThis.navigator?.gpu, userAgent = globalThis.navigator?.userAgent || 'unknown-browser',
    commit = null, onProgress = () => {}, memoryAttentionKernel = 'online' } = options;
  if (!modelPackageRoot) throw new Error('a stream model package root is required');
  if (!['online', 'flash'].includes(memoryAttentionKernel)) throw new Error('unsupported memory attention kernel');
  const modelRuntime = await dependencies.loadRuntime({ rootUrl: modelPackageRoot, pageUrl, cache });
  if (modelRuntime.modelPackage?.components?.stream?.schema !== 'kaminos.sam31-stream-model.v1') {
    throw new Error('a production stream model package is required, not a two-frame fixture');
  }
  const id = `sam31-stream:${crypto.randomUUID()}`;
  const session = borrowed || await dependencies.createInferenceSession({ sessionId: id, gpu,
    browser: userAgent, deviceOwnership: 'owned' });
  let route = null, resources = null, driver = null, listenerAttached = false;
  const errors = [];
  const onError = event => errors.push(String(event.error?.message || event.error));
  const adapterInfo = { description: String(session.adapter?.info?.description || ''),
    vendor: String(session.adapter?.info?.vendor || ''), architecture: String(session.adapter?.info?.architecture || ''),
    device: String(session.adapter?.info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({ vendor: session.adapter?.info?.vendor,
      architecture: session.adapter?.info?.architecture,
      explicitFallback: session.adapter?.isFallbackAdapter ?? session.adapter?.info?.isFallbackAdapter }) };
  function active(phase) {
    const state = session.snapshot();
    if (state.status !== 'active' || state.deviceLoss || errors.length) {
      throw new Error(`SAM3.1 ${phase}: ${state.deviceLoss?.message || state.status}; ${errors.join('; ')}`);
    }
  }
  async function release() {
    // Only SAM's route is drained/detached; the host may still be rendering.
    if (route) await route.drain();
    if (session.snapshot().status === 'active') await session.device.queue.onSubmittedWorkDone();
    driver?.close(); driver = null;
    const released = resources?.release(); resources = null;
    const detached = route ? session.unregisterRoute(route.routeId) : null; route = null;
    if (listenerAttached) session.device.removeEventListener?.('uncapturederror', onError);
    listenerAttached = false;
    const closed = borrowed ? null : session.close();
    return { modelReleased: released?.status === 'released' || released?.status === 'already-released',
      ownerRouteDetached: detached?.status === 'detached', sessionOwnership: borrowed ? 'borrowed' : 'owned',
      sessionClosed: closed?.status === 'closed' };
  }
  try {
    active('setup');
    session.device.addEventListener?.('uncapturederror', onError); listenerAttached = true;
    route = await session.registerRoute({ routeId: id, runtimeOptions: {
      runtimeLabel: 'sam31-stream-model-owner', kernel: { profile: 'sam31-stream-model-owner-v1', commit }, requiredStages: [] } });
    resources = await dependencies.createResources({ packageRuntime: modelRuntime, route });
    const residentRuntime = { ...modelRuntime, loadUint8: resources.loadUint8,
      async loadFloat32(entry) {
        const tensor = await resources.loadFloat32(entry);
        resources.bind(entry, tensor);
        return tensor;
      },
      residentTensorResolver(tensor) {
        const binding = resources.residentTensorResolver(tensor);
        if (!binding) throw new Error(`static tensor ${tensor.name || '<unnamed>'} is not authenticated resident memory`);
        return binding;
      } };
    driver = await dependencies.createDriver({ packageRuntime: residentRuntime, adapter: session.adapter,
      device: session.device, adapterInfo, errors, commit, userAgent, onProgress, memoryAttentionKernel });
    active('setup complete');
    const engine = createSam31StreamEngine({ ...driver, async execute(input) {
      active('frame start');
      const result = await driver.execute(input);
      active('frame completion');
      return result;
    }, close: release });
    return Object.freeze({ ...engine, schema: 'kaminos.sam31-video-tracker.v1', packageId: modelRuntime.packageId,
      imageWidth: driver.imageWidth, imageHeight: driver.imageHeight, adapterInfo,
      snapshot: () => ({ ...engine.snapshot(), packageId: modelRuntime.packageId, inferenceSessionId: session.sessionId,
        sessionOwnership: borrowed ? 'borrowed' : 'owned' }) });
  } catch (error) {
    try { await release(); } catch (cleanup) { throw new AggregateError([error, cleanup], `${error.message}; cleanup: ${cleanup.message}`); }
    throw error;
  }
}

export function createSam31VideoTracker(options = {}) {
  for (const name of ['modelPackageRuntime', 'residentResources', 'execute', 'createDriver', 'dependencies']) {
    if (Object.hasOwn(options, name)) throw new Error(`public video tracker does not accept ${name}`);
  }
  return createTracker(options, production);
}

export function createSam31VideoTrackerForTest(options, dependencies) {
  return createTracker(options, dependencies);
}
