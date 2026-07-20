export const WEBGPU_MODEL_RESOURCE_CACHE_STORAGE_SCHEMA = 'kaminos.webgpu-model-resource-cache-storage.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'model resource CacheStorage operation aborted'));
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

function normalizeBaseUrl(value) {
  if (!isNonEmptyString(value) && !(value instanceof URL)) {
    throw new Error('model resource CacheStorage baseUrl must be an absolute HTTP(S) URL');
  }
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('model resource CacheStorage baseUrl must be an absolute HTTP(S) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('model resource CacheStorage baseUrl must use HTTP(S)');
  }
  if (url.search || url.hash) {
    throw new Error('model resource CacheStorage baseUrl cannot include a query or fragment');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function validateOpenedCache(cache) {
  if (
    !cache
    || typeof cache.match !== 'function'
    || typeof cache.put !== 'function'
    || typeof cache.delete !== 'function'
  ) {
    throw new Error('opened model resource CacheStorage cache must expose match(), put(), and delete()');
  }
  return cache;
}

export function createWebGpuModelResourceCacheStorage(input = {}) {
  if (!isNonEmptyString(input.cacheId)) {
    throw new Error('model resource CacheStorage cacheId must be a non-empty caller-owned identity');
  }
  if (!isNonEmptyString(input.cacheName)) {
    throw new Error('model resource CacheStorage cacheName must be a non-empty string');
  }
  if (!input.cacheStorage || typeof input.cacheStorage.open !== 'function') {
    throw new Error('model resource cacheStorage must expose open()');
  }
  if (input.maxEntries != null || input.maxBytes != null || input.retentionLimit != null) {
    throw new Error('model resource CacheStorage is uncapped; maxEntries, maxBytes, and retentionLimit are not supported');
  }
  const RequestImpl = input.Request || globalThis.Request;
  const ResponseImpl = input.Response || globalThis.Response;
  if (typeof RequestImpl !== 'function' || typeof ResponseImpl !== 'function') {
    throw new Error('model resource CacheStorage requires Request and Response constructors');
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  let openedCache = null;

  async function open(signal) {
    throwIfAborted(signal);
    if (!openedCache) {
      const pending = Promise.resolve()
        .then(() => input.cacheStorage.open(input.cacheName))
        .then(validateOpenedCache);
      openedCache = pending;
      pending.catch(() => {
        if (openedCache === pending) openedCache = null;
      });
    }
    return awaitWithAbort(openedCache, signal);
  }

  function requestFor(key) {
    if (!isNonEmptyString(key)) throw new Error('model resource CacheStorage key must be a non-empty string');
    return new RequestImpl(new URL(encodeURIComponent(key), baseUrl), { method: 'GET' });
  }

  return Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_CACHE_STORAGE_SCHEMA,
    cacheId: input.cacheId,
    cacheName: input.cacheName,
    baseUrl,
    keyAuthority: 'manifest-content-key-to-caller-owned-cache-namespace',
    async get(key, context = {}) {
      const cache = await open(context.signal);
      const response = await awaitWithAbort(cache.match(requestFor(key)), context.signal);
      throwIfAborted(context.signal);
      return response || null;
    },
    async put(key, ownedBuffer, context = {}) {
      if (!(ownedBuffer instanceof ArrayBuffer)) {
        throw new Error('model resource CacheStorage put() requires a cache-owned ArrayBuffer');
      }
      if (
        Number.isSafeInteger(context.expectedByteLength)
        && ownedBuffer.byteLength !== context.expectedByteLength
      ) {
        throw new Error(`model resource CacheStorage byteLength ${ownedBuffer.byteLength} does not match ${context.expectedByteLength}`);
      }
      const cache = await open(context.signal);
      const headers = {
        'content-length': String(ownedBuffer.byteLength),
        'content-type': 'application/octet-stream',
      };
      if (isNonEmptyString(context.expectedSha256)) {
        headers['x-kaminos-model-sha256'] = context.expectedSha256;
      }
      if (isNonEmptyString(context.manifestIdentity)) {
        headers['x-kaminos-model-manifest'] = context.manifestIdentity;
      }
      const response = new ResponseImpl(ownedBuffer, { status: 200, headers });
      await awaitWithAbort(cache.put(requestFor(key), response), context.signal);
      throwIfAborted(context.signal);
    },
    async delete(key, context = {}) {
      const cache = await open(context.signal);
      const deleted = await awaitWithAbort(cache.delete(requestFor(key)), context.signal);
      throwIfAborted(context.signal);
      return Boolean(deleted);
    },
  });
}
