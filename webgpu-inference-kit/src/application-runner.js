import { createWebGpuInferenceControl } from './inference-control.js';

// Shared run lifetime used by the Klein and SuperMat application entry points.
// Device creation, model loading/resources and final app destruction stay with the port.
export function createWebGpuApplicationRunner({ session, foreground, routeId,
  label, phase, runtimeLabel, prepare, execute, scheduling = {},
  assertOpen, getError, onFatal, settle } = {}) {
  let active = null;
  const stopped = signal => {
    if (!signal.aborted) return;
    const error = new Error(String(signal.reason?.message ?? signal.reason ?? `${label} stopped`));
    error.name = 'AbortError';
    throw error;
  };
  const checkResult = signal => {
    const error = getError();
    if (error) throw error;
    stopped(signal);
  };

  function run({ signal, cooperative = true, scheduling: runScheduling = {}, ...options } = {}) {
    assertOpen();
    if (active) throw new Error(`a ${label} is already running`);
    if (Object.hasOwn(options, 'schedule')) throw new Error('use scheduling here, or the model directly for an existing invocation');
    for (const key of ['runtime', 'invocation', 'control', 'signal', 'withForeground']) {
      if (Object.hasOwn(scheduling, key) || Object.hasOwn(runScheduling, key)) throw new Error(`${label} owns scheduling.${key}`);
    }
    const abort = new AbortController(), forward = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    const current = { abort, control: null, phase: 'loading', cooperative, job: null, promise: null };
    active = current;
    const cancel = () => current.job?.cancel(`${label} stopped`);
    abort.signal.addEventListener('abort', cancel, { once: true });
    current.promise = Promise.resolve().then(async () => {
      let admission;
      try {
        stopped(abort.signal);
        await prepare(abort.signal);
        stopped(abort.signal);
        admission = await session.registerRoute({ routeId: `${routeId}:admission` });
        stopped(abort.signal);
        current.phase = 'queued';
        const runId = `${runtimeLabel}:${crypto.randomUUID()}`;
        // Only the outer job queues. Its model invocation runs directly inside
        // the admission, after the previous host's foreground run has finished.
        current.job = admission.enqueue({ jobId: runId, execute: async () => {
          let frames, modelRoute, output, failure;
          const errors = [];
          try {
            stopped(abort.signal); assertOpen();
            frames = await foreground.beginRun(runId, { routeId });
            stopped(abort.signal); current.phase = phase;
            if (cooperative) {
              modelRoute = await session.registerRoute({ routeId, runtimeOptions: {
                runtimeLabel, foregroundOpportunities: frames.foregroundOpportunities } });
              // CPU preparation/reloads and a pause share one ordered window stream.
              let tail = Promise.resolve();
              const withForeground = (name, work) => {
                const window = tail.then(() => frames.withForeground(name, work));
                tail = window.catch(() => {});
                return window;
              };
              current.control = createWebGpuInferenceControl({ queue: session.device.queue, signal: abort.signal, withForeground });
              output = await modelRoute.runtime.runInvocation({ invocationId: runId }, invocation => execute(options, {
                ...scheduling, ...runScheduling, runtime: modelRoute.runtime, invocation,
                control: current.control, signal: abort.signal, withForeground }));
            } else output = await execute(options, null);
            checkResult(abort.signal);
          } catch (error) { failure = error; }
          finally {
            // Hold admission through all cleanup, including a port's extra GPU settlement.
            current.phase = 'finishing';
            try { await current.control?.close(); } catch (e) { errors.push(e); }
            current.control = null;
            try { await settle?.(); } catch (e) { errors.push(e); }
            if (modelRoute) { try { session.unregisterRoute(modelRoute.routeId); } catch (e) { errors.push(e); } }
            try { await frames?.finish(); } catch (e) { errors.push(e); }
          }
          if (errors.length) {
            const error = new AggregateError([...(failure ? [failure] : []), ...errors], `${label} cleanup failed`);
            onFatal(error); throw error;
          }
          if (failure) throw failure;
          return output;
        } });
        if (abort.signal.aborted) cancel();
        const result = await current.job.completion;
        checkResult(abort.signal);
        if (result.status !== 'succeeded') throw Object.assign(new Error(result.failure?.message ?? result.status), {
          name: result.failure?.name ?? 'Error' });
        return result.output;
      } finally {
        signal?.removeEventListener('abort', forward);
        abort.signal.removeEventListener('abort', cancel);
        try { if (admission) { await admission.drain(); session.unregisterRoute(admission.routeId); } }
        catch (error) { onFatal(error); throw error; }
        finally { active = null; }
      }
    });
    return current.promise;
  }
  return Object.freeze({ run,
    pause: async () => active?.control ? active.control.pause() : null,
    resume: async () => active?.control ? active.control.resume() : null,
    stop: (reason = 'stopped by user') => active?.abort.abort(reason),
    get pending() { return active?.promise; },
    snapshot: () => ({ phase: active?.phase ?? null, cooperative: active?.cooperative ?? null,
      control: active?.control?.snapshot() ?? null }),
  });
}
