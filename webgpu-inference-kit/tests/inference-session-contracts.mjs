import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.createWebGpuInferenceSession,
  'function',
  'the kit must export a shared WebGPU inference session',
);

const {
  WEBGPU_INFERENCE_SESSION_SCHEMA,
  WEBGPU_INFERENCE_SESSION_DEVICE_LOSS_SCHEMA,
  createWebGpuInferenceSession,
} = kit;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDevice() {
  const lost = deferred();
  let destroyCount = 0;
  let bufferDestroyCount = 0;
  return {
    device: {
      queue: {},
      features: new Set(['shader-f16']),
      limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 29 },
      lost: lost.promise,
      createBuffer(descriptor) {
        let destroyed = false;
        return {
          descriptor,
          destroy() {
            if (destroyed) return;
            destroyed = true;
            bufferDestroyCount += 1;
          },
        };
      },
      destroy() {
        destroyCount += 1;
        lost.resolve({ reason: 'destroyed', message: 'destroyed by contract test' });
      },
    },
    lose(info) { lost.resolve(info); },
    destroyCount() { return destroyCount; },
    bufferDestroyCount() { return bufferDestroyCount; },
  };
}

await assert.rejects(
  () => createWebGpuInferenceSession({}),
  /sessionId.*non-empty/i,
);
await assert.rejects(
  () => createWebGpuInferenceSession({
    sessionId: 'capped',
    device: createDevice().device,
    adapterName: 'test-adapter',
    maxRoutes: 4,
  }),
  /does not impose.*route cap|uncapped/i,
);
await assert.rejects(
  () => createWebGpuInferenceSession({
    sessionId: 'missing-adapter-identity',
    device: createDevice().device,
  }),
  /adapter.*identity|adapterName/i,
);

const identityDevice = createDevice();
const callerIdentity = {
  kind: 'webgpu-local',
  runtime: 'browser',
  adapterName: 'caller-owned-name',
  requestedFeatures: [],
  features: ['shader-f16'],
  limits: { maxBufferSize: 2 ** 30 },
  timestampQuery: 'unavailable',
};
const identitySession = await createWebGpuInferenceSession({
  sessionId: 'identity-custody',
  device: identityDevice.device,
  backendIdentity: callerIdentity,
});
callerIdentity.adapterName = 'mutated-after-session-creation';
assert.equal(identitySession.snapshot().backendIdentity.adapterName, 'caller-owned-name');
identitySession.close();

const borrowed = createDevice();
let nowMs = 0;
const session = await createWebGpuInferenceSession({
  sessionId: 'kiln-primary',
  device: borrowed.device,
  adapterName: 'Apple test adapter',
  now: () => {
    nowMs += 1;
    return nowMs;
  },
});

const initial = session.snapshot();
assert.equal(initial.schema, WEBGPU_INFERENCE_SESSION_SCHEMA);
assert.equal(initial.sessionId, 'kiln-primary');
assert.equal(initial.status, 'active');
assert.equal(initial.deviceOwnership, 'borrowed');
assert.equal(initial.routeRetention, 'uncapped-until-explicit-unregister');
assert.equal(initial.deviceLoss, null);
assert.deepEqual(initial.routes, []);

let activeRouteCount = 0;
const executionLog = [];
const holderRelease = deferred();
const holderStarted = deferred();

function runtimeOptions(routeId) {
  return {
    runtimeLabel: `${routeId}.runtime`,
    kernel: { profile: `${routeId}.kernel.v0` },
    requiredStages: ['identity-stage'],
    yield: async () => ({}),
  };
}

const holderRoute = await session.registerRoute({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runtimeOptions: runtimeOptions('sharp'),
});
const waitingRoute = await session.registerRoute({
  routeId: 'sf3d.image-to-mesh.webgpu-local.v0',
  runtimeOptions: runtimeOptions('sf3d'),
});
holderRoute.runtime.createBuffer({ label: 'holder-owned', size: 128, usage: 1 });

const concurrentRouteId = 'kimodo.text-to-motion.webgpu-local.v0';
const concurrentRegistrations = await Promise.allSettled([
  session.registerRoute({ routeId: concurrentRouteId }),
  session.registerRoute({ routeId: concurrentRouteId }),
]);
assert.deepEqual(
  concurrentRegistrations.map(result => result.status).sort(),
  ['fulfilled', 'rejected'],
  'concurrent duplicate registration must create exactly one route',
);
assert.match(concurrentRegistrations.find(result => result.status === 'rejected').reason.message, /duplicate route/i);
const concurrentRoute = concurrentRegistrations.find(result => result.status === 'fulfilled').value;
concurrentRoute.runtime.createBuffer({ label: 'concurrent-owned', size: 64, usage: 1 });
session.unregisterRoute(concurrentRouteId);
assert.equal(borrowed.bufferDestroyCount(), 1, 'route unregister must dispose route-owned runtime buffers exactly once');

assert.equal(holderRoute.runtime.device, borrowed.device);
assert.equal(waitingRoute.runtime.device, borrowed.device);
assert.equal(holderRoute.runtime.admissionCoordinator, session.admissionCoordinator);
assert.equal(Object.isFrozen(holderRoute.runtime.backendIdentity), true);
assert.throws(
  () => { holderRoute.runtime.backendIdentity.adapterName = 'forged-route-adapter'; },
  /read only|readonly|not extensible|Cannot assign/i,
);
assert.equal(holderRoute.runtime.backendIdentity.adapterName, 'Apple test adapter');
await holderRoute.runtime.runStage('identity-stage', async () => 'identity-recorded');
assert.equal(
  holderRoute.runtime.finishProfile({
    evidence: { mode: 'live', source: 'session-identity-contract' },
  }).backend.adapterName,
  'Apple test adapter',
);
assert.equal(holderRoute.snapshot().queue.admissionPolicy, 'shared-global-fifo-by-eligible-route-head');

await assert.rejects(
  () => session.registerRoute({ routeId: holderRoute.routeId }),
  /duplicate route/i,
);
await assert.rejects(
  () => session.registerRoute({
    routeId: 'override.webgpu-local.v0',
    runtimeOptions: { device: createDevice().device },
  }),
  /session owns.*device|cannot override/i,
);

const holder = holderRoute.enqueue({
  jobId: 'holder',
  async execute() {
    assert.equal(activeRouteCount, 0);
    activeRouteCount += 1;
    executionLog.push('start:holder');
    holderStarted.resolve();
    await holderRelease.promise;
    executionLog.push('end:holder');
    activeRouteCount -= 1;
    return 'holder.ply';
  },
});
await holderStarted.promise;

const waiting = waitingRoute.enqueue({
  jobId: 'waiting',
  async execute() {
    executionLog.push('should-not-run:waiting');
    return 'waiting.glb';
  },
});
await Promise.resolve();
assert.throws(() => session.close(), /drain.*before close|active.*work/i);

borrowed.lose({ reason: 'unknown', message: 'opaque browser diagnostic' });
const loss = await session.deviceLost;
assert.equal(loss.schema, WEBGPU_INFERENCE_SESSION_DEVICE_LOSS_SCHEMA);
assert.equal(loss.sessionId, 'kiln-primary');
assert.equal(loss.reason, 'unknown');
assert.equal(loss.message, 'opaque browser diagnostic');
assert.equal(session.snapshot().status, 'device-lost');

const waitingCompletion = await waiting.completion;
assert.equal(waitingCompletion.status, 'cancelled-before-start');
assert.match(waitingCompletion.cancellation.reason, /device-lost:unknown/);
assert.throws(
  () => waitingRoute.enqueue({ jobId: 'after-loss', async execute() {} }),
  /device.*lost/i,
);
assert.equal(holder.cancel('after-device-loss').status, 'not-cancelled-active');

holderRelease.resolve();
assert.equal((await holder.completion).output, 'holder.ply');
await session.drain();
assert.deepEqual(executionLog, ['start:holder', 'end:holder']);

assert.equal(session.unregisterRoute(waitingRoute.routeId).routeId, waitingRoute.routeId);
assert.throws(
  () => waitingRoute.enqueue({ jobId: 'detached', async execute() {} }),
  /unregistered|detached/i,
);
const closedBorrowed = session.close();
assert.equal(closedBorrowed.status, 'closed');
assert.equal(borrowed.destroyCount(), 0, 'closing a borrowed device session must not destroy caller-owned state');
assert.equal(borrowed.bufferDestroyCount(), 2, 'session close must dispose attached route buffers without redisposing an unregistered route runtime');
session.close();
assert.equal(borrowed.bufferDestroyCount(), 2, 'repeated session close must not redispose route-owned buffers');

const ownedDevice = createDevice();
const adapter = {
  info: { description: 'owned adapter' },
  features: ownedDevice.device.features,
  limits: ownedDevice.device.limits,
  async requestDevice() { return ownedDevice.device; },
};
const ownedSession = await createWebGpuInferenceSession({
  sessionId: 'owned-session',
  gpu: { async requestAdapter() { return adapter; } },
  adapterName: 'owned adapter',
});
assert.equal(ownedSession.snapshot().deviceOwnership, 'owned');
assert.equal(ownedSession.close().status, 'closed');
assert.equal(ownedDevice.destroyCount(), 1);
assert.equal((await ownedSession.deviceLost).reason, 'destroyed');
assert.equal(ownedSession.snapshot().status, 'closed');

const alreadyLost = createDevice();
alreadyLost.lose({ reason: 'unknown', message: 'lost before session creation' });
const lostAtCreation = await createWebGpuInferenceSession({
  sessionId: 'already-lost-session',
  device: alreadyLost.device,
  adapterName: 'lost adapter',
});
assert.equal(lostAtCreation.snapshot().status, 'device-lost');
await assert.rejects(
  () => lostAtCreation.registerRoute({ routeId: 'too-late.webgpu-local.v0' }),
  /device.*lost/i,
);

console.log('inference session contracts passed');
