import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as kit from '../src/index.js';

assert.equal(typeof kit.defineWebGpuModelResourceManifest, 'function');
assert.equal(typeof kit.validateWebGpuModelResourceManifest, 'function');
assert.equal(typeof kit.verifyWebGpuModelResourceBundle, 'function');
assert.equal(typeof kit.loadWebGpuModelResources, 'function');
assert.equal(typeof kit.prepareWebGpuModelResourceBundle, 'function');

const {
  WEBGPU_BUFFER_USAGE,
  createWebGpuResourceFactory,
  createWebGpuResourceResidency,
  defineWebGpuModelResourceManifest,
  loadWebGpuModelResources,
  prepareWebGpuModelResourceBundle,
  validateWebGpuModelResourceManifest,
  verifyWebGpuModelResourceBundle,
} = kit;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function manifestFor(bytes, overrides = {}) {
  return defineWebGpuModelResourceManifest({
    modelId: 'acme/vision-model',
    revision: '0123456789abcdef',
    bundle: {
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    },
    allocations: [
      {
        allocationId: 'encoder',
        byteOffset: 0,
        byteLength: 16,
        usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
        tensors: [
          { name: 'encoder.weight', dtype: 'f32', shape: [2], byteOffset: 0, byteLength: 8 },
          { name: 'encoder.bias', dtype: 'f32', shape: [2], byteOffset: 8, byteLength: 8 },
        ],
      },
      {
        allocationId: 'decoder',
        byteOffset: 16,
        byteLength: 16,
        usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
        tensors: [
          { name: 'decoder.weight', dtype: 'f16', shape: [4], byteOffset: 0, byteLength: 8 },
          { name: 'decoder.bias', dtype: 'u32', shape: [2], byteOffset: 8, byteLength: 8 },
        ],
      },
    ],
    ...overrides,
  });
}

function runtimeFixture(options = {}) {
  const created = [];
  const writes = [];
  return {
    created,
    writes,
    createBuffer(descriptor) {
      if (options.failLabel && descriptor.label.includes(options.failLabel)) {
        throw new Error(`fixture allocation failed for ${descriptor.label}`);
      }
      const buffer = {
        descriptor: { ...descriptor },
        destroyed: false,
        destroy() { this.destroyed = true; },
      };
      created.push(buffer);
      return buffer;
    },
    writeBuffer(buffer, data, offset = 0) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      writes.push({ buffer, offset, bytes: Uint8Array.from(bytes) });
    },
  };
}

function routeFixture({ routeId, runtime, residency, factory }) {
  return {
    routeId,
    runtime,
    residency: {
      acquireOrCreate(input) {
        return factory.acquireOrCreate({ ...input, routeId });
      },
      snapshot() { return residency.routeSnapshot(routeId); },
    },
  };
}

const bundle = Uint8Array.from({ length: 32 }, (_, index) => index);
const manifest = manifestFor(bundle);
assert.equal(manifest.schema, 'kaminos.webgpu-model-resource-manifest.v0');
assert.equal(manifest.identity, `acme/vision-model@0123456789abcdef#sha256:${sha256(bundle)}`);
assert.equal(manifest.allocations.length, 2);
assert.equal(manifest.allocations[0].resourceId, `kaminos:model-resource:sha256:${sha256(bundle)}:0:16:${WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst}`);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.allocations), true);
assert.equal(Object.isFrozen(manifest.allocations[0].tensors[0].shape), true);
assert.throws(() => { manifest.allocations.push({}); }, /read only|not extensible|object is not extensible/i);
assert.deepEqual(validateWebGpuModelResourceManifest(manifest), { ok: true, errors: [] });

const verification = await verifyWebGpuModelResourceBundle(manifest, bundle);
assert.deepEqual(verification, {
  schema: 'kaminos.webgpu-model-resource-bundle-verification.v0',
  status: 'verified',
  algorithm: 'SHA-256',
  expectedByteLength: 32,
  effectiveByteLength: 32,
  expectedSha256: sha256(bundle),
  effectiveSha256: sha256(bundle),
  byteCustody: 'loader-owned-snapshot-before-verification',
});
assert.equal(Object.isFrozen(verification), true);

const copiedSource = Uint8Array.from(bundle);
const copiedBundle = await prepareWebGpuModelResourceBundle(manifest, copiedSource);
assert.equal(copiedBundle.schema, 'kaminos.webgpu-model-resource-bundle-custody.v0');
assert.equal(copiedBundle.identity, manifest.identity);
assert.equal(copiedBundle.ownership, 'copy');
assert.equal(copiedBundle.byteLength, bundle.byteLength);
assert.equal(copiedBundle.verification.byteCustody, 'loader-owned-copy-before-verification');
assert.equal(Object.isFrozen(copiedBundle), true);
assert.equal(Object.hasOwn(copiedBundle, 'bytes'), false, 'owned bytes must not be publicly mutable');
copiedSource.fill(0xff);
const copiedResidency = createWebGpuResourceResidency({ sessionId: 'copied-custody' });
const copiedRuntime = runtimeFixture();
const copiedModel = await loadWebGpuModelResources({
  manifest,
  bundle: copiedBundle,
  route: routeFixture({
    routeId: 'copied-custody-route',
    runtime: copiedRuntime,
    residency: copiedResidency,
    factory: createWebGpuResourceFactory({ sessionId: 'copied-custody', residency: copiedResidency }),
  }),
});
assert.deepEqual(
  copiedRuntime.writes.map(write => [...write.bytes]),
  [[...bundle.subarray(0, 16)], [...bundle.subarray(16, 32)]],
);
copiedModel.release();

const transferSource = Uint8Array.from(bundle).buffer;
const transferredBundle = await prepareWebGpuModelResourceBundle(manifest, transferSource, { ownership: 'transfer' });
assert.equal(transferSource.byteLength, 0, 'transfer custody must detach caller ArrayBuffer');
assert.equal(transferredBundle.ownership, 'transfer');
assert.equal(transferredBundle.verification.byteCustody, 'loader-owned-transfer-before-verification');

const custodyResidency = createWebGpuResourceResidency({ sessionId: 'custody' });
const custodyRuntime = runtimeFixture();
const custodyRoute = routeFixture({
  routeId: 'custody-route',
  runtime: custodyRuntime,
  residency: custodyResidency,
  factory: createWebGpuResourceFactory({ sessionId: 'custody', residency: custodyResidency }),
});
const custodyModel = await loadWebGpuModelResources({ manifest, bundle: transferredBundle, route: custodyRoute });
assert.deepEqual(
  custodyRuntime.writes.map(write => [...write.bytes]),
  [[...bundle.subarray(0, 16)], [...bundle.subarray(16, 32)]],
);
custodyModel.release();
assert.equal(transferredBundle.release().status, 'released');
assert.equal(transferredBundle.release().status, 'already-released');
await assert.rejects(
  () => loadWebGpuModelResources({ manifest, bundle: transferredBundle, route: custodyRoute }),
  /bundle custody.*released/i,
);

const counterfeitRuntime = runtimeFixture();
await assert.rejects(
  () => loadWebGpuModelResources({
    manifest,
    bundle: {
      schema: 'kaminos.webgpu-model-resource-bundle-custody.v0',
      identity: manifest.identity,
      ownership: 'transfer',
      byteLength: bundle.byteLength,
      verification,
    },
    route: { routeId: 'counterfeit', runtime: counterfeitRuntime, residency: { acquireOrCreate() {} } },
  }),
  /authentic|module-issued|bundle custody/i,
);
assert.equal(counterfeitRuntime.created.length, 0);

const foreignManifest = manifestFor(bundle, { revision: 'foreign-revision' });
const foreignPrepared = await prepareWebGpuModelResourceBundle(foreignManifest, bundle);
await assert.rejects(
  () => loadWebGpuModelResources({ manifest, bundle: foreignPrepared, route: custodyRoute }),
  /manifest identity|prepared.*identity/i,
);
foreignPrepared.release();

const layoutPrepared = await prepareWebGpuModelResourceBundle(manifest, bundle);
const sameIdentityDifferentLayout = {
  ...manifest,
  allocations: [...manifest.allocations].reverse(),
};
assert.deepEqual(validateWebGpuModelResourceManifest(sameIdentityDifferentLayout), { ok: true, errors: [] });
await assert.rejects(
  () => loadWebGpuModelResources({ manifest: sameIdentityDifferentLayout, bundle: layoutPrepared, route: custodyRoute }),
  /manifest content|manifest fingerprint|prepared.*manifest/i,
);
layoutPrepared.release();

await assert.rejects(
  () => prepareWebGpuModelResourceBundle(manifest, Uint8Array.from(bundle), { ownership: 'transfer' }),
  /transfer.*ArrayBuffer/i,
);
await assert.rejects(
  () => prepareWebGpuModelResourceBundle(manifest, Uint8Array.from(bundle).buffer, { ownership: 'borrowed' }),
  /ownership.*copy or transfer/i,
);
copiedBundle.release();

const wrongLengthRuntime = runtimeFixture();
await assert.rejects(
  () => loadWebGpuModelResources({
    manifest,
    bundle: bundle.subarray(0, 28),
    route: { routeId: 'wrong-length', runtime: wrongLengthRuntime, residency: { acquireOrCreate() {} } },
  }),
  /bundle byteLength 28.*expected 32/i,
);
assert.equal(wrongLengthRuntime.created.length, 0, 'length mismatch must fail before GPU allocation');

const wrongHash = Uint8Array.from(bundle);
wrongHash[0] ^= 0xff;
const wrongHashRuntime = runtimeFixture();
await assert.rejects(
  () => loadWebGpuModelResources({
    manifest,
    bundle: wrongHash,
    route: { routeId: 'wrong-hash', runtime: wrongHashRuntime, residency: { acquireOrCreate() {} } },
  }),
  /bundle SHA-256 .* does not match expected/i,
);
assert.equal(wrongHashRuntime.created.length, 0, 'hash mismatch must fail before GPU allocation');

assert.equal(validateWebGpuModelResourceManifest({ ...manifest, allocations: [manifest.allocations[0], { ...manifest.allocations[1], allocationId: 'encoder' }] }).ok, false);
assert.match(
  validateWebGpuModelResourceManifest({ ...manifest, allocations: [{ ...manifest.allocations[0], byteOffset: 4 }, manifest.allocations[1]] }).errors.join('\n'),
  /allocation ranges.*overlap/i,
);
assert.match(
  validateWebGpuModelResourceManifest({ ...manifest, allocations: [{ ...manifest.allocations[0], byteLength: 36 }] }).errors.join('\n'),
  /outside bundle|exceeds bundle/i,
);
assert.match(
  validateWebGpuModelResourceManifest({
    ...manifest,
    allocations: [{
      ...manifest.allocations[0],
      tensors: [manifest.allocations[0].tensors[0], { ...manifest.allocations[0].tensors[1], name: 'encoder.weight' }],
    }],
  }).errors.join('\n'),
  /duplicate tensor name/i,
);
assert.match(
  validateWebGpuModelResourceManifest({
    ...manifest,
    allocations: [{
      ...manifest.allocations[0],
      tensors: [manifest.allocations[0].tensors[0], { ...manifest.allocations[0].tensors[1], byteOffset: 4 }],
    }],
  }).errors.join('\n'),
  /tensor ranges.*overlap/i,
);

const residency = createWebGpuResourceResidency({ sessionId: 'models' });
const factory = createWebGpuResourceFactory({ sessionId: 'models', residency });
const runtimeA = runtimeFixture();
const runtimeB = runtimeFixture();
const routeA = routeFixture({ routeId: 'sharp', runtime: runtimeA, residency, factory });
const routeB = routeFixture({ routeId: 'sf3d', runtime: runtimeB, residency, factory });
const [modelA, modelB] = await Promise.all([
  loadWebGpuModelResources({ manifest, bundle, route: routeA }),
  loadWebGpuModelResources({ manifest, bundle, route: routeB }),
]);

assert.equal(runtimeA.created.length + runtimeB.created.length, 2, 'each allocation uploads exactly once');
assert.equal(runtimeA.writes.length + runtimeB.writes.length, 2);
assert.equal(modelA.schema, 'kaminos.webgpu-model-resource-lease.v0');
assert.equal(modelA.identity, manifest.identity);
assert.equal(modelA.verification.status, 'verified');
assert.equal(modelA.allocations.length, 2);
assert.equal(modelA.allocations[0].buffer, modelB.allocations[0].buffer);
assert.equal(modelA.allocations[1].buffer, modelB.allocations[1].buffer);
assert.notEqual(modelA.allocations[0].leaseId, modelB.allocations[0].leaseId);
assert.equal(modelA.tensors['encoder.bias'].buffer, modelA.allocations[0].buffer);
assert.equal(modelA.tensors['encoder.bias'].bufferOffset, 8);
assert.equal(modelA.tensors['encoder.bias'].byteLength, 8);
assert.deepEqual(modelA.tensors['encoder.bias'].shape, [2]);
assert.deepEqual(modelA.tensors['encoder.bias'].strides, [1]);
assert.equal(modelA.tensors['encoder.bias'].ownsBuffer, false);
assert.equal(residency.snapshot().activeLeaseCount, 4);
assert.equal(modelA.release().status, 'released');
assert.equal(modelA.release().status, 'already-released');
assert.equal(residency.snapshot().activeLeaseCount, 2);
assert.equal(modelB.release().status, 'released');
assert.equal(residency.snapshot().activeLeaseCount, 0);
assert.equal(residency.snapshot().evictionCandidates.length, 2);

const mutableSource = Uint8Array.from(bundle);
const mutationResidency = createWebGpuResourceResidency({ sessionId: 'mutation' });
const mutationFactory = createWebGpuResourceFactory({ sessionId: 'mutation', residency: mutationResidency });
const mutationRuntime = runtimeFixture();
const mutationModel = await loadWebGpuModelResources({
  manifest,
  bundle: mutableSource,
  route: routeFixture({
    routeId: 'mutation-route',
    runtime: mutationRuntime,
    residency: mutationResidency,
    factory: mutationFactory,
  }),
  subtle: {
    async digest(algorithm, bytes) {
      const digest = await globalThis.crypto.subtle.digest(algorithm, bytes);
      mutableSource.fill(0xff);
      return digest;
    },
  },
});
assert.deepEqual(
  mutationRuntime.writes.map(write => [...write.bytes]),
  [[...bundle.subarray(0, 16)], [...bundle.subarray(16, 32)]],
  'uploaded bytes must come from the loader-owned snapshot that was actually verified',
);
mutationModel.release();

const magicBundle = new Uint8Array(4);
const magicManifest = defineWebGpuModelResourceManifest({
  modelId: 'acme/magic-name',
  revision: 'r1',
  bundle: { byteLength: 4, sha256: sha256(magicBundle) },
  allocations: [{
    allocationId: 'magic',
    byteOffset: 0,
    byteLength: 4,
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
    tensors: [{ name: '__proto__', dtype: 'u32', shape: [1], byteOffset: 0, byteLength: 4 }],
  }],
});
const magicResidency = createWebGpuResourceResidency({ sessionId: 'magic' });
const magicModel = await loadWebGpuModelResources({
  manifest: magicManifest,
  bundle: magicBundle,
  route: routeFixture({
    routeId: 'magic-route',
    runtime: runtimeFixture(),
    residency: magicResidency,
    factory: createWebGpuResourceFactory({ sessionId: 'magic', residency: magicResidency }),
  }),
});
assert.equal(Object.hasOwn(magicModel.tensors, '__proto__'), true);
assert.deepEqual(Object.keys(magicModel.tensors), ['__proto__']);
assert.equal(magicModel.tensors.__proto__.name, '__proto__');
magicModel.release();

const partialResidency = createWebGpuResourceResidency({ sessionId: 'partial-model' });
const partialFactory = createWebGpuResourceFactory({ sessionId: 'partial-model', residency: partialResidency });
const partialRuntime = runtimeFixture({ failLabel: 'decoder' });
const partialRoute = routeFixture({
  routeId: 'partial-route', runtime: partialRuntime, residency: partialResidency, factory: partialFactory,
});
let partialError;
try {
  await loadWebGpuModelResources({ manifest, bundle, route: partialRoute });
} catch (error) {
  partialError = error;
}
assert.equal(partialError?.phase, 'allocation');
assert.equal(partialError?.allocationId, 'decoder');
assert.equal(partialError?.cleanup?.releasedLeaseCount, 1);
assert.equal(partialResidency.snapshot().activeLeaseCount, 0);
assert.deepEqual(partialResidency.snapshot().evictionCandidates.map(candidate => candidate.resourceId), [manifest.allocations[0].resourceId]);

const aborted = new AbortController();
aborted.abort('caller-left');
const cancelledRuntime = runtimeFixture();
const cancelledResidency = createWebGpuResourceResidency({ sessionId: 'cancelled' });
await assert.rejects(
  () => loadWebGpuModelResources({
    manifest,
    bundle,
    route: routeFixture({
      routeId: 'cancelled',
      runtime: cancelledRuntime,
      residency: cancelledResidency,
      factory: createWebGpuResourceFactory({
        sessionId: 'cancelled',
        residency: cancelledResidency,
      }),
    }),
    signal: aborted.signal,
  }),
  /aborted|caller-left/i,
);
assert.equal(cancelledRuntime.created.length, 0);

const manyBundle = new Uint8Array(96 * 4);
const manyManifest = defineWebGpuModelResourceManifest({
  modelId: 'acme/uncapped',
  revision: 'r1',
  bundle: { byteLength: manyBundle.byteLength, sha256: sha256(manyBundle) },
  allocations: Array.from({ length: 96 }, (_, index) => ({
    allocationId: `part-${index}`,
    byteOffset: index * 4,
    byteLength: 4,
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
    tensors: [{ name: `tensor.${index}`, dtype: 'u32', shape: [1], byteOffset: 0, byteLength: 4 }],
  })),
});
const manyResidency = createWebGpuResourceResidency({ sessionId: 'many' });
const manyRuntime = runtimeFixture();
const manyModel = await loadWebGpuModelResources({
  manifest: manyManifest,
  bundle: manyBundle,
  route: routeFixture({
    routeId: 'many-route',
    runtime: manyRuntime,
    residency: manyResidency,
    factory: createWebGpuResourceFactory({ sessionId: 'many', residency: manyResidency }),
  }),
});
assert.equal(manyModel.allocations.length, 96);
assert.equal(Object.keys(manyModel.tensors).length, 96);
assert.equal(manyRuntime.created.length, 96);
manyModel.release();

const lost = new Promise(() => {});
const sessionRuntime = runtimeFixture();
const session = await kit.createWebGpuInferenceSession({
  sessionId: 'manifest-session',
  device: {
    queue: { writeBuffer: sessionRuntime.writeBuffer.bind(sessionRuntime) },
    createBuffer: sessionRuntime.createBuffer.bind(sessionRuntime),
    features: new Set(),
    limits: {},
    lost,
  },
  adapterName: 'fixture-adapter',
});
const sessionRoute = await session.registerRoute({ routeId: 'session-route' });
assert.equal(typeof sessionRoute.loadModelResources, 'function');
const sessionModel = await sessionRoute.loadModelResources({ manifest, bundle });
assert.equal(sessionModel.allocations.length, 2);
sessionModel.release();
assert.equal(session.unregisterRoute(sessionRoute.routeId).status, 'detached');
assert.throws(
  () => sessionRoute.loadModelResources({ manifest, bundle }),
  /detached|unregistered/i,
);

const lossDuringCreate = deferred();
let lossBufferDestroyCount = 0;
const lossSession = await kit.createWebGpuInferenceSession({
  sessionId: 'loss-during-model-create',
  device: {
    queue: { writeBuffer() {} },
    createBuffer() {
      lossDuringCreate.resolve({ reason: 'lost-during-create', message: 'fixture loss' });
      return {
        destroy() { lossBufferDestroyCount += 1; },
      };
    },
    features: new Set(),
    limits: {},
    lost: lossDuringCreate.promise,
  },
  adapterName: 'fixture-adapter',
});
const lossRoute = await lossSession.registerRoute({ routeId: 'loss-route' });
await assert.rejects(
  () => lossRoute.loadModelResources({ manifest: magicManifest, bundle: magicBundle }),
  /device-lost|invalidated|lost-during-create/i,
);
await lossSession.deviceLost;
await lossSession.resourceFactory.drain();
assert.equal(lossSession.resourceFactory.snapshot().flights[0].status, 'invalidated');
assert.equal(lossBufferDestroyCount, 1, 'managed model buffer rejected by invalidation must be destroyed exactly once');

console.log('model resource manifest contracts passed');
