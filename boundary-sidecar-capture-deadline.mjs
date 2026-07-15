export const BOUNDARY_SIDECAR_CAPTURE_DEADLINE_IDENTITY = 'boundary-sidecar-raw-browser-deadline-v0';

export async function runBoundarySidecarCaptureWithDeadline({
  capture,
  release,
  deadlineMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof capture !== 'function') throw new Error('boundary sidecar deadline capture callback is required');
  if (typeof release !== 'function') throw new Error('boundary sidecar deadline release callback is required');
  const effectiveDeadlineMs = Number(deadlineMs);
  if (!Number.isFinite(effectiveDeadlineMs) || effectiveDeadlineMs <= 0) {
    throw new Error(`boundary sidecar deadline must be positive and finite, got ${deadlineMs}`);
  }

  let deadlineTimer = null;
  const capturePromise = Promise.resolve().then(capture);
  const captureOutcome = capturePromise.then(
    value => ({ kind: 'capture', value }),
    error => ({ kind: 'capture-error', error }),
  );
  const deadlineOutcome = new Promise(resolve => {
    deadlineTimer = setTimer(() => resolve({ kind: 'deadline' }), effectiveDeadlineMs);
  });
  const outcome = await Promise.race([captureOutcome, deadlineOutcome]);

  if (outcome.kind === 'capture') {
    clearTimer(deadlineTimer);
    return outcome.value;
  }
  if (outcome.kind === 'capture-error') {
    clearTimer(deadlineTimer);
    throw outcome.error;
  }

  capturePromise.then(async receipt => {
    if (receipt?.ok === true && receipt.captureId) {
      await release(receipt.captureId);
    }
  }).catch(() => {});

  return {
    ok: false,
    identity: BOUNDARY_SIDECAR_CAPTURE_DEADLINE_IDENTITY,
    reason: 'boundary-sidecar-raw-capture-deadline-exceeded',
    deadlineMs: effectiveDeadlineMs,
    lateReleaseScheduled: true,
    browserSessionDisposition: 'poisoned-close-required',
  };
}
