import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
  createWebGpuInferenceSession,
  defineWebGpuModelResourceManifest,
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

function manifestFor(bytes) {
  return defineWebGpuModelResourceManifest({
    modelId: 'acme/integrated-browser-model',
    revision: 'revision-a',
    bundle: {
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
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

function deviceFixture(options = {}) {
  const buffers = [];
  const writes = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, data, dataOffset = 0, size = data.byteLength - dataOffset) {
        writes.push({ buffer, offset, bytes: Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset + dataOffset, size)) });
      },
    },
    features: new Set(),
    limits: {},
    lost: new Promise(() => {}),
    createBuffer(descriptor) {
      if (options.createBufferError) throw options.createBufferError;
      const buffer = {
        descriptor,
        destroyCount: 0,
        destroy() { this.destroyCount += 1; },
      };
      buffers.push(buffer);
      return buffer;
    },
  };
  return { device, buffers, writes };
}

function responseFor(bytes) {
  return new Response(bytes, {
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'application/octet-stream',
    },
  });
}

const bytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const manifest = manifestFor(bytes);
const fixture = deviceFixture();
const session = await createWebGpuInferenceSession({
  sessionId: 'integrated-model-source-session',
  device: fixture.device,
  adapterName: 'fixture-adapter',
});
const sharp = await session.registerRoute({ routeId: 'sharp.image-to-splat.webgpu-local.v0' });
const sf3d = await session.registerRoute({ routeId: 'sf3d.image-to-mesh.webgpu-local.v0' });
assert.equal(typeof sharp.loadModelResourcesFromSource, 'function');

const cached = new Map();
const cache = {
  cacheId: 'integrated-test-cache',
  async get(key) { return cached.get(key)?.slice(0) || null; },
  async put(key, buffer) { cached.set(key, buffer.slice(0)); },
};
let fetchCount = 0;
const fetch = async () => {
  fetchCount += 1;
  return responseFor(bytes);
};

const sharpModel = await sharp.loadModelResourcesFromSource({
  manifest,
  source: 'https://models.example/integrated.bin',
  cache,
  fetch,
});
assert.equal(sharpModel.schema, WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA);
assert.equal(sharpModel.routeId, sharp.routeId);
assert.equal(sharpModel.acquisitionReport.status, 'acquired');
assert.equal(sharpModel.acquisitionReport.cache.status, 'miss-stored');
assert.equal(sharpModel.allocations.length, 1);
assert.equal(fixture.buffers.length, 1);

const sf3dModel = await sf3d.loadModelResourcesFromSource({
  manifest,
  source: 'https://models.example/integrated.bin',
  cache,
  fetch,
});
assert.equal(sf3dModel.acquisitionReport.cache.status, 'hit');
assert.equal(fetchCount, 1);
assert.equal(fixture.buffers.length, 1, 'semantic residency must reuse the uploaded GPU allocation');
assert.equal(sharpModel.allocations[0].buffer, sf3dModel.allocations[0].buffer);
assert.equal(sharpModel.release().status, 'released');
assert.equal(sf3dModel.release().status, 'released');
session.unregisterRoute(sharp.routeId);
session.unregisterRoute(sf3d.routeId);
session.close();

const failedFixture = deviceFixture({ createBufferError: new Error('GPU allocation failed') });
const failedSession = await createWebGpuInferenceSession({
  sessionId: 'integrated-model-source-failure',
  device: failedFixture.device,
  adapterName: 'fixture-adapter',
});
const failedRoute = await failedSession.registerRoute({ routeId: 'failure-route' });
await assert.rejects(
  () => failedRoute.loadModelResourcesFromSource({ manifest, source: Uint8Array.from(bytes) }),
  error => {
    assert.match(error.message, /GPU allocation failed/);
    assert.equal(error.acquisitionReport.status, 'acquired');
    assert.equal(failedSession.residency.hasActiveLeases(failedRoute.routeId), false);
    return true;
  },
);
const corruptBytes = Uint8Array.from(bytes);
corruptBytes[0] ^= 0xff;
await assert.rejects(
  () => failedRoute.loadModelResourcesFromSource({ manifest, source: corruptBytes }),
  error => {
    assert.equal(error.acquisitionReport.status, 'failed');
    assert.equal(error.acquisitionReport.failure.phase, 'source-verification');
    assert.match(error.message, /sha-256|digest/i);
    return true;
  },
);
failedSession.unregisterRoute(failedRoute.routeId);
failedSession.close();

const detachedFixture = deviceFixture();
const detachedSession = await createWebGpuInferenceSession({
  sessionId: 'integrated-model-source-detach',
  device: detachedFixture.device,
  adapterName: 'fixture-adapter',
});
const detachedRoute = await detachedSession.registerRoute({ routeId: 'detached-route' });
const fetchStarted = deferred();
const fetchRelease = deferred();
const detachedLoad = detachedRoute.loadModelResourcesFromSource({
  manifest,
  source: 'https://models.example/detached.bin',
  async fetch() {
    fetchStarted.resolve();
    await fetchRelease.promise;
    return responseFor(bytes);
  },
});
await fetchStarted.promise;
detachedSession.unregisterRoute(detachedRoute.routeId);
fetchRelease.resolve();
await assert.rejects(detachedLoad, /detached|unregistered/i);
assert.equal(detachedFixture.buffers.length, 0, 'detached route must not upload after source acquisition settles');
detachedSession.close();

console.log('model resource route loading contracts passed');
