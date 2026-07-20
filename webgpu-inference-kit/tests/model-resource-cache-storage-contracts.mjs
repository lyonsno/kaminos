import assert from 'node:assert/strict';

import {
  createWebGpuModelResourceCacheStorage,
} from '../src/index.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entries = new Map();
const operations = [];
const cacheStorage = {
  async open(name) {
    operations.push({ operation: 'open', name });
    return {
      async match(request) {
        operations.push({ operation: 'match', url: request.url });
        return entries.get(request.url)?.clone() || undefined;
      },
      async put(request, response) {
        operations.push({ operation: 'put', url: request.url });
        entries.set(request.url, response.clone());
      },
      async delete(request) {
        operations.push({ operation: 'delete', url: request.url });
        return entries.delete(request.url);
      },
    };
  },
};

const adapter = createWebGpuModelResourceCacheStorage({
  cacheId: 'cache-storage:test-models-v1',
  cacheName: 'test-models-v1',
  baseUrl: 'https://app.example/__kaminos_model_cache__/',
  cacheStorage,
});
assert.equal(Object.isFrozen(adapter), true);
assert.equal(adapter.cacheId, 'cache-storage:test-models-v1');

const contentKey = 'sha256:abcdef:bytes:8';
assert.equal(await adapter.get(contentKey), null);
const source = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
await adapter.put(contentKey, source, {
  expectedByteLength: 8,
  expectedSha256: 'abcdef',
  manifestIdentity: 'model@revision:manifest',
  ownership: 'cache-owned-array-buffer',
});
const cached = await adapter.get(contentKey);
assert.equal(cached instanceof Response, true);
assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), new Uint8Array(source));
assert.equal(cached.headers.get('content-length'), '8');
assert.equal(cached.headers.get('x-kaminos-model-sha256'), 'abcdef');
assert.equal(cached.headers.get('x-kaminos-model-manifest'), 'model@revision:manifest');
assert.match(operations.find(operation => operation.operation === 'put').url, /sha256%3Aabcdef%3Abytes%3A8$/);
assert.equal(await adapter.delete(contentKey), true);
assert.equal(await adapter.get(contentKey), null);

assert.throws(
  () => createWebGpuModelResourceCacheStorage({
    cacheId: '', cacheName: 'models', baseUrl: 'https://app.example/cache/', cacheStorage,
  }),
  /cacheId/i,
);
assert.throws(
  () => createWebGpuModelResourceCacheStorage({
    cacheId: 'models', cacheName: '', baseUrl: 'https://app.example/cache/', cacheStorage,
  }),
  /cacheName/i,
);
assert.throws(
  () => createWebGpuModelResourceCacheStorage({
    cacheId: 'models', cacheName: 'models', baseUrl: 'file:///tmp/cache/', cacheStorage,
  }),
  /baseUrl|https/i,
);
assert.throws(
  () => createWebGpuModelResourceCacheStorage({
    cacheId: 'models', cacheName: 'models', baseUrl: 'https://app.example/cache/', cacheStorage: {},
  }),
  /cacheStorage.*open/i,
);
assert.throws(
  () => createWebGpuModelResourceCacheStorage({
    cacheId: 'models', cacheName: 'models', baseUrl: 'https://app.example/cache/', cacheStorage,
    maxEntries: 4,
  }),
  /uncapped|maxEntries/i,
);

const stalledOpen = deferred();
const controller = new AbortController();
const stalled = createWebGpuModelResourceCacheStorage({
  cacheId: 'stalled-cache',
  cacheName: 'stalled-cache',
  baseUrl: 'https://app.example/stalled/',
  cacheStorage: { open() { return stalledOpen.promise; } },
});
const stalledRead = stalled.get(contentKey, { signal: controller.signal });
controller.abort('cancel-cache-storage-open');
await assert.rejects(stalledRead, error => error.name === 'AbortError');

let retryOpenCount = 0;
const retrying = createWebGpuModelResourceCacheStorage({
  cacheId: 'retrying-cache',
  cacheName: 'retrying-cache',
  baseUrl: 'https://app.example/retrying/',
  cacheStorage: {
    open() {
      retryOpenCount += 1;
      if (retryOpenCount === 1) return Promise.reject(new Error('transient CacheStorage open failure'));
      return cacheStorage.open('retrying-cache-inner');
    },
  },
});
await assert.rejects(retrying.get(contentKey), /transient CacheStorage open failure/);
assert.equal(await retrying.get(contentKey), null);
assert.equal(retryOpenCount, 2, 'a failed lazy open must not poison every later cache operation');

console.log('model resource CacheStorage contracts passed');
