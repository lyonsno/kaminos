function notification() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

/** Invocation-scoped admission for leaf duties, not nested model calls. */
export function createWebGpuInferenceControl({ queue, signal = null, withForeground = null } = {}) {
  if (typeof queue?.onSubmittedWorkDone !== 'function') throw new TypeError('queue.onSubmittedWorkDone is required');
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (withForeground != null && typeof withForeground !== 'function') throw new TypeError('withForeground must be a function');
  let requested = false;
  let active = 0;
  let closed = false;
  let failure = null;
  let status = 'running';
  let parking = null;
  let changed = notification();

  const snapshot = () => Object.freeze({ status, pauseRequested: requested, activeDutyCount: active });
  function notify() {
    const prior = changed;
    changed = notification();
    prior.resolve();
  }
  function assertOpen() {
    if (failure) throw failure;
    if (signal?.aborted) {
      const error = new Error(signal.reason?.message || String(signal.reason || 'inference stopped'));
      error.name = 'AbortError';
      throw error;
    }
    if (closed) throw new Error('inference control is closed');
  }
  function abort() {
    requested = false;
    status = 'cancelled';
    notify();
  }
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  function startParking() {
    if (!requested || active || parking || closed || failure || signal?.aborted) return;
    // Install the transition before executing caller-supplied queue/window code.
    parking = Promise.resolve().then(async () => {
      const fence = queue.onSubmittedWorkDone();
      if (typeof fence?.then !== 'function') throw new TypeError('queue completion must return a Promise');
      await fence;
      if (!requested || closed || signal?.aborted) return;
      const wait = async () => {
        if (!requested || closed || signal?.aborted) return;
        status = 'paused';
        notify();
        while (requested && !closed && !signal?.aborted) await changed.promise;
      };
      if (withForeground) await withForeground('inference-paused', wait);
      else await wait();
    }).catch(error => {
      failure = error;
      requested = false;
      status = 'failed';
    }).finally(() => {
      parking = null;
      if (!failure) status = signal?.aborted ? 'cancelled' : closed ? 'closed' : requested ? 'pausing' : 'running';
      notify();
      startParking();
    });
  }

  async function pause() {
    assertOpen();
    requested = true;
    if (status !== 'paused') status = 'pausing';
    notify();
    startParking();
    while (requested && status !== 'paused') {
      assertOpen();
      await changed.promise;
    }
    assertOpen();
    return snapshot();
  }

  async function resume() {
    assertOpen();
    requested = false;
    status = parking ? 'resuming' : 'running';
    notify();
    while (parking) await changed.promise;
    assertOpen();
    return snapshot();
  }

  async function runDuty(work) {
    if (typeof work !== 'function') throw new TypeError('duty work must be a function');
    while (true) {
      assertOpen();
      if (!requested && !parking) break;
      await changed.promise;
    }
    // No await between checking admission and reserving this duty.
    active++;
    try {
      return await work();
    } finally {
      active--;
      notify();
      startParking();
    }
  }

  async function close() {
    closed = true;
    requested = false;
    notify();
    while (active || parking) await changed.promise;
    signal?.removeEventListener('abort', abort);
    if (failure) throw failure;
    status = signal?.aborted ? 'cancelled' : 'closed';
    return snapshot();
  }

  return Object.freeze({ pause, resume, runDuty, close, snapshot, signal });
}
