import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.createWebGpuResourceResidency,
  'function',
  'the kit must export a session-scoped GPU resource residency ledger',
);

const {
  WEBGPU_RESOURCE_RESIDENCY_SCHEMA,
  WEBGPU_RESOURCE_RESIDENCY_RESOURCE_SCHEMA,
  createWebGpuInferenceSession,
  createWebGpuResourceResidency,
} = kit;

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createDevice() {
  const lost = deferred();
  return {
    device: { queue: {}, features: new Set(), limits: {}, lost: lost.promise },
    lose(info) { lost.resolve(info); },
  };
}

await assert.rejects(
  () => kit.createWebGpuInferenceSession({
    sessionId: 'forged-residency',
    device: createDevice().device,
    adapterName: 'test-adapter',
    residency: {},
  }),
  /session owns.*residency|cannot override/i,
);

let nowMs = 0;
const residency = createWebGpuResourceResidency({
  sessionId: 'kiln-memory',
  now: () => ++nowMs,
});
assert.throws(
  () => residency.acquire({ resourceId: 'missing-object', routeId: 'sharp', declaredBytes: 1 }),
  /first acquisition.*resource|resource.*required/i,
);

assert.throws(
  () => createWebGpuResourceResidency({ sessionId: 'capped', maxBytes: 1024 }),
  /does not impose.*memory cap|caller.*policy|uncapped/i,
);
assert.throws(
  () => residency.acquire({ resourceId: 'bad', routeId: 'sharp', declaredBytes: 1.5 }),
  /declaredBytes.*safe.*integer/i,
);

const sharedWeightBuffer = { label: 'dinov2.vitl14.weights.f16' };
const sharpWeights = residency.acquire({
  resourceId: 'weights.dinov2.vitl14',
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  declaredBytes: 1_024,
  kind: 'model-weight',
  metadata: { precision: 'f16' },
  resource: sharedWeightBuffer,
});
assert.equal(sharpWeights.resource, sharedWeightBuffer);
const sf3dWeights = residency.acquire({
  resourceId: 'weights.dinov2.vitl14',
  routeId: 'sf3d.image-to-mesh.webgpu-local.v0',
  declaredBytes: 1_024,
  kind: 'model-weight',
  metadata: { precision: 'f16' },
});
assert.equal(sf3dWeights.resource, sharedWeightBuffer, 'the second route must receive the same live GPU resource');
const sharpActivation = residency.acquire({
  resourceId: 'sharp.activation.0',
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  declaredBytes: 256,
  kind: 'activation',
  resource: { label: 'sharp.activation.0' },
});

let snapshot = residency.snapshot();
assert.equal(snapshot.schema, WEBGPU_RESOURCE_RESIDENCY_SCHEMA);
assert.equal(snapshot.sessionId, 'kiln-memory');
assert.equal(snapshot.status, 'active');
assert.equal(snapshot.accountingAuthority, 'caller-declared-allocation-bytes-not-browser-global-vram');
assert.equal(snapshot.retention, 'uncapped-until-explicit-forget');
assert.equal(snapshot.totalResidentDeclaredBytes, 1_280);
assert.equal(snapshot.activeLeaseCount, 3);
assert.equal(snapshot.resources.length, 2, 'a shared allocation must count once globally');
assert.deepEqual(snapshot.evictionCandidates, []);
assert.deepEqual(
  snapshot.routes.map(route => [route.routeId, route.leasedDeclaredBytes, route.activeLeaseCount]),
  [
    ['sf3d.image-to-mesh.webgpu-local.v0', 1_024, 1],
    ['sharp.image-to-splat.webgpu-local.v0', 1_280, 2],
  ],
);
assert.throws(
  () => residency.acquire({
    resourceId: 'weights.dinov2.vitl14',
    routeId: 'kimodo.text-to-motion.webgpu-local.v0',
    declaredBytes: 1_024,
    kind: 'model-weight',
    metadata: { precision: 'f16' },
    resource: { label: 'different-buffer' },
  }),
  /different.*resource object|resource identity/i,
);
assert.equal(snapshot.resources[0].schema, WEBGPU_RESOURCE_RESIDENCY_RESOURCE_SCHEMA);
assert.equal(snapshot.resources[0].liveResource, 'present-not-serialized');
assert.equal(Object.hasOwn(snapshot.resources[0], 'resource'), false, 'snapshots must not serialize live GPU objects');
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(Object.isFrozen(snapshot.resources[0].metadata), true);
assert.throws(
  () => { snapshot.resources[0].metadata.precision = 'forged'; },
  /read only|readonly|not extensible|Cannot assign/i,
);

assert.throws(
  () => residency.acquire({
    resourceId: 'weights.dinov2.vitl14',
    routeId: 'kimodo.text-to-motion.webgpu-local.v0',
    declaredBytes: 2_048,
    kind: 'model-weight',
    metadata: { precision: 'f16' },
  }),
  /conflicting.*resource identity|descriptor/i,
);
assert.throws(
  () => residency.evict('weights.dinov2.vitl14'),
  /active lease|leased/i,
);

assert.equal(sf3dWeights.release().status, 'released');
assert.equal(sf3dWeights.release().status, 'already-released');
snapshot = residency.snapshot();
assert.equal(snapshot.totalResidentDeclaredBytes, 1_280);
assert.equal(snapshot.routes.find(route => route.routeId.startsWith('sf3d')).leasedDeclaredBytes, 0);
assert.deepEqual(snapshot.evictionCandidates, []);

assert.equal(sharpWeights.release().status, 'released');
snapshot = residency.snapshot();
assert.deepEqual(snapshot.evictionCandidates.map(candidate => candidate.resourceId), ['weights.dinov2.vitl14']);
assert.equal(residency.evict('weights.dinov2.vitl14').status, 'evicted');
assert.equal(residency.snapshot().totalResidentDeclaredBytes, 256);

const reacquiredWeights = residency.acquire({
  resourceId: 'weights.dinov2.vitl14',
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  declaredBytes: 1_024,
  kind: 'model-weight',
  metadata: { precision: 'f16' },
  resource: { label: 'dinov2.vitl14.weights.f16.generation-2' },
});
assert.equal(reacquiredWeights.generation, 2);
assert.equal(residency.snapshot().totalResidentDeclaredBytes, 1_280);
assert.equal(reacquiredWeights.release().status, 'released');
assert.equal(residency.evict('weights.dinov2.vitl14').status, 'evicted');
assert.equal(sharpActivation.release().status, 'released');

for (let index = 0; index < 96; index += 1) {
  const lease = residency.acquire({
    resourceId: `uncapped.${index}`,
    routeId: 'uncapped.webgpu-local.v0',
    declaredBytes: index,
    kind: 'test-fixture',
    resource: { index },
  });
  lease.release();
}
assert.equal(
  residency.snapshot().resources.filter(resource => resource.resourceId.startsWith('uncapped.')).length,
  96,
  'the ledger must not truncate retained allocation identity',
);

const device = createDevice();
const session = await createWebGpuInferenceSession({
  sessionId: 'session-residency',
  device: device.device,
  adapterName: 'test-adapter',
});
const route = await session.registerRoute({ routeId: 'sharp.image-to-splat.webgpu-local.v0' });
assert.equal(route.residency, session.residency, 'routes must share their session residency ledger');
const routeLease = route.acquireResource({
  resourceId: 'sharp.weights',
  declaredBytes: 4_096,
  kind: 'model-weight',
  resource: { label: 'sharp.weights' },
});
assert.equal(session.snapshot().residency.totalResidentDeclaredBytes, 4_096);
assert.throws(
  () => session.unregisterRoute(route.routeId),
  /resource lease|release.*before unregister/i,
);
assert.throws(
  () => session.close(),
  /resource lease|release.*before close/i,
);
routeLease.release();
assert.equal(session.unregisterRoute(route.routeId).status, 'detached');

const detachedSnapshot = route.snapshot();
assert.equal(detachedSnapshot.residency.activeLeaseCount, 0);
assert.throws(
  () => route.acquireResource({ resourceId: 'detached', declaredBytes: 1 }),
  /unregistered|detached/i,
);

const route2 = await session.registerRoute({ routeId: 'sf3d.image-to-mesh.webgpu-local.v0' });
let lossDisposeCount = 0;
const doomedLease = route2.acquireResource({
  resourceId: 'sf3d.weights',
  declaredBytes: 8_192,
  kind: 'model-weight',
  resource: { label: 'sf3d.weights' },
  ownership: 'managed',
  dispose() { lossDisposeCount += 1; },
});
device.lose({ reason: 'unknown', message: 'fixture loss' });
await session.deviceLost;
const lostResidency = session.snapshot().residency;
assert.equal(lostResidency.status, 'invalidated');
assert.equal(lostResidency.totalResidentDeclaredBytes, 0);
assert.equal(lostResidency.activeLeaseCount, 0);
assert.equal(lostResidency.invalidation.reason, 'device-lost:unknown');
assert.equal(doomedLease.release().status, 'invalidated');
assert.equal(lossDisposeCount, 0, 'device loss must not dispose already-invalid GPU resources');
assert.throws(
  () => route2.acquireResource({ resourceId: 'after-loss', declaredBytes: 1 }),
  /device.*lost|invalidated/i,
);

const closeDevice = createDevice();
const closeSession = await createWebGpuInferenceSession({
  sessionId: 'close-residency',
  device: closeDevice.device,
  adapterName: 'test-adapter',
});
const closeRoute = await closeSession.registerRoute({ routeId: 'moge.depth.webgpu-local.v0' });
let managedDisposeCount = 0;
const closeLease = closeRoute.acquireResource({
  resourceId: 'moge.weights',
  declaredBytes: 512,
  resource: { label: 'moge.weights' },
  ownership: 'managed',
  dispose() { managedDisposeCount += 1; },
});
closeLease.release();
const closed = closeSession.close();
assert.equal(closed.residency.status, 'invalidated');
assert.equal(closed.residency.invalidation.reason, 'session-closed');
assert.equal(closed.residency.totalResidentDeclaredBytes, 0);
assert.equal(managedDisposeCount, 1, 'session close must dispose managed resident resources exactly once');

let evictedDisposeCount = 0;
const managed = createWebGpuResourceResidency({ sessionId: 'managed-eviction' });
const managedLease = managed.acquire({
  resourceId: 'managed.buffer',
  routeId: 'sharp',
  declaredBytes: 64,
  resource: { label: 'managed.buffer' },
  ownership: 'managed',
  dispose() { evictedDisposeCount += 1; },
});
managedLease.release();
assert.equal(managed.evict('managed.buffer').status, 'evicted');
assert.equal(evictedDisposeCount, 1);
assert.equal(managed.evict('managed.buffer').status, 'already-evicted');
assert.equal(evictedDisposeCount, 1);

const failingDisposeDevice = createDevice();
const failingDisposeSession = await createWebGpuInferenceSession({
  sessionId: 'failing-managed-disposal',
  device: failingDisposeDevice.device,
  adapterName: 'test-adapter',
});
const failingDisposeRoute = await failingDisposeSession.registerRoute({ routeId: 'sharp' });
const failingDisposeLease = failingDisposeRoute.acquireResource({
  resourceId: 'managed.failure',
  declaredBytes: 32,
  resource: { label: 'managed.failure' },
  ownership: 'managed',
  dispose() { throw new Error('fixture disposer failed'); },
});
failingDisposeLease.release();
const failingDisposeClosed = failingDisposeSession.close();
assert.equal(failingDisposeClosed.status, 'closed');
assert.equal(failingDisposeClosed.residency.status, 'invalidated');
assert.equal(failingDisposeClosed.residency.invalidation.managedDisposal.attemptedCount, 1);
assert.equal(failingDisposeClosed.residency.invalidation.managedDisposal.succeededCount, 0);
assert.equal(failingDisposeClosed.residency.invalidation.managedDisposal.failedCount, 1);
assert.match(
  failingDisposeClosed.residency.invalidation.managedDisposal.failures[0].message,
  /fixture disposer failed/,
);

console.log('resource residency contracts passed');
