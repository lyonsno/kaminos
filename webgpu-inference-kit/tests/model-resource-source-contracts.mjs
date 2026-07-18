import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_MODEL_RESOURCE_SOURCE_REPORT_SCHEMA,
  acquireWebGpuModelResourceBundle,
  defineWebGpuModelResourceManifest,
} from '../src/index.js';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestFor(bytes) {
  return defineWebGpuModelResourceManifest({
    modelId: 'acme/browser-source-model',
    revision: 'revision-a',
    bundle: { byteLength: bytes.byteLength, sha256: sha256(bytes) },
    allocations: [{
      allocationId: 'weights',
      byteOffset: 0,
      byteLength: bytes.byteLength,
      usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      tensors: [{
        name: 'weights',
        dtype: 'u32',
        shape: [bytes.byteLength / 4],
        byteOffset: 0,
        byteLength: bytes.byteLength,
      }],
    }],
  });
}

function streamedResponse(chunks, options = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  }), {
    status: options.status ?? 200,
    headers: {
      'content-length': String(chunks.reduce((total, chunk) => total + chunk.length, 0)),
      'content-type': 'application/octet-stream',
    },
  });
}

const bytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const manifest = manifestFor(bytes);
const cached = new Map();
const cacheCalls = [];
const cache = {
  cacheId: 'test-persistent-cache',
  async get(key) {
    cacheCalls.push({ operation: 'get', key });
    const value = cached.get(key);
    return value == null ? null : value.slice(0);
  },
  async put(key, ownedBuffer) {
    cacheCalls.push({ operation: 'put', key, byteLength: ownedBuffer.byteLength });
    cached.set(key, ownedBuffer.slice(0));
  },
  async delete(key) {
    cacheCalls.push({ operation: 'delete', key });
    return cached.delete(key);
  },
};

let fetchCount = 0;
const fetch = async requested => {
  fetchCount += 1;
  assert.equal(String(requested), 'https://models.example/acme.bin');
  return streamedResponse([bytes.subarray(0, 5), bytes.subarray(5, 11), bytes.subarray(11)]);
};
const progress = [];
const cold = await acquireWebGpuModelResourceBundle(manifest, 'https://models.example/acme.bin', {
  cache,
  fetch,
  onProgress(event) { progress.push(event); },
});
assert.equal(cold.report.schema, WEBGPU_MODEL_RESOURCE_SOURCE_REPORT_SCHEMA);
assert.equal(cold.report.status, 'acquired');
assert.equal(cold.report.requestedSource.kind, 'url');
assert.equal(cold.report.effectiveSource.kind, 'response');
assert.equal(cold.report.cache.status, 'miss-stored');
assert.equal(cold.report.cache.cacheId, 'test-persistent-cache');
assert.match(cold.report.cache.key, new RegExp(manifest.bundle.sha256));
assert.equal(cold.report.progress.length, 3);
assert.equal(progress.length, 3);
assert.equal(progress.at(-1).loadedBytes, bytes.byteLength);
assert.equal(cold.bundle.snapshot().status, 'owned');
assert.equal(cold.bundle.verification.status, 'verified');
assert.equal(fetchCount, 1);
cold.bundle.release();

const warm = await acquireWebGpuModelResourceBundle(manifest, 'https://models.example/acme.bin', {
  cache,
  fetch,
});
assert.equal(warm.report.cache.status, 'hit');
assert.equal(warm.report.effectiveSource.kind, 'persistent-cache');
assert.equal(fetchCount, 1, 'cache hit must not fetch the source');
warm.bundle.release();

const cacheKey = warm.report.cache.key;
cached.set(cacheKey, Uint8Array.from({ length: 16 }, () => 0xff).buffer);
const recovered = await acquireWebGpuModelResourceBundle(manifest, 'https://models.example/acme.bin', {
  cache,
  fetch,
});
assert.equal(recovered.report.cache.status, 'rejected-refetched-stored');
assert.equal(recovered.report.cache.rejection.phase, 'cache-verification');
assert.equal(fetchCount, 2);
assert.equal(cacheCalls.some(call => call.operation === 'delete'), true);
recovered.bundle.release();

const directResponse = await acquireWebGpuModelResourceBundle(
  manifest,
  streamedResponse([bytes]),
);
assert.equal(directResponse.report.requestedSource.kind, 'response');
assert.equal(directResponse.report.cache.status, 'not-configured');
directResponse.bundle.release();

const directBlob = await acquireWebGpuModelResourceBundle(
  manifest,
  new Blob([bytes], { type: 'application/octet-stream' }),
);
assert.equal(directBlob.report.requestedSource.kind, 'blob');
assert.equal(directBlob.report.effectiveSource.byteLength, bytes.byteLength);
directBlob.bundle.release();

const transferred = Uint8Array.from(bytes).buffer;
const directBuffer = await acquireWebGpuModelResourceBundle(manifest, transferred, {
  ownership: 'transfer',
});
assert.equal(transferred.byteLength, 0, 'transfer source must detach caller ArrayBuffer custody');
assert.equal(directBuffer.bundle.ownership, 'transfer');
directBuffer.bundle.release();

const cacheFailure = await acquireWebGpuModelResourceBundle(manifest, Uint8Array.from(bytes), {
  cache: {
    cacheId: 'failing-cache',
    async get() { throw new Error('cache database unavailable'); },
    async put() { throw new Error('cache write unavailable'); },
  },
});
assert.equal(cacheFailure.report.cache.status, 'read-failed-write-failed');
assert.match(cacheFailure.report.cache.readFailure.error.message, /database unavailable/);
assert.match(cacheFailure.report.cache.writeFailure.error.message, /write unavailable/);
cacheFailure.bundle.release();

await assert.rejects(
  () => acquireWebGpuModelResourceBundle(
    { ...manifest, schema: 'not-a-model-resource-manifest' },
    Uint8Array.from(bytes),
  ),
  error => {
    assert.match(error.message, /invalid WebGPU model resource manifest/);
    assert.equal(error.report.schema, WEBGPU_MODEL_RESOURCE_SOURCE_REPORT_SCHEMA);
    assert.equal(error.report.failure.phase, 'manifest-validation');
    assert.equal(error.report.requestedSource, null);
    return true;
  },
);

await assert.rejects(
  () => acquireWebGpuModelResourceBundle(manifest, Uint8Array.from(bytes), {
    cache: { cacheId: 'incomplete-cache', async get() { return null; } },
  }),
  error => {
    assert.match(error.message, /get\(\) and put\(\)/);
    assert.equal(error.report.failure.phase, 'cache-validation');
    assert.equal(error.report.cache.cacheId, 'incomplete-cache');
    return true;
  },
);

await assert.rejects(
  () => acquireWebGpuModelResourceBundle(manifest, { bytes }),
  error => {
    assert.match(error.message, /source must be/);
    assert.equal(error.report.failure.phase, 'source-normalization');
    assert.equal(error.report.requestedSource, null);
    return true;
  },
);

await assert.rejects(
  () => acquireWebGpuModelResourceBundle(manifest, 'https://models.example/fail.bin', {
    fetch: async () => { throw new Error('network offline'); },
  }),
  error => {
    assert.match(error.message, /network offline/);
    assert.equal(error.report.schema, WEBGPU_MODEL_RESOURCE_SOURCE_REPORT_SCHEMA);
    assert.equal(error.report.status, 'failed');
    assert.equal(error.report.failure.phase, 'source-fetch');
    assert.equal(error.report.lastTrustworthyProgress, null);
    return true;
  },
);

const controller = new AbortController();
controller.abort('operator-canceled-model-load');
await assert.rejects(
  () => acquireWebGpuModelResourceBundle(manifest, Uint8Array.from(bytes), {
    signal: controller.signal,
  }),
  error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.report.status, 'canceled');
    assert.equal(error.report.failure.phase, 'source-normalization');
    return true;
  },
);

let stalledReaderCanceled = false;
const stalledController = new AbortController();
const stalledResponse = new Response(new ReadableStream({
  pull() { return new Promise(() => {}); },
  cancel() { stalledReaderCanceled = true; },
}));
const stalledAcquisition = acquireWebGpuModelResourceBundle(manifest, stalledResponse, {
  signal: stalledController.signal,
});
await Promise.resolve();
stalledController.abort('cancel-stalled-model-stream');
await assert.rejects(stalledAcquisition, error => {
  assert.equal(error.name, 'AbortError');
  assert.equal(error.report.status, 'canceled');
  assert.equal(error.report.failure.phase, 'source-read');
  return true;
});
assert.equal(stalledReaderCanceled, true);

const cacheReadController = new AbortController();
let markCacheReadStarted;
const cacheReadStarted = new Promise(resolve => { markCacheReadStarted = resolve; });
const stalledCacheRead = acquireWebGpuModelResourceBundle(manifest, Uint8Array.from(bytes), {
  signal: cacheReadController.signal,
  cache: {
    cacheId: 'stalled-read-cache',
    async get() {
      markCacheReadStarted();
      return new Promise(() => {});
    },
    async put() {},
  },
});
await cacheReadStarted;
cacheReadController.abort('cancel-stalled-cache-read');
await assert.rejects(stalledCacheRead, error => {
  assert.equal(error.name, 'AbortError');
  assert.equal(error.report.failure.phase, 'cache-read');
  assert.equal(error.report.cache.status, 'read-incomplete');
  return true;
});

const cacheWriteController = new AbortController();
let markCacheWriteStarted;
const cacheWriteStarted = new Promise(resolve => { markCacheWriteStarted = resolve; });
const stalledCacheWrite = acquireWebGpuModelResourceBundle(manifest, Uint8Array.from(bytes), {
  signal: cacheWriteController.signal,
  cache: {
    cacheId: 'stalled-write-cache',
    async get() { return null; },
    async put() {
      markCacheWriteStarted();
      return new Promise(() => {});
    },
  },
});
await cacheWriteStarted;
cacheWriteController.abort('cancel-stalled-cache-write');
await assert.rejects(stalledCacheWrite, error => {
  assert.equal(error.name, 'AbortError');
  assert.equal(error.report.status, 'canceled');
  assert.equal(error.report.failure.phase, 'cache-write');
  assert.equal(error.report.cache.status, 'miss-write-incomplete');
  return true;
});

const callerOwnedWithCache = Uint8Array.from(bytes).buffer;
let cacheOwnedBuffer;
const cachedCallerOwned = await acquireWebGpuModelResourceBundle(manifest, callerOwnedWithCache, {
  cache: {
    cacheId: 'ownership-cache',
    async get() { return null; },
    async put(key, buffer) { cacheOwnedBuffer = buffer; },
  },
});
new Uint8Array(cacheOwnedBuffer)[0] = 0;
assert.equal(new Uint8Array(callerOwnedWithCache)[0], bytes[0]);
cachedCallerOwned.bundle.release();

await assert.rejects(
  () => acquireWebGpuModelResourceBundle(manifest, Uint8Array.from(bytes), { maxBytes: 8 }),
  error => {
    assert.match(error.message, /uncapped|maxBytes/i);
    assert.equal(error.report.failure.phase, 'option-validation');
    return true;
  },
);
assert.equal(Object.isFrozen(cold.report), true);
assert.equal(Object.isFrozen(cold.report.progress), true);

console.log('model resource source contracts passed');
