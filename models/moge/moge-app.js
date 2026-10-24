import { createWebGpuApplicationRunner, createWebGpuForegroundService, createWebGpuInferenceSession,
  requestBrowserWebGpuDevice } from '../../webgpu-inference-kit/src/core.js';
import { MoGeInference } from './moge-inference.js';

const stopped = signal => {
  if (signal.aborted) throw new DOMException(String(signal.reason?.message ?? signal.reason ?? 'MoGe stopped'), 'AbortError');
};
function waitForLoad(promise, signal) {
  stopped(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { try { stopped(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function createMoGeApp({ device, session, foreground, gpu = globalThis.navigator?.gpu,
  adapterName = 'moge-app', modelOptions = {}, scheduling = {}, onProgress, load = true,
  Inference = MoGeInference, routeId = `moge.depth-normal.webgpu-local.v0:${crypto.randomUUID()}` } = {}) {
  const ownsDevice = !device && !session, ownsSession = !session, ownsForeground = !foreground;
  if (session && !foreground) throw Error('a shared MoGe session requires its host foreground service');
  if (session && device && device !== session.device) throw Error('MoGe session and device must match');
  device ??= session?.device;
  let model = null, loading = null, closing = null, destroyed = false, fatal = null, runner, context;
  const loadAbort = new AbortController();
  function assertOpen() {
    if (destroyed) throw Error('this MoGe app has been destroyed');
    if (fatal) throw fatal;
    if (session.snapshot().status !== 'active') throw Error('MoGe inference session is not active');
  }
  const onFatal = error => { fatal = error; runner?.stop(error); loadAbort.abort(error); };
  const onGpuError = event => onFatal(event.error ?? Error('MoGe GPU error'));
  try {
    if (!device) { context = await requestBrowserWebGpuDevice(gpu, { adapterName }); device = context.device; }
    if (session && session.queue !== device.queue) throw Error('MoGe session must use the device queue');
    if (foreground && (foreground.device !== device || foreground.queue !== device.queue)) throw Error('MoGe foreground and device must match');
    session ??= await createWebGpuInferenceSession({ device, sessionId: `moge-app:${crypto.randomUUID()}`,
      ...(context ? { adapter: context.adapter, backendIdentity: context.backendIdentity } : { adapterName }) });
    foreground ??= createWebGpuForegroundService({ device, routeId });
    device.addEventListener?.('uncapturederror', onGpuError);
    device.lost.then(info => { if (!destroyed) onFatal(Error(`MoGe device lost: ${info.reason}: ${info.message}`)); });
  } catch (error) {
    if (ownsForeground) await foreground?.dispose();
    if (ownsSession) session?.close();
    if (ownsDevice) device?.destroy();
    throw error;
  }
  function loadWeights(progress = onProgress) {
    assertOpen();
    if (loading) return loading;
    if (model) return Promise.resolve();
    loading = (async () => {
      const admission = await session.registerRoute({ routeId: `${routeId}:load` });
      let job;
      const abort = () => job?.cancel('MoGe loading cancelled');
      try {
        stopped(loadAbort.signal);
        job = admission.enqueue({ jobId: `moge-load:${crypto.randomUUID()}`, execute: async () => {
          assertOpen(); stopped(loadAbort.signal);
          const candidate = new Inference({ ...context, device, backendIdentity: session.backendIdentity }, modelOptions);
          try {
            await candidate.init(progress);
            assertOpen(); stopped(loadAbort.signal);
            model = candidate;
          } catch (error) {
            try { await candidate.dispose(); }
            catch (cleanup) { onFatal(new AggregateError([error, cleanup], 'MoGe loading cleanup failed')); throw fatal; }
            throw error;
          }
        } });
        loadAbort.signal.addEventListener('abort', abort, { once: true });
        if (loadAbort.signal.aborted) abort();
        const result = await job.completion;
        if (fatal) throw fatal;
        stopped(loadAbort.signal);
        if (result.status !== 'succeeded') throw Object.assign(Error(result.failure?.message ?? result.status), { name: result.failure?.name ?? 'Error' });
      } finally {
        loadAbort.signal.removeEventListener('abort', abort);
        try { await admission.drain(); session.unregisterRoute(admission.routeId); }
        catch (error) { onFatal(error); throw error; }
      }
    })().finally(() => { loading = null; });
    return loading;
  }
  runner = createWebGpuApplicationRunner({ session, foreground, routeId, label: 'MoGe inference', phase: 'inferring',
    runtimeLabel: 'moge-app', scheduling, assertOpen, getError: () => fatal, onFatal,
    prepare: signal => waitForLoad(loadWeights(), signal), settle: () => device.queue.onSubmittedWorkDone(),
    execute: ({ image, scheduler, ...options }, schedule) => model.run(image, { ...options,
      ...(schedule ? { scheduler: { splitVitBlocks: true, splitDecoderResBlocks: true, pacing: 'bounded-prefix',
        ...scheduler, mode: 'cooperative', schedule } } : { scheduler }),
    }),
  });
  function infer(options = {}) {
    if (options.scheduler?.schedule != null) throw Error('MoGe app owns scheduler.schedule');
    if (options.scheduler?.mode && options.scheduler.mode !== 'cooperative' && options.cooperative !== false) {
      throw Error('use cooperative:false for direct MoGe execution');
    }
    return runner.run(options);
  }
  function snapshot() {
    const run = runner.snapshot();
    return { ...run, loaded: Boolean(model), destroyed, phase: run.phase ?? (loading ? 'loading' : 'idle'),
      error: fatal?.message ?? null, routeId, admission: 'whole-operation-fifo',
      ownership: { device: ownsDevice ? 'owned' : 'borrowed', session: ownsSession ? 'owned' : 'borrowed', foreground: ownsForeground ? 'owned' : 'borrowed' } };
  }
  function destroy() {
    if (closing) return closing;
    destroyed = true; runner.stop('MoGe app destroyed'); loadAbort.abort('MoGe app destroyed');
    closing = (async () => {
      await Promise.allSettled([runner.pending, loading]);
      const errors = [];
      try { await model?.dispose(); model = null; } catch (error) { errors.push(error); }
      if (ownsForeground) { try { await foreground.dispose(); } catch (error) { errors.push(error); } }
      if (ownsSession) { try { session.close(); } catch (error) { errors.push(error); } }
      device.removeEventListener?.('uncapturederror', onGpuError);
      if (ownsDevice) device.destroy();
      if (errors.length) throw new AggregateError(errors, 'MoGe destruction failed');
    })(); return closing;
  }
  const app = Object.freeze({ device, session, foreground, routeId, get model() { return model; },
    load: loadWeights, infer, pause: runner.pause, resume: runner.resume, stop: runner.stop, snapshot, destroy });
  if (load) { try { await loadWeights(); } catch (error) {
    try { await destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'MoGe setup cleanup failed'); }
    throw error;
  } }
  return app;
}
