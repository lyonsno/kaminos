import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_MODEL_RESOURCE_CHUNK_ALLOCATION_PROVENANCE_SCHEMA,
  WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_SCHEMA,
  WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_VERIFICATION_SCHEMA,
  createWebGpuInferenceSession,
  defineWebGpuModelResourceChunkPlan,
  defineWebGpuModelResourceManifest,
  validateWebGpuModelResourceChunkPlan,
} from '../src/index.js';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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

function responseFor(bytes) {
  return new Response(bytes, {
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'application/octet-stream',
    },
  });
}

function deviceFixture() {
  const buffers = [];
  const writes = [];
  const device = {
    queue: {
      writeBuffer(buffer, bufferOffset, data, dataOffset = 0, size = undefined) {
        const view = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const byteLength = size ?? (view.byteLength - dataOffset);
        writes.push({
          buffer,
          bufferOffset,
          bytes: Uint8Array.from(view.subarray(dataOffset, dataOffset + byteLength)),
        });
      },
    },
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
  return { device, buffers, writes };
}

const bundle = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const chunkBytes = {
  'encoder-0': bundle.slice(0, 8),
  'encoder-1': bundle.slice(8, 16),
  'decoder-0': bundle.slice(16, 24),
  'decoder-1': bundle.slice(24, 32),
};

function manifestFor(tensorSuffix = 'weight') {
  return defineWebGpuModelResourceManifest({
    modelId: 'acme/chunked-browser-model',
    revision: 'revision-a',
    bundle: { byteLength: bundle.byteLength, sha256: sha256(bundle) },
    allocations: [
      {
        allocationId: 'encoder',
        byteOffset: 0,
        byteLength: 16,
        usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
        tensors: [{
          name: `encoder.${tensorSuffix}`,
          dtype: 'u32',
          shape: [4],
          byteOffset: 0,
          byteLength: 16,
        }],
      },
      {
        allocationId: 'decoder',
        byteOffset: 16,
        byteLength: 16,
        usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
        tensors: [{
          name: 'decoder.weight',
          dtype: 'u32',
          shape: [4],
          byteOffset: 0,
          byteLength: 16,
        }],
      },
    ],
  });
}

function planInput(manifest = manifestFor()) {
  return {
    planId: 'acme/chunked-browser-model:browser-f16-chunks',
    manifest,
    allocations: [
      {
        allocationId: 'encoder',
        chunks: [
          { chunkId: 'encoder-0', byteOffset: 0, byteLength: 8, sha256: sha256(chunkBytes['encoder-0']) },
          { chunkId: 'encoder-1', byteOffset: 8, byteLength: 8, sha256: sha256(chunkBytes['encoder-1']) },
        ],
      },
      {
        allocationId: 'decoder',
        chunks: [
          { chunkId: 'decoder-0', byteOffset: 0, byteLength: 8, sha256: sha256(chunkBytes['decoder-0']) },
          { chunkId: 'decoder-1', byteOffset: 8, byteLength: 8, sha256: sha256(chunkBytes['decoder-1']) },
        ],
      },
    ],
  };
}

const manifest = manifestFor();
const plan = defineWebGpuModelResourceChunkPlan(planInput(manifest));
assert.equal(plan.schema, WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_SCHEMA);
assert.equal(plan.manifest, manifest);
assert.deepEqual(plan.chunkIds, ['encoder-0', 'encoder-1', 'decoder-0', 'decoder-1']);
assert.equal(plan.totalSourceByteLength, 32);
assert.equal(plan.largestChunkByteLength, 8);
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.allocations[0].chunks), true);
assert.deepEqual(validateWebGpuModelResourceChunkPlan(plan), { ok: true, errors: [] });
assert.notEqual(plan.allocations[0].resourceId, manifest.allocations[0].resourceId);

const semanticVariant = defineWebGpuModelResourceChunkPlan(planInput(manifestFor('projection.weight')));
assert.notEqual(
  semanticVariant.identity,
  plan.identity,
  'chunk-plan identity must bind existing normalized allocation and tensor semantics',
);
const renamedChunkInput = planInput(manifest);
renamedChunkInput.allocations[0].chunks[0].chunkId = 'renamed-encoder-0';
const renamedChunkPlan = defineWebGpuModelResourceChunkPlan(renamedChunkInput);
assert.notEqual(
  renamedChunkPlan.identity,
  plan.identity,
  'chunk-plan identity must bind logical chunk ids used by source maps and reports',
);
assert.doesNotThrow(() => validateWebGpuModelResourceChunkPlan({
  ...plan,
  allocations: [
    { ...plan.allocations[0], chunks: [null] },
    plan.allocations[1],
  ],
}));
assert.equal(validateWebGpuModelResourceChunkPlan({
  ...plan,
  allocations: [
    { ...plan.allocations[0], chunks: [null] },
    plan.allocations[1],
  ],
}).ok, false);

const gapInput = planInput(manifest);
gapInput.allocations[0].chunks[1].byteOffset = 12;
assert.throws(
  () => defineWebGpuModelResourceChunkPlan(gapInput),
  /contiguous|coverage|offset/i,
);
const overlapInput = planInput(manifest);
overlapInput.allocations[0].chunks[1].byteOffset = 4;
assert.throws(
  () => defineWebGpuModelResourceChunkPlan(overlapInput),
  /contiguous|coverage|offset/i,
);
assert.throws(
  () => defineWebGpuModelResourceChunkPlan({ ...planInput(manifest), maxChunks: 4 }),
  /uncapped|maxChunks/i,
);

const fixture = deviceFixture();
const session = await createWebGpuInferenceSession({
  sessionId: 'chunk-plan-session',
  device: fixture.device,
  adapterName: 'fixture-adapter',
});
const sharp = await session.registerRoute({ routeId: 'sharp.chunk-plan' });
const sf3d = await session.registerRoute({ routeId: 'sf3d.chunk-plan' });
assert.equal(typeof sharp.loadModelResourceChunksFromSources, 'function');

const sources = Object.freeze(Object.fromEntries(
  plan.chunkIds.map(chunkId => [chunkId, `https://models.example/${chunkId}.bin`]),
));
const bytesByUrl = new Map(plan.chunkIds.map(chunkId => [sources[chunkId], chunkBytes[chunkId]]));
const gates = new Map(plan.chunkIds.map(chunkId => [sources[chunkId], deferred()]));
const fetchStarts = [];
const cacheEntries = new Map();
const cache = {
  cacheId: 'chunk-plan-cache',
  async get(key) { return cacheEntries.get(key)?.slice(0) || null; },
  async put(key, bytes) { cacheEntries.set(key, bytes.slice(0)); },
  async delete(key) { return cacheEntries.delete(key); },
};
const loading = sharp.loadModelResourceChunksFromSources({
  plan,
  sources,
  cache,
  async fetch(url) {
    fetchStarts.push(String(url));
    await gates.get(String(url)).promise;
    return responseFor(bytesByUrl.get(String(url)));
  },
});
const joinedLoading = sf3d.loadModelResourceChunksFromSources({
  plan,
  sources,
  cache,
  async fetch() { throw new Error('successful active-flight reuse must not fetch'); },
});
for (let index = 0; index < plan.chunkIds.length; index += 1) {
  await waitFor(() => fetchStarts.length === index + 1);
  assert.deepEqual(
    fetchStarts,
    plan.chunkIds.slice(0, index + 1).map(chunkId => sources[chunkId]),
    'chunk sources must be acquired strictly in declaration order',
  );
  gates.get(sources[plan.chunkIds[index]]).resolve();
}
const sharpLease = await loading;
const sf3dJoinedLease = await joinedLoading;
assert.equal(sharpLease.chunkReport.status, 'loaded');
assert.equal(sharpLease.verification.schema, WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_VERIFICATION_SCHEMA);
assert.equal(sharpLease.chunkReport.allocations.length, 2);
assert.equal(sharpLease.chunkReport.sourceMemoryBound.largestChunkByteLength, 8);
assert.equal(sharpLease.chunkReport.sourceMemoryBound.authority, 'sequential-chunk-acquisition-declared-byte-length');
assert.deepEqual(fixture.writes.map(write => write.bufferOffset), [0, 8, 0, 8]);
assert.equal(Math.max(...fixture.writes.map(write => write.bytes.byteLength)), 8);
assert.deepEqual([...fixture.writes[0].bytes, ...fixture.writes[1].bytes], [...bundle.slice(0, 16)]);
assert.deepEqual([...fixture.writes[2].bytes, ...fixture.writes[3].bytes], [...bundle.slice(16, 32)]);
assert.equal(fixture.buffers.length, 2);
assert.deepEqual(
  sf3dJoinedLease.chunkReport.allocations.map(allocation => allocation.chunks.length),
  [2, 2],
  'a successful flight joiner must retain the creator chunk verification provenance',
);
assert.equal(
  sf3dJoinedLease.chunkReport.allocations[0].provenance.schema,
  WEBGPU_MODEL_RESOURCE_CHUNK_ALLOCATION_PROVENANCE_SCHEMA,
);
assert.equal(
  sf3dJoinedLease.chunkReport.allocations[0].provenance,
  sharpLease.chunkReport.allocations[0].provenance,
  'a successful flight joiner must reference the immutable creator provenance object',
);
assert.equal(Object.isFrozen(sf3dJoinedLease.chunkReport.allocations[0].provenance), true);
assert.equal(sf3dJoinedLease.release().status, 'released');

const sf3dLease = await sf3d.loadModelResourceChunksFromSources({
  plan,
  sources,
  cache,
  async fetch() { throw new Error('resident reuse must not fetch'); },
});
assert.equal(fixture.buffers.length, 2, 'a second route must reuse chunk-backed resident allocations');
assert.equal(sharpLease.tensors['encoder.weight'].buffer, sf3dLease.tensors['encoder.weight'].buffer);
assert.deepEqual(
  sf3dLease.chunkReport.allocations.map(allocation => allocation.chunks.length),
  [2, 2],
  'resident reuse must retain the chunk verification provenance that authorized publication',
);
assert.equal(
  sf3dLease.chunkReport.allocations[0].provenance,
  sharpLease.chunkReport.allocations[0].provenance,
  'resident reuse must reference the immutable provenance retained with the resident buffer',
);
assert.equal(sharpLease.release().status, 'released');
assert.equal(sf3dLease.release().status, 'released');

for (const allocation of plan.allocations) {
  assert.equal(session.residency.evict(allocation.resourceId).status, 'evicted');
}
const warm = await sharp.loadModelResourceChunksFromSources({
  plan,
  sources,
  cache,
  async fetch() { throw new Error('verified chunk cache hit must not fetch'); },
});
assert.equal(
  warm.chunkReport.allocations.every(allocation => (
    allocation.chunks.every(chunk => chunk.acquisitionReport.cache.status === 'hit')
  )),
  true,
);
assert.equal(fixture.buffers.length, 4);
assert.equal(warm.release().status, 'released');

const corruptCacheKey = warm.chunkReport.allocations[0].chunks[1].acquisitionReport.cache.key;
cacheEntries.set(corruptCacheKey, Uint8Array.from({ length: 8 }, () => 0xff).buffer);
for (const allocation of plan.allocations) {
  assert.equal(session.residency.evict(allocation.resourceId).status, 'evicted');
}
const recoveryFetches = [];
const recovered = await sharp.loadModelResourceChunksFromSources({
  plan,
  sources,
  cache,
  async fetch(url) {
    recoveryFetches.push(String(url));
    return responseFor(bytesByUrl.get(String(url)));
  },
});
assert.deepEqual(recoveryFetches, [sources['encoder-1']]);
assert.equal(
  recovered.chunkReport.allocations[0].chunks[1].acquisitionReport.cache.status,
  'rejected-refetched-stored',
);
assert.equal(recovered.release().status, 'released');

const physicalManifest = defineWebGpuModelResourceManifest({
  modelId: manifest.modelId,
  revision: manifest.revision,
  bundle: manifest.bundle,
  resourceSharing: { policy: 'content-addressed-physical-dedupe' },
  allocations: manifest.allocations,
});
const physicalPlanInputA = planInput(physicalManifest);
physicalPlanInputA.planId = 'physical-plan-a';
const physicalPlanInputB = planInput(physicalManifest);
physicalPlanInputB.planId = 'physical-plan-b';
const physicalPlanA = defineWebGpuModelResourceChunkPlan(physicalPlanInputA);
const physicalPlanB = defineWebGpuModelResourceChunkPlan(physicalPlanInputB);
assert.notEqual(physicalPlanA.identity, physicalPlanB.identity);
assert.deepEqual(
  physicalPlanA.allocations.map(allocation => allocation.resourceId),
  physicalPlanB.allocations.map(allocation => allocation.resourceId),
);
const physicalA = await sharp.loadModelResourceChunksFromSources({
  plan: physicalPlanA,
  sources,
  cache,
  async fetch() { throw new Error('physical plan must use the verified chunk cache'); },
});
const physicalB = await sf3d.loadModelResourceChunksFromSources({
  plan: physicalPlanB,
  sources,
  cache,
  async fetch() { throw new Error('physical resident reuse must not fetch'); },
});
assert.equal(physicalA.tensors['encoder.weight'].buffer, physicalB.tensors['encoder.weight'].buffer);
assert.equal(physicalA.release().status, 'released');
assert.equal(physicalB.release().status, 'released');
session.unregisterRoute(sharp.routeId);
session.unregisterRoute(sf3d.routeId);
session.close();

const failureFixture = deviceFixture();
const failureSession = await createWebGpuInferenceSession({
  sessionId: 'chunk-plan-failure',
  device: failureFixture.device,
  adapterName: 'fixture-adapter',
});
const failureRoute = await failureSession.registerRoute({ routeId: 'chunk-plan-failure-route' });
const joinedFailureRoute = await failureSession.registerRoute({ routeId: 'chunk-plan-joined-failure-route' });

await assert.rejects(
  () => failureRoute.loadModelResourceChunksFromSources({
    plan,
    sources: {
      'encoder-0': new Blob([chunkBytes['encoder-0']]),
      'encoder-1': {},
      'decoder-0': new Blob([chunkBytes['decoder-0']]),
      'decoder-1': new Blob([chunkBytes['decoder-1']]),
    },
  }),
  /source.*URL|Request|Response|Blob|ArrayBuffer|typed array/i,
);
assert.equal(failureFixture.buffers.length, 0, 'all chunk source classes must be validated before GPU work');

await assert.rejects(
  () => failureRoute.loadModelResourceChunksFromSources({
    plan,
    sources: { ...chunkBytes },
  }),
  /multi-chunk.*mutable|mutable.*Blob|immutable.*Blob/i,
);
assert.equal(failureFixture.buffers.length, 0, 'mutable multi-chunk sources must fail before GPU work');

const corrupt = Uint8Array.from(chunkBytes['encoder-1']);
corrupt[0] ^= 0xff;
await assert.rejects(
  () => failureRoute.loadModelResourceChunksFromSources({
    plan,
    sources: {
      'encoder-0': new Blob([chunkBytes['encoder-0']]),
      'encoder-1': new Blob([corrupt]),
      'decoder-0': new Blob([chunkBytes['decoder-0']]),
      'decoder-1': new Blob([chunkBytes['decoder-1']]),
    },
  }),
  error => {
    assert.equal(error.chunkReport.status, 'failed');
    assert.equal(error.chunkReport.failedAllocationId, 'encoder');
    assert.equal(error.chunkReport.failedChunkId, 'encoder-1');
    assert.equal(error.chunkReport.failedAllocation.status, 'failed-before-publication');
    assert.deepEqual(
      error.chunkReport.failedAllocation.chunks.map(chunk => chunk.chunkId),
      ['encoder-0'],
      'a failed allocation must retain every trustworthy prior chunk acquisition report',
    );
    return true;
  },
);
assert.equal(failureFixture.buffers.length, 1);
assert.equal(failureFixture.buffers[0].destroyCount, 1, 'failed allocation buffer must be destroyed before publication');
assert.equal(failureSession.residency.snapshot().activeLeaseCount, 0);

const joinedCorruptSources = {
  'encoder-0': new Blob([chunkBytes['encoder-0']]),
  'encoder-1': new Blob([corrupt]),
  'decoder-0': new Blob([chunkBytes['decoder-0']]),
  'decoder-1': new Blob([chunkBytes['decoder-1']]),
};
const joinedFailures = await Promise.allSettled([
  failureRoute.loadModelResourceChunksFromSources({ plan, sources: joinedCorruptSources }),
  joinedFailureRoute.loadModelResourceChunksFromSources({ plan, sources: joinedCorruptSources }),
]);
assert.deepEqual(joinedFailures.map(result => result.status), ['rejected', 'rejected']);
assert.deepEqual(
  joinedFailures.map(result => result.reason.chunkReport.failedChunkId),
  ['encoder-1', 'encoder-1'],
  'every waiter on a failed allocation flight must receive the exact creator chunk failure identity',
);
assert.deepEqual(
  joinedFailures.map(result => result.reason.chunkReport.failedAllocation.chunks.length),
  [1, 1],
  'every failed-flight waiter must retain the creator partial allocation report',
);

const stalled = deferred();
const secondStarted = deferred();
const controller = new AbortController();
const canceledCreator = failureRoute.loadModelResourceChunksFromSources({
  plan,
  sources,
  signal: controller.signal,
  async fetch(url) {
    if (String(url) === sources['encoder-0']) return responseFor(chunkBytes['encoder-0']);
    secondStarted.resolve();
    await stalled.promise;
    return responseFor(bytesByUrl.get(String(url)));
  },
});
const canceledJoiner = joinedFailureRoute.loadModelResourceChunksFromSources({
  plan,
  sources,
  signal: controller.signal,
  async fetch() { throw new Error('joined canceled waiter must not fetch'); },
});
await secondStarted.promise;
controller.abort('cancel-chunk-plan');
const canceledResults = await Promise.allSettled([canceledCreator, canceledJoiner]);
assert.deepEqual(canceledResults.map(result => result.status), ['rejected', 'rejected']);
assert.deepEqual(
  canceledResults.map(result => result.reason.chunkReport.routeId),
  [failureRoute.routeId, joinedFailureRoute.routeId],
  'shared creator failure identity must still produce caller-specific immutable reports',
);
for (const result of canceledResults) {
  assert.equal(result.reason.name, 'AbortError');
  assert.equal(result.reason.chunkReport.status, 'canceled');
  assert.equal(result.reason.chunkReport.failedChunkId, 'encoder-1');
  assert.deepEqual(
    result.reason.chunkReport.failedAllocation.chunks.map(chunk => chunk.chunkId),
    ['encoder-0'],
    'every canceled waiter must retain the creator failed-chunk and partial verified-chunk identity',
  );
}
assert.equal(failureFixture.buffers.at(-1).destroyCount, 1);
assert.equal(failureSession.residency.snapshot().activeLeaseCount, 0);

const singleBytes = bundle.slice(0, 16);
const singleManifest = defineWebGpuModelResourceManifest({
  modelId: manifest.modelId,
  revision: manifest.revision,
  bundle: { byteLength: singleBytes.byteLength, sha256: sha256(singleBytes) },
  allocations: [{
    allocationId: 'single',
    byteOffset: 0,
    byteLength: singleBytes.byteLength,
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
    tensors: [{
      name: 'single.weight',
      dtype: 'u32',
      shape: [4],
      byteOffset: 0,
      byteLength: singleBytes.byteLength,
    }],
  }],
});
const singlePlan = defineWebGpuModelResourceChunkPlan({
  planId: 'single-chunk-plan',
  manifest: singleManifest,
  allocations: [{
    allocationId: 'single',
    chunks: [{
      chunkId: 'single-0',
      byteOffset: 0,
      byteLength: singleBytes.byteLength,
      sha256: sha256(singleBytes),
    }],
  }],
});
const mutableSingleSource = Uint8Array.from(singleBytes);
const singleLoad = failureRoute.loadModelResourceChunksFromSources({
  plan: singlePlan,
  sources: { 'single-0': mutableSingleSource },
});
mutableSingleSource.fill(0xff);
const singleLease = await singleLoad;
assert.equal(singleLease.chunkReport.status, 'loaded');
assert.equal(singleLease.release().status, 'released');

await failureSession.drain();
failureSession.unregisterRoute(failureRoute.routeId);
failureSession.unregisterRoute(joinedFailureRoute.routeId);
failureSession.close();

console.log('model resource chunk plan contracts passed');
