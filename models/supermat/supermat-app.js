import { createWebGpuForegroundService, createWebGpuInferenceControl, createWebGpuInferenceSession,
  requestBrowserWebGpuDevice } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, superMatDeviceOptions, SUPERMAT_ROUTE_ID } from './supermat-route.js';

export const SUPERMAT_HOSTED_WEIGHTS_URL = 'https://huggingface.co/BasinShapers/supermat-webgpu-weights/resolve/7cd6ed65c0c4db59f9cdf431f3ad6316d4ca7f49/f16/';
const checkSignal = signal => {
  if (signal?.aborted) throw new DOMException(String(signal.reason?.message ?? signal.reason ?? 'SuperMat stopped'), 'AbortError');
};
// Stop an inference waiting for shared loading without cancelling another caller's load flight.
function waitForLoad(promise, signal) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { try { checkSignal(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// Application lifecycle around the existing adapter. Loading keeps a resident resource route;
// each inference takes session admission before acquiring its foreground run and model runtime.
export async function createSuperMatApp({ device, session, foreground, gpu = globalThis.navigator?.gpu,
  adapterName = 'supermat-app', weightsUrl = SUPERMAT_HOSTED_WEIGHTS_URL, adapterOptions = {},
  scheduling = {}, onProgress, load = true, Adapter = createSuperMatAdapter,
  routeId = `${SUPERMAT_ROUTE_ID}:${crypto.randomUUID()}` } = {}) {
  const ownsDevice = !device && !session, ownsSession = !session, ownsForeground = !foreground;
  if (session && !foreground) throw Error('a shared SuperMat session requires its host foreground service');
  if (session && device && device !== session.device) throw Error('SuperMat session and device must match');
  for (const name of ['route', 'weightsUrl', 'signal', 'onProgress']) {
    if (Object.hasOwn(adapterOptions, name)) throw Error(`use the SuperMat app option ${name} instead of adapterOptions.${name}`);
  }
  device ??= session?.device;
  let adapter = null, weightRoute = null, loading = null, active = null, closing = null, destroyed = false, fatal = null;
  const loadAbort = new AbortController();
  function assertOpen() {
    if (destroyed) throw Error('this SuperMat app has been destroyed');
    if (fatal) throw fatal;
    if (session.snapshot().status !== 'active') throw Error('SuperMat inference session is not active');
  }
  const onGpuError = event => { fatal = event.error ?? Error('SuperMat GPU error'); active?.abort.abort(fatal); loadAbort.abort(fatal); };
  try {
    let context;
    if (!device) {
      if (!gpu) throw Error('WebGPU is unavailable');
      context = await requestBrowserWebGpuDevice(gpu, await superMatDeviceOptions(gpu, { adapterName }));
      device = context.device;
    }
    if (session && session.queue !== device.queue) throw Error('SuperMat session must use the device queue');
    if (foreground && (foreground.device !== device || foreground.queue !== device.queue)) throw Error('SuperMat foreground and device must match');
    session ??= await createWebGpuInferenceSession({ sessionId: `supermat-app:${crypto.randomUUID()}`, device,
      ...(context ? { adapter: context.adapter, backendIdentity: context.backendIdentity } : { adapterName }) });
    foreground ??= createWebGpuForegroundService({ device, routeId });
    device.addEventListener?.('uncapturederror', onGpuError);
    device.lost.then(info => {
      if (destroyed) return;
      fatal = Error(`SuperMat device lost: ${info.reason}: ${info.message}`);
      active?.abort.abort(fatal); loadAbort.abort(fatal);
    });
  } catch (error) {
    if (ownsSession) session?.close();
    if (ownsDevice) device?.destroy();
    throw error;
  }

  function loadWeights(progress = onProgress) {
    assertOpen();
    if (loading) return loading;
    if (adapter) return Promise.resolve();
    loading = (async () => {
      weightRoute = await session.registerRoute({ routeId: `${routeId}:weights` });
      const route = weightRoute;
      const abort = () => job?.cancel('SuperMat load cancelled');
      let job;
      try {
        checkSignal(loadAbort.signal);
        // Resource loading uploads independent buffers; it does not run model dispatches.
        // Idle foreground requests remain serviceable while downloads/uploads are admitted.
        job = route.enqueue({ jobId: `supermat-load:${crypto.randomUUID()}`, execute: async () => {
          assertOpen(); checkSignal(loadAbort.signal);
          adapter = await Adapter({ ...adapterOptions, route, weightsUrl, onProgress: progress, signal: loadAbort.signal });
          await device.queue.onSubmittedWorkDone();
        } });
        loadAbort.signal.addEventListener('abort', abort, { once: true });
        if (loadAbort.signal.aborted) abort();
        const result = await job.completion;
        checkSignal(loadAbort.signal);
        if (result.status !== 'succeeded') throw Object.assign(Error(result.failure?.message ?? result.status), { name: result.failure?.name ?? 'Error' });
        assertOpen();
      } catch (error) {
        try { await device.queue.onSubmittedWorkDone(); adapter?.release(); adapter = null;
          await route.drain(); session.unregisterRoute(route.routeId); weightRoute = null; }
        catch (cleanup) { fatal = new AggregateError([error, cleanup], 'SuperMat load cleanup failed'); throw fatal; }
        throw error;
      } finally { loadAbort.signal.removeEventListener('abort', abort); }
    })().finally(() => { loading = null; });
    return loading;
  }

  function infer({ signal, cooperative = true, scheduling: runScheduling = {}, ...options } = {}) {
    assertOpen();
    if (active) throw Error('a SuperMat inference is already running');
    if (Object.hasOwn(options, 'schedule')) throw Error('use scheduling here, or adapter.run for an existing invocation');
    for (const key of ['runtime', 'invocation', 'control', 'signal', 'withForeground']) {
      if (Object.hasOwn(scheduling, key) || Object.hasOwn(runScheduling, key)) throw Error(`SuperMat app owns scheduling.${key}`);
    }
    const abort = new AbortController(), forward = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', forward, { once: true }); if (signal?.aborted) forward();
    const run = { abort, control: null, phase: 'loading', cooperative, job: null, promise: null };
    active = run;
    const cancel = () => run.job?.cancel('SuperMat stopped');
    abort.signal.addEventListener('abort', cancel, { once: true });
    run.promise = (async () => {
      let admission;
      try {
        checkSignal(abort.signal); await waitForLoad(loadWeights(), abort.signal); checkSignal(abort.signal);
        admission = await session.registerRoute({ routeId: `${routeId}:admission` });
        checkSignal(abort.signal); run.phase = 'queued';
        const runId = `supermat:${crypto.randomUUID()}`;
        run.job = admission.enqueue({ jobId: runId, execute: async () => {
          let frames, modelRoute, output, failure;
          const errors = [];
          try {
            assertOpen(); checkSignal(abort.signal);
            frames = await foreground.beginRun(runId, { routeId });
            checkSignal(abort.signal); run.phase = 'inferring';
            let schedule = null;
            if (cooperative) {
              modelRoute = await session.registerRoute({ routeId, runtimeOptions: {
                runtimeLabel: 'supermat-app', foregroundOpportunities: frames.foregroundOpportunities } });
              let tail = Promise.resolve();
              const withForeground = (phase, work) => {
                const window = tail.then(() => frames.withForeground(phase, work));
                tail = window.catch(() => {}); return window;
              };
              run.control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal, withForeground });
              output = await modelRoute.runtime.runInvocation({ invocationId: runId }, invocation => {
                schedule = { ...scheduling, ...runScheduling, runtime: modelRoute.runtime, invocation,
                  control: run.control, signal: abort.signal, withForeground };
                return adapter.run({ ...options, schedule });
              });
            } else output = await adapter.run(options);
            if (fatal) throw fatal;
            checkSignal(abort.signal);
          } catch (error) { failure = error; }
          finally {
            run.phase = 'finishing';
            try { await run.control?.close(); } catch (e) { errors.push(e); } run.control = null;
            try { await device.queue.onSubmittedWorkDone(); } catch (e) { errors.push(e); }
            if (modelRoute) { try { session.unregisterRoute(modelRoute.routeId); } catch (e) { errors.push(e); } }
            try { await frames?.finish(); } catch (e) { errors.push(e); }
          }
          if (errors.length) { fatal = new AggregateError([...(failure ? [failure] : []), ...errors], 'SuperMat inference cleanup failed'); throw fatal; }
          if (failure) throw failure;
          return output;
        } });
        if (abort.signal.aborted) cancel();
        const result = await run.job.completion;
        if (fatal) throw fatal;
        checkSignal(abort.signal);
        if (result.status !== 'succeeded') throw Object.assign(Error(result.failure?.message ?? result.status), { name: result.failure?.name ?? 'Error' });
        return result.output;
      } finally {
        signal?.removeEventListener('abort', forward); abort.signal.removeEventListener('abort', cancel);
        try { if (admission) { await admission.drain(); session.unregisterRoute(admission.routeId); } }
        catch (error) { fatal = error; throw error; }
        finally { active = null; }
      }
    })();
    return run.promise;
  }
  const pause = async () => active?.control ? active.control.pause() : null;
  const resume = async () => active?.control ? active.control.resume() : null;
  const stop = (reason = 'stopped by user') => active?.abort.abort(reason);
  function snapshot() { return { loaded: Boolean(adapter), destroyed, phase: active?.phase ?? (loading ? 'loading' : 'idle'),
    cooperative: active?.cooperative ?? null, control: active?.control?.snapshot() ?? null, error: fatal?.message ?? null, routeId,
    ownership: { device: ownsDevice ? 'owned' : 'borrowed', session: ownsSession ? 'owned' : 'borrowed', foreground: ownsForeground ? 'owned' : 'borrowed' } }; }
  function destroy() {
    if (closing) return closing;
    destroyed = true; stop('SuperMat app destroyed'); loadAbort.abort('SuperMat app destroyed');
    closing = (async () => {
      await Promise.allSettled([active?.promise, loading]);
      const errors = [];
      try { await device.queue.onSubmittedWorkDone(); } catch (e) { errors.push(e); }
      try { adapter?.release(); adapter = null; } catch (e) { errors.push(e); }
      if (weightRoute) { try { await weightRoute.drain(); session.unregisterRoute(weightRoute.routeId); weightRoute = null; } catch (e) { errors.push(e); } }
      if (ownsForeground) { try { await foreground.dispose(); } catch (e) { errors.push(e); } }
      if (ownsSession) { try { session.close(); } catch (e) { errors.push(e); } }
      device.removeEventListener?.('uncapturederror', onGpuError);
      if (ownsDevice) device.destroy();
      if (errors.length) throw new AggregateError(errors, 'SuperMat destruction failed');
    })(); return closing;
  }
  const app = Object.freeze({ device, session, foreground, routeId, get adapter() { return adapter; },
    load: loadWeights, infer, pause, resume, stop, snapshot, destroy });
  if (load) { try { await loadWeights(); } catch (error) {
    try { await destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'SuperMat setup cleanup failed'); }
    throw error;
  } }
  return app;
}
