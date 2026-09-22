export function validateMountedComposition(snapshot) {
  const { setup, state, volume } = snapshot || {};
  if (setup?.status !== 'mounted') throw new Error(`composition did not reach mounted state (${setup?.status || 'missing'})`);
  if (volume?.active !== true || volume?.ordinaryForeground?.mode !== 'producer-foreground-opportunities') {
    throw new Error('composition mounted without an active persistent-service-owned volume renderer');
  }
  if (state?.status !== 'mounted' || state.mount?.foregroundConnected !== true || state.mount?.loadHandlerInstalled !== true) {
    throw new Error('composition published a partial shared-device mount');
  }
  if (state.deviceTopology !== 'same-device' || state.queueTopology !== 'exact-device-queue') {
    throw new Error('composition did not preserve exact same-device and queue topology');
  }
  return state;
}

export function validateSuccessfulRun(terminal) {
  if (terminal?.status !== 'succeeded') throw new Error(terminal?.lastError?.message || `Generation ended as ${terminal?.status || 'missing'}`);
  const run = terminal.runs?.at(-1);
  if (!run?.foregroundRunReport) throw new Error('Generation succeeded without a persistent foreground run report');
  if (!run.foregroundReceipts?.length) throw new Error('Generation succeeded without current-run foreground frame receipts');
  if (run.foregroundReceipts.some(receipt => receipt.status !== 'completed' || receipt.submissionCount < 1 || receipt.result?.status !== 'submitted')) {
    throw new Error('Generation succeeded with a failed, canceled, or submission-free current-run foreground receipt');
  }
  if (run.foregroundRunReport.status !== 'succeeded'
    || run.foregroundRunReport.receipts?.some(receipt => receipt.status !== 'completed')
    || run.foregroundRunReport.services?.some(service => !['serviced', 'no-demand'].includes(service.status) || service.failures?.length)) {
    throw new Error('Generation succeeded with an unhealthy foreground service report');
  }
  if (!(run.flameAfter?.frameCount > run.flameBefore?.frameCount)
    || !(run.flameAfter?.simStepCount > run.flameBefore?.simStepCount)) {
    throw new Error('Generation completed without positive same-run flame frame and simulation progress');
  }
  const runningSamples = (run.samples || []).filter(sample => sample.status === 'running');
  if (runningSamples.length < 2
    || Math.max(...runningSamples.map(sample => sample.frameCount ?? -Infinity)) <= Math.min(...runningSamples.map(sample => sample.frameCount ?? Infinity))) {
    throw new Error('Generation lacks sampled flame progress while model work was running');
  }
  return run;
}

export function progressFailure({ now, deadline, lastProgressAt, noProgressTimeoutMs, label, totalTimeoutMs }) {
  if (now >= deadline) {
    const error = new Error(`${label} exceeded the bounded ${totalTimeoutMs}ms witness deadline`);
    error.code = 'TIMEOUT';
    return error;
  }
  if (now - lastProgressAt >= noProgressTimeoutMs) {
    const error = new Error(`${label} made no source-owned progress for ${noProgressTimeoutMs}ms`);
    error.code = 'WEDGED';
    return error;
  }
  return null;
}
