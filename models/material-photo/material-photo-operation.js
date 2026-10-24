// Compose resident model apps without taking ownership of their host or resources.
export function createMaterialPhotoOperation({ geometry, materials }) {
  for (const key of ['device', 'session', 'foreground']) {
    if (!geometry?.[key] || geometry[key] !== materials?.[key]) throw Error(`Photograph models must use the same ${key}`);
  }
  let active = null;
  const check = signal => {
    if (signal.aborted) throw new DOMException(String(signal.reason?.message ?? signal.reason ?? 'Photograph stopped'), 'AbortError');
  };
  // Cancelling an operation leaves the shared, single-flight model load intact.
  function wait(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { try { check(signal); } catch (error) { reject(error); } };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  function infer({ image, size = 768, depth, signal, geometryOptions = {}, materialOptions = {}, onProgress, onGeometry } = {}) {
    if (active) throw Error('a photograph operation is already running');
    for (const options of [geometryOptions, materialOptions]) {
      for (const key of ['image', 'signal', 'size', 'onRunProgress']) {
        if (Object.hasOwn(options, key)) throw Error(`Photograph operation owns ${key}`);
      }
    }
    const abort = new AbortController(), forward = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    const current = { abort, stage: null, phase: null };
    active = current;
    const progress = (stage, phase, detail) => {
      if (!abort.signal.aborted) {
        current.stage = stage; current.phase = phase;
        onProgress?.({ stage, phase, detail });
      }
    };
    return Promise.resolve().then(async () => {
      try {
        check(abort.signal);
        const cached = depth != null, phases = {};
        if (!cached) {
          progress('geometry', 'loading'); check(abort.signal);
          await wait(geometry.load((received, total) => progress('geometry', 'loading', { received, total })), abort.signal);
          check(abort.signal);
          if (!geometry.model?.useRealWeights) throw Error('MoGe real weights did not load');
        }
        progress('geometry', cached ? 'retained' : 'inferring'); check(abort.signal);
        let started = performance.now();
        depth ??= await geometry.infer({ ...geometryOptions, image, signal: abort.signal });
        phases.geometryMs = performance.now() - started;
        check(abort.signal);
        await onGeometry?.(depth, { cached, durationMs: phases.geometryMs });
        check(abort.signal);
        progress('materials', 'loading'); check(abort.signal);
        await wait(materials.load(event => progress('materials', 'loading', event)), abort.signal);
        check(abort.signal);
        progress('materials', 'inferring'); check(abort.signal);
        started = performance.now();
        const maps = await materials.infer({ ...materialOptions, image, size, signal: abort.signal,
          onRunProgress: event => progress('materials', 'inferring', event) });
        phases.materialsMs = performance.now() - started;
        check(abort.signal);
        if (maps.width !== size || maps.height !== size) throw Error('Material output resolution differs from requested resolution');
        return { depth, maps, phases };
      } finally {
        signal?.removeEventListener('abort', forward);
        active = null;
      }
    });
  }
  return Object.freeze({ infer,
    stop: (reason = 'stopped by user') => active?.abort.abort(reason),
    snapshot: () => ({ stage: active?.stage ?? null, phase: active?.phase ?? null }),
  });
}
