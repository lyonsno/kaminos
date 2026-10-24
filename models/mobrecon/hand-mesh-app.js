import { createWebGpuApplicationRunner, createWebGpuForegroundService, createWebGpuInferenceSession,
  requestBrowserWebGpuDevice } from '../../webgpu-inference-kit/src/core.js';
import { createBrowserHandMeshRoute, HAND_MESH_ROUTE_ID } from './hand-mesh-route.js';

function stopped(signal) {
  if (signal.aborted) throw new DOMException(String(signal.reason?.message ?? signal.reason ?? 'Hand inference stopped'), 'AbortError');
}
function waitForLoad(promise, signal) {
  stopped(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { try { stopped(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// Camera and input lifetime stay with the caller. A shared session serializes whole
// model operations; getFrame is evaluated after admission to avoid capturing stale input.
export async function createHandMeshApp({ device, session, foreground, gpu = globalThis.navigator?.gpu,
  adapterName = 'hand-mesh-app', mobreconPackageUrl, detectorPackageUrl, mobreconPackageSource,
  detectorPackageSource, onProgress, load = true, Route = createBrowserHandMeshRoute,
  routeId = `${HAND_MESH_ROUTE_ID}:${crypto.randomUUID()}` } = {}) {
  const ownsDevice = !device && !session, ownsSession = !session, ownsForeground = !foreground;
  if (session && !foreground) throw Error('a shared hand session requires its host foreground service');
  if (session && device && session.device !== device) throw Error('hand session and device must match');
  device ??= session?.device;
  let route = null, loading = null, closing = null, destroyed = false, fatal = null, runner;
  const loadAbort = new AbortController();
  function assertOpen() {
    if (destroyed) throw Error('this hand app has been destroyed');
    if (fatal) throw fatal;
    if (session.snapshot().status !== 'active') throw Error('hand inference session is not active');
  }
  const onFatal = error => { fatal = error; runner?.stop(error); loadAbort.abort(error); };
  const onGpuError = event => onFatal(event.error ?? Error('Hand WebGPU error'));
  try {
    let context;
    if (!device) { context = await requestBrowserWebGpuDevice(gpu, { adapterName }); device = context.device; }
    if (session && session.queue !== device.queue) throw Error('hand session must use the device queue');
    if (foreground && (foreground.device !== device || foreground.queue !== device.queue)) throw Error('hand foreground and device must match');
    session ??= await createWebGpuInferenceSession({ device, sessionId: `hand-app:${crypto.randomUUID()}`,
      ...(context ? { adapter: context.adapter, backendIdentity: context.backendIdentity } : { adapterName }) });
    foreground ??= createWebGpuForegroundService({ device, routeId });
    device.addEventListener?.('uncapturederror', onGpuError);
    device.lost.then(info => { if (!destroyed) onFatal(Error(`Hand device lost: ${info.reason}: ${info.message}`)); });
  } catch (error) {
    if (ownsForeground) await foreground?.dispose();
    if (ownsSession) session?.close();
    if (ownsDevice) device?.destroy();
    throw error;
  }
  function loadWeights(progress = onProgress) {
    assertOpen();
    if (loading) return loading;
    if (route) return Promise.resolve();
    loading = (async () => {
      const admission = await session.registerRoute({ routeId: `${routeId}:load` });
      let job;
      const abort = () => job?.cancel('Hand loading cancelled');
      try {
        stopped(loadAbort.signal);
        job = admission.enqueue({ jobId: `hand-load:${crypto.randomUUID()}`, execute: async () => {
          assertOpen(); stopped(loadAbort.signal);
          try {
            route = await Route({ session, routeId, mobreconPackageUrl, detectorPackageUrl,
              mobreconPackageSource, detectorPackageSource, signal: loadAbort.signal, onProgress: progress });
            await device.queue.onSubmittedWorkDone();
            assertOpen(); stopped(loadAbort.signal);
          } catch (error) {
            // Keep admission until uploads/readbacks have retired, even after a failed load.
            try { await device.queue.onSubmittedWorkDone(); route?.release(); route = null; }
            catch (cleanup) { onFatal(new AggregateError([error, cleanup], 'Hand loading cleanup failed')); throw fatal; }
            throw error;
          }
        } });
        loadAbort.signal.addEventListener('abort', abort, { once: true });
        if (loadAbort.signal.aborted) abort();
        const result = await job.completion;
        if (fatal) throw fatal;
        stopped(loadAbort.signal);
        if (result.status !== 'succeeded') throw Object.assign(Error(result.failure?.message ?? result.status), { name: result.failure?.name ?? 'Error' });
        assertOpen();
      } finally {
        loadAbort.signal.removeEventListener('abort', abort);
        try { await admission.drain(); session.unregisterRoute(admission.routeId); }
        catch (error) { onFatal(error); throw error; }
      }
    })().finally(() => { loading = null; });
    return loading;
  }
  runner = createWebGpuApplicationRunner({ session, foreground, routeId, label: 'hand inference', phase: 'inferring',
    runtimeLabel: 'hand-mesh-app', assertOpen, getError: () => fatal, onFatal,
    prepare: signal => waitForLoad(loadWeights(), signal), settle: () => device.queue.onSubmittedWorkDone(),
    execute: async ({ getFrame, handedness = 'right', acquisition, ...input }, schedule) => {
      const frame = getFrame ? await getFrame({ signal: schedule?.signal }) : input;
      if (schedule) stopped(schedule.signal);
      assertOpen();
      if (!frame?.source) throw Error('hand inference requires a source frame');
      const width = frame.width ?? frame.source.videoWidth ?? frame.source.width;
      const height = frame.height ?? frame.source.videoHeight ?? frame.source.height;
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw Error('hand frame dimensions must be positive integers');
      const result = await route.infer({ ...input, ...frame, width, height, handedness,
        acquisition: { mode: 'detector', threshold: .8, padding: 1.4, onMiss: 'skip', ...acquisition }, schedule });
      return { ...result, input: { width, height, frameId: frame.frameId ?? null } };
    },
  });
  function infer(options = {}) {
    if (options.getFrame != null && typeof options.getFrame !== 'function') throw TypeError('getFrame must be a function');
    if (options.getFrame && options.source != null) throw Error('choose source or getFrame for hand input');
    return runner.run(options);
  }
  function snapshot() {
    const run = runner.snapshot();
    return { api: 'kaminos.hand-mesh-app.v0', ...run, phase: run.phase ?? (loading ? 'loading' : 'idle'), loaded: Boolean(route), destroyed,
      error: fatal?.message ?? null, routeId, admission: 'whole-operation-fifo', gpuBoundary: 'detector-and-reconstruction',
      ownership: { device: ownsDevice ? 'owned' : 'borrowed', session: ownsSession ? 'owned' : 'borrowed', foreground: ownsForeground ? 'owned' : 'borrowed' } };
  }
  function destroy() {
    if (closing) return closing;
    destroyed = true; runner.stop('Hand app destroyed'); loadAbort.abort('Hand app destroyed');
    closing = (async () => {
      await Promise.allSettled([runner.pending, loading]);
      const errors = [];
      try { await device.queue.onSubmittedWorkDone(); } catch (error) { errors.push(error); }
      try { route?.release(); route = null; } catch (error) { errors.push(error); }
      if (ownsForeground) { try { await foreground.dispose(); } catch (error) { errors.push(error); } }
      if (ownsSession) { try { session.close(); } catch (error) { errors.push(error); } }
      device.removeEventListener?.('uncapturederror', onGpuError);
      if (ownsDevice) device.destroy();
      if (errors.length) throw new AggregateError(errors, 'Hand app destruction failed');
    })();
    return closing;
  }
  const app = Object.freeze({ device, session, foreground, routeId, get route() { return route; },
    get identity() { return route?.identity ?? null; }, get faces() { return route?.faces ?? null; },
    load: loadWeights, infer, pause: runner.pause, resume: runner.resume, stop: runner.stop, snapshot, destroy });
  if (load) { try { await loadWeights(); } catch (error) {
    try { await destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Hand setup cleanup failed'); }
    throw error;
  } }
  return app;
}
