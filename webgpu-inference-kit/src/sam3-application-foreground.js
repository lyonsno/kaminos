import { createCooperativeYield } from './inference-runtime.js';
import { SAM3_BROWSER_RESIDENT_MODEL_OWNER_ROUTE_ID } from './sam3-browser-resident-model-session.js';

export function createSam3ApplicationForeground({ inferenceSession, foregroundService, yieldToBrowser } = {}) {
  if (!inferenceSession?.device || !inferenceSession.queue) {
    throw new Error('SAM application foreground requires a borrowed inference session');
  }
  const { device, queue } = inferenceSession;
  if (device.queue !== queue || foregroundService?.device !== device || foregroundService?.queue !== queue) {
    throw new Error('SAM application foreground must use the exact borrowed device and queue');
  }
  if (typeof foregroundService.beginRun !== 'function' || typeof queue.onSubmittedWorkDone !== 'function') {
    throw new TypeError('SAM application foreground requires beginRun and queue completion');
  }
  if (yieldToBrowser != null && typeof yieldToBrowser !== 'function') {
    throw new TypeError('SAM application yield must be a function');
  }
  const browserYield = yieldToBrowser || createCooperativeYield();
  let current = null, reserved = false, settlementError = null, lastReport = null, sequence = 0;

  function assertSettled() {
    if (reserved || current || settlementError) {
      throw new Error('SAM application foreground has unsettled work; retain the model resources', { cause: settlementError });
    }
  }

  async function yieldAtBoundary(metadata = {}) {
    if (!current) throw new Error('SAM application foreground requires an admitted detector run');
    await queue.onSubmittedWorkDone();
    const id = `${current.runId}:sam-boundary:${++sequence}`;
    const result = await current.foregroundOpportunities.serviceAtBoundary({
      invocationId: current.runId, boundaryId: id, dutyId: id,
      phase: metadata.reason || 'sam-cooperative-yield', position: 'before-encode',
      metadata: metadata.metadata || {},
    });
    if (result.status === 'failed') throw new Error('SAM application foreground callback failed');
    return browserYield(metadata);
  }

  async function execute(invocationId, operation) {
    assertSettled();
    if (typeof invocationId !== 'string' || !invocationId.trim() || typeof operation !== 'function') {
      throw new TypeError('SAM application execution requires an invocation id and operation');
    }
    reserved = true;
    lastReport = null;
    try {
      current = await foregroundService.beginRun(invocationId, { routeId: SAM3_BROWSER_RESIDENT_MODEL_OWNER_ROUTE_ID });
    } catch (error) {
      reserved = false;
      throw error;
    }
    let output, primaryError, operationFailed = false;
    try { output = await operation(); } catch (error) { primaryError = error; operationFailed = true; }
    const cleanupErrors = [];
    try { await queue.onSubmittedWorkDone(); } catch (error) { cleanupErrors.push(error); }
    try {
      lastReport = await current.finish();
      if (lastReport.status !== 'succeeded') throw new Error('SAM application foreground handback is incomplete');
      if (!operationFailed && lastReport.receipts.some(receipt => receipt.failure != null)) {
        primaryError = new Error('SAM application foreground callback failed');
        operationFailed = true;
      }
    } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) {
      settlementError = new AggregateError(cleanupErrors, 'SAM application foreground settlement failed');
    } else {
      current = null;
      reserved = false;
    }
    if (operationFailed) {
      if (cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], primaryError?.message || 'SAM execution failed', { cause: primaryError });
      throw primaryError;
    }
    if (settlementError) throw settlementError;
    return output;
  }

  return Object.freeze({
    execute, yield: yieldAtBoundary, assertSettled,
    evidence: () => ({ routeId: SAM3_BROWSER_RESIDENT_MODEL_OWNER_ROUTE_ID,
      status: settlementError ? 'settlement-failed' : reserved ? 'running' : 'idle',
      boundaryCount: sequence, lastRun: lastReport, error: settlementError?.message || null,
      authority: 'borrowed-application-foreground-callbacks-and-queue-settlement-no-presentation-claim' }),
  });
}
