import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA,
  WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA,
  createWebGpuInferenceSession,
  createWebGpuPhaseResourceWorkingSet,
  defineWebGpuModelResourceChunkPlan,
  defineWebGpuModelResourceManifest,
  defineWebGpuModelResourcePackage,
  defineWebGpuPhaseResourcePlan,
  loadWebGpuModelResourcePackageFromSources,
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
  const lost = deferred();
  const device = {
    queue: { writeBuffer() {} },
    features: new Set(),
    limits: {},
    lost: lost.promise,
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
  return { device, buffers, lose(info) { lost.resolve(info); } };
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
const legacySourceOnlyPackage = {
  ...modelPackage,
  resources: modelPackage.resources.map(({ loadKind, ...resource }) => resource),
};
delete legacySourceOnlyPackage.largestSourceByteLength;
assert.equal(validateWebGpuModelResourcePackage(legacySourceOnlyPackage).ok, true);
assert.equal(legacySourceOnlyPackage.identity, modelPackage.identity);
assert.equal(defineWebGpuModelResourcePackage(legacySourceOnlyPackage).identity, modelPackage.identity);
const decoderChunkPlan = defineWebGpuModelResourceChunkPlan({
  planId: 'acme/large-browser-model:decoder-chunks',
  manifest: manifests.decoder,
  allocations: [{
    allocationId: 'decoder-weights',
    chunks: [
      {
        chunkId: 'decoder-0',
        byteOffset: 0,
        byteLength: 4,
        sha256: createHash('sha256').update(byteSets.decoder.slice(0, 4)).digest('hex'),
      },
      {
        chunkId: 'decoder-1',
        byteOffset: 4,
        byteLength: 8,
        sha256: createHash('sha256').update(byteSets.decoder.slice(4)).digest('hex'),
      },
    ],
  }],
});
const mixedPackage = defineWebGpuModelResourcePackage({
  packageId: modelPackage.packageId,
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [
    { resourceId: 'encoder', manifest: manifests.encoder },
    { resourceId: 'decoder', chunkPlan: decoderChunkPlan },
  ],
});
assert.deepEqual(mixedPackage.resources.map(resource => resource.loadKind), ['source', 'chunks']);
assert.equal(mixedPackage.resources[1].manifest, manifests.decoder);
assert.equal(mixedPackage.resources[1].chunkPlan.identity, decoderChunkPlan.identity);
assert.notEqual(
  mixedPackage.identity,
  defineWebGpuModelResourcePackage({
    packageId: modelPackage.packageId,
    modelId: modelPackage.modelId,
    revision: modelPackage.revision,
    resources: [
      { resourceId: 'encoder', manifest: manifests.encoder },
      { resourceId: 'decoder', manifest: manifests.decoder },
    ],
  }).identity,
  'package identity must bind whether a child uses whole-source or chunk-plan loading',
);
assert.equal(mixedPackage.largestResourceByteLength, 12);
assert.equal(mixedPackage.largestSourceByteLength, 8);
assert.equal(validateWebGpuModelResourcePackage(mixedPackage).ok, true);
const mismatchedChunkManifestPackage = {
  ...mixedPackage,
  resources: [
    mixedPackage.resources[0],
    { ...mixedPackage.resources[1], manifest: manifests.encoder },
  ],
};
assert.equal(
  validateWebGpuModelResourcePackage(mismatchedChunkManifestPackage).errors.some(
    error => /exact normalized chunkPlan\.manifest/.test(error),
  ),
  true,
);
const divergentDecoderManifest = defineWebGpuModelResourceManifest({
  modelId: manifests.decoder.modelId,
  revision: manifests.decoder.revision,
  bundle: {
    byteLength: 1_000,
    sha256: manifests.decoder.bundle.sha256,
  },
  resourceSharing: manifests.decoder.resourceSharing,
  metadata: manifests.decoder.metadata,
  allocations: manifests.decoder.allocations.map(allocation => ({
    allocationId: allocation.allocationId,
    byteOffset: allocation.byteOffset,
    byteLength: allocation.byteLength,
    usage: allocation.usage,
    metadata: allocation.metadata,
    tensors: allocation.tensors.map(tensor => ({
      name: tensor.name,
      dtype: tensor.dtype,
      shape: tensor.shape,
      byteOffset: tensor.byteOffset,
      byteLength: tensor.byteLength,
      metadata: tensor.metadata,
    })),
  })),
});
assert.equal(divergentDecoderManifest.identity, manifests.decoder.identity);
assert.equal(
  divergentDecoderManifest.allocations[0].semanticResourceId,
  manifests.decoder.allocations[0].semanticResourceId,
  'the falsifier must preserve the partial manifest identity projection used by the R1 candidate',
);
const forgedSameIdentityPackage = {
  ...mixedPackage,
  resources: [
    mixedPackage.resources[0],
    { ...mixedPackage.resources[1], manifest: divergentDecoderManifest },
  ],
  totalByteLength: byteSets.encoder.byteLength + divergentDecoderManifest.bundle.byteLength,
  largestResourceByteLength: divergentDecoderManifest.bundle.byteLength,
};
const forgedSameIdentityValidation = validateWebGpuModelResourcePackage(forgedSameIdentityPackage);
assert.equal(forgedSameIdentityValidation.ok, false);
assert.equal(
  forgedSameIdentityValidation.errors.some(error => /exact normalized chunkPlan\.manifest/.test(error)),
  true,
);
assert.throws(
  () => defineWebGpuModelResourcePackage({
    packageId: mixedPackage.packageId,
    modelId: mixedPackage.modelId,
    revision: mixedPackage.revision,
    resources: [
      { resourceId: 'encoder', manifest: manifests.encoder },
      { resourceId: 'decoder', manifest: divergentDecoderManifest, chunkPlan: decoderChunkPlan },
    ],
  }),
  /exact normalized chunkPlan\.manifest/,
);
await assert.rejects(
  () => loadWebGpuModelResourcePackageFromSources({
    package: mixedPackage,
    route: {
      routeId: 'source-only-route-surface',
      loadModelResourcesFromSource() {},
    },
    sources: {
      encoder: new Blob([byteSets.encoder]),
      decoder: {
        'decoder-0': new Blob([byteSets.decoder.slice(0, 4)]),
        'decoder-1': new Blob([byteSets.decoder.slice(4)]),
      },
    },
  }),
  /chunk-backed.*loadModelResourceChunksFromSources/i,
);
const chunkOnlyPackage = defineWebGpuModelResourcePackage({
  packageId: 'acme/large-browser-model:chunk-only',
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [{ resourceId: 'decoder', chunkPlan: decoderChunkPlan }],
});
await assert.rejects(
  () => loadWebGpuModelResourcePackageFromSources({
    package: chunkOnlyPackage,
    route: {
      routeId: 'chunk-only-route-surface',
      loadModelResourceChunksFromSources() {
        throw new Error('chunk-only-loader-invoked');
      },
    },
    sources: {
      decoder: {
        'decoder-0': new Blob([byteSets.decoder.slice(0, 4)]),
        'decoder-1': new Blob([byteSets.decoder.slice(4)]),
      },
    },
  }),
  /chunk-only-loader-invoked/,
);
const singleChunkDecoderPlan = defineWebGpuModelResourceChunkPlan({
  planId: 'acme/large-browser-model:decoder-single-chunk',
  manifest: manifests.decoder,
  allocations: [{
    allocationId: 'decoder-weights',
    chunks: [{
      chunkId: 'decoder-single',
      byteOffset: 0,
      byteLength: byteSets.decoder.byteLength,
      sha256: createHash('sha256').update(byteSets.decoder).digest('hex'),
    }],
  }],
});
const mutableChunkPackage = defineWebGpuModelResourcePackage({
  packageId: 'acme/large-browser-model:mutable-chunk-snapshot',
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [
    { resourceId: 'encoder', manifest: manifests.encoder },
    { resourceId: 'decoder', chunkPlan: singleChunkDecoderPlan },
  ],
});
const semanticallyDistinctManifest = childManifest(
  'encoder-weights',
  'encoder.projection.weight',
  byteSets.encoder,
);
const semanticallyDistinctPackage = defineWebGpuModelResourcePackage({
  packageId: modelPackage.packageId,
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [{ resourceId: 'encoder', manifest: semanticallyDistinctManifest }],
});
const semanticBaselinePackage = defineWebGpuModelResourcePackage({
  packageId: modelPackage.packageId,
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [{ resourceId: 'encoder', manifest: manifests.encoder }],
});
assert.notEqual(
  semanticallyDistinctPackage.identity,
  semanticBaselinePackage.identity,
  'package identity must bind normalized child allocation and tensor semantics',
);
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
const snapshotFetchOptions = { headers: { authorization: 'one-shot-admitted' } };
const observedSnapshotAuthorizations = [];
const snapshotBytes = new Map([
  [snapshotSources.encoder, byteSets.encoder],
  [snapshotSources.decoder, byteSets.decoder],
  [snapshotSources.head, byteSets.head],
]);
const snapshotLoad = snapshotRoute.loadModelResourcePackageFromSources({
  package: mutablePackage,
  sources: snapshotSources,
  fetchOptions: snapshotFetchOptions,
  async fetch(url, options) {
    if (url === snapshotSources.encoder) {
      snapshotFetchStarted.resolve();
      await snapshotFetchRelease.promise;
    }
    observedSnapshotAuthorizations.push(new Headers(options.headers).get('authorization'));
    return responseFor(snapshotBytes.get(url));
  },
});
await snapshotFetchStarted.promise;
mutablePackage.resources[1].resourceId = 'mutated-after-admission';
snapshotSources.decoder = 'https://models.example/mutated-after-admission.bin';
snapshotFetchOptions.headers.authorization = 'one-shot-mutated-after-admission';
snapshotFetchRelease.resolve();
const snapshotLease = await snapshotLoad;
assert.deepEqual(snapshotLease.resources.map(resource => resource.resourceId), ['encoder', 'decoder', 'head']);
assert.deepEqual(
  observedSnapshotAuthorizations,
  ['one-shot-admitted', 'one-shot-admitted', 'one-shot-admitted'],
  'one-shot ordinary children must use request options captured at package admission',
);
assert.equal(snapshotLease.release().status, 'released');
const mutableChunkFetchStarted = deferred();
const mutableChunkFetchRelease = deferred();
const mutableDecoderChunk = Uint8Array.from(byteSets.decoder);
const mutableChunkLoad = snapshotRoute.loadModelResourcePackageFromSources({
  package: mutableChunkPackage,
  sources: {
    encoder: 'https://models.example/mutable-chunk-encoder.bin',
    decoder: { 'decoder-single': mutableDecoderChunk },
  },
  async fetch() {
    mutableChunkFetchStarted.resolve();
    await mutableChunkFetchRelease.promise;
    return responseFor(byteSets.encoder);
  },
});
await mutableChunkFetchStarted.promise;
mutableDecoderChunk.fill(0xff);
mutableChunkFetchRelease.resolve();
const mutableChunkLease = await mutableChunkLoad;
assert.equal(mutableChunkLease.resources[1].chunkReport.status, 'loaded');
assert.equal(mutableChunkLease.release().status, 'released');

const oneShotChunkFetchStarted = deferred();
const oneShotChunkFetchRelease = deferred();
const oneShotChunkFetchOptions = {
  headers: new Headers({ authorization: 'one-shot-chunk-admitted' }),
};
const observedOneShotChunkAuthorizations = [];
const oneShotChunkSources = {
  encoder: 'https://models.example/one-shot-chunk-encoder.bin',
  decoder: {
    'decoder-0': 'https://models.example/one-shot-decoder-0.bin',
    'decoder-1': 'https://models.example/one-shot-decoder-1.bin',
  },
};
const oneShotChunkLoad = snapshotRoute.loadModelResourcePackageFromSources({
  package: mixedPackage,
  sources: oneShotChunkSources,
  fetchOptions: oneShotChunkFetchOptions,
  async fetch(url, options) {
    if (url === oneShotChunkSources.encoder) {
      oneShotChunkFetchStarted.resolve();
      await oneShotChunkFetchRelease.promise;
    }
    observedOneShotChunkAuthorizations.push(
      new Headers(options.headers).get('authorization'),
    );
    if (url === oneShotChunkSources.encoder) return responseFor(byteSets.encoder);
    if (url === oneShotChunkSources.decoder['decoder-0']) {
      options.headers.authorization = 'one-shot-mutated-by-first-chunk-fetch';
      return responseFor(byteSets.decoder.slice(0, 4));
    }
    return responseFor(byteSets.decoder.slice(4));
  },
});
await oneShotChunkFetchStarted.promise;
oneShotChunkFetchOptions.headers.set('authorization', 'one-shot-chunk-mutated-after-admission');
oneShotChunkFetchRelease.resolve();
const oneShotChunkLease = await oneShotChunkLoad;
assert.equal(oneShotChunkLease.release().status, 'released');
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
assert.equal(
  sharpPackage.report.sourceMemoryBound.residual,
  'one-resource-source-acquisition-may-retain-multiple-host-representations',
);
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

const mixedFixture = deviceFixture();
const mixedSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-mixed-package-session',
  device: mixedFixture.device,
  adapterName: 'fixture-adapter',
});
const mixedRoute = await mixedSession.registerRoute({ routeId: 'mixed-package-route' });
const mixedSources = {
  encoder: new Blob([byteSets.encoder]),
  decoder: {
    'decoder-0': new Blob([byteSets.decoder.slice(0, 4)]),
    'decoder-1': new Blob([byteSets.decoder.slice(4)]),
  },
};
const mixedLease = await mixedRoute.loadModelResourcePackageFromSources({
  package: mixedPackage,
  sources: mixedSources,
});
assert.deepEqual(mixedLease.resources.map(resource => resource.loadKind), ['source', 'chunks']);
assert.equal(mixedLease.resources[0].acquisitionReport != null, true);
assert.equal(mixedLease.resources[0].chunkReport, null);
assert.equal(mixedLease.resources[1].acquisitionReport, null);
assert.equal(mixedLease.resources[1].chunkReport.status, 'loaded');
assert.equal(mixedLease.resources[1].authorityReport, mixedLease.resources[1].chunkReport);
assert.deepEqual(Object.keys(mixedLease.tensors), ['encoder.weight', 'decoder.weight']);
assert.equal(mixedLease.report.sourceMemoryBound.largestResourceByteLength, 12);
assert.equal(mixedLease.report.sourceMemoryBound.largestSourceByteLength, 8);
assert.equal(
  mixedLease.report.sourceMemoryBound.authority,
  'sequential-package-child-acquisition-declared-source-unit',
);
assert.equal(mixedFixture.buffers.length, 2);
const mixedReuseRoute = await mixedSession.registerRoute({ routeId: 'mixed-package-reuse-route' });
const mixedReuseLease = await mixedReuseRoute.loadModelResourcePackageFromSources({
  package: mixedPackage,
  sources: mixedSources,
});
assert.equal(mixedFixture.buffers.length, 2, 'mixed packages must reuse ordinary and chunk-backed resident allocations');
assert.equal(mixedReuseLease.tensors['encoder.weight'].buffer, mixedLease.tensors['encoder.weight'].buffer);
assert.equal(mixedReuseLease.tensors['decoder.weight'].buffer, mixedLease.tensors['decoder.weight'].buffer);
assert.equal(
  mixedReuseLease.resources[1].chunkReport.allocations[0].provenance,
  mixedLease.resources[1].chunkReport.allocations[0].provenance,
  'mixed package reuse must preserve the creator chunk verification provenance',
);
assert.equal(mixedReuseLease.release().status, 'released');
assert.equal(mixedLease.release().status, 'released');
mixedSession.unregisterRoute(mixedReuseRoute.routeId);
mixedSession.unregisterRoute(mixedRoute.routeId);
mixedSession.close();

const mixedFailureFixture = deviceFixture();
const mixedFailureSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-mixed-package-failure',
  device: mixedFailureFixture.device,
  adapterName: 'fixture-adapter',
});
const mixedFailureRoute = await mixedFailureSession.registerRoute({ routeId: 'mixed-package-failure-route' });
const mixedFailureJoinedRoute = await mixedFailureSession.registerRoute({
  routeId: 'mixed-package-failure-joined-route',
});
await assert.rejects(
  () => mixedFailureRoute.loadModelResourcePackageFromSources({
    package: mixedPackage,
    sources: {
      encoder: new Blob([byteSets.encoder]),
      decoder: {
        'decoder-0': new Blob([byteSets.decoder.slice(0, 4)]),
        'decoder-1': {},
      },
    },
  }),
  /source.*URL|Request|Response|Blob|ArrayBuffer|typed array/i,
);
assert.equal(
  mixedFailureFixture.buffers.length,
  0,
  'every nested chunk source must be preflighted before an earlier package child allocates',
);
const corruptDecoderChunk = Uint8Array.from(byteSets.decoder.slice(4));
corruptDecoderChunk[0] ^= 0xff;
await assert.rejects(
  () => mixedFailureRoute.loadModelResourcePackageFromSources({
    package: mixedPackage,
    sources: {
      encoder: new Blob([byteSets.encoder]),
      decoder: {
        'decoder-0': new Blob([byteSets.decoder.slice(0, 4)]),
        'decoder-1': new Blob([corruptDecoderChunk]),
      },
    },
  }),
  error => {
    assert.equal(error.packageReport.failedResourceId, 'decoder');
    assert.equal(error.packageReport.failure.acquisitionReport, null);
    assert.equal(error.packageReport.failure.chunkReport.failedChunkId, 'decoder-1');
    assert.equal(error.packageReport.failure.authorityReport, error.packageReport.failure.chunkReport);
    assert.deepEqual(error.packageReport.resources.map(resource => resource.loadKind), ['source']);
    assert.equal(
      error.packageReport.resources[0].authorityReport,
      error.packageReport.resources[0].acquisitionReport,
    );
    assert.equal(error.packageReport.cleanup.status, 'released');
    return true;
  },
);
assert.equal(mixedFailureSession.residency.hasActiveLeases(mixedFailureRoute.routeId), false);
const joinedCorruptSources = {
  encoder: new Blob([byteSets.encoder]),
  decoder: {
    'decoder-0': new Blob([byteSets.decoder.slice(0, 4)]),
    'decoder-1': new Blob([corruptDecoderChunk]),
  },
};
const joinedMixedFailures = await Promise.allSettled([
  mixedFailureRoute.loadModelResourcePackageFromSources({
    package: mixedPackage,
    sources: joinedCorruptSources,
  }),
  mixedFailureJoinedRoute.loadModelResourcePackageFromSources({
    package: mixedPackage,
    sources: joinedCorruptSources,
  }),
]);
assert.deepEqual(joinedMixedFailures.map(result => result.status), ['rejected', 'rejected']);
assert.deepEqual(
  joinedMixedFailures.map(result => result.reason.packageReport.routeId),
  [mixedFailureRoute.routeId, mixedFailureJoinedRoute.routeId],
  'shared child failure must produce caller-specific package reports',
);
assert.deepEqual(
  joinedMixedFailures.map(result => result.reason.packageReport.failure.chunkReport.failedChunkId),
  ['decoder-1', 'decoder-1'],
);
assert.deepEqual(
  joinedMixedFailures.map(result => result.reason.packageReport.failure.chunkReport.routeId),
  [mixedFailureRoute.routeId, mixedFailureJoinedRoute.routeId],
  'shared creator chunk evidence must retain each package caller route identity',
);
assert.equal(mixedFailureSession.residency.hasActiveLeases(mixedFailureJoinedRoute.routeId), false);
mixedFailureSession.unregisterRoute(mixedFailureJoinedRoute.routeId);
mixedFailureSession.unregisterRoute(mixedFailureRoute.routeId);
mixedFailureSession.close();

const failureFixture = deviceFixture();
const failureSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-failure',
  device: failureFixture.device,
  adapterName: 'fixture-adapter',
});
const failureRoute = await failureSession.registerRoute({ routeId: 'package-failure-route' });
const buffersBeforeMalformedSource = failureFixture.buffers.length;
await assert.rejects(
  () => failureRoute.loadModelResourcePackageFromSources({
    package: modelPackage,
    sources: {
      encoder: new Blob([byteSets.encoder]),
      decoder: {},
      head: new Blob([byteSets.head]),
    },
  }),
  /source.*URL|Request|Response|Blob|ArrayBuffer|typed array/i,
);
assert.equal(
  failureFixture.buffers.length,
  buffersBeforeMalformedSource,
  'every package source shape must be validated before the first GPU allocation',
);
assert.equal(failureSession.residency.hasActiveLeases(failureRoute.routeId), false);

const buffersBeforeMutableSources = failureFixture.buffers.length;
await assert.rejects(
  () => failureRoute.loadModelResourcePackageFromSources({
    package: modelPackage,
    sources: {
      encoder: byteSets.encoder,
      decoder: byteSets.decoder,
      head: byteSets.head,
    },
  }),
  /multi-resource.*mutable|mutable.*Blob|immutable.*Blob/i,
);
assert.equal(
  failureFixture.buffers.length,
  buffersBeforeMutableSources,
  'mutable package bytes must be rejected before the first GPU allocation',
);

const corruptDecoder = Uint8Array.from(byteSets.decoder);
corruptDecoder[0] ^= 0xff;
await assert.rejects(
  () => failureRoute.loadModelResourcePackageFromSources({
    package: modelPackage,
    sources: {
      encoder: new Blob([byteSets.encoder]),
      decoder: new Blob([corruptDecoder]),
      head: new Blob([byteSets.head]),
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

const singleResourcePackage = defineWebGpuModelResourcePackage({
  packageId: 'acme/large-browser-model:single-resource',
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [{ resourceId: 'encoder', manifest: manifests.encoder }],
});
const singleResourceLease = await failureRoute.loadModelResourcePackageFromSources({
  package: singleResourcePackage,
  sources: { encoder: byteSets.encoder },
});
assert.equal(singleResourceLease.resources.length, 1);
assert.equal(singleResourceLease.release().status, 'released');

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

const childLoaderFixture = deviceFixture();
const childLoaderSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-child-loader',
  device: childLoaderFixture.device,
  adapterName: 'fixture-adapter',
});
const childLoaderRoute = await childLoaderSession.registerRoute({
  routeId: 'package-child-loader-route',
});
assert.equal(
  typeof childLoaderRoute.createModelResourcePackageLoader,
  'function',
  'a registered route must expose package admission with independent child acquisition',
);

const admittedChunkBytes = Uint8Array.from(byteSets.decoder);
const admittedSources = {
  encoder: 'https://models.example/admitted-encoder.bin',
  decoder: { 'decoder-single': admittedChunkBytes },
};
const fetchedChildUrls = [];
const observedChildAuthorizations = [];
const observedCustomFetchPairs = [];
const admittedFetchOptions = {
  headers: { authorization: 'ordinary-admitted' },
  custom: { routing: 'admitted' },
};
const childLoader = childLoaderRoute.createModelResourcePackageLoader({
  loaderId: 'phase-package-loader',
  package: mutableChunkPackage,
  sources: admittedSources,
  fetchOptions: admittedFetchOptions,
  async fetch(url, options) {
    fetchedChildUrls.push(String(url));
    observedChildAuthorizations.push(new Headers(options.headers).get('authorization'));
    observedCustomFetchPairs.push(options.custom.routing);
    return responseFor(byteSets.encoder);
  },
});
assert.equal(childLoader.schema, 'kaminos.webgpu-model-resource-package-loader.v0');
assert.equal(Object.isFrozen(childLoader), true);
assert.equal(childLoader.packageIdentity, mutableChunkPackage.identity);
assert.deepEqual(childLoader.resourceIds, ['encoder', 'decoder']);
assert.equal(childLoader.snapshot().status, 'active');
assert.equal(childLoader.snapshot().activeLeaseCount, 0);
assert.equal(childLoaderFixture.buffers.length, 0, 'package admission must not allocate GPU resources');

admittedSources.encoder = 'https://models.example/redirected-after-admission.bin';
admittedChunkBytes.fill(0xff);
admittedFetchOptions.headers.authorization = 'ordinary-mutated-after-admission';
admittedFetchOptions.custom.routing = 'custom-mutated-after-admission';
await assert.rejects(
  () => childLoader.acquireResource({ resourceId: 'missing' }),
  /unknown.*package resource|package resource.*missing/i,
);
assert.equal(childLoaderFixture.buffers.length, 0, 'unknown child lookup must fail before GPU work');

const decoderChild = await childLoader.acquireResource({
  resource: { resourceId: 'decoder' },
  phaseId: 'decode',
  purpose: 'required',
});
assert.equal(decoderChild.schema, 'kaminos.webgpu-model-resource-package-child-lease.v0');
assert.equal(decoderChild.resourceId, 'decoder');
assert.equal(decoderChild.loadKind, 'chunks');
assert.equal(decoderChild.report.status, 'loaded');
assert.equal(decoderChild.report.packageIdentity, mutableChunkPackage.identity);
assert.equal(decoderChild.report.phaseId, 'decode');
assert.equal(decoderChild.report.purpose, 'required');
assert.equal(decoderChild.authorityReport, decoderChild.chunkReport);
assert.deepEqual(fetchedChildUrls, [], 'chunk-only acquisition must not fetch an unrelated ordinary child');
assert.equal(childLoaderFixture.buffers.length, 1);
assert.equal(childLoader.snapshot().activeLeaseCount, 1);
assert.deepEqual(childLoader.snapshot().activeResourceIds, ['decoder']);

const encoderChild = await childLoader.acquireResource({ resourceId: 'encoder' });
assert.equal(encoderChild.resourceId, 'encoder');
assert.equal(encoderChild.loadKind, 'source');
assert.equal(encoderChild.authorityReport, encoderChild.acquisitionReport);
assert.deepEqual(
  fetchedChildUrls,
  ['https://models.example/admitted-encoder.bin'],
  'ordinary child acquisition must use the source captured at admission',
);
assert.deepEqual(
  observedChildAuthorizations,
  ['ordinary-admitted'],
  'ordinary child fetch must use nested request options captured at admission',
);
assert.deepEqual(observedCustomFetchPairs, ['admitted']);
assert.equal(childLoaderFixture.buffers.length, 2);
const decoderChildRelease = decoderChild.release();
assert.equal(decoderChildRelease.schema, 'kaminos.webgpu-model-resource-package-child-lease.v0');
assert.equal(decoderChildRelease.status, 'released');
assert.equal(decoderChild.release().status, 'already-released');
const encoderChildRelease = encoderChild.release();
assert.equal(encoderChildRelease.schema, 'kaminos.webgpu-model-resource-package-child-lease.v0');
assert.equal(encoderChildRelease.status, 'released');
assert.equal(encoderChildRelease.underlyingRelease.status, 'released');
assert.equal(childLoader.snapshot().activeLeaseCount, 0);

const residentEncoderChild = await childLoader.acquireResource({ resourceId: 'encoder' });
assert.equal(residentEncoderChild.report.loadPath, 'resident');
assert.equal(
  residentEncoderChild.authorityReport.schema,
  'kaminos.webgpu-model-resource-resident-reuse.v0',
);
assert.equal(residentEncoderChild.acquisitionReport, null);
assert.deepEqual(
  fetchedChildUrls,
  ['https://models.example/admitted-encoder.bin'],
  'direct resident reacquisition must not fetch source bytes',
);
assert.equal(residentEncoderChild.release().status, 'released');

const childPlan = defineWebGpuPhaseResourcePlan({
  planId: 'package-child-phase-plan',
  resources: [
    { resourceId: 'encoder', declaredBytes: manifests.encoder.bundle.byteLength },
    { resourceId: 'decoder', declaredBytes: manifests.decoder.bundle.byteLength },
  ],
  phases: [
    { phaseId: 'encode', requiredResourceIds: ['encoder'], prefetchResourceIds: ['decoder'] },
    { phaseId: 'decode', requiredResourceIds: ['decoder'] },
  ],
});
const childWorkingSet = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'package-child-working-set',
  plan: childPlan,
  acquireResource: childLoader.acquireResource,
});
const fetchedBeforeResidentReacquire = [...fetchedChildUrls];
const childEncode = await childWorkingSet.transitionToPhase('encode');
assert.deepEqual(childEncode.acquiredResourceIds, ['encoder', 'decoder']);
assert.deepEqual(
  fetchedChildUrls,
  fetchedBeforeResidentReacquire,
  'phase reacquisition must not refetch an ordinary child while every allocation remains resident',
);
assert.equal(childLoader.snapshot().activeLeaseCount, 2);
const childDecode = await childWorkingSet.transitionToPhase('decode');
assert.deepEqual(childDecode.releasedResourceIds, ['encoder']);
assert.deepEqual(childLoader.snapshot().activeResourceIds, ['decoder']);
assert.equal(childWorkingSet.close().status, 'closed');
assert.equal(childLoader.snapshot().activeLeaseCount, 0);

assert.equal(
  childLoaderSession.residency.evict(manifests.encoder.allocations[0].resourceId).status,
  'evicted',
);
const fetchCountBeforeEvictedFallback = fetchedChildUrls.length;
const custodyAfterClose = await childLoader.acquireResource({ resourceId: 'encoder' });
assert.equal(custodyAfterClose.report.loadPath, 'source');
assert.equal(
  fetchedChildUrls.length,
  fetchCountBeforeEvictedFallback + 1,
  'evicted ordinary children must fall back to the admitted authenticated source',
);
const loaderClose = childLoader.close();
assert.equal(loaderClose.status, 'closed-with-active-leases');
assert.equal(loaderClose.activeLeaseCount, 1);
await assert.rejects(
  () => childLoader.acquireResource({ resourceId: 'decoder' }),
  /package resource loader is closed/i,
);
assert.equal(custodyAfterClose.release().status, 'released', 'closing admission must not steal child lease custody');
assert.equal(childLoader.snapshot().activeLeaseCount, 0);
assert.equal(childLoader.close().status, 'already-closed');

assert.throws(
  () => childLoaderRoute.createModelResourcePackageLoader({
    loaderId: 'missing-source-loader',
    package: mutableChunkPackage,
    sources: { encoder: new Blob([byteSets.encoder]) },
  }),
  /missing.*decoder|decoder.*source/i,
);
assert.throws(
  () => childLoaderRoute.createModelResourcePackageLoader({
    loaderId: 'capped-child-loader',
    package: mutableChunkPackage,
    sources: {
      encoder: new Blob([byteSets.encoder]),
      decoder: { 'decoder-single': new Blob([byteSets.decoder]) },
    },
    maxActiveResources: 1,
  }),
  /uncapped|maxActiveResources/i,
);
const accessorFetchOptions = {};
Object.defineProperty(accessorFetchOptions, 'headers', {
  enumerable: true,
  get() { return { authorization: 'accessor-must-not-run-later' }; },
});
assert.throws(
  () => childLoaderRoute.createModelResourcePackageLoader({
    loaderId: 'accessor-fetch-options-loader',
    package: singleResourcePackage,
    sources: { encoder: new Blob([byteSets.encoder]) },
    fetchOptions: accessorFetchOptions,
  }),
  /fetchOptions.*data propert|enumerable data propert/i,
);
assert.throws(
  () => childLoaderRoute.createModelResourcePackageLoader({
    loaderId: 'signal-fetch-options-loader',
    package: singleResourcePackage,
    sources: { encoder: new Blob([byteSets.encoder]) },
    fetchOptions: { signal: new AbortController().signal },
  }),
  /fetchOptions\.signal.*acquireResource|invocation signal/i,
);
childLoaderSession.unregisterRoute(childLoaderRoute.routeId);
childLoaderSession.close();

const chunkFetchOptionsFixture = deviceFixture();
const chunkFetchOptionsSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-chunk-fetch-options',
  device: chunkFetchOptionsFixture.device,
  adapterName: 'fixture-adapter',
});
const chunkFetchOptionsRoute = await chunkFetchOptionsSession.registerRoute({
  routeId: 'package-chunk-fetch-options-route',
});
const chunkFetchOptions = { headers: new Headers({ authorization: 'chunk-admitted' }) };
const observedChunkAuthorizations = [];
const chunkSourceUrls = {
  'decoder-0': 'https://models.example/chunk-fetch-options-0.bin',
  'decoder-1': 'https://models.example/chunk-fetch-options-1.bin',
};
const chunkFetchOptionsLoader = chunkFetchOptionsRoute.createModelResourcePackageLoader({
  loaderId: 'package-chunk-fetch-options-loader',
  package: chunkOnlyPackage,
  sources: { decoder: chunkSourceUrls },
  fetchOptions: chunkFetchOptions,
  async fetch(url, options) {
    observedChunkAuthorizations.push(new Headers(options.headers).get('authorization'));
    if (url === chunkSourceUrls['decoder-0']) {
      options.headers.authorization = 'chunk-mutated-by-first-fetch';
    }
    return responseFor(url === chunkSourceUrls['decoder-0']
      ? byteSets.decoder.slice(0, 4)
      : byteSets.decoder.slice(4));
  },
});
chunkFetchOptions.headers.set('authorization', 'chunk-mutated-after-admission');
const chunkFetchOptionsLease = await chunkFetchOptionsLoader.acquireResource({ resourceId: 'decoder' });
assert.deepEqual({
  oneShot: observedOneShotChunkAuthorizations,
  reusable: observedChunkAuthorizations,
}, {
  oneShot: ['one-shot-chunk-admitted', 'one-shot-chunk-admitted', 'one-shot-chunk-admitted'],
  reusable: ['chunk-admitted', 'chunk-admitted'],
}, 'every one-shot and reusable chunk fetch must receive independent admitted request options');
assert.equal(chunkFetchOptionsLease.release().status, 'released');
assert.equal(chunkFetchOptionsLoader.close().status, 'closed');
chunkFetchOptionsSession.unregisterRoute(chunkFetchOptionsRoute.routeId);
chunkFetchOptionsSession.close();

const invalidatedChildFixture = deviceFixture();
const invalidatedChildSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-child-invalidation',
  device: invalidatedChildFixture.device,
  adapterName: 'fixture-adapter',
});
const invalidatedChildRoute = await invalidatedChildSession.registerRoute({
  routeId: 'package-child-invalidation-route',
});
const invalidatedChildLoader = invalidatedChildRoute.createModelResourcePackageLoader({
  loaderId: 'package-child-invalidation-loader',
  package: singleResourcePackage,
  sources: { encoder: new Blob([byteSets.encoder]) },
});
const invalidatedChildLease = await invalidatedChildLoader.acquireResource({ resourceId: 'encoder' });
assert.equal(invalidatedChildLoader.snapshot().activeLeaseCount, 1);
invalidatedChildFixture.lose({ reason: 'unknown', message: 'package child invalidation fixture' });
await invalidatedChildSession.deviceLost;
const invalidatedChildRelease = invalidatedChildLease.release();
assert.equal(invalidatedChildRelease.schema, 'kaminos.webgpu-model-resource-package-child-lease.v0');
assert.equal(invalidatedChildRelease.status, 'invalidated');
assert.equal(invalidatedChildRelease.underlyingRelease.status, 'invalidated');
assert.equal(invalidatedChildLoader.snapshot().activeLeaseCount, 0);
assert.equal(invalidatedChildLoader.close().status, 'closed');

const partialResidentBytes = Uint8Array.from({ length: 8 }, (_, index) => index + 91);
const partialResidentManifest = defineWebGpuModelResourceManifest({
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  bundle: {
    byteLength: partialResidentBytes.byteLength,
    sha256: createHash('sha256').update(partialResidentBytes).digest('hex'),
  },
  allocations: [
    {
      allocationId: 'partial-resident-a',
      byteOffset: 0,
      byteLength: 4,
      usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      tensors: [{
        name: 'partial.a',
        dtype: 'u32',
        shape: [1],
        byteOffset: 0,
        byteLength: 4,
      }],
    },
    {
      allocationId: 'partial-resident-b',
      byteOffset: 4,
      byteLength: 4,
      usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      tensors: [{
        name: 'partial.b',
        dtype: 'u32',
        shape: [1],
        byteOffset: 0,
        byteLength: 4,
      }],
    },
  ],
});
const partialResidentPackage = defineWebGpuModelResourcePackage({
  packageId: 'acme/large-browser-model:partial-resident-fallback',
  modelId: modelPackage.modelId,
  revision: modelPackage.revision,
  resources: [{ resourceId: 'partial', manifest: partialResidentManifest }],
});
const partialResidentFixture = deviceFixture();
const partialResidentSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-partial-resident',
  device: partialResidentFixture.device,
  adapterName: 'fixture-adapter',
});
const partialResidentRoute = await partialResidentSession.registerRoute({
  routeId: 'package-partial-resident-route',
});
let partialResidentFetchCount = 0;
const partialResidentLoader = partialResidentRoute.createModelResourcePackageLoader({
  loaderId: 'package-partial-resident-loader',
  package: partialResidentPackage,
  sources: { partial: 'https://models.example/partial-resident.bin' },
  async fetch() {
    partialResidentFetchCount += 1;
    return responseFor(partialResidentBytes);
  },
});
const partialResidentInitial = await partialResidentLoader.acquireResource({ resourceId: 'partial' });
const retainedPartialBuffer = partialResidentInitial.allocations[0].buffer;
assert.equal(partialResidentInitial.release().status, 'released');
assert.equal(
  partialResidentSession.residency.evict(partialResidentManifest.allocations[1].resourceId).status,
  'evicted',
);
const partialResidentFallback = await partialResidentLoader.acquireResource({ resourceId: 'partial' });
assert.equal(partialResidentFallback.report.loadPath, 'source');
assert.equal(partialResidentFetchCount, 2);
assert.equal(partialResidentFallback.allocations[0].buffer, retainedPartialBuffer);
assert.equal(partialResidentRoute.residency.snapshot().activeLeaseCount, 2);
assert.equal(
  partialResidentFixture.buffers.length,
  3,
  'partial resident fallback must reuse the surviving allocation and recreate only the evicted allocation',
);
assert.equal(partialResidentFallback.release().status, 'released');
assert.equal(partialResidentRoute.residency.snapshot().activeLeaseCount, 0);
assert.equal(partialResidentLoader.close().status, 'closed');
partialResidentSession.unregisterRoute(partialResidentRoute.routeId);
partialResidentSession.close();

const prototypeFixture = deviceFixture();
const prototypeSession = await createWebGpuInferenceSession({
  sessionId: 'model-resource-package-prototype-authority',
  device: prototypeFixture.device,
  adapterName: 'fixture-adapter',
});
const prototypeRoute = await prototypeSession.registerRoute({
  routeId: 'package-prototype-authority-route',
});
const prototypeSources = {
  encoder: 'https://models.example/prototype-encoder.bin',
  decoder: {
    'decoder-0': 'https://models.example/prototype-decoder-0.bin',
    'decoder-1': 'https://models.example/prototype-decoder-1.bin',
  },
};
const originalPrototypeRouting = Object.getOwnPropertyDescriptor(Object.prototype, 'routing');
const oneShotPrototypeStarted = deferred();
const oneShotPrototypeRelease = deferred();
const observedOneShotPrototypeRouting = [];
let oneShotPrototypeLease;
try {
  const loading = prototypeRoute.loadModelResourcePackageFromSources({
    package: mixedPackage,
    sources: prototypeSources,
    fetchOptions: { custom: {} },
    async fetch(url, options) {
      observedOneShotPrototypeRouting.push(options.custom.routing ?? null);
      if (url === prototypeSources.encoder) {
        oneShotPrototypeStarted.resolve();
        await oneShotPrototypeRelease.promise;
        return responseFor(byteSets.encoder);
      }
      if (url === prototypeSources.decoder['decoder-0']) {
        Object.defineProperty(Object.prototype, 'routing', {
          value: 'one-shot-mutated-by-first-chunk-prototype',
          configurable: true,
          writable: true,
        });
        return responseFor(byteSets.decoder.slice(0, 4));
      }
      return responseFor(byteSets.decoder.slice(4));
    },
  });
  await oneShotPrototypeStarted.promise;
  Object.defineProperty(Object.prototype, 'routing', {
    value: 'one-shot-mutated-after-admission-prototype',
    configurable: true,
    writable: true,
  });
  oneShotPrototypeRelease.resolve();
  oneShotPrototypeLease = await loading;
} finally {
  oneShotPrototypeRelease.resolve();
  if (originalPrototypeRouting) {
    Object.defineProperty(Object.prototype, 'routing', originalPrototypeRouting);
  } else {
    delete Object.prototype.routing;
  }
}
assert.deepEqual(
  observedOneShotPrototypeRouting,
  [null, null, null],
  'one-shot package admission must sever inherited prototype authority across children and chunks',
);
assert.equal(oneShotPrototypeLease.release().status, 'released');
for (const allocation of chunkOnlyPackage.resources[0].chunkPlan.allocations) {
  assert.equal(
    prototypeSession.residency.evict(allocation.resourceId).status,
    'evicted',
    'the reusable prototype probe must exercise fresh chunk fetches rather than resident reuse',
  );
}

const reusablePrototypeSources = {
  decoder: {
    'decoder-0': 'https://models.example/reusable-prototype-decoder-0.bin',
    'decoder-1': 'https://models.example/reusable-prototype-decoder-1.bin',
  },
};
const observedReusablePrototypeRouting = [];
const reusablePrototypeLoader = prototypeRoute.createModelResourcePackageLoader({
  loaderId: 'package-prototype-authority-loader',
  package: chunkOnlyPackage,
  sources: reusablePrototypeSources,
  fetchOptions: { custom: {} },
  async fetch(url, options) {
    observedReusablePrototypeRouting.push(options.custom.routing ?? null);
    if (url === reusablePrototypeSources.decoder['decoder-0']) {
      Object.defineProperty(Object.prototype, 'routing', {
        value: 'reusable-mutated-by-first-chunk-prototype',
        configurable: true,
        writable: true,
      });
      return responseFor(byteSets.decoder.slice(0, 4));
    }
    return responseFor(byteSets.decoder.slice(4));
  },
});
let reusablePrototypeLease;
try {
  Object.defineProperty(Object.prototype, 'routing', {
    value: 'reusable-mutated-after-admission-prototype',
    configurable: true,
    writable: true,
  });
  reusablePrototypeLease = await reusablePrototypeLoader.acquireResource({ resourceId: 'decoder' });
} finally {
  if (originalPrototypeRouting) {
    Object.defineProperty(Object.prototype, 'routing', originalPrototypeRouting);
  } else {
    delete Object.prototype.routing;
  }
}
assert.deepEqual(
  observedReusablePrototypeRouting,
  [null, null],
  'reusable package admission must sever inherited prototype authority across chunk fetches',
);
assert.equal(reusablePrototypeLease.release().status, 'released');
assert.equal(reusablePrototypeLoader.close().status, 'closed');

let tupleHeaderValue = null;
let tupleHeadersWereCanonical = false;
const tupleHeaderLease = await prototypeRoute.loadModelResourcePackageFromSources({
  package: singleResourcePackage,
  sources: { encoder: 'https://models.example/tuple-header-encoder.bin' },
  fetchOptions: { headers: [['authorization', 'tuple-admitted']] },
  async fetch(_url, options) {
    tupleHeadersWereCanonical = Object.getPrototypeOf(options.headers) === null;
    tupleHeaderValue = new Headers(options.headers).get('authorization');
    return responseFor(byteSets.encoder);
  },
});
assert.equal(
  tupleHeadersWereCanonical,
  true,
  'lawful tuple-array HeadersInit must canonicalize to a prototype-severed HeadersInit record',
);
assert.equal(tupleHeaderValue, 'tuple-admitted');
assert.equal(tupleHeaderLease.release().status, 'released');

const buffersBeforePackageNestedArray = prototypeFixture.buffers.length;
let packageNestedArrayFetchCount = 0;
await assert.rejects(
  () => prototypeRoute.loadModelResourcePackageFromSources({
    package: singleResourcePackage,
    sources: { encoder: 'https://models.example/rejected-array-encoder.bin' },
    fetchOptions: { custom: [] },
    async fetch() {
      packageNestedArrayFetchCount += 1;
      throw new Error('nested-array rejection must precede fetch');
    },
  }),
  /fetchOptions.*arrays.*headers|arrays.*fetchOptions\.headers/i,
);
assert.throws(
  () => prototypeRoute.createModelResourcePackageLoader({
    loaderId: 'rejected-array-package-loader',
    package: singleResourcePackage,
    sources: { encoder: 'https://models.example/rejected-loader-array-encoder.bin' },
    fetchOptions: { custom: [] },
  }),
  /fetchOptions.*arrays.*headers|arrays.*fetchOptions\.headers/i,
);
assert.equal(packageNestedArrayFetchCount, 0);
assert.equal(prototypeFixture.buffers.length, buffersBeforePackageNestedArray);
prototypeSession.unregisterRoute(prototypeRoute.routeId);
prototypeSession.close();

console.log('model resource package contracts passed');
