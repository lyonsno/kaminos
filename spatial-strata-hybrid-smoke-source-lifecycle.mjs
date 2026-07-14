function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

export function spatialStrataHybridSmokeConfigIdentity(config = {}) {
  const manifestUrl = String(config.manifestUrl || '').trim();
  if (!manifestUrl) throw new TypeError('manifestUrl must be non-empty');
  return JSON.stringify({
    manifestUrl,
    fineLodFraction: finite(config.fineLodFraction, 'fineLodFraction'),
    coarseCoverageScale: finite(config.coarseCoverageScale, 'coarseCoverageScale'),
    motionRate: finite(config.motionRate, 'motionRate'),
  });
}

export function createSpatialStrataHybridSmokeSourceLifecycle({ loadSource, createRenderer } = {}) {
  if (typeof loadSource !== 'function') throw new TypeError('loadSource must be a function');
  if (typeof createRenderer !== 'function') throw new TypeError('createRenderer must be a function');

  let generation = 0;
  let disposed = false;
  let status = 'idle';
  let requestedKey = null;
  let effectiveKey = null;
  let renderer = null;
  let pending = null;
  let failureReason = null;

  function detachRenderer() {
    const stale = renderer;
    renderer = null;
    effectiveKey = null;
    stale?.dispose?.();
  }

  function currentRenderer(config) {
    if (disposed || status !== 'loaded' || !renderer) return null;
    return spatialStrataHybridSmokeConfigIdentity(config) === effectiveKey ? renderer : null;
  }

  function ensure(config) {
    if (disposed) return Promise.reject(new Error('spatial-strata smoke source lifecycle is disposed'));
    const snapshot = { ...config, manifestUrl: String(config?.manifestUrl || '').trim() };
    const key = spatialStrataHybridSmokeConfigIdentity(snapshot);
    if (renderer && effectiveKey === key && status === 'loaded') return Promise.resolve(renderer);
    if (pending?.key === key) return pending.promise;

    generation += 1;
    const requestGeneration = generation;
    detachRenderer();
    requestedKey = key;
    status = 'loading';
    failureReason = null;

    const promise = (async () => {
      let candidate = null;
      try {
        const source = await loadSource(snapshot);
        if (disposed || requestGeneration !== generation) return null;
        candidate = await createRenderer(source, snapshot);
        if (disposed || requestGeneration !== generation) {
          candidate?.dispose?.();
          return null;
        }
        renderer = candidate;
        candidate = null;
        effectiveKey = key;
        status = 'loaded';
        return renderer;
      } catch (error) {
        candidate?.dispose?.();
        if (!disposed && requestGeneration === generation) {
          renderer = null;
          effectiveKey = null;
          status = 'failed';
          failureReason = error?.message || String(error);
        }
        throw error;
      } finally {
        if (pending?.generation === requestGeneration) pending = null;
      }
    })();
    pending = { key, generation: requestGeneration, promise };
    return promise;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    detachRenderer();
    requestedKey = null;
    status = 'disposed';
  }

  return {
    ensure,
    currentRenderer,
    dispose,
    debugState() {
      return {
        identity: 'spatial-strata-hybrid-smoke-source-lifecycle-v0',
        generation,
        status,
        requestedConfigIdentity: requestedKey,
        effectiveConfigIdentity: effectiveKey,
        failureReason,
        hasRenderer: Boolean(renderer),
        hasPendingLoad: Boolean(pending),
        disposed,
      };
    },
  };
}

export function createSpatialStrataHybridSmokeSourceRuntime({
  lifecycle,
  getCurrentConfig,
  publishState = () => {},
} = {}) {
  if (!lifecycle || typeof lifecycle.ensure !== 'function' || typeof lifecycle.currentRenderer !== 'function') {
    throw new TypeError('lifecycle must expose ensure and currentRenderer');
  }
  if (typeof getCurrentConfig !== 'function') throw new TypeError('getCurrentConfig must be a function');
  if (typeof publishState !== 'function') throw new TypeError('publishState must be a function');
  let disposed = false;

  function snapshot() {
    const lifecycleState = lifecycle.debugState();
    let renderer = null;
    if (!disposed && lifecycleState.status !== 'disposed') {
      renderer = lifecycle.currentRenderer(getCurrentConfig());
    }
    const state = { renderer, lifecycle: lifecycleState };
    publishState(state);
    return state;
  }

  async function ensure(config) {
    if (disposed) throw new Error('spatial-strata smoke source runtime is disposed');
    const pending = lifecycle.ensure(config);
    snapshot();
    try {
      await pending;
    } catch (error) {
      const current = snapshot();
      if (current.renderer || current.lifecycle.status === 'disposed') return current.renderer;
      throw error;
    }
    return snapshot().renderer;
  }

  return {
    ensure,
    currentRenderer() {
      if (disposed) return null;
      return lifecycle.currentRenderer(getCurrentConfig());
    },
    debugState() {
      return lifecycle.debugState();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.dispose();
      snapshot();
    },
  };
}
