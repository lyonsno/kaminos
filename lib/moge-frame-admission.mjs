// The shared foreground service owns lifecycle, ordering, and receipts. This
// adapter owns only MoGe boundary identity plus the host flame's observable
// freshness predicate. Separate GPUDevices mean counter advancement is not a
// presentation or hardware-priority claim.
export function resolveMogeFrameAdmissionMode(hash = '') {
  const mode = new URLSearchParams(String(hash).replace(/^#/, '')).get('moge_frame_admission') || 'none';
  if (!['none', 'fresh-flame'].includes(mode)) {
    throw new Error(`Unknown moge_frame_admission: ${mode}`);
  }
  return mode;
}

function abortError() {
  return new DOMException('Frame admission cancelled', 'AbortError');
}

export async function createMogeFrameAdmission({
  foregroundService,
  runId,
  readFlame,
  visibility = () => globalThis.document?.visibilityState,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  now = () => performance.now(),
  events = [],
}) {
  if (typeof foregroundService?.beginRun !== 'function'
    || typeof foregroundService?.snapshot !== 'function'
    || typeof runId !== 'string' || runId.length === 0
    || typeof readFlame !== 'function'
    || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new Error('MoGe frame admission requires a shared foreground service, run identity, and live flame state');
  }
  const foregroundRun = await foregroundService.beginRun(runId);
  let sequence = 0;
  let finishReport = null;

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

  function waitForFreshFlame(event, signal) {
    return new Promise((resolve, reject) => {
      let frame = null;
      let settled = false;
      const finish = (error, after = null) => {
        if (settled) return;
        settled = true;
        if (frame !== null) cancelFrame(frame);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve({ before: event.before, after });
      };
      const onAbort = () => finish(abortError());
      const tick = () => {
        if (settled) return;
        try {
          const current = read();
          if (current.frameCount < event.before.frameCount
            || current.simStepCount < event.before.simStepCount) {
            throw new Error('Foreground counters reset');
          }
          if (current.frameCount > event.before.frameCount
            && current.simStepCount > event.before.simStepCount) {
            finish(null, current);
          } else {
            frame = requestFrame(tick);
          }
        } catch (error) {
          finish(error);
        }
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        // Strict-drain MoGe invokes host admission after the submitted model
        // chunk has retired, so this is the boundary-time freshness baseline.
        event.before = read();
        frame = requestFrame(tick);
      } catch (error) {
        finish(error);
      }
    });
  }

  async function admit({ phase, chunk, signal } = {}) {
    const admissionSequence = ++sequence;
    const event = {
      phase,
      chunk,
      mode: 'fresh-flame',
      requestId: `${runId}:fresh-flame:${admissionSequence}`,
      startedAtMs: now(),
      status: 'pending',
    };
    events.push(event);
    const request = foregroundRun.foregroundOpportunities.request({
      requestId: event.requestId,
      metadata: { phase, chunk, admissionSequence },
      run: ({ signal: foregroundSignal }) => waitForFreshFlame(event, foregroundSignal),
    });
    const onAbort = () => request.cancel('moge-scheduler-aborted');
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    try {
      event.foregroundService = await foregroundRun.foregroundOpportunities.serviceAtBoundary({
        invocationId: runId,
        boundaryId: `${event.requestId}:boundary`,
        dutyId: String(chunk || `${phase || 'unknown'}:${admissionSequence}`),
        phase: String(phase || 'unknown'),
        position: 'before-encode',
        metadata: { chunk, admissionSequence },
      });
      event.foregroundReceipt = await request.completion;
      if (event.foregroundReceipt.status !== 'completed') {
        if (event.foregroundReceipt.status.startsWith('canceled')) throw abortError();
        const message = event.foregroundReceipt.failure?.error?.message
          || `Foreground flame admission ${event.foregroundReceipt.status}`;
        throw new Error(message);
      }
      event.after = event.foregroundReceipt.result?.after ?? null;
      event.status = 'advanced';
    } catch (error) {
      event.foregroundReceipt ??= await request.completion;
      event.status = 'failed';
      event.error = error?.message || String(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      event.endedAtMs = now();
    }
  }

  async function finish() {
    if (!finishReport) finishReport = await foregroundRun.finish();
    return finishReport;
  }

  return Object.freeze({
    admit,
    finish,
    snapshot: () => foregroundRun.foregroundOpportunities.snapshot(),
    serviceSnapshot: () => foregroundService.snapshot(),
  });
}

export function verifyMogeFrameAdmission({ events, schedulerReceipt, finishReport }) {
  const trace = schedulerReceipt?.eventTrace?.events;
  const effective = schedulerReceipt?.scheduler?.effectiveScheduler;
  if (effective?.hostAdmission !== 'callback'
    || effective?.pacing !== 'strict-drain'
    || effective?.waitForSubmittedWorkDone !== true
    || !Array.isArray(events) || events.length < 1 || !Array.isArray(trace)
    || finishReport?.status !== 'succeeded'
    || !Array.isArray(finishReport?.receipts)) {
    throw new Error('Frame admission evidence missing');
  }
  const retainedById = new Map(finishReport.receipts.map(receipt => [receipt?.requestId, receipt]));
  const requestIds = new Set();
  let traceCursor = 0;
  for (const event of events) {
    const result = event.foregroundReceipt?.result;
    const requestId = event.requestId;
    const retained = retainedById.get(requestId);
    const queueEndIndex = trace.findIndex((row, index) => index >= traceCursor
      && row.kind === 'queue-work-done-end'
      && row.provenance === 'observed'
      && row.phase === event.phase
      && row.chunk === event.chunk);
    const admissionStartIndex = trace.findIndex((row, index) => index > queueEndIndex
      && row.kind === 'host-admission-start'
      && row.provenance === 'observed'
      && row.phase === event.phase
      && row.chunk === event.chunk);
    const admissionEndIndex = trace.findIndex((row, index) => index > admissionStartIndex
      && row.kind === 'host-admission-end'
      && row.provenance === 'observed'
      && row.phase === event.phase
      && row.chunk === event.chunk
      && row.status === 'advanced');
    if (event.mode !== 'fresh-flame' || event.status !== 'advanced'
      || event.foregroundService?.status !== 'serviced'
      || event.foregroundReceipt?.status !== 'completed'
      || event.foregroundReceipt?.submissionCount !== 0
      || typeof requestId !== 'string' || requestId.length === 0
      || requestIds.has(requestId)
      || event.foregroundReceipt?.requestId !== requestId
      || !event.foregroundService?.receiptIds?.includes(requestId)
      || event.foregroundReceipt?.boundary?.phase !== event.phase
      || event.foregroundReceipt?.boundary?.dutyId !== event.chunk
      || retained?.requestId !== requestId
      || retained?.status !== 'completed'
      || retained?.boundary?.phase !== event.phase
      || retained?.boundary?.dutyId !== event.chunk
      || queueEndIndex < traceCursor
      || admissionStartIndex <= queueEndIndex
      || admissionEndIndex <= admissionStartIndex
      || !Number.isFinite(event.startedAtMs) || !Number.isFinite(event.endedAtMs)
      || event.endedAtMs < event.startedAtMs
      || !Number.isSafeInteger(result?.before?.frameCount)
      || !Number.isSafeInteger(result?.before?.simStepCount)
      || !Number.isSafeInteger(result?.after?.frameCount)
      || !Number.isSafeInteger(result?.after?.simStepCount)
      || result.after.frameCount <= result.before.frameCount
      || result.after.simStepCount <= result.before.simStepCount) {
      throw new Error('Unverified foreground advancement');
    }
    requestIds.add(requestId);
    traceCursor = admissionEndIndex + 1;
  }
  const starts = trace.filter(event => event.kind === 'host-admission-start');
  const ends = trace.filter(event => event.kind === 'host-admission-end');
  if (starts.length !== events.length || ends.length !== events.length
    || ends.some(event => event.status !== 'advanced')
    || finishReport.receiptCount !== events.length
    || finishReport.receipts.length !== events.length
    || retainedById.size !== events.length) {
    throw new Error('Scheduler, foreground service, and flame admission counts differ');
  }
  return {
    status: 'verified',
    authority: 'shared-foreground-service-and-fresh-live-flame-dual-counter',
    admissions: events.length,
  };
}
