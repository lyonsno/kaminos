const phases = {
  preprocess: ['Preparing image', 'preprocessMs'], encode: ['Encoding image', 'encodeMs'],
  unet: ['Inferring materials', 'unetMs'], 'decode-albedo': ['Decoding albedo', 'decodeAlbedoMs'],
  'decode-orm': ['Decoding surface maps', 'decodeOrmMs'], 'pack-maps': ['Finishing maps', 'packMapsMs'],
};
const duration = ms => ms == null ? '--' : ms < 60000 ? `${(ms / 1000).toFixed(1)} s`
  : `${Math.floor(ms / 60000)} m ${Math.floor(ms % 60000 / 1000)} s`;
const bytes = value => Number.isFinite(value) && value >= 0 ? `${(value / 1048576).toFixed(1)} MiB` : null;
const fraction = (value, total) => Number.isFinite(value) && Number.isFinite(total) && total > 0
  && value >= 0 && value <= total ? value / total : null;

export function createProgressView(get) {
  let started = null, inferenceStarted = null, ended = null, phaseStarted = null;
  let state = 'idle', control = null, load = {}, run = {}, phaseTimes = {}, timer = null, resident = false;
  const text = (id, value) => { if (get(id).textContent !== value) get(id).textContent = value; };
  const stopTimer = () => { clearInterval(timer); timer = null; };
  function render() {
    const now = ended ?? performance.now();
    get('runtime').hidden = started == null;
    get('progress-area').hidden = started == null;
    if (started == null) return;
    text('elapsed', `${duration(now - started)} elapsed`);
    text('time-loading', resident ? 'Already loaded' : duration((inferenceStarted ?? now) - started));
    text('time-inference', duration(inferenceStarted == null ? null : now - inferenceStarted));
    text('load-resource', Number.isInteger(load.resourceIndex) && load.resourceCount > 0
      ? `${load.resourceIndex + 1} / ${load.resourceCount}` : '--');
    const received = bytes(load.loadedBytes), total = bytes(load.totalBytes);
    text('transfer', received ? `${received}${total ? ` / ${total}` : ''}` : '--');
    text('transfer-scope', load.chunkIndex == null ? 'Resource bytes' : 'Chunk bytes');
    text('phase-count', Number.isInteger(run.phaseIndex) && run.phaseCount > 0
      ? `${run.phaseIndex + 1} / ${run.phaseCount}` : '--');
    text('operation', run.dutyLabel || '--');
    text('work', Number.isFinite(run.completedFlops) ? `${(run.completedFlops / 1e9).toFixed(1)} GFLOP` : '--');
    text('queue-time', Number.isFinite(run.lastDutyMs) ? `${run.lastDutyMs.toFixed(1)} ms` : '--');
    for (const [phase] of Object.entries(phases)) {
      const elapsed = phase === run.phase && ended == null && phaseStarted != null
        ? now - phaseStarted : phaseTimes[phase];
      text(`time-${phase}`, duration(elapsed));
    }
    let value = null, label = '', status = '';
    if (state === 'loading') {
      value = fraction(load.loadedBytes, load.totalBytes);
      label = load.chunkIndex == null ? 'Current resource' : 'Current chunk';
      status = 'Loading model';
    } else if (state === 'inferring') {
      value = fraction(run.completedFlops, run.totalFlops);
      label = value == null ? 'Inference in progress' : `${Math.round(value * 100)}% of GPU work (estimated)`;
      status = phases[run.phase]?.[0] || 'Inferring materials';
    } else {
      status = state;
      label = state === 'Materials complete' ? 'Complete' : state;
      if (state === 'Materials complete') value = 1;
    }
    if (control) { status = control; label = control; }
    text('status', status); text('progress-label', label);
    const bar = get('progress');
    bar.hidden = Boolean(control) || (ended != null && state !== 'Materials complete');
    if (value == null) bar.removeAttribute('value'); else bar.value = value;
  }
  return {
    start(alreadyLoaded = false) {
      stopTimer(); started = performance.now(); ended = inferenceStarted = phaseStarted = null;
      load = {}; run = {}; phaseTimes = {}; control = null; resident = alreadyLoaded; state = 'loading';
      render(); timer = setInterval(render, 1000);
    },
    loading(event) {
      if (state !== 'loading' || event.phase !== 'weights') return;
      load = event; render();
    },
    beginInference() {
      inferenceStarted = phaseStarted = performance.now(); state = 'inferring';
      run = { phase: 'preprocess', phaseIndex: 0, phaseCount: 6 }; render();
    },
    inference(event) {
      if (state !== 'inferring') return;
      if (event.phase !== run.phase) {
        phaseTimes[run.phase] = performance.now() - phaseStarted;
        phaseStarted = performance.now();
      }
      run = event; render();
    },
    control(message) { if (ended == null) { control = message; render(); } },
    finish(message, result) {
      ended = performance.now(); state = message; control = null; stopTimer();
      if (phaseStarted != null) phaseTimes[run.phase] = ended - phaseStarted;
      for (const [phase, [, key]] of Object.entries(phases)) {
        if (Number.isFinite(result?.timings?.[key])) phaseTimes[phase] = result.timings[key];
      }
      render();
    },
    reset() { stopTimer(); started = null; state = 'idle'; render(); },
    destroy: stopTimer,
  };
}
