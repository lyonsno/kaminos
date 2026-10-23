// Consumer checks deliberately distinguish actual installed/native output from projections or fallback.
export function checkSuperMatAppWitness(r) {
  const errors = [], need = (ok, message) => { if (!ok) errors.push(message); };
  need(r.source?.rev === r.expectedRevision && r.source?.dirtyFiles?.length === 0, 'effective source must match the clean requested revision');
  need(r.installed?.name === '@kaminos/supermat' && r.outsideCheckout === true, 'actual installed outside package required');
  need(r.browserExit?.code === 0, 'owned browser must exit cleanly');
  need(r.gpuErrors?.length === 0, 'GPU errors must be absent');
  for (const run of r.runs ?? []) {
    need(run.identity?.backend === 'webgpu-local' && run.identity?.modelId === 'supermat.single-image', 'effective native SuperMat route required');
    need(run.cpuWorker === true && run.dutyCount > 0 && run.frames > 0, 'real CPU worker, cooperative duties and foreground frames required');
    need(run.width === r.size && run.height === r.size, 'selected map size must reach the producer');
  }
  need(r.runs?.length === 2, 'two actual completed inferences required');
  need(r.albedo?.std > 1 && r.albedo?.bytes === r.size * r.size * 4, 'nonblank selected-size albedo required');
  need(r.paused?.status === 'paused' && r.pausedFrames > 0 && r.resumed === true, 'pause, completed foreground frames and resume required');
  need(r.stopped === true && r.invalidSize?.includes('multiple of 64'), 'stop/retry and producer validation required');
  need(r.afterBorrowedDestroy?.phase === 'idle' && r.afterBorrowedDestroy?.loaded === true, 'borrowed application destroy must preserve host');
  need(r.afterDestroy?.destroyed === true && r.afterDestroy?.loaded === false, 'application destruction required');
  return errors;
}
