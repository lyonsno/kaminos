import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA,
  WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA,
  createWebGpuInferenceSession,
  defineWebGpuModelResourceManifest,
  defineWebGpuModelResourcePackage,
  validateWebGpuModelResourcePackage,
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

async function waitFor(predicate) {
  while (!predicate()) await new Promise(resolve => setImmediate(resolve));
}

function childManifest(resourceId, tensorName, bytes) {
  return defineWebGpuModelResourceManifest({
    modelId: 'acme/large-browser-model',
    revision: 'revision-a',
    bundle: {
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    allocations: [{
      allocationId: resourceId,
      byteOffset: 0,
      byteLength: bytes.byteLength,
      usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      tensors: [{
        name: tensorName,
        dtype: 'u32',
        shape: [bytes.byteLength / 4],
        byteOffset: 0,
        byteLength: bytes.byteLength,
      }],
    }],
  });
}

function deviceFixture() {
  const buffers = [];
  const device = {
    queue: { writeBuffer() {} },
    features: new Set(),
    limits: {},
    lost: new Promise(() => {}),
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyCount: 0,
        destroy() { this.destroyCount += 1; },
      };
      buffers.push(buffer);
      return buffer;
    },
  };
  return { device, buffers };
}

function responseFor(bytes) {
  return new Response(bytes, {
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'application/octet-stream',
    },
  });
}

const byteSets = {
  encoder: Uint8Array.from({ length: 8 }, (_, index) => index + 1),
  decoder: Uint8Array.from({ length: 12 }, (_, index) => index + 21),
  head: Uint8Array.from({ length: 16 }, (_, index) => index + 41),
};
const manifests = {
  encoder: childManifest('encoder-weights', 'encoder.weight', byteSets.encoder),
  decoder: childManifest('decoder-weights', 'decoder.weight', byteSets.decoder),
  head: childManifest('head-weights', 'head.weight', byteSets.head),
};
const modelPackage = defineWebGpuModelResourcePackage({
  packageId: 'acme/large-browser-model:browser-f16',
  modelId: 'acme/large-browser-model',
  revision: 'revision-a',
  resources: [
    { resourceId: 'encoder', manifest: manifests.encoder },
    { resourceId: 'decoder', manifest: manifests.decoder },
    { resourceId: 'head', manifest: manifests.head },
  ],
});
assert.equal(modelPackage.schema, WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA);
assert.equal(Object.isFrozen(modelPackage), true);
assert.equal(Object.isFrozen(modelPackage.resources), true);
assert.deepEqual(modelPackage.resourceIds, ['encoder', 'decoder', 'head']);
assert.equal(modelPackage.totalByteLength, 36);
assert.equal(modelPackage.largestResourceByteLength, 16);
assert.equal(validateWebGpuModelResourcePackage(modelPackage).ok, true);
const missingMemoryAuthority = { ...modelPackage };
delete missingMemoryAuthority.largestResourceByteLength;
assert.equal(
  validateWebGpuModelResourcePackage(missingMemoryAuthority).ok,
  false,
  'external packages must carry the same declared memory authority as module-defined packages',
);

assert.throws(
  () => defineWebGpuModelResourcePackage({
    packageId: 'duplicate-tensors',
    modelId: modelPackage.modelId,
    revision: modelPackage.revision,
    resources: [
      { resourceId: 'first', manifest: manifests.encoder },
      { resourceId: 'second', manifest: childManifest('other', 'encoder.weight', byteSets.decoder) },
    ],
  }),
  /duplicate.*tensor|tensor.*unique/i,
);
assert.throws(
  () => defineWebGpuModelResourcePackage({
    packageId: 'wrong-revision',
    modelId: modelPackage.modelId,
    revision: 'revision-b',
    resources: [{ resourceId: 'encoder', manifest: manifests.encoder }],
  }),
  /revision/i,
);
assert.throws(
  () => defineWebGpuModelResourcePackage({
    packageId: 'capped',
    modelId: modelPackage.modelId,
    revision: modelPackage.revision,
    resources: [{ resourceId: 'encoder', manifest: manifests.encoder }],
    maxResources: 1,
  }),
  /uncapped|maxResources/i,
);

const snapshotFixture = deviceFixture();
const snapshotSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-snapshot',
  device: snapshotFixture.device,
  adapterName: 'fixture-adapter',
});
const snapshotRoute = await snapshotSession.registerRoute({ routeId: 'package-snapshot-route' });
const mutablePackage = {
  ...modelPackage,
  resources: modelPackage.resources.map(resource => ({ ...resource })),
  resourceIds: [...modelPackage.resourceIds],
};
const snapshotFetchStarted = deferred();
const snapshotFetchRelease = deferred();
const snapshotSources = {
  encoder: 'https://models.example/snapshot-encoder.bin',
  decoder: 'https://models.example/snapshot-decoder.bin',
  head: 'https://models.example/snapshot-head.bin',
};
const snapshotBytes = new Map([
  [snapshotSources.encoder, byteSets.encoder],
  [snapshotSources.decoder, byteSets.decoder],
  [snapshotSources.head, byteSets.head],
]);
const snapshotLoad = snapshotRoute.loadModelResourcePackageFromSources({
  package: mutablePackage,
  sources: snapshotSources,
  async fetch(url) {
    if (url === snapshotSources.encoder) {
      snapshotFetchStarted.resolve();
      await snapshotFetchRelease.promise;
    }
    return responseFor(snapshotBytes.get(url));
  },
});
await snapshotFetchStarted.promise;
mutablePackage.resources[1].resourceId = 'mutated-after-admission';
snapshotSources.decoder = 'https://models.example/mutated-after-admission.bin';
snapshotFetchRelease.resolve();
const snapshotLease = await snapshotLoad;
assert.deepEqual(snapshotLease.resources.map(resource => resource.resourceId), ['encoder', 'decoder', 'head']);
assert.equal(snapshotLease.release().status, 'released');
snapshotSession.unregisterRoute(snapshotRoute.routeId);
snapshotSession.close();

const fixture = deviceFixture();
const session = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-session',
  device: fixture.device,
  adapterName: 'fixture-adapter',
});
const sharp = await session.registerRoute({ routeId: 'sharp.image-to-splat.webgpu-local.v0' });
const sf3d = await session.registerRoute({ routeId: 'sf3d.image-to-mesh.webgpu-local.v0' });
assert.equal(typeof sharp.loadModelResourcePackageFromSources, 'function');

const sources = Object.freeze({
  encoder: 'https://models.example/encoder.bin',
  decoder: 'https://models.example/decoder.bin',
  head: 'https://models.example/head.bin',
});
const sourceByUrl = new Map([
  [sources.encoder, byteSets.encoder],
  [sources.decoder, byteSets.decoder],
  [sources.head, byteSets.head],
]);
const gates = new Map([...sourceByUrl].map(([url]) => [url, deferred()]));
const fetchStarts = [];
const cacheEntries = new Map();
const cache = {
  cacheId: 'package-cache',
  async get(key) { return cacheEntries.get(key)?.slice(0) || null; },
  async put(key, bytes) { cacheEntries.set(key, bytes.slice(0)); },
};
const loading = sharp.loadModelResourcePackageFromSources({
  package: modelPackage,
  sources,
  cache,
  async fetch(url) {
    fetchStarts.push(url);
    await gates.get(url).promise;
    return responseFor(sourceByUrl.get(url));
  },
});
await waitFor(() => fetchStarts.length === 1);
assert.deepEqual(fetchStarts, [sources.encoder], 'the next package resource must wait for the prior integrated load');
gates.get(sources.encoder).resolve();
await waitFor(() => fetchStarts.length === 2);
assert.deepEqual(fetchStarts, [sources.encoder, sources.decoder]);
gates.get(sources.decoder).resolve();
await waitFor(() => fetchStarts.length === 3);
assert.deepEqual(fetchStarts, [sources.encoder, sources.decoder, sources.head]);
gates.get(sources.head).resolve();
const sharpPackage = await loading;
assert.equal(sharpPackage.schema, WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA);
assert.equal(sharpPackage.routeId, sharp.routeId);
assert.equal(sharpPackage.resources.length, 3);
assert.equal(sharpPackage.allocations.length, 3);
assert.deepEqual(Object.keys(sharpPackage.tensors), ['encoder.weight', 'decoder.weight', 'head.weight']);
assert.equal(sharpPackage.report.status, 'loaded');
assert.equal(sharpPackage.report.resources.length, 3);
assert.equal(sharpPackage.report.sourceMemoryBound.largestResourceByteLength, 16);
assert.equal(sharpPackage.report.sourceMemoryBound.authority, 'sequential-resource-acquisition-declared-byte-length');
assert.equal(fixture.buffers.length, 3);

const sf3dPackage = await sf3d.loadModelResourcePackageFromSources({
  package: modelPackage,
  sources,
  cache,
  async fetch() { throw new Error('cache hit must not fetch'); },
});
assert.equal(sf3dPackage.resources.every(resource => resource.acquisitionReport.cache.status === 'hit'), true);
assert.equal(fixture.buffers.length, 3, 'the second route must reuse all resident package allocations');
assert.equal(sharpPackage.tensors['encoder.weight'].buffer, sf3dPackage.tensors['encoder.weight'].buffer);
assert.equal(sharpPackage.release().status, 'released');
assert.equal(sharpPackage.release().status, 'already-released');
assert.equal(sf3dPackage.release().status, 'released');
session.unregisterRoute(sharp.routeId);
session.unregisterRoute(sf3d.routeId);
session.close();

const failureFixture = deviceFixture();
const failureSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-failure',
  device: failureFixture.device,
  adapterName: 'fixture-adapter',
});
const failureRoute = await failureSession.registerRoute({ routeId: 'package-failure-route' });
const corruptDecoder = Uint8Array.from(byteSets.decoder);
corruptDecoder[0] ^= 0xff;
await assert.rejects(
  () => failureRoute.loadModelResourcePackageFromSources({
    package: modelPackage,
    sources: {
      encoder: byteSets.encoder,
      decoder: corruptDecoder,
      head: byteSets.head,
    },
  }),
  error => {
    assert.equal(error.packageReport.status, 'failed');
    assert.equal(error.packageReport.failedResourceId, 'decoder');
    assert.equal(error.packageReport.resources.length, 1);
    assert.equal(error.packageReport.cleanup.status, 'released');
    assert.equal(failureSession.residency.hasActiveLeases(failureRoute.routeId), false);
    return true;
  },
);
assert.equal(failureFixture.buffers.length, 1, 'failure must stop before later package resources upload');

const buffersBeforeMissingSource = failureFixture.buffers.length;
await assert.rejects(
  () => failureRoute.loadModelResourcePackageFromSources({
    package: modelPackage,
    sources: { encoder: byteSets.encoder, decoder: byteSets.decoder },
  }),
  /missing.*head|head.*source/i,
);
assert.equal(failureFixture.buffers.length, buffersBeforeMissingSource, 'source-set validation must precede GPU work');
assert.equal(failureSession.residency.hasActiveLeases(failureRoute.routeId), false);
failureSession.unregisterRoute(failureRoute.routeId);
failureSession.close();

const cancelFixture = deviceFixture();
const cancelSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-cancel',
  device: cancelFixture.device,
  adapterName: 'fixture-adapter',
});
const cancelRoute = await cancelSession.registerRoute({ routeId: 'package-cancel-route' });
const secondFetchStarted = deferred();
const stalledSecondFetch = deferred();
const cancelController = new AbortController();
const cancelLoad = cancelRoute.loadModelResourcePackageFromSources({
  package: modelPackage,
  sources,
  signal: cancelController.signal,
  async fetch(url) {
    if (url === sources.encoder) return responseFor(byteSets.encoder);
    secondFetchStarted.resolve();
    await stalledSecondFetch.promise;
    return responseFor(sourceByUrl.get(url));
  },
});
await secondFetchStarted.promise;
cancelController.abort('cancel-after-first-package-resource');
await assert.rejects(
  cancelLoad,
  error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.packageReport.status, 'canceled');
    assert.equal(error.packageReport.failedResourceId, 'decoder');
    assert.equal(error.packageReport.cleanup.status, 'released');
    return true;
  },
);
assert.equal(cancelSession.residency.hasActiveLeases(cancelRoute.routeId), false);
cancelSession.unregisterRoute(cancelRoute.routeId);
cancelSession.close();

console.log('model resource package contracts passed');
