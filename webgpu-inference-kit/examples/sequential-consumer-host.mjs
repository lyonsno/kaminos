/**
 * Host-owned ordering/lifetime for already-admitted SAM and SF3D consumers.
 * The caller creates SAM with its borrowed application session/yield callback
 * and SF3D with the same device; this module never owns the device or models.
 */
export function createSequentialConsumerHost({ device, sam, sf3d, onState = () => {} } = {}) {
  if (!device || !sam || !sf3d) throw new Error('device, sam, and sf3d consumers are required');
  if (sam.device && sam.device !== device) throw new Error('SAM consumer is not using the host device');
  if (sf3d.device && sf3d.device !== device) throw new Error('SF3D consumer is not using the host device');
  if (typeof sam.run !== 'function' || typeof sam.close !== 'function') throw new Error('SAM consumer must expose run() and close()');
  if (typeof sf3d.run !== 'function' || typeof sf3d.dispose !== 'function') throw new Error('SF3D consumer must expose run() and dispose()');
  if (typeof onState !== 'function') throw new Error('onState must be a function');

  let active = null;
  let closed = false;
  let disposal;
  const outputs = [];
  const state = { status: 'idle', model: null, phase: 'Waiting', outputs, error: null };
  const publish = () => onState(Object.freeze({ ...state, outputs: Object.freeze([...outputs]) }));

  async function runSam(manifestUrl, request) {
    return run('sam', () => sam.run(manifestUrl, request));
  }

  async function runSf3d(image, options = {}) {
    return run('sf3d', () => sf3d.run(image, {
      ...options,
      onProgress(message) {
        state.phase = String(message);
        options.onProgress?.(message);
        publish();
      },
    }));
  }

  async function run(model, work) {
    if (closed) throw new Error('consumer host is closed');
    if (active) throw new Error('a consumer run is already active');
    state.status = 'running';
    state.model = model;
    state.phase = 'Starting';
    state.error = null;
    publish();
    active = Promise.resolve().then(work).then(output => {
      outputs.push(Object.freeze({ model, output }));
      state.status = 'succeeded';
      state.phase = 'Complete';
      return output;
    }, error => {
      state.status = 'failed';
      state.phase = 'Failed';
      state.error = String(error?.message ?? error);
      throw error;
    }).finally(() => {
      active = null;
      publish();
    });
    return active;
  }

  function dispose() {
    if (disposal) return disposal;
    closed = true;
    disposal = (async () => {
      let failure;
      try { await active; } catch (error) { failure = error; }
      try { await sam.close(); } catch (error) { failure ??= error; }
      try { await sf3d.dispose().completion; } catch (error) { failure ??= error; }
      state.status = 'closed';
      state.phase = 'Closed';
      publish();
      if (failure) throw failure;
    })();
    return disposal;
  }

  publish();
  return Object.freeze({ runSam, runSf3d, snapshot: () => Object.freeze({ ...state, outputs: Object.freeze([...outputs]) }), dispose });
}
