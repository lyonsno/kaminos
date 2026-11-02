const phases = { 'u2net-pre-resize': 'Preparing image', 'u2net-input': 'Removing background',
  'u2net-mask': 'Refining mask', 'u2net-cutout': 'Creating cutout' };
const duration = ms => ms == null ? '--' : ms < 60000 ? `${(ms / 1000).toFixed(1)} s`
  : `${Math.floor(ms / 60000)} m ${Math.floor(ms % 60000 / 1000)} s`;

export function createProgressView(get) {
  let started, inference, ended, timer, state = '', control = '', loaded;
  function render() {
    const now = ended ?? performance.now();
    get('status').textContent = control || state;
    get('elapsed').textContent = `${duration(now - started)} elapsed`;
    get('load-time').textContent = loaded ? 'Already loaded' : duration((inference ?? now) - started);
    get('run-time').textContent = duration(inference == null ? null : now - inference);
    get('progress-label').textContent = control || state;
    get('progress').hidden = Boolean(control) || ended != null;
  }
  return {
    start(resident) {
      clearInterval(timer); started = performance.now(); inference = ended = null;
      loaded = resident; control = ''; state = resident ? 'Waiting for inference' : 'Loading model';
      get('progress').removeAttribute('value'); get('operation').textContent = '--';
      render(); timer = setInterval(render, 1000);
    },
    beginInference() { inference = performance.now(); state = 'Waiting for inference'; render(); },
    phase(name) {
      if (ended != null) return;
      state = phases[name] || name; get('operation').textContent = name; render();
    },
    control(message) { control = message; render(); },
    finish(message) { ended = performance.now(); state = message; control = ''; clearInterval(timer); render(); },
    destroy() { clearInterval(timer); },
  };
}
