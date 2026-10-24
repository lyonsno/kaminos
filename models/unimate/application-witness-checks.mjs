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
    require(run.encoding?.demand?.pendingRequestCount > 0, 'real renderer demand before text encoding');
    require(run.encoding?.cooperative === true && run.encoding.duties?.length >= 2 && run.encoding.frameSubmissions?.length > 0, 'foreground submissions inside actual text encoding');
    require(Number.isFinite(run.dutyCount) && run.dutyCount > 0 && run.framesDuring > 0, 'model duties and renderer frames');
    require(run.frames === 60 && run.joints === 18 && run.glbBytes > 0, 'complete animation and GLB');
    require(run.positions?.length === 60 * 18 * 3 && run.positions.every(Number.isFinite), 'complete finite joint motion');
    require(run.positions?.some((v, i) => i >= 18 * 3 && Math.abs(v - run.positions[i % (18 * 3)]) > 1e-5), 'motion changes over time');
  }
  require(Number.isFinite(report.repeatMaxDifference) && report.repeatMaxDifference < 1e-5, 'repeat preserves generated motion');
  if (report.baseline) require(report.baseline.sha256 && Number.isFinite(report.baseline.maxDifference) && report.baseline.maxDifference < 1e-5, 'preserve pre-correction motion');
  require(report.export?.channels === 19 && report.export?.frames === 60 && report.export?.allFinite === true, 'exported rotation and root tracks');
  require(report.afterDestroy?.phase === 'destroyed' && report.afterDestroy?.routes === 0 && report.afterDestroy?.session === 'active'
    && report.afterDestroy?.foregroundDisposed === false && report.afterDestroy?.frames >= 2, 'borrowed host survives teardown');
  require(Array.isArray(report.gpuErrors) && report.gpuErrors.length === 0, 'GPU errors must be present and empty');
  require(report.browser?.browserExit?.code === 0, 'owned browser exited');
  return problems;
}

// Align the witness with an actual renderer request. A short warm encode may
// otherwise finish between rAF callbacks, leaving no demand to service.
// This waits before the measured encode and never submits a frame itself.
export async function waitForEncoderFrameDemand(foreground, nextFrame) {
  for (;;) {
    const run = foreground.snapshot().activeRun;
    if (!run || run.finishing || run.foregroundPhase) throw Error('encoder witness requires an admitted GPU run');
    if (run.pressure.pendingRequestCount > 0) return structuredClone(run.pressure);
    await nextFrame();
  }
}


// The observed 14 MB partial-motion history closes the browser WebSocket as one
// value. Transport every character in 256 KiB pieces, without capping the result.
export async function readBrowserJson(evaluate, expression) {
  const key = `__unimateReadback_${crypto.randomUUID().replaceAll('-', '')}`;
  const slot = `window[${JSON.stringify(key)}]`;
  try {
    const length = await evaluate(`(${slot}=JSON.stringify(${expression})).length`);
    if (!Number.isSafeInteger(length) || length < 0) throw Error('invalid browser JSON length');
    let json = '';
    for (let offset = 0; offset < length; offset += 262144) {
      const end = Math.min(length, offset + 262144);
      const chunk = await evaluate(`${slot}.slice(${offset},${end})`);
      if (typeof chunk !== 'string' || chunk.length !== end - offset) throw Error('incomplete browser JSON transport');
      json += chunk;
    }
    return JSON.parse(json);
  } finally { await evaluate(`delete ${slot};true`); }
}
