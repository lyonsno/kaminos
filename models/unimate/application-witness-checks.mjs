export function checkUniMateApplicationWitness(report) {
  const problems = [];
  const require = (ok, message) => { if (!ok) problems.push(message); };
  require(report.source?.rev === report.expectedRevision && report.source?.dirtyFiles?.length === 0, 'clean requested source');
  require(report.outsideCheckout === true && report.installed?.kit && report.installed?.model, 'installed outside consumer');
  require(report.browser?.effectiveBrowser && report.browser?.executable && report.browser?.profile?.temporary === true, 'effective independent browser');
  require(report.input?.joints === 18 && report.input?.frames === 60, 'effective Go2 input');
  require(report.paused === 'paused' && report.pausedFrames >= 2 && report.resumed === 'running', 'pause and resumed renderer');
  require(report.stopped === true, 'stop before retry');
  require(Array.isArray(report.runs) && report.runs.length === 2, 'two completed generations');
  for (const run of report.runs ?? []) {
    require(run.textEncoder === 'browser T5', 'real text encoder');
    require(Number.isFinite(run.dutyCount) && run.dutyCount > 0 && run.framesDuring > 0, 'model duties and renderer frames');
    require(run.frames === 60 && run.joints === 18 && run.glbBytes > 0, 'complete animation and GLB');
    require(run.positions?.length === 60 * 18 * 3 && run.positions.every(Number.isFinite), 'complete finite joint motion');
    require(run.positions?.some((v, i) => i >= 18 * 3 && Math.abs(v - run.positions[i % (18 * 3)]) > 1e-5), 'motion changes over time');
  }
  require(Number.isFinite(report.repeatMaxDifference) && report.repeatMaxDifference < 1e-5, 'repeat preserves generated motion');
  require(report.export?.channels === 19 && report.export?.frames === 60 && report.export?.allFinite === true, 'exported rotation and root tracks');
  require(report.afterDestroy?.phase === 'destroyed' && report.afterDestroy?.routes === 0 && report.afterDestroy?.session === 'active'
    && report.afterDestroy?.foregroundDisposed === false && report.afterDestroy?.frames >= 2, 'borrowed host survives teardown');
  require(Array.isArray(report.gpuErrors) && report.gpuErrors.length === 0, 'GPU errors must be present and empty');
  require(report.browser?.browserExit?.code === 0, 'owned browser exited');
  return problems;
}
