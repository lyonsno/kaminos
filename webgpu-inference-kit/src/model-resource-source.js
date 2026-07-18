import {
  prepareWebGpuModelResourceBundle,
  validateWebGpuModelResourceManifest,
} from './model-resource-manifest.js';

export const WEBGPU_MODEL_RESOURCE_SOURCE_REPORT_SCHEMA = 'kaminos.webgpu-model-resource-source-report.v0';
export const WEBGPU_MODEL_RESOURCE_SOURCE_PROGRESS_SCHEMA = 'kaminos.webgpu-model-resource-source-progress.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeError(error) {
  return deepFreeze({
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  });
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'model resource acquisition aborted'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function awaitWithAbort(value, signal) {
  if (!signal) return Promise.resolve(value);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function isInstance(value, constructorName) {
  const Constructor = globalThis[constructorName];
  return typeof Constructor === 'function' && value instanceof Constructor;
}

function sourceDescription(source) {
  if (typeof source === 'string' || isInstance(source, 'URL')) {
    return deepFreeze({ kind: 'url', url: String(source) });
  }
  if (isInstance(source, 'Request')) {
    return deepFreeze({ kind: 'request', url: source.url, method: source.method });
  }
  if (isInstance(source, 'Response')) {
    return deepFreeze({
      kind: 'response',
      url: source.url || null,
      status: source.status,
      contentType: source.headers?.get?.('content-type') || null,
    });
  }
  if (isInstance(source, 'Blob')) {
    return deepFreeze({
      kind: 'blob',
      name: isNonEmptyString(source.name) ? source.name : null,
      contentType: source.type || null,
      byteLength: source.size,
    });
  }
  if (source instanceof ArrayBuffer) {
    return deepFreeze({ kind: 'array-buffer', byteLength: source.byteLength });
  }
  if (ArrayBuffer.isView(source)) {
    return deepFreeze({
      kind: 'typed-array',
      constructor: source.constructor?.name || null,
      byteLength: source.byteLength,
    });
  }
  throw new Error('model resource source must be a URL, Request, Response, Blob, ArrayBuffer, or typed array');
}

function totalBytesFromResponse(response) {
  const raw = response.headers?.get?.('content-length');
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function readStream(stream, input) {
  if (!stream || typeof stream.getReader !== 'function') return null;
  const reader = stream.getReader();
  const chunks = [];
  let loadedBytes = 0;
  try {
    while (true) {
      throwIfAborted(input.signal);
      const { done, value } = await awaitWithAbort(reader.read(), input.signal);
      if (done) break;
      const ownedChunk = Uint8Array.from(value instanceof Uint8Array ? value : new Uint8Array(value));
      chunks.push(ownedChunk);
      loadedBytes += ownedChunk.byteLength;
      input.recordProgress(ownedChunk.byteLength, loadedBytes, input.totalBytes);
    }
  } catch (error) {
    try { Promise.resolve(reader.cancel(error)).catch(() => {}); } catch {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function consumeSource(source, input = {}) {
  throwIfAborted(input.signal);
  if (source instanceof ArrayBuffer) {
    input.recordProgress(source.byteLength, source.byteLength, source.byteLength);
    return { buffer: source, effectiveSource: sourceDescription(source) };
  }
  if (ArrayBuffer.isView(source)) {
    const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    input.recordProgress(buffer.byteLength, buffer.byteLength, buffer.byteLength);
    return { buffer, effectiveSource: sourceDescription(source) };
  }
  if (isInstance(source, 'Blob')) {
    const streamBuffer = await readStream(source.stream?.(), { ...input, totalBytes: source.size });
    const buffer = streamBuffer ?? await awaitWithAbort(source.arrayBuffer(), input.signal);
    if (streamBuffer == null) input.recordProgress(buffer.byteLength, buffer.byteLength, source.size);
    return { buffer, effectiveSource: sourceDescription(source) };
  }
  if (isInstance(source, 'Response')) {
    if (!source.ok) throw new Error(`model resource response status ${source.status} is not successful`);
    const totalBytes = totalBytesFromResponse(source);
    const streamBuffer = await readStream(source.body, { ...input, totalBytes });
    const buffer = streamBuffer ?? await awaitWithAbort(source.arrayBuffer(), input.signal);
    if (streamBuffer == null) input.recordProgress(buffer.byteLength, buffer.byteLength, totalBytes);
    return { buffer, effectiveSource: sourceDescription(source) };
  }
  throw new Error('model resource source did not resolve to consumable bytes');
}

function validateCache(cache) {
  if (cache == null) return null;
  if (!isNonEmptyString(cache.cacheId)) throw new Error('model resource cache.cacheId must be a non-empty caller-owned identity');
  if (typeof cache.get !== 'function' || typeof cache.put !== 'function') {
    throw new Error('model resource cache must expose async get() and put()');
  }
  return cache;
}

function cacheKey(manifest) {
  return `sha256:${manifest.bundle.sha256}:bytes:${manifest.bundle.byteLength}`;
}

function cacheStatus(state) {
  if (!state.configured) return 'not-configured';
  if (state.validationFailure) return 'invalid-config';
  if (state.hit) return 'hit';
  if (!state.readAttempted) return 'configured-not-read';
  if (!state.readSettled) return 'read-incomplete';
  const prefix = state.rejection ? 'rejected-refetched' : (state.readFailure ? 'read-failed' : 'miss');
  const suffix = !state.writeAttempted
    ? 'not-stored'
    : (!state.writeSettled ? 'write-incomplete' : (state.writeFailure ? 'write-failed' : 'stored'));
  return `${prefix}-${suffix}`;
}

function publicCacheState(state) {
  return deepFreeze({
    status: cacheStatus(state),
    cacheId: state.cacheId,
    key: state.key,
    validationFailure: state.validationFailure,
    readFailure: state.readFailure,
    rejection: state.rejection,
    deleteFailure: state.deleteFailure,
    writeFailure: state.writeFailure,
  });
}

function failureWithReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  try {
    error.report = report;
    if (error.report === report) return error;
  } catch {}
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.report = report;
  return wrapped;
}

async function acquire(manifest, source, options) {
  const progress = [];
  const now = typeof options.now === 'function'
    ? options.now
    : (() => globalThis.performance?.now?.() ?? Date.now());
  const startedAtMs = now();
  let phase = 'option-validation';
  let manifestIdentity = isNonEmptyString(manifest?.identity) ? manifest.identity : null;
  let requestedSource = null;
  let effectiveSource = null;
  let cache = null;
  let bundle = null;
  const cacheState = {
    configured: options.cache != null,
    cacheId: isNonEmptyString(options.cache?.cacheId) ? options.cache.cacheId : null,
    key: null,
    validationFailure: null,
    readAttempted: false,
    readSettled: false,
    writeAttempted: false,
    writeSettled: false,
    hit: false,
    readFailure: null,
    rejection: null,
    deleteFailure: null,
    writeFailure: null,
  };

  function recordProgress(chunkBytes, loadedBytes, totalBytes) {
    const event = deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_SOURCE_PROGRESS_SCHEMA,
      sequence: progress.length + 1,
      phase: 'source-read',
      chunkBytes,
      loadedBytes,
      totalBytes,
      observedAtMs: now(),
    });
    progress.push(event);
    if (typeof options.onProgress === 'function') options.onProgress(event);
  }

  function finishReport(status, failure = null) {
    return deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_SOURCE_REPORT_SCHEMA,
      status,
      manifestIdentity,
      requestedSource,
      effectiveSource,
      cache: publicCacheState(cacheState),
      startedAtMs,
      settledAtMs: now(),
      progress: [...progress],
      lastTrustworthyProgress: progress.at(-1) || null,
      failure,
      authority: 'source-bytes-verified-against-manifest-no-network-or-cache-freshness-beyond-effective-read-claim',
    });
  }

  try {
    if (options.maxBytes != null || options.maxChunks != null || options.maxProgressEvents != null) {
      throw new Error('model resource acquisition is uncapped; maxBytes, maxChunks, and maxProgressEvents are not supported');
    }
    phase = 'manifest-validation';
    const validation = validateWebGpuModelResourceManifest(manifest);
    if (!validation.ok) throw new Error(`invalid WebGPU model resource manifest:\n${validation.errors.join('\n')}`);
    manifestIdentity = manifest.identity;

    phase = 'cache-validation';
    try {
      cache = validateCache(options.cache);
    } catch (error) {
      cacheState.validationFailure = normalizeError(error);
      throw error;
    }
    if (cache) cacheState.key = cacheKey(manifest);

    phase = 'source-normalization';
    requestedSource = sourceDescription(source);
    throwIfAborted(options.signal);
    if (cache) {
      let cachedSource = null;
      phase = 'cache-read';
      cacheState.readAttempted = true;
      try {
        cachedSource = await awaitWithAbort(cache.get(cacheState.key, Object.freeze({
          signal: options.signal || null,
          manifestIdentity: manifest.identity,
          expectedByteLength: manifest.bundle.byteLength,
          expectedSha256: manifest.bundle.sha256,
          ownership: 'acquisition-owned-source',
        })), options.signal);
        cacheState.readSettled = true;
      } catch (error) {
        if (error?.name === 'AbortError' && options.signal?.aborted) throw error;
        cacheState.readSettled = true;
        cacheState.readFailure = { phase, error: normalizeError(error) };
      }
      throwIfAborted(options.signal);
      if (cachedSource != null) {
        try {
          phase = 'cache-read';
          const cachedBytes = await consumeSource(cachedSource, { signal: options.signal, recordProgress });
          effectiveSource = deepFreeze({
            kind: 'persistent-cache',
            cacheId: cache.cacheId,
            key: cacheState.key,
            byteLength: cachedBytes.buffer.byteLength,
            backingSource: cachedBytes.effectiveSource,
          });
          phase = 'cache-verification';
          bundle = await prepareWebGpuModelResourceBundle(manifest, cachedBytes.buffer, {
            ownership: 'transfer', signal: options.signal, subtle: options.subtle,
          });
          throwIfAborted(options.signal);
          cacheState.hit = true;
          return deepFreeze({ bundle, report: finishReport('acquired') });
        } catch (error) {
          if (bundle) {
            try { bundle.release(); } catch {}
            bundle = null;
          }
          if (error?.name === 'AbortError') throw error;
          cacheState.rejection = { phase, error: normalizeError(error) };
          if (typeof cache.delete === 'function') {
            try {
              phase = 'cache-delete';
              await awaitWithAbort(cache.delete(cacheState.key, Object.freeze({
                signal: options.signal || null,
                reason: 'cached-model-bundle-failed-verification',
                manifestIdentity: manifest.identity,
              })), options.signal);
            } catch (deleteError) {
              if (deleteError?.name === 'AbortError' && options.signal?.aborted) throw deleteError;
              cacheState.deleteFailure = { phase: 'cache-delete', error: normalizeError(deleteError) };
            }
          }
        }
      }
    }

    let effectiveInput = source;
    if (requestedSource.kind === 'url' || requestedSource.kind === 'request') {
      phase = 'source-fetch';
      const fetchImpl = options.fetch || globalThis.fetch;
      if (typeof fetchImpl !== 'function') throw new Error('fetch is required for URL and Request model resource sources');
      effectiveInput = await awaitWithAbort(
        fetchImpl(source, { ...(options.fetchOptions || {}), signal: options.signal }),
        options.signal,
      );
    }
    phase = 'source-read';
    const acquired = await consumeSource(effectiveInput, { signal: options.signal, recordProgress });
    effectiveSource = acquired.effectiveSource.kind === 'response'
      ? deepFreeze({ ...acquired.effectiveSource, url: acquired.effectiveSource.url || requestedSource.url || null })
      : acquired.effectiveSource;
    throwIfAborted(options.signal);

    phase = 'source-verification';
    bundle = await prepareWebGpuModelResourceBundle(manifest, acquired.buffer, {
      ownership: cache ? 'copy' : (options.ownership || 'copy'),
      signal: options.signal,
      subtle: options.subtle,
    });
    if (cache) {
      phase = 'cache-write';
      cacheState.writeAttempted = true;
      try {
        await awaitWithAbort(cache.put(cacheState.key, acquired.buffer.slice(0), Object.freeze({
          signal: options.signal || null,
          manifestIdentity: manifest.identity,
          expectedByteLength: manifest.bundle.byteLength,
          expectedSha256: manifest.bundle.sha256,
          ownership: 'cache-owned-array-buffer',
        })), options.signal);
        cacheState.writeSettled = true;
      } catch (error) {
        if (error?.name === 'AbortError' && options.signal?.aborted) throw error;
        cacheState.writeSettled = true;
        cacheState.writeFailure = { phase, error: normalizeError(error) };
      }
      throwIfAborted(options.signal);
    }
    return deepFreeze({ bundle, report: finishReport('acquired') });
  } catch (cause) {
    if (bundle) {
      try { bundle.release(); } catch {}
      bundle = null;
    }
    const normalizedCause = cause instanceof Error ? cause : new Error(String(cause));
    const report = finishReport(normalizedCause.name === 'AbortError' ? 'canceled' : 'failed', {
      phase,
      error: normalizeError(normalizedCause),
    });
    throw failureWithReport(normalizedCause, report);
  }
}

export function acquireWebGpuModelResourceBundle(manifest, source, options = {}) {
  return acquire(manifest, source, options ?? {});
}
