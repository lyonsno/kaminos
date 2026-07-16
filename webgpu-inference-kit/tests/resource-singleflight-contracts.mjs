import assert from 'node:assert/strict';
import * as kit from '../src/index.js';

assert.equal(typeof kit.createWebGpuResourceFactory, 'function');

const { createWebGpuResourceFactory, createWebGpuResourceResidency } = kit;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const residency = createWebGpuResourceResidency({ sessionId: 'singleflight' });
const factory = createWebGpuResourceFactory({ sessionId: 'singleflight', residency });
const creation = deferred();
let createCount = 0;
const requests = Array.from({ length: 32 }, (_, index) => factory.acquireOrCreate({
  resourceId: 'weights.shared',
  routeId: `route.${index}`,
  declaredBytes: 4096,
  kind: 'model-weight',
  metadata: { precision: 'f16' },
  async create({ signal }) {
    createCount += 1;
    assert.equal(signal.aborted, false);
    return creation.promise;
  },
  dispose(resource) { resource.destroyed = true; },
}));

await Promise.resolve();
assert.equal(createCount, 1);
assert.equal(factory.snapshot().activeFlightCount, 1);
assert.equal(factory.snapshot().flights[0].waiterCount, 32);
await assert.rejects(
  () => factory.acquireOrCreate({
    resourceId: 'weights.shared', routeId: 'conflict', declaredBytes: 8192,
    kind: 'model-weight', metadata: { precision: 'f16' }, async create() { return {}; }, dispose() {},
  }),
  /conflicting.*descriptor/i,
);

const shared = { label: 'shared-weight-buffer' };
creation.resolve(shared);
const leases = await Promise.all(requests);
assert.equal(createCount, 1);
assert.equal(new Set(leases.map(lease => lease.resource)).size, 1);
assert.equal(leases[0].resource, shared);
assert.equal(residency.snapshot().totalResidentDeclaredBytes, 4096);
assert.equal(residency.snapshot().activeLeaseCount, 32);
leases.forEach(lease => lease.release());

const partial = deferred();
const partialAbort = new AbortController();
let partialCreatorSignal;
const cancelled = factory.acquireOrCreate({
  resourceId: 'partial', routeId: 'cancelled', declaredBytes: 16, signal: partialAbort.signal,
  async create({ signal }) { partialCreatorSignal = signal; return partial.promise; }, dispose() {},
});
const survivor = factory.acquireOrCreate({
  resourceId: 'partial', routeId: 'survivor', declaredBytes: 16, async create() { throw new Error('must not run'); }, dispose() {},
});
partialAbort.abort('caller-left');
await assert.rejects(cancelled, /aborted|caller-left/i);
assert.equal(partialCreatorSignal.aborted, false);
partial.resolve({ label: 'partial' });
assert.equal((await survivor).routeId, 'survivor');

let failedCreates = 0;
await assert.rejects(
  () => factory.acquireOrCreate({
    resourceId: 'retry', routeId: 'first', declaredBytes: 8,
    async create() { failedCreates += 1; throw new Error('upload failed'); }, dispose() {},
  }),
  /upload failed/,
);
const retryLease = await factory.acquireOrCreate({
  resourceId: 'retry', routeId: 'second', declaredBytes: 8,
  async create() { failedCreates += 1; return { label: 'retry-success' }; }, dispose() {},
});
assert.equal(failedCreates, 2);
assert.equal(retryLease.resource.label, 'retry-success');
assert.deepEqual(factory.snapshot().flights.filter(flight => flight.resourceId === 'retry').map(flight => flight.status), ['failed', 'succeeded']);

const allAbortGate = deferred();
const allAbort = new AbortController();
let allAbortCreatorSignal;
const abandoned = factory.acquireOrCreate({
  resourceId: 'abandoned', routeId: 'gone', declaredBytes: 4, signal: allAbort.signal,
  async create({ signal }) { allAbortCreatorSignal = signal; return allAbortGate.promise; }, dispose() {},
});
allAbort.abort('all-waiters-left');
await assert.rejects(abandoned, /aborted|all-waiters-left/i);
assert.equal(allAbortCreatorSignal.aborted, true);
allAbortGate.reject(new Error('creator observed abort'));
await factory.drain();
assert.equal(factory.snapshot().activeFlightCount, 0);

assert.equal(factory.snapshot().retention, 'uncapped-until-explicit-forget-flight');
assert.equal(factory.snapshot().flights.length, 5);
assert.equal(factory.forgetFlight(factory.snapshot().flights[0].flightId), true);

const lost = deferred();
const session = await kit.createWebGpuInferenceSession({
  sessionId: 'session-singleflight',
  device: { queue: {}, features: new Set(), limits: {}, lost: lost.promise },
  adapterName: 'test-adapter',
});
assert.equal(session.resourceFactory.snapshot().flights.length, 0);
const routeA = await session.registerRoute({ routeId: 'sharp' });
const routeB = await session.registerRoute({ routeId: 'sf3d' });
const sessionGate = deferred();
let sessionCreateCount = 0;
const routeRequestA = routeA.residency.acquireOrCreate({
  resourceId: 'session.weights', declaredBytes: 128,
  async create() { sessionCreateCount += 1; return sessionGate.promise; }, dispose() {},
});
const routeRequestB = routeB.residency.acquireOrCreate({
  resourceId: 'session.weights', declaredBytes: 128,
  async create() { sessionCreateCount += 1; return {}; }, dispose() {},
});
await Promise.resolve();
assert.equal(sessionCreateCount, 1);
assert.throws(() => session.unregisterRoute('sharp'), /resource creation|waiter.*settle/i);
assert.throws(() => session.close(), /resource creation|flight.*settle/i);
sessionGate.resolve({ label: 'session.weights' });
const [sessionLeaseA, sessionLeaseB] = await Promise.all([routeRequestA, routeRequestB]);
assert.equal(sessionLeaseA.resource, sessionLeaseB.resource);
sessionLeaseA.release();
sessionLeaseB.release();

const detachedCreatorGate = deferred();
const detachedCreatorAbort = new AbortController();
const detachedCreator = routeB.residency.acquireOrCreate({
  resourceId: 'detached.creator', declaredBytes: 32, signal: detachedCreatorAbort.signal,
  async create() { return detachedCreatorGate.promise; }, dispose() {},
});
detachedCreatorAbort.abort('route-cancelled');
await assert.rejects(detachedCreator, /aborted|route-cancelled/i);
assert.throws(
  () => session.unregisterRoute(routeB.routeId),
  /resource creation|active flight|settle/i,
);
detachedCreatorGate.reject(new Error('creator settled after abort'));
await session.resourceFactory.drain();
assert.equal(session.unregisterRoute(routeB.routeId).status, 'detached');

const lossGate = deferred();
const lossRequest = routeA.residency.acquireOrCreate({
  resourceId: 'loss.weights', declaredBytes: 64,
  async create({ signal }) {
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('loss-aborted')), { once: true }));
    return lossGate.promise;
  },
  dispose() {},
});
lost.resolve({ reason: 'unknown', message: 'fixture loss' });
await session.deviceLost;
await assert.rejects(lossRequest, /device-lost|invalidated|loss-aborted/i);
assert.equal(session.resourceFactory.snapshot().status, 'invalidated');
assert.equal(session.resourceFactory.snapshot().activeFlightCount, 0);

console.log('resource single-flight contracts passed');
