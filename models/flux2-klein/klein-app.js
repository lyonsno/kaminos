import { KleinPipeline } from './klein-pipeline.js';
import { createWebGpuForegroundService, createWebGpuApplicationRunner, createWebGpuInferenceSession }
  from '../../webgpu-inference-kit/src/core.js';

export const KLEIN_ROUTE_ID = 'flux2-klein.text-to-image.webgpu-local.v0';

// The demo's cooperative lifecycle, usable without its canvas or scene. A caller can borrow the
// app's device/foreground service, or lend an existing session/device/foreground service to it.
// load:false exposes the app before the first download. Loading itself has no pause/stop contract.
export async function createKleinApp({ device, session, foreground, gpu = globalThis.navigator?.gpu,
  deviceDescriptor, adapterName = 'application-provided-device', pipelineOptions = {},
  Pipeline = KleinPipeline, load = true, onProgress, scheduling = {},
  routeId = `${KLEIN_ROUTE_ID}:${crypto.randomUUID()}` } = {}) {
  const ownsDevice = !device && !session, ownsSession = !session, ownsForeground = !foreground;
  if (session && !foreground) throw new Error('a shared Klein session requires its host foreground service');
  if (session && device && device !== session.device) throw new Error('Klein session and device must match');
  device ??= session?.device;
  if (device && !device.features?.has('shader-f16')) throw new Error('Klein requires shader-f16 on the effective device');
  if (foreground && device && (foreground.device !== device || foreground.queue !== device.queue)) {
    throw new Error('Klein foreground and device must match');
  }
  if (session && session.queue !== device.queue) throw new Error('Klein session must use the device queue');
  let pipeline, loading = null, warmupJob = null, loaded = false, runner = null, closing = null, destroyed = false, fatal = null;
  const onGpuError = event => { fatal = event.error ?? new Error('Klein WebGPU error'); runner?.stop(fatal); };
  function assertOpen() {
    if (destroyed) throw new Error('this Klein app has been destroyed');
    if (fatal) throw fatal;
    if (session.snapshot().status !== 'active') throw new Error('Klein inference session is not active');
  }
  try {
    if (!device) {
      const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter?.features.has('shader-f16')) throw new Error('WebGPU with shader-f16 is required');
      const requiredLimits = Object.fromEntries(['maxBufferSize', 'maxStorageBufferBindingSize',
        'maxStorageBuffersPerShaderStage', 'maxComputeWorkgroupStorageSize'].map(k => [k, adapter.limits[k]]));
      device = await adapter.requestDevice({ ...deviceDescriptor,
        requiredFeatures: [...new Set(['shader-f16', ...(deviceDescriptor?.requiredFeatures ?? [])])],
        requiredLimits: deviceDescriptor?.requiredLimits ?? requiredLimits });
      adapterName = adapter.info?.description || adapter.info?.device || 'browser-primary-adapter';
    }
    if (foreground && (foreground.device !== device || foreground.queue !== device.queue)) {
      throw new Error('Klein foreground and device must match');
    }
    session ??= await createWebGpuInferenceSession({ sessionId: `klein-app:${crypto.randomUUID()}`, device, adapterName });
    foreground ??= createWebGpuForegroundService({ routeId, device });
    pipeline = new Pipeline(device, pipelineOptions);
    device.addEventListener?.('uncapturederror', onGpuError);
    device.lost.then(info => {
      if (destroyed) return;
      fatal = new Error(`Klein WebGPU device lost: ${info.reason}: ${info.message}`);
      runner?.stop(fatal);
    });
  } catch (error) {
    if (ownsSession) session?.close();
    if (ownsDevice) device?.destroy();
    throw error;
  }

  async function runWarmup(work) {
    assertOpen();
    const route = await session.registerRoute({ routeId: `${routeId}:load` });
    try {
      assertOpen();
      const runId = `klein-warmup:${crypto.randomUUID()}`;
      warmupJob = route.enqueue({ jobId: runId, execute: async () => {
        let frameRun, failure;
        const cleanupErrors = [];
        try {
          assertOpen();
          frameRun = await foreground.beginRun(runId, { routeId });
          assertOpen();
          await work();
          assertOpen();
        } catch (error) { failure = error; }
        finally {
          // Even a failed warmup retains admission until submitted work settles.
          try { await device.queue.onSubmittedWorkDone(); } catch (e) { cleanupErrors.push(e); }
          try { await frameRun?.finish(); } catch (e) { cleanupErrors.push(e); }
        }
        if (cleanupErrors.length) {
          fatal = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Klein warmup cleanup failed');
          throw fatal;
        }
        if (failure) throw failure;
      } });
      const completion = await warmupJob.completion;
      assertOpen();
      if (completion.status !== 'succeeded') {
        const error = new Error(completion.failure?.message ?? completion.status);
        error.name = completion.failure?.name ?? 'Error';
        throw error;
      }
    } finally {
      warmupJob = null;
      try { await route.drain(); session.unregisterRoute(route.routeId); }
      catch (error) { fatal = error; throw error; }
    }
  }

  function loadWeights(progress = onProgress) {
    assertOpen();
    if (loading) return loading;
    if (loaded) return Promise.resolve();
    loading = Promise.resolve().then(async () => {
      pipeline ??= new Pipeline(device, pipelineOptions);
      try { await pipeline.load(progress, { runWarmup }); assertOpen(); loaded = true; }
      catch (error) {
        // A failed load cannot leave a half-built instance for a retry to overwrite.
        try { await pipeline.destroy(); pipeline = null; }
        catch (cleanup) { fatal = new AggregateError([error, cleanup], 'Klein load and cleanup failed'); throw fatal; }
        throw error;
      }
    }).finally(() => { loading = null; });
    return loading;
  }

  runner = createWebGpuApplicationRunner({ session, foreground, routeId,
    label: 'Klein generation', phase: 'generating', runtimeLabel: 'klein-app',
    scheduling: { maxInFlight: 2, ...scheduling }, assertOpen,
    getError: () => fatal, onFatal: error => { fatal = error; },
    prepare: () => loadWeights(),
    execute: (options, schedule) => pipeline.generate(schedule ? { ...options, schedule } : options),
  });
  const { run: generate, pause, resume, stop } = runner;

  function snapshot() {
    const run = runner.snapshot();
    return { loaded, destroyed, ...run, phase: run.phase ?? (loading ? 'loading' : 'idle'),
      ownership: { device: ownsDevice ? 'owned' : 'borrowed', session: ownsSession ? 'owned' : 'borrowed',
        foreground: ownsForeground ? 'owned' : 'borrowed' }, routeId, error: fatal?.message ?? null };
  }
  function destroy() {
    if (closing) return closing;
    destroyed = true;
    stop('Klein app destroyed');
    warmupJob?.cancel('Klein app destroyed');
    closing = (async () => {
      // The original operation retains its own failure; destruction waits for it to retire.
      await Promise.allSettled([runner.pending, loading]);
      const errors = [];
      try { await pipeline?.destroy(); pipeline = null; loaded = false; } catch (e) { errors.push(e); }
      if (ownsForeground) { try { await foreground.dispose(); } catch (e) { errors.push(e); } }
      if (ownsSession) { try { session.close(); } catch (e) { errors.push(e); } }
      device.removeEventListener?.('uncapturederror', onGpuError);
      if (ownsDevice) device.destroy();
      if (errors.length) throw new AggregateError(errors, 'Klein app destruction failed');
    })();
    return closing;
  }
  const app = Object.freeze({ device, session, foreground, routeId, get pipeline() { return pipeline; },
    load: loadWeights, generate, pause, resume, stop, snapshot, destroy });
  if (load) {
    try { await loadWeights(); }
    catch (error) {
      try { await destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Klein setup and cleanup failed'); }
      throw error;
    }
  }
  return app;
}
