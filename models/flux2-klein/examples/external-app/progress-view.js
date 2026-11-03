const phases = { text: 'Encoding prompt', denoise: 'Generating image', decode: 'Decoding image',
  weights: 'Preparing model weights', reference: 'Encoding reference' };
const duration = ms => ms == null ? '--' : ms < 60000 ? `${(ms / 1000).toFixed(1)} s`
  : `${Math.floor(ms / 60000)} m ${Math.floor(ms % 60000 / 1000)} s`;
const fraction = (value, total) => Number.isFinite(value) && Number.isFinite(total) && total > 0
  && value >= 0 && value <= total ? value / total : null;

export function createProgressView(get) {
  let started, generated, ended, phaseStart, phase, control, message, timer, resident;
  let load = {}, step = {}, duty = {}, times = {}, work = 0;
  const text = (id, value) => { if (get(id).textContent !== value) get(id).textContent = value; };
  const stopTimer = () => { clearInterval(timer); timer = null; };
  function render() {
    const now = ended ?? performance.now();
    text('elapsed', `${duration(now - started)} elapsed`);
    text('time-loading', resident ? 'Already loaded' : duration((generated ?? now) - started));
    text('time-generation', duration(generated == null ? null : now - generated));
    for (const name of Object.keys(phases)) text(`time-${name}`, duration(
      phase === name && ended == null ? (times[name] ?? 0) + now - phaseStart : times[name]));
    text('load-part', load.part || '--'); text('load-file', load.file || '--');
    text('transfer', Number.isFinite(load.loadedBytes) ? `${(load.loadedBytes / 1048576).toFixed(1)} MiB`
      + (Number.isFinite(load.totalBytes) ? ` / ${(load.totalBytes / 1048576).toFixed(1)} MiB` : '') : '--');
    text('operation', duty.label || '--');
    text('queue-time', Number.isFinite(duty.queueMs) ? `${duty.queueMs.toFixed(1)} ms` : '--');
    text('work', work ? `${(work / 1e9).toFixed(1)} GFLOP` : '--');
    let value = null, label;
    if (ended != null) { label = message; if (message === 'Image complete') value = 1; }
    else if (generated == null) { value = fraction(load.loadedBytes, load.totalBytes); label = 'Model weight bytes'; }
    else if (phase === 'denoise') {
      value = fraction(step.completed, step.total);
      label = value == null ? 'Sampling in progress' : `Sampling step ${step.completed} of ${step.total}`;
    } else label = 'Generation in progress';
    text('status', control || message || phases[phase] || (generated == null ? 'Loading model' : 'Waiting for generation'));
    text('progress-label', control || label);
    const bar = get('progress');
    bar.hidden = Boolean(control) || (ended != null && message !== 'Image complete');
    if (value == null) bar.removeAttribute('value'); else bar.value = value;
  }
  return {
    start(alreadyLoaded = false) {
      stopTimer(); started = performance.now(); generated = ended = phaseStart = null;
      phase = control = message = null; resident = alreadyLoaded;
      load = {}; step = {}; duty = {}; times = {}; work = 0;
      get('progress-area').hidden = get('runtime').hidden = false;
      render(); timer = setInterval(render, 1000);
    },
    loading(part, file, event) { if (generated == null && ended == null) { load = { part, file, ...event }; render(); } },
    beginGeneration() { generated = performance.now(); render(); },
    phase(name) {
      if (ended != null) return;
      const now = performance.now();
      if (phase != null) times[phase] = (times[phase] ?? 0) + now - phaseStart;
      phase = name; phaseStart = now; step = {}; render();
    },
    step(completed, total) { if (ended == null) { step = { completed, total }; render(); } },
    duty(event) {
      if (ended != null) return;
      duty = event; if (Number.isFinite(event.estimatedFlops)) work += event.estimatedFlops;
      render();
    },
    control(value) { if (ended == null) { control = value; render(); } },
    finish(status) {
      ended = performance.now();
      if (phase != null) times[phase] = (times[phase] ?? 0) + ended - phaseStart;
      control = null; message = status; stopTimer(); render();
    },
    destroy: stopTimer,
  };
}
