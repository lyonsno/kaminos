const duration = ms => ms < 60000 ? `${(ms / 1000).toFixed(1)} s`
  : `${Math.floor(ms / 60000)} m ${Math.floor(ms % 60000 / 1000)} s`;
export function createMotionProgress(get, setStatus) {
  let started, ended, timer, message, control, value = null, label, interval;
  const text = (id, value) => { if (get(id).textContent !== value) get(id).textContent = value; };
  const stopTimer = () => { clearInterval(timer); timer = null; };
  function render() {
    setStatus(control || message);
    text('elapsed', `${duration((ended ?? performance.now()) - started)} elapsed`);
    text('progress-label', control || label);
    const bar = get('bar');
    bar.hidden = Boolean(control) || (ended != null && message !== 'Motion complete');
    if (value == null) bar.removeAttribute('value'); else bar.value = value;
  }
  return {
    start(status, outputTimes = null) {
      stopTimer(); started = performance.now(); ended = null; message = status; control = null;
      interval = outputTimes; value = null; label = 'In progress';
      text('evaluations', '--'); text('accepted-time', '--'); text('download-bytes', '--');
      get('progress-area').hidden = get('runtime').hidden = false;
      render(); timer = setInterval(render, 1000);
    },
    status(status) { if (ended == null) { message = status; render(); } },
    bytes(loaded, total) {
      if (ended != null) return;
      value = Number.isFinite(loaded) && Number.isFinite(total) && total > 0 && loaded >= 0 && loaded <= total ? loaded / total : null;
      label = 'Model weight bytes';
      text('download-bytes', Number.isFinite(loaded) ? `${(loaded / 1048576).toFixed(1)} MiB`
        + (Number.isFinite(total) ? ` / ${(total / 1048576).toFixed(1)} MiB` : '') : '--');
      render();
    },
    evaluation(event) {
      if (ended != null) return;
      message = 'Generating motion'; text('evaluations', String(event.evaluations)); render();
    },
    step(event) {
      if (ended != null || !event.accepted) return;
      const start = interval?.[0], end = interval?.at(-1), accepted = event.t0 + event.dt;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start && Number.isFinite(accepted)) {
        value = Math.min(1, Math.max(0, (accepted - start) / (end - start)));
        text('accepted-time', `${Math.min(end, accepted).toFixed(3)} / ${end.toFixed(3)}`);
        label = 'Solver interval';
      }
      render();
    },
    control(status) { if (ended == null) { control = status; render(); } },
    finish(status) {
      ended = performance.now(); message = label = status; control = null;
      if (status === 'Motion complete') value = 1;
      stopTimer(); render();
    },
    destroy: stopTimer,
  };
}
