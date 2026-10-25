async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, n => n.toString(16).padStart(2, '0')).join('')}`;
}

// One capture per completed inference; the display receives the exact source
// snapshot beside its result, never an old mask over a newer camera frame.
export function createSam31LiveLoop({ tracker, getFrame, onFrame } = {}) {
  if (typeof tracker?.initialize !== 'function' || typeof tracker.track !== 'function'
      || typeof getFrame !== 'function' || typeof onFrame !== 'function') throw new TypeError('tracker, getFrame and onFrame are required');
  const abort = new AbortController();
  let status = 'idle', paused = false, wake = null, completedFrames = 0, failure = null, inference = null;
  const stopped = () => {
    if (abort.signal.aborted) throw new DOMException(String(abort.signal.reason || 'stopped'), 'AbortError');
  };
  async function start(seed) {
    if (status !== 'idle') throw new Error('live loop is already running or finished; create another loop after tracker.reset()');
    status = 'running';
    let input = seed, first = true;
    try {
      while (true) {
        stopped();
        while (paused) { await new Promise(resolve => { wake = resolve; }); wake = null; stopped(); }
        if (!first) input = await getFrame({ signal: abort.signal });
        stopped();
        while (paused) { await new Promise(resolve => { wake = resolve; }); wake = null; stopped(); }
        const source = { rgba: new Uint8Array(input.rgba), timestamp: input.timestamp,
          width: tracker.imageWidth, height: tracker.imageHeight, mediaTime: input.mediaTime ?? null };
        const sourceHash = await sha256(source.rgba);
        stopped();
        while (paused) { await new Promise(resolve => { wake = resolve; }); wake = null; stopped(); }
        inference = first ? tracker.initialize({ ...source, mask: new Uint8Array(seed.mask), objectSlot: seed.objectSlot })
          : tracker.track(source);
        const result = await inference;
        inference = null;
        stopped();
        if (result.sourceImageSha256 !== sourceHash || result.timestamp !== source.timestamp) {
          throw new Error('live mask source identity does not match its captured frame');
        }
        completedFrames++;
        await onFrame({ source, result });
        first = false;
      }
    } catch (error) {
      inference = null;
      if (abort.signal.aborted && error.name === 'AbortError') { status = 'stopped'; return; }
      failure = error; status = 'failed'; throw error;
    }
  }
  async function pause() {
    if (status !== 'running') throw new Error('live loop is not running');
    paused = true;
    const control = await tracker.pause?.();
    // Before FIFO admission there is no GPU control yet. In that case wait
    // for this frame to finish; the paused loop cannot acquire its successor.
    if (control == null) await inference;
    if (!abort.signal.aborted) status = 'paused';
  }
  async function resume() {
    if (!paused || abort.signal.aborted) throw new Error('live loop is not paused');
    await tracker.resume?.();
    paused = false; status = 'running'; wake?.();
  }
  function stop(reason = 'stopped by user') {
    abort.abort(reason); paused = false; wake?.(); tracker.stop?.(reason);
  }
  return Object.freeze({ start, pause, resume, stop,
    snapshot: () => ({ status, completedFrames, error: failure?.message ?? null }) });
}
