import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.createWebGpuInferenceCoordinator,
  'function',
  'the kit must export a shared multi-route inference coordinator',
);

const {
  WEBGPU_INFERENCE_COORDINATOR_SCHEMA,
  createWebGpuInferenceCoordinator,
  createWebGpuInferenceQueue,
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

let nowMs = 0;
const coordinator = createWebGpuInferenceCoordinator({
  now: () => {
    nowMs += 1;
    return nowMs;
  },
});

assert.throws(
  () => createWebGpuInferenceCoordinator({ maxAdmissions: 4 }),
  /does not impose.*cap|uncapped/i,
);

const initial = coordinator.snapshot();
assert.equal(initial.schema, WEBGPU_INFERENCE_COORDINATOR_SCHEMA);
assert.equal(initial.status, 'idle');
assert.equal(initial.schedulingPolicy, 'global-fifo-by-eligible-route-head');
assert.equal(initial.retention, 'uncapped-until-explicit-forget');
assert.equal(initial.cancellationAuthority, 'pending-admission-only-no-active-work-preemption');
assert.equal(initial.activeAdmissionSequence, null);
assert.equal(initial.pendingAdmissionCount, 0);
assert.deepEqual(initial.admissions, []);

const executionLog = [];
let activeInvocationCount = 0;

function createRuntime(routeId) {
  return {
    routeId,
    async runInvocation({ invocationId }, execute) {
      assert.equal(activeInvocationCount, 0, 'shared admission must prevent cross-route overlap');
      activeInvocationCount += 1;
      executionLog.push(`start:${routeId}:${invocationId}`);
      try {
        return await execute(Object.freeze({
          routeId,
          invocationId,
          schedulerRevision: 0,
          scheduler: Object.freeze({ yieldMs: 0 }),
          getControl() { return 8; },
          async yieldToBrowser() {},
        }));
      } finally {
        executionLog.push(`end:${routeId}:${invocationId}`);
        activeInvocationCount -= 1;
      }
    },
  };
}

const sharpRoute = 'sharp.image-to-splat.webgpu-local.v0';
const sf3dRoute = 'sf3d.image-to-mesh.webgpu-local.v0';
const kimodoRoute = 'kimodo.text-to-motion.webgpu-local.v0';
const sharpQueue = createWebGpuInferenceQueue({
  runtime: createRuntime(sharpRoute),
  admissionCoordinator: coordinator,
});
const sf3dQueue = createWebGpuInferenceQueue({
  runtime: createRuntime(sf3dRoute),
  admissionCoordinator: coordinator,
});
const kimodoQueue = createWebGpuInferenceQueue({
  runtime: createRuntime(kimodoRoute),
  admissionCoordinator: coordinator,
});

const releaseSharp = deferred();
const sharpStarted = deferred();
const sharpFirst = sharpQueue.enqueue({
  jobId: 'sharp-first',
  async execute(invocation) {
    sharpStarted.resolve();
    invocation.reportProgress({ stage: 'spn', completed: 1, total: 2 });
    await releaseSharp.promise;
    return 'sharp.ply';
  },
});

await sharpStarted.promise;

const sharpSecond = sharpQueue.enqueue({
  jobId: 'sharp-second',
  async execute() { return 'sharp-second.ply'; },
});
const sf3dFirst = sf3dQueue.enqueue({
  jobId: 'sf3d-first',
  async execute() { return 'sf3d.glb'; },
});
const kimodoFirst = kimodoQueue.enqueue({
  jobId: 'kimodo-first',
  async execute() { return 'kimodo.motion'; },
});

await Promise.resolve();
await Promise.resolve();

const contended = coordinator.snapshot();
assert.equal(contended.status, 'running');
assert.equal(contended.activeAdmission.routeId, sharpRoute);
assert.equal(contended.activeAdmission.jobId, 'sharp-first');
assert.equal(contended.pendingAdmissionCount, 2);
assert.deepEqual(
  contended.pendingAdmissions.map(row => `${row.routeId}:${row.jobId}`),
  [`${sf3dRoute}:sf3d-first`, `${kimodoRoute}:kimodo-first`],
  'only eligible route heads enter global FIFO; sharp-second remains behind sharp-first locally',
);

const sf3dCancellation = sf3dFirst.cancel('superseded-source');
assert.equal(sf3dCancellation.status, 'cancelled-before-start');
assert.equal((await sf3dFirst.completion).status, 'cancelled-before-start');
assert.equal(coordinator.snapshot().pendingAdmissionCount, 1);

const activeCancellation = sharpFirst.cancel('too-late');
assert.equal(activeCancellation.status, 'not-cancelled-active');

releaseSharp.resolve();
const [sharpCompletion, kimodoCompletion, sharpSecondCompletion] = await Promise.all([
  sharpFirst.completion,
  kimodoFirst.completion,
  sharpSecond.completion,
]);
await Promise.all([sharpQueue.drain(), sf3dQueue.drain(), kimodoQueue.drain(), coordinator.drain()]);

assert.equal(sharpCompletion.output, 'sharp.ply');
assert.equal(sharpCompletion.progress.length, 1);
assert.equal(sharpCompletion.admission.routeId, sharpRoute);
assert.equal(kimodoCompletion.output, 'kimodo.motion');
assert.equal(sharpSecondCompletion.output, 'sharp-second.ply');
assert.deepEqual(executionLog, [
  `start:${sharpRoute}:sharp-first`,
  `end:${sharpRoute}:sharp-first`,
  `start:${kimodoRoute}:kimodo-first`,
  `end:${kimodoRoute}:kimodo-first`,
  `start:${sharpRoute}:sharp-second`,
  `end:${sharpRoute}:sharp-second`,
]);

const settled = coordinator.snapshot();
assert.equal(settled.status, 'idle');
assert.equal(settled.pendingAdmissionCount, 0);
assert.equal(settled.admissions.length, 4);
assert.equal(settled.admissions.filter(row => row.status === 'released').length, 3);
assert.equal(settled.admissions.filter(row => row.status === 'cancelled-before-start').length, 1);
assert.equal(settled.admissions.every(row => row.routeId && row.jobId), true);

const releasedSequence = settled.admissions.find(row => row.status === 'released').sequence;
assert.equal(coordinator.forgetAdmission(releasedSequence), true);
assert.equal(coordinator.forgetAdmission(releasedSequence), false);

const bulkQueues = [sharpQueue, sf3dQueue, kimodoQueue];
const bulkHandles = [];
for (let index = 0; index < 96; index += 1) {
  bulkHandles.push(bulkQueues[index % bulkQueues.length].enqueue({
    jobId: `bulk-${index}`,
    async execute() { return index; },
  }));
}
await coordinator.drain();
const bulkCompletions = await Promise.all(bulkHandles.map(handle => handle.completion));
assert.deepEqual(
  bulkCompletions.map(row => row.output).sort((a, b) => a - b),
  Array.from({ length: 96 }, (_, index) => index),
);
assert.equal(
  coordinator.snapshot().admissions.filter(row => row.jobId.startsWith('bulk-')).length,
  96,
  'the coordinator must not hide or truncate retained admissions',
);

console.log('inference coordinator contracts passed');
