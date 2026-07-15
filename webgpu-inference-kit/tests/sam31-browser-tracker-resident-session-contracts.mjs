import assert from 'node:assert/strict';

import * as kit from '../src/index.js';
import { createSam31BrowserTrackerResidentSessionForTest } from '../src/sam31-browser-tracker-session.js';

assert.equal(
  kit.SAM31_BROWSER_TRACKER_RESIDENT_SESSION_SCHEMA,
  'kaminos.sam31-browser-tracker-resident-session.v0',
);
assert.equal(typeof kit.createSam31BrowserTrackerResidentSession, 'function');
assert.equal(
  kit.createSam31BrowserTrackerResidentSessionForTest,
  undefined,
  'the resident lifecycle seam must not be part of the public kit API',
);

const events = [];
const device = { queue: {}, lost: Promise.resolve({ reason: 'destroyed', message: '' }) };
const inferenceSession = {
  adapter: { info: { description: 'resident-test-adapter' } },
  device,
  queue: device.queue,
  backendIdentity: { kind: 'webgpu-local', adapterName: 'resident-test-adapter' },
  deviceLost: device.lost,
  async drain() { events.push('drain'); return this.snapshot(); },
  unregisterRoute(routeId) { events.push(`unregister:${routeId}`); return { routeId, status: 'detached' }; },
  close() { events.push('close-session'); return { status: 'closed', deviceOwnership: 'owned' }; },
  snapshot() { return { status: 'active', residency: { activeLeaseCount: 1 } }; },
};
const ownerRoute = { routeId: 'sam31.resident-model-owner.webgpu-local.v0' };
const liveBufferIds = ['resident-buffer:1', 'resident-buffer:2'];
let released = false;
const residentResources = {
  bind() {},
  residentTensorResolver() { return null; },
  evidence() {
    return {
      schema: 'kaminos.sam31-resident-model-resources-evidence.v0',
      released,
      truncated: false,
      resourceCount: 2,
      allocationCount: 2,
      uploadCount: 2,
      bindingCount: 0,
      resources: liveBufferIds.map((liveBufferId, index) => ({ liveBufferId, resourceId: `resource:${index}` })),
      bindings: [],
    };
  },
  release() { released = true; events.push('release-model'); return { status: 'released' }; },
};
const modelPackageRuntime = {
  packageId: 'sam31-model-package:test',
  modelPackage: { packageId: 'sam31-model-package:test' },
  loadFloat32() {},
  loadUint8() {},
  cacheEvidence: () => ({ staticNetworkLoadCount: 2 }),
};

let nextInvocation = 0;
const callerRuntimes = [];
async function createCallerRuntime({ modelPackageRuntime: modelRuntime, sourceImages, initialMask, session }) {
  assert.notEqual(modelRuntime.residentTensorResolver, residentResources.residentTensorResolver, 'the public owner must wrap residency in a fail-closed resolver');
  assert.throws(
    () => modelRuntime.residentTensorResolver({ name: 'unbound-static', sourceData: new Float32Array(1) }),
    /did not resolve to authenticated model residency/,
  );
  assert.equal(modelRuntime.bindResidentTensor, residentResources.bind);
  const runtime = {
    ...modelRuntime,
    invocationId: `invocation:${nextInvocation++}`,
    sourceImages,
    initialMask,
    session,
  };
  callerRuntimes.push(runtime);
  return runtime;
}

function completeResult(packageRuntime) {
  const rows = Array.from({ length: 19 }, (_, index) => `${packageRuntime.invocationId}:${index}`);
  return {
    evidence: { passed: true },
    receipts: [...rows],
    requestIds: [...rows],
    requestedRouteIds: [...rows],
    effectiveRouteIds: [...rows],
    packageRuntime: { invocationId: packageRuntime.invocationId },
  };
}

let holdInvocation = null;
async function executeInvocation({ packageRuntime, adapter, device: effectiveDevice }) {
  assert.equal(adapter, inferenceSession.adapter);
  assert.equal(effectiveDevice, device);
  if (packageRuntime.session?.fail === true) throw new Error('intentional resident invocation failure');
  if (holdInvocation) return holdInvocation.promise.then(() => completeResult(packageRuntime));
  return completeResult(packageRuntime);
}

const residentSession = createSam31BrowserTrackerResidentSessionForTest({
  modelPackageRuntime,
  inferenceSession,
  ownerRoute,
  residentResources,
  createCallerRuntime,
  executeInvocation,
});
assert.equal(residentSession.status, 'open');

const invocationInput = index => ({
  sourceImages: [new Uint8Array([index, 0]), new Uint8Array([index, 1])],
  initialMask: new Float32Array([index % 2]),
  session: { sessionId: `caller:${index}` },
});
const first = await residentSession.run(invocationInput(0));
const second = await residentSession.run(invocationInput(1));
assert.equal(callerRuntimes.length, 2);
assert.notEqual(callerRuntimes[0], callerRuntimes[1], 'every run must receive a fresh caller invocation runtime');
assert.notEqual(first.packageRuntime.invocationId, second.packageRuntime.invocationId);
for (const result of [first, second]) {
  assert.deepEqual(result.residentRuntime.liveBufferIds, liveBufferIds);
  assert.equal(result.residentRuntime.modelAllocationDelta, 0);
  assert.equal(result.residentRuntime.modelUploadDelta, 0);
  assert.equal(result.residentRuntime.truncated, false);
}

await assert.rejects(
  () => residentSession.run({ ...invocationInput(2), session: { sessionId: 'caller:failed', fail: true } }),
  /intentional resident invocation failure/,
);
const recovered = await residentSession.run(invocationInput(3));
assert.equal(recovered.residentRuntime.invocationIndex, 3, 'a retry must not reuse the failed attempt index');
assert.equal(residentSession.invocationCount, 3);
assert.equal(residentSession.attemptCount, 4);

let releaseHold;
holdInvocation = {};
holdInvocation.promise = new Promise(resolve => { releaseHold = resolve; });
const thirdRun = residentSession.run(invocationInput(4));
await assert.rejects(() => residentSession.run(invocationInput(5)), /already running/);
releaseHold();
await thirdRun;
holdInvocation = null;
assert.equal(residentSession.invocationCount, 4, 'the resident session must not impose a hidden invocation cap');
assert.equal(residentSession.attemptCount, 5);
assert.equal(residentSession.evidence().invocations.length, 5);
assert.equal(residentSession.evidence().truncated, false);

const closeEvidence = await residentSession.close();
assert.deepEqual(events, [
  'drain',
  'release-model',
  `unregister:${ownerRoute.routeId}`,
  'close-session',
]);
assert.equal(closeEvidence.queueDrained, true);
assert.equal(closeEvidence.modelReleased, true);
assert.equal(closeEvidence.ownerRouteDetached, true);
assert.equal(closeEvidence.sessionClosed, true);
assert.equal(closeEvidence.deviceLossAwaited, true);
assert.equal(await residentSession.close(), closeEvidence, 'resident close must be idempotent');
await assert.rejects(() => residentSession.run(invocationInput(4)), /closed/);

await assert.rejects(
  () => kit.createSam31BrowserTrackerResidentSession({ modelPackageRuntime }),
  /does not accept modelPackageRuntime/,
);
await assert.rejects(
  () => kit.createSam31BrowserTrackerResidentSession(),
  /model package root and shared cache are required/,
);

console.log('sam3.1 browser tracker resident session contracts passed');
