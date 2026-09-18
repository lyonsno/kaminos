// Separate devices: counter advancement is a render/simulation opportunity,
// not proof of presentation or hardware-wide priority.
export function resolveMogeFrameAdmissionMode(hash = '') {
  const mode = new URLSearchParams(String(hash).replace(/^#/, '')).get('moge_frame_admission') || 'none';
  if (!['none', 'fresh-flame'].includes(mode)) {
    throw new Error(`Unknown moge_frame_admission: ${mode}`);
  }
  return mode;
}

export function createMogeFrameAdmission({
  queue,
  readFlame,
  visibility = () => globalThis.document?.visibilityState,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  now = () => performance.now(),
  events = [],
}) {
  if (!queue?.onSubmittedWorkDone || typeof readFlame !== 'function'
    || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new Error('MoGe frame admission requires its GPU queue and live flame state');
  }
  return function admit({ phase, chunk, signal } = {}) {
    const event = { phase, chunk, mode: 'fresh-flame', startedAtMs: now(), status: 'pending' };
    events.push(event);
    return new Promise((resolve, reject) => {
      let frame = null;
      let settled = false;
      let baseline;
      const finish = error => {
        if (settled) return;
        settled = true;
        if (frame !== null) cancelFrame(frame);
        signal?.removeEventListener('abort', abort);
        event.endedAtMs = now();
        event.status = error ? 'failed' : 'advanced';
        if (error) {
          event.error = error.message;
          reject(error);
        } else resolve();
      };
      const abort = () => finish(new DOMException('Frame admission cancelled', 'AbortError'));
      const read = () => {
        const flame = readFlame();
        if (visibility() !== 'visible' || flame?.active !== true || flame?.error
          || !/^WebGPU:/.test(flame?.backend ?? '')
          || !Number.isSafeInteger(flame?.frameCount)
          || !Number.isSafeInteger(flame?.simStepCount)) {
          throw new Error('Foreground flame unavailable or hidden');
        }
        return { frameCount: flame.frameCount, simStepCount: flame.simStepCount };
      };
      const tick = () => {
        if (settled) return;
        try {
          const current = read();
          if (current.frameCount < baseline.frameCount || current.simStepCount < baseline.simStepCount) {
            throw new Error('Foreground counters reset');
          }
          if (current.frameCount > baseline.frameCount && current.simStepCount > baseline.simStepCount) {
            event.after = current;
            finish();
          } else frame = requestFrame(tick);
        } catch (error) {
          finish(error);
        }
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve(queue.onSubmittedWorkDone()).then(() => {
        if (settled) return;
        event.queueDoneAtMs = now();
        baseline = read();
        event.before = baseline;
        frame = requestFrame(tick);
      }).catch(finish);
    });
  };
}

export function verifyMogeFrameAdmission({ events, schedulerReceipt }) {
  const trace = schedulerReceipt?.eventTrace?.events;
  if (schedulerReceipt?.scheduler?.effectiveScheduler?.hostAdmission !== 'callback'
    || !Array.isArray(events) || events.length < 1 || !Array.isArray(trace)) {
    throw new Error('Frame admission evidence missing');
  }
  for (const event of events) {
    if (event.mode !== 'fresh-flame' || event.status !== 'advanced'
      || !Number.isFinite(event.startedAtMs) || !Number.isFinite(event.queueDoneAtMs)
      || !Number.isFinite(event.endedAtMs)
      || event.queueDoneAtMs < event.startedAtMs || event.endedAtMs < event.queueDoneAtMs
      || !Number.isSafeInteger(event.before?.frameCount)
      || !Number.isSafeInteger(event.before?.simStepCount)
      || !Number.isSafeInteger(event.after?.frameCount)
      || !Number.isSafeInteger(event.after?.simStepCount)
      || event.after.frameCount <= event.before.frameCount
      || event.after.simStepCount <= event.before.simStepCount) {
      throw new Error('Unverified foreground advancement');
    }
  }
  const starts = trace.filter(event => event.kind === 'host-admission-start');
  const ends = trace.filter(event => event.kind === 'host-admission-end' && event.status === 'advanced');
  if (starts.length !== events.length || ends.length !== events.length) {
    throw new Error('Scheduler and flame admission counts differ');
  }
  return {
    status: 'verified',
    authority: 'model-queue-fence-and-fresh-live-flame-dual-counter',
    admissions: events.length,
  };
}
