import { createWebGpuInferenceSession } from './inference-session.js';
import { createSam31BrowserTrackerPackageCache, loadSam31BrowserTrackerModelPackageRuntime } from './sam31-browser-tracker-package-runtime.js';
import { createSam31ResidentModelResources } from './sam31-resident-model-resources.js';
import { createSam31StreamDriver } from './sam31-stream-driver.js';
import { createSam31StreamEngine } from './sam31-stream-engine.js';
import { classifySam31MemoryAttentionAdapter } from './sam31-memory-attention-evidence.js';
import { createWebGpuApplicationRunner } from './application-runner.js';

const production = { loadRuntime: loadSam31BrowserTrackerModelPackageRuntime,
  createInferenceSession: createWebGpuInferenceSession, createResources: createSam31ResidentModelResources,
  createDriver: createSam31StreamDriver };

async function createTracker(options, dependencies) {
  const { modelPackageRoot, pageUrl = globalThis.location?.href,
    cache = createSam31BrowserTrackerPackageCache(), inferenceSession: borrowed = null, foregroundService = null,
    gpu = globalThis.navigator?.gpu, userAgent = globalThis.navigator?.userAgent || 'unknown-browser',
    commit = null, onProgress = () => {}, memoryAttentionKernel = 'online' } = options;
  if (!modelPackageRoot) throw new Error('a stream model package root is required');
  if (!['online', 'flash'].includes(memoryAttentionKernel)) throw new Error('unsupported memory attention kernel');
  if (foregroundService) {
    if (!borrowed) throw new Error('SAM foreground requires a borrowed inference session');
    if (borrowed.device?.queue !== borrowed.queue || foregroundService.device !== borrowed.device
        || foregroundService.queue !== borrowed.queue) throw new Error('SAM foreground must use the exact borrowed device and queue');
    if (typeof foregroundService.beginRun !== 'function') throw new TypeError('SAM foreground requires beginRun');
  }
  const modelRuntime = await dependencies.loadRuntime({ rootUrl: modelPackageRoot, pageUrl, cache });
  if (modelRuntime.modelPackage?.components?.stream?.schema !== 'kaminos.sam31-stream-model.v1') {
    throw new Error('a production stream model package is required, not a two-frame fixture');
  }
  const id = `sam31-stream:${crypto.randomUUID()}`;
  const session = borrowed || await dependencies.createInferenceSession({ sessionId: id, gpu,
    browser: userAgent, deviceOwnership: 'owned' });
  let route = null, resources = null, driver = null, listenerAttached = false;
  let runner = null, fatal = null, lastRun = null, closing = null, pending = null;
  const errors = [];
  const onError = event => errors.push(String(event.error?.message || event.error));
  const adapterInfo = { description: String(session.adapter?.info?.description || ''),
    vendor: String(session.adapter?.info?.vendor || ''), architecture: String(session.adapter?.info?.architecture || ''),
    device: String(session.adapter?.info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({ vendor: session.adapter?.info?.vendor,
      architecture: session.adapter?.info?.architecture,
      explicitFallback: session.adapter?.isFallbackAdapter ?? session.adapter?.info?.isFallbackAdapter }) };
  function active(phase) {
    if (fatal) throw fatal;
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
    const prepare = async () => {
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
    };
    if (foregroundService) {
      const job = route.enqueue({ jobId: `${id}:load`, execute: prepare });
      const result = await job.completion;
      if (result.status !== 'succeeded') throw Object.assign(new Error(result.failure?.message || result.status), {
        name: result.failure?.name || 'Error' });
    } else await prepare();
    if (foregroundService) {
      // Keep the common runner's FIFO/control lifetime, and require its final
      // foreground report before the stream engine commits temporal memory.
      const foreground = { async beginRun(...args) {
        const frames = await foregroundService.beginRun(...args);
        lastRun = null;
        return { ...frames, async finish() {
          lastRun = await frames.finish();
          if (lastRun?.status !== 'succeeded' || lastRun.receipts.some(receipt => receipt.failure != null)) {
            throw new Error('SAM foreground handback failed');
          }
          return lastRun;
        } };
      } };
      runner = createWebGpuApplicationRunner({ session, foreground, routeId: `${id}:frame`,
        label: 'SAM video frame', phase: 'tracking', runtimeLabel: 'sam31-video-tracker',
        assertOpen: () => active('frame admission'), getError: () => fatal,
        onFatal: error => { fatal = error; }, prepare: async () => {},
        settle: () => session.device.queue.onSubmittedWorkDone(),
        execute: async ({ frame }, schedule) => ({ ...await driver.execute({ ...frame, schedule }),
          applicationInvocation: { invocationId: schedule.invocation.invocationId,
            routeId: schedule.invocation.routeId, frameIndex: frame.frameIndex } }),
      });
    }
    const engine = createSam31StreamEngine({ ...driver, async execute(input) {
      active('frame start');
      const result = runner ? await runner.run({ frame: input }) : await driver.execute(input);
      active('frame completion');
      return runner ? { ...result, foreground: lastRun } : result;
    }, close: release });
    const run = (method, input) => {
      if (closing) return Promise.reject(new Error('tracker is closed'));
      if (pending) return Promise.reject(new Error('tracker is busy'));
      const operation = engine[method](input);
      pending = operation;
      operation.finally(() => { if (pending === operation) pending = null; }).catch(() => {});
      return operation;
    };
    return Object.freeze({ ...engine, schema: 'kaminos.sam31-video-tracker.v1', packageId: modelRuntime.packageId,
      imageWidth: driver.imageWidth, imageHeight: driver.imageHeight, adapterInfo,
      initialize: input => run('initialize', input), track: input => run('track', input),
      ...(runner ? { pause: runner.pause, resume: runner.resume, stop: runner.stop,
        close() {
          if (closing) return closing;
          runner.stop('SAM tracker closed');
          closing = (async () => { await Promise.allSettled([pending]); return engine.close(); })();
          return closing;
        } } : {}),
      snapshot: () => ({ ...engine.snapshot(), packageId: modelRuntime.packageId, inferenceSessionId: session.sessionId,
        sessionOwnership: borrowed ? 'borrowed' : 'owned',
        ...(runner ? { scheduling: { ...runner.snapshot(), admission: 'whole-frame-fifo', lastRun } } : {}) }) });
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
