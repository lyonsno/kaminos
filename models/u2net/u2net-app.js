import { createWebGpuForegroundService, createWebGpuApplicationRunner, createWebGpuInferenceSession,
  requestBrowserWebGpuDevice } from '../../webgpu-inference-kit/src/core.js';
import { loadU2NetPackage, createU2NetRunner } from './u2net-webgpu.js';
import { removeForegroundU2Net } from './rembg-u2net.js';
export const U2NET_ROUTE_ID = 'u2net.foreground-removal';

export const U2NET_HOSTED_WEIGHTS_URL = 'https://huggingface.co/BasinShapers/u2net-webgpu/resolve/f4f82a54b6e8d7ffd4321005dbff1cb03198c78b/f32/';
const checkSignal = signal => {
  if (signal?.aborted) throw new DOMException(String(signal.reason?.message ?? signal.reason ?? 'U2Net stopped'), 'AbortError');
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

// Application lifecycle around the existing U2Net producer. Loading keeps a resident route;
// each inference takes session admission before acquiring its foreground run and model runtime.
export async function createU2NetApp({ device, session, foreground, gpu = globalThis.navigator?.gpu,
  adapterName = 'u2net-app', weightsUrl = U2NET_HOSTED_WEIGHTS_URL,
  scheduling = {}, onProgress, load = true, loadPackage = loadU2NetPackage,
  routeId = `${U2NET_ROUTE_ID}:${crypto.randomUUID()}` } = {}) {
  const ownsDevice = !device && !session, ownsSession = !session, ownsForeground = !foreground;
  if (session && !foreground) throw Error('a shared U2Net session requires its host foreground service');
  if (session && device && device !== session.device) throw Error('U2Net session and device must match');
  device ??= session?.device;
  let adapter = null, weightRoute = null, loading = null, runner = null, closing = null, destroyed = false, fatal = null;
  const loadAbort = new AbortController();
  function assertOpen() {
    if (destroyed) throw Error('this U2Net app has been destroyed');
    if (fatal) throw fatal;
    if (session.snapshot().status !== 'active') throw Error('U2Net inference session is not active');
  }
  const onGpuError = event => { fatal = event.error ?? Error('U2Net GPU error'); runner?.stop(fatal); loadAbort.abort(fatal); };
  try {
    let context;
    if (!device) {
      if (!gpu) throw Error('WebGPU is unavailable');
      context = await requestBrowserWebGpuDevice(gpu, { adapterName });
      device = context.device;
    }
    if (session && session.queue !== device.queue) throw Error('U2Net session must use the device queue');
    if (foreground && (foreground.device !== device || foreground.queue !== device.queue)) throw Error('U2Net foreground and device must match');
    session ??= await createWebGpuInferenceSession({ sessionId: `u2net-app:${crypto.randomUUID()}`, device,
      ...(context ? { adapter: context.adapter, backendIdentity: context.backendIdentity } : { adapterName }) });
    foreground ??= createWebGpuForegroundService({ device, routeId });
    device.addEventListener?.('uncapturederror', onGpuError);
    device.lost.then(info => {
      if (destroyed) return;
      fatal = Error(`U2Net device lost: ${info.reason}: ${info.message}`);
      runner?.stop(fatal); loadAbort.abort(fatal);
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
      const abort = () => job?.cancel('U2Net load cancelled');
      let job;
      try {
        checkSignal(loadAbort.signal);
        // Resource loading uploads independent buffers; it does not run model dispatches.
        // Idle foreground requests remain serviceable while downloads/uploads are admitted.
        job = route.enqueue({ jobId: `u2net-load:${crypto.randomUUID()}`, execute: async () => {
          assertOpen(); checkSignal(loadAbort.signal);
          progress?.({phase:'loading'});
          const pkg=await loadPackage(weightsUrl,{signal:loadAbort.signal});
          assertOpen();checkSignal(loadAbort.signal);
          adapter=createU2NetRunner({device,...pkg});
          progress?.({phase:'loaded',source:pkg.graph.source,weights:pkg.graph.weights});
          await device.queue.onSubmittedWorkDone();
        } });
        loadAbort.signal.addEventListener('abort', abort, { once: true });
        if (loadAbort.signal.aborted) abort();
        const result = await job.completion;
        checkSignal(loadAbort.signal);
        if (result.status !== 'succeeded') throw Object.assign(Error(result.failure?.message ?? result.status), { name: result.failure?.name ?? 'Error' });
        assertOpen();
      } catch (error) {
        try { await device.queue.onSubmittedWorkDone(); adapter?.dispose(); adapter = null;
          await route.drain(); session.unregisterRoute(route.routeId); weightRoute = null; }
        catch (cleanup) { fatal = new AggregateError([error, cleanup], 'U2Net load cleanup failed'); throw fatal; }
        throw error;
      } finally { loadAbort.signal.removeEventListener('abort', abort); }
    })().finally(() => { loading = null; });
    return loading;
  }

  runner = createWebGpuApplicationRunner({ session, foreground, routeId,
    label: 'U2Net inference', phase: 'inferring', runtimeLabel: 'u2net-app', scheduling, assertOpen,
    getError: () => fatal, onFatal: error => { fatal = error; },
    prepare: signal => waitForLoad(loadWeights(), signal),
    execute: (options, schedule) => {
      for(const key of ['runner','foreground'])if(Object.hasOwn(options,key))throw Error(`U2Net app owns ${key}; use the low-level function directly`);
      return removeForegroundU2Net({...options,runner:adapter,schedule});
    },
    settle: () => device.queue.onSubmittedWorkDone(),
  });
  const { run: removeForeground, pause, resume, stop } = runner;

  function snapshot() { const run = runner.snapshot();
    return { loaded: Boolean(adapter), destroyed, ...run, phase: run.phase ?? (loading ? 'loading' : 'idle'),
    error: fatal?.message ?? null, routeId,
    ownership: { device: ownsDevice ? 'owned' : 'borrowed', session: ownsSession ? 'owned' : 'borrowed', foreground: ownsForeground ? 'owned' : 'borrowed' } }; }
  function destroy() {
    if (closing) return closing;
    destroyed = true; stop('U2Net app destroyed'); loadAbort.abort('U2Net app destroyed');
    closing = (async () => {
      await Promise.allSettled([runner.pending, loading]);
      const errors = [];
      try { await device.queue.onSubmittedWorkDone(); } catch (e) { errors.push(e); }
      try { adapter?.dispose(); adapter = null; } catch (e) { errors.push(e); }
      if (weightRoute) { try { await weightRoute.drain(); session.unregisterRoute(weightRoute.routeId); weightRoute = null; } catch (e) { errors.push(e); } }
      if (ownsForeground) { try { await foreground.dispose(); } catch (e) { errors.push(e); } }
      if (ownsSession) { try { session.close(); } catch (e) { errors.push(e); } }
      device.removeEventListener?.('uncapturederror', onGpuError);
      if (ownsDevice) device.destroy();
      if (errors.length) throw new AggregateError(errors, 'U2Net destruction failed');
    })(); return closing;
  }
  const app = Object.freeze({ device, session, foreground, routeId, get model() { return adapter; },
    load: loadWeights, removeForeground, pause, resume, stop, snapshot, destroy });
  if (load) { try { await loadWeights(); } catch (error) {
    try { await destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'U2Net setup cleanup failed'); }
    throw error;
  } }
  return app;
}
