import { KleinPipeline } from './klein-pipeline.js';
import { createWebGpuForegroundService, createWebGpuInferenceControl, createWebGpuInferenceSession }
  from '../../webgpu-inference-kit/src/core.js';

export const KLEIN_ROUTE_ID = 'flux2-klein.text-to-image.webgpu-local.v0';

function stopped(signal) {
  if (!signal.aborted) return;
  const error = new Error(String(signal.reason?.message ?? signal.reason ?? 'Klein stopped'));
  error.name = 'AbortError';
  throw error;
}

// The demo's cooperative lifecycle, usable without its canvas or scene. A caller can borrow the
// app's device/foreground service, or lend an existing session/device/foreground service to it.
// load:false exposes the app before the first download. Loading itself has no pause/stop contract.
export async function createKleinApp({ device, session, foreground, gpu = globalThis.navigator?.gpu,
  deviceDescriptor, adapterName = 'application-provided-device', pipelineOptions = {},
  Pipeline = KleinPipeline, load = true, onProgress, scheduling = {},
  routeId = `${KLEIN_ROUTE_ID}:${crypto.randomUUID()}` } = {}) {
  const ownsDevice = !device && !session, ownsSession = !session, ownsForeground = !foreground;
  if (session && device && device !== session.device) throw new Error('Klein session and device must match');
  device ??= session?.device;
  if (device && !device.features?.has('shader-f16')) throw new Error('Klein requires shader-f16 on the effective device');
  if (foreground && device && (foreground.device !== device || foreground.queue !== device.queue)) {
    throw new Error('Klein foreground and device must match');
  }
  if (session && session.queue !== device.queue) throw new Error('Klein session must use the device queue');
  let pipeline, loading = null, loaded = false, active = null, closing = null, destroyed = false, fatal = null;
  const onGpuError = event => { fatal = event.error ?? new Error('Klein WebGPU error'); active?.abort.abort(fatal); };
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
      active?.abort.abort(fatal);
    });
  } catch (error) {
    if (ownsSession) session?.close();
    if (ownsDevice) device?.destroy();
    throw error;
  }

  function loadWeights(progress = onProgress) {
    assertOpen();
    if (loading) return loading;
    if (loaded) return Promise.resolve();
    loading = Promise.resolve().then(async () => {
      pipeline ??= new Pipeline(device, pipelineOptions);
      try { await pipeline.load(progress); assertOpen(); loaded = true; }
      catch (error) {
        // A failed load cannot leave a half-built instance for a retry to overwrite.
        try { await pipeline.destroy(); pipeline = null; }
        catch (cleanup) { fatal = new AggregateError([error, cleanup], 'Klein load and cleanup failed'); throw fatal; }
        throw error;
      }
    }).finally(() => { loading = null; });
    return loading;
  }

  function generate({ signal, cooperative = true, scheduling: runScheduling = {}, ...options } = {}) {
    assertOpen();
    if (active) throw new Error('a Klein generation is already running');
    if (Object.hasOwn(options, 'schedule')) throw new Error('use scheduling options here, or pipeline.generate for an existing invocation');
    for (const key of ['runtime', 'invocation', 'control', 'signal', 'withForeground']) {
      if (Object.hasOwn(scheduling, key) || Object.hasOwn(runScheduling, key)) throw new Error(`Klein app owns scheduling.${key}`);
    }
    const abort = new AbortController();
    const forwardAbort = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    const run = { abort, control: null, cooperative, phase: 'loading', promise: null, job: null };
    active = run;
    const cancelPending = () => run.job?.cancel('Klein stopped');
    abort.signal.addEventListener('abort', cancelPending, { once: true });
    run.promise = Promise.resolve().then(async () => {
      let frameRun, route, result, failure;
      const cleanupErrors = [];
      try {
        stopped(abort.signal);
        await loadWeights();
        stopped(abort.signal);
        if (cooperative) {
          frameRun = await foreground.beginRun(`klein:${crypto.randomUUID()}`, { routeId });
          stopped(abort.signal);
          route = await session.registerRoute({ routeId, runtimeOptions: {
            runtimeLabel: 'klein-app', foregroundOpportunities: frameRun.foregroundOpportunities } });
          stopped(abort.signal);
          run.control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal, withForeground: frameRun.withForeground });
          run.phase = 'queued';
          run.job = route.enqueue({ jobId: frameRun.runId, execute: async invocation => {
            run.phase = 'generating';
            stopped(abort.signal);
            return pipeline.generate({ ...options, schedule: { maxInFlight: 2, ...scheduling, ...runScheduling,
              runtime: route.runtime, invocation, control: run.control, signal: abort.signal, withForeground: frameRun.withForeground } });
          } });
          const completion = await run.job.completion;
          stopped(abort.signal);
          if (completion.status !== 'succeeded') {
            const error = new Error(completion.failure?.message ?? completion.status);
            error.name = completion.failure?.name ?? 'Error';
            throw error;
          }
          result = completion.output;
        } else {
          run.phase = 'generating';
          result = await pipeline.generate(options);
        }
        if (fatal) throw fatal;
        stopped(abort.signal);
      } catch (error) { failure = error; }
      finally {
        // Attempt all independent releases and surface cleanup failure. A poisoned lifecycle
        // refuses reuse instead of leaving a ghost route behind a successful image result.
        run.phase = 'finishing';
        try { await run.control?.close(); } catch (e) { cleanupErrors.push(e); }
        if (route) {
          try { await route.drain(); session.unregisterRoute(route.routeId); } catch (e) { cleanupErrors.push(e); }
        }
        try { await frameRun?.finish(); } catch (e) { cleanupErrors.push(e); }
        signal?.removeEventListener('abort', forwardAbort);
        abort.signal.removeEventListener('abort', cancelPending);
        active = null;
      }
      if (cleanupErrors.length) {
        fatal = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Klein generation cleanup failed');
        throw fatal;
      }
      if (failure) throw failure;
      return result;
    });
    return run.promise;
  }

  async function pause() { return active?.control ? active.control.pause() : null; }
  async function resume() { return active?.control ? active.control.resume() : null; }
  function stop(reason = 'stopped by user') { active?.abort.abort(reason); }
  function snapshot() {
    return { loaded, destroyed, phase: active?.phase ?? (loading ? 'loading' : 'idle'),
      cooperative: active?.cooperative ?? null, control: active?.control?.snapshot() ?? null,
      ownership: { device: ownsDevice ? 'owned' : 'borrowed', session: ownsSession ? 'owned' : 'borrowed',
        foreground: ownsForeground ? 'owned' : 'borrowed' }, routeId, error: fatal?.message ?? null };
  }
  function destroy() {
    if (closing) return closing;
    destroyed = true;
    stop('Klein app destroyed');
    closing = (async () => {
      // The original operation retains its own failure; destruction waits for it to retire.
      await Promise.allSettled([active?.promise, loading]);
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
